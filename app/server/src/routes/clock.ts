import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../auth";
import { ClockType, CLOCK_TYPES } from "../types";
import { requireAssignedTask } from "../util/assignment";

import { transitionContract, type ContractState } from "../services/contractState";
// Shared with the store map: two copies of a distance function is how two
// parts of a dispatch system come to disagree about whether a courier is near
// a shop.
import { haversineMetres } from "../util/geo";
import { userActor, type AuditActor } from "../util/audit";
import { claimClockPhoto } from "../services/evidence";
import { clockTime } from "../services/clockTime";

const router = Router();

/**
 * Advance the contract that binds this worker to this task, if there is one.
 *
 * Best-effort and deliberately silent on failure. These calls sit alongside the
 * action that already succeeded - a clock-in has happened, a timesheet is
 * approved - and refusing that action because a lifecycle row would not move
 * would be trading a real outcome for a bookkeeping one. An illegal transition
 * here means the contract was already further along, which is not an error the
 * person in front of us can do anything about.
 *
 * The transition itself is still audited; only the failure is swallowed.
 */
async function advanceContract(
  taskId: string,
  workerId: string,
  to: ContractState,
  actor: AuditActor,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const contract = await prisma.contract.findFirst({
    where: { taskId, workerId },
    select: { id: true },
  });
  if (!contract) return;
  await transitionContract(prisma, contract.id, to, actor, meta);
}



// GEOFENCE DECISION (applied per clock event):
//   - REMOTE task                                → withinFence = true  (no zone)
//   - PHYSICAL task, task has lat/lng, worker has coords
//                                                → haversine check vs task.geofenceRadius
//   - PHYSICAL task, task has lat/lng, no worker coords
//                                                → withinFence = false (can't verify)
//   - PHYSICAL task, task has NO lat/lng         → withinFence = true  (zone not configured)

/** The answer to a clock event, also given again for a resend of one. */
async function clockAnswer(event: { workerId: string; taskId: string; type: string; createdAt: Date }) {
  // clockedIn reflects the latest event for this task by this worker.
  const clockedIn = event.type === "IN";
  let elapsedSeconds = 0;
  if (clockedIn) {
    elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(event.createdAt).getTime()) / 1000));
  } else {
    // On OUT, report elapsed since the matching prior IN, if any.
    const lastIn = await prisma.clockEvent.findFirst({
      where: { workerId: event.workerId, taskId: event.taskId, type: "IN", createdAt: { lte: event.createdAt } },
      orderBy: { createdAt: "desc" },
    });
    if (lastIn) {
      elapsedSeconds = Math.max(
        0,
        Math.floor((new Date(event.createdAt).getTime() - new Date(lastIn.createdAt).getTime()) / 1000)
      );
    }
  }
  return { clockedIn, elapsedSeconds };
}

// POST /api/clock → body {taskId, type:"IN"|"OUT", lat?, lng?, occurredAt?, clientId?}.
// Acting worker = req.user.id. → {event, clockedIn, elapsedSeconds}.
//
// occurredAt and clientId are how a clock event made without signal arrives
// later (services/clockTime.ts): the time it was tapped, and the phone's id
// for it so that sending it twice records it once.
router.post("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const workerId = req.user!.id;
  const { taskId, type, lat, lng, note } = req.body || {};
  if (!taskId) return res.status(400).json({ error: "taskId is required" });
  if (!CLOCK_TYPES.includes(type as ClockType)) {
    return res.status(400).json({ error: 'type must be "IN" or "OUT"' });
  }
  const clientId =
    typeof req.body?.clientId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(req.body.clientId)
      ? (req.body.clientId as string)
      : null;
  if (clientId) {
    const seen = await prisma.clockEvent.findUnique({ where: { workerId_clientId: { workerId, clientId } } });
    if (seen) return res.status(200).json({ event: seen, ...(await clockAnswer(seen)) });
  }

  // Clocking in is only meaningful on a task this worker was actually given.
  const assignment = await requireAssignedTask(workerId, taskId);
  if (!assignment.ok) return res.status(assignment.status).json({ error: assignment.error });
  const { task } = assignment;

  // Hourly on-site work clocks with a fresh photo each time (services/
  // evidence.ts). The app uploads it first and passes its id here.
  const photo = await claimClockPhoto(task, workerId, type as ClockType, req.body?.evidenceId);
  if (!photo.ok) {
    return res.status(400).json({ error: photo.error, code: photo.code, stage: photo.stage });
  }

  const hasWorkerCoords = lat != null && lng != null;
  const hasTaskCoords = task.lat != null && task.lng != null;
  let withinFence: boolean;
  if (task.locationType === "REMOTE") {
    withinFence = true;
  } else if (!hasTaskCoords) {
    withinFence = true; // geofence not configured for this task
  } else if (!hasWorkerCoords) {
    withinFence = false; // task has a zone but worker didn't share location
  } else {
    const dist = haversineMetres(Number(lat), Number(lng), task.lat!, task.lng!);
    withinFence = dist <= task.geofenceRadius;
  }

  // Clocking IN is what actually starts the work, so it is the transition out of
  // CLAIMED. Clocking OUT does not end anything - a worker clocks out for the
  // day and back in tomorrow, and it is submitting the timesheet that says the
  // job is done.
  const now = new Date();
  const previous = await prisma.clockEvent.findFirst({
    where: { workerId, taskId: task.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const when = clockTime(req.body?.occurredAt, now, previous?.createdAt ?? null);

  let event;
  try {
    event = await prisma.clockEvent.create({
      data: {
        workerId,
        taskId: task.id,
        type: type as ClockType,
        lat: hasWorkerCoords ? Number(lat) : null,
        lng: hasWorkerCoords ? Number(lng) : null,
        withinFence,
        note: note != null ? String(note) : null,
        createdAt: when.at,
        receivedAt: now,
        recordedOffline: when.offline,
        clientId,
      },
    });
  } catch (e) {
    // Two copies of the same queued event arriving together: the second
    // loses the race on the unique index and answers with the first.
    const seen = clientId
      ? await prisma.clockEvent.findUnique({ where: { workerId_clientId: { workerId, clientId } } })
      : null;
    if (!seen) throw e;
    return res.status(200).json({ event: seen, ...(await clockAnswer(seen)) });
  }

  if (photo.evidenceId) {
    await prisma.evidence.update({ where: { id: photo.evidenceId }, data: { clockEventId: event.id } });
  }

  if (event.type === "IN") {
    await advanceContract(task.id, workerId, "IN_PROGRESS", userActor(workerId), {
      via: "clock-in",
      clockEventId: event.id,
    });
  }

  res.status(201).json({ event, ...(await clockAnswer(event)) });
});

export default router;
