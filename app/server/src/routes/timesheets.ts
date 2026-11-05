import { Router, Response } from "express";
import { payCrew, submitCrew } from "../services/crew";
import { prisma } from "../prisma";
import { requireEvidence } from "../services/evidence";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { requireAssignedTask } from "../util/assignment";
import { tiersToArray } from "../types";
import { computeWht } from "../util/tax";

import { transitionContract, type ContractState } from "../services/contractState";
import { releaseForContract } from "../services/commitments";
import { userActor, writeAudit, type AuditActor } from "../util/audit";
import { readCriteria } from "../services/proof";
import { notifyWorker } from "../services/push";

const router = Router();

/**
 * Advance the contract binding this worker to this task, if there is one.
 *
 * Best-effort and deliberately silent on failure. These calls sit alongside an
 * action that already succeeded - a timesheet is approved, a payment released -
 * and refusing that action because a lifecycle row would not move would trade a
 * real outcome for a bookkeeping one. An illegal transition here means the
 * contract was already further along, which is not something the person in
 * front of us can act on. The transition itself is still audited; only the
 * failure is swallowed.
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


const SLA_HOURS = 48; // 24–48h SLA per design spec; use 48h ceiling.

// GET /api/timesheets?status=SUBMITTED → joined w/ worker + task + slaHoursLeft
// Admin-only: the worker's own view is GET /api/me/timesheets, already scoped.
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const sheets = await prisma.timesheet.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { worker: true, task: true },
  });
  // The clock events behind each sheet, summarised: how many there were and
  // how many arrived late from a phone without signal, whose times are the
  // phone's (services/clockTime.ts). One query for the page, not one a row.
  const events = sheets.length
    ? await prisma.clockEvent.findMany({
        where: {
          taskId: { in: [...new Set(sheets.map((t) => t.taskId))] },
          workerId: { in: [...new Set(sheets.map((t) => t.workerId))] },
        },
        select: { workerId: true, taskId: true, createdAt: true, recordedOffline: true, withinFence: true },
      })
    : [];
  const clockFor = (t: (typeof sheets)[number]) => {
    const mine = events.filter(
      (e) =>
        e.workerId === t.workerId &&
        e.taskId === t.taskId &&
        e.createdAt >= t.periodStart &&
        e.createdAt <= t.periodEnd
    );
    return {
      events: mine.length,
      offline: mine.filter((e) => e.recordedOffline).length,
      outsideFence: mine.filter((e) => !e.withinFence).length,
    };
  };
  const now = Date.now();
  res.json(
    sheets.map((t) => {
      const elapsedH = (now - new Date(t.createdAt).getTime()) / 3_600_000;
      const slaHoursLeft = Math.max(0, Math.round(SLA_HOURS - elapsedH));
      return {
        id: t.id,
        taskId: t.taskId,
        workerId: t.workerId,
        periodStart: t.periodStart,
        periodEnd: t.periodEnd,
        hours: t.hours,
        units: t.units,
        acceptedUnits: t.acceptedUnits,
        note: t.note,
        reviewNote: t.reviewNote,
        status: t.status,
        gpsNote: t.gpsNote,
        createdAt: t.createdAt,
        slaHoursLeft,
        clock: clockFor(t),
        worker: {
          id: t.worker.id,
          name: t.worker.name,
          tiers: tiersToArray(t.worker.tiers),
          kycStatus: t.worker.kycStatus,
          rating: t.worker.rating,
        },
        task: {
          id: t.task.id,
          title: t.task.title,
          payModel: t.task.payModel,
          rate: t.task.rate,
          budget: t.task.budget,
          unitLabel: t.task.unitLabel,
          acceptanceCriteria: readCriteria(t.task.acceptanceCriteria),
        },
      };
    })
  );
});

// POST /api/timesheets → worker submits a timesheet (status SUBMITTED).
// Acting worker = req.user.id; never trust a workerId from the body.
router.post("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const workerId = req.user!.id;
  const { taskId, periodStart, periodEnd, hours, units, note } = req.body || {};
  if (!taskId || !periodStart || !periodEnd) {
    return res.status(400).json({ error: "taskId, periodStart and periodEnd are required" });
  }
  // Hours can only be billed against a task this worker was actually given.
  // Approving a timesheet mints a Payment, so an unassigned row reaching the
  // admin queue is a payout request that looks exactly like a real one.
  const assignment = await requireAssignedTask(workerId, taskId);
  if (!assignment.ok) return res.status(assignment.status).json({ error: assignment.error });
  const { task } = assignment;

  // PER_UNIT work is handed in as a count; hours are optional there and
  // required everywhere else, as before.
  let unitsNum: number | null = null;
  let hoursNum = 0;
  if (task.payModel === "PER_UNIT") {
    unitsNum = Number(units);
    if (!Number.isInteger(unitsNum) || unitsNum < 1) {
      return res.status(400).json({ error: `Say how many ${task.unitLabel ?? "units"} you are handing in` });
    }
    if (task.maxUnits != null && unitsNum > task.maxUnits) {
      return res.status(400).json({ error: `This task takes at most ${task.maxUnits} ${task.unitLabel ?? "units"} per person` });
    }
    if (hours != null && hours !== "") {
      hoursNum = Number(hours);
      if (!Number.isFinite(hoursNum) || hoursNum < 0) return res.status(400).json({ error: "hours must be a number" });
    }
  } else {
    if (hours == null) return res.status(400).json({ error: "hours is required" });
    hoursNum = Number(hours);
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
      return res.status(400).json({ error: "hours must be a positive number" });
    }
  }
  const noteText = typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null;

  // One hand-in waiting at a time, and none once the work is approved. Before
  // this, a second hand-in on a fixed-price task could be approved too and
  // pay the whole budget twice.
  const contract = await prisma.contract.findFirst({
    where: { taskId: task.id, workerId },
    select: { id: true, status: true },
  });
  if (contract && ["VERIFIED", "PAID", "CLOSED", "CANCELLED", "DISPUTED"].includes(contract.status)) {
    return res.status(409).json({ error: "This work has already been handed in and decided", code: "ALREADY_DECIDED" });
  }
  const waiting = await prisma.timesheet.findFirst({
    where: { taskId: task.id, workerId, status: "SUBMITTED" },
    select: { id: true },
  });
  if (waiting) {
    return res.status(409).json({ error: "Your last hand-in is still being checked", code: "AWAITING_REVIEW" });
  }

  // Field and media work is handed in with a photo of the result.
  const shown = await requireEvidence(task, workerId, "WORK");
  if (!shown.ok) return res.status(400).json(shown);

  const created = await prisma.timesheet.create({
    data: {
      taskId: task.id,
      workerId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      hours: hoursNum,
      units: unitsNum,
      note: noteText,
      status: "SUBMITTED",
    },
  });

  // Handing in a timesheet is the Tasker saying the work is done - Blueprint
  // §4.2's Submitted. Clocking out does not mean this: a worker clocks out for
  // the day and back in tomorrow.
  //
  // Work with no clock-in (remote, fixed-price) is still CLAIMED here, and
  // work that was sent back is in REWORK; both pass through IN_PROGRESS, the
  // only legal way to SUBMITTED.
  if (contract && (contract.status === "CLAIMED" || contract.status === "REWORK")) {
    await advanceContract(task.id, workerId, "IN_PROGRESS", userActor(workerId), {
      via: "timesheet-submitted",
      timesheetId: created.id,
    });
  }
  await advanceContract(task.id, workerId, "SUBMITTED", userActor(workerId), {
    via: "timesheet-submitted",
    timesheetId: created.id,
  });

  // A crew lead hands in for the whole crew (services/crew.ts).
  const leadContract = await prisma.contract.findFirst({
    where: { taskId: task.id, workerId },
    select: { id: true },
  });
  if (leadContract) {
    await submitCrew(leadContract.id, userActor(workerId), { timesheetId: created.id });
  }

  res.status(201).json(created);
});

// POST /api/timesheets/:id/approve → creates a Payment (status APPROVED),
// gross = hours*task.rate (HOURLY) or task.budget (FIXED).
// Admin-only. This is the money-minting endpoint: approving a timesheet
// creates the Payment row (gross = hours * rate). A worker submits their own
// hours, so letting them also approve was a complete self-serve payout chain.
router.post("/:id/approve", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const sheet = await prisma.timesheet.findUnique({ where: { id: req.params.id }, include: { task: true } });
  if (!sheet) return res.status(404).json({ error: "Timesheet not found" });
  if (sheet.status === "APPROVED") return res.status(400).json({ error: "Timesheet already approved" });
  if (sheet.status !== "SUBMITTED" && sheet.status !== "DISPUTED") {
    return res.status(409).json({ error: "Only work waiting to be checked can be approved" });
  }

  const task = sheet.task;
  const b = req.body || {};

  // Every acceptance check, confirmed by the person approving. Sent as the
  // list of confirmed sentences; anything short of all of them is refused.
  const criteria = readCriteria(task.acceptanceCriteria);
  const confirmed: string[] = Array.isArray(b.checks) ? b.checks.filter((x: unknown) => typeof x === "string") : [];
  const unconfirmed = criteria.filter((c) => !confirmed.includes(c));
  if (unconfirmed.length > 0) {
    return res.status(400).json({
      error: `Confirm every acceptance check first: ${unconfirmed[0]}`,
      code: "CHECKS_INCOMPLETE",
      unconfirmed,
    });
  }

  // PER_UNIT: the reviewer says how many units they accept, never more than
  // were handed in. Defaults to all of them.
  let acceptedUnits: number | null = null;
  if (task.payModel === "PER_UNIT") {
    const claimed = sheet.units ?? 0;
    acceptedUnits = b.acceptedUnits === undefined || b.acceptedUnits === null ? claimed : Number(b.acceptedUnits);
    if (!Number.isInteger(acceptedUnits) || acceptedUnits < 1 || acceptedUnits > claimed) {
      return res.status(400).json({
        error: `Accept between 1 and ${claimed} ${task.unitLabel ?? "units"}, or send it back instead`,
      });
    }
  }

  // A fixed price is paid once per person, whatever is handed in.
  if (task.payModel === "FIXED") {
    const paid = await prisma.payment.findFirst({
      where: { taskId: sheet.taskId, workerId: sheet.workerId },
      select: { id: true },
    });
    if (paid) {
      return res.status(409).json({ error: "This person has already been paid for this task", code: "ALREADY_PAID" });
    }
  }
  const reviewNote = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
  // A crew lead's contract carries their own share; the rest of the budget is
  // paid to the members below, each in their own Payment.
  const contractRow = await prisma.contract.findFirst({
    where: { taskId: sheet.taskId, workerId: sheet.workerId },
    select: { id: true, share: true },
  });
  let gross: number;
  if (task.payModel === "FIXED") {
    gross = contractRow?.share ?? task.budget ?? 0;
  } else if (task.payModel === "PER_UNIT") {
    gross = (acceptedUnits ?? 0) * (task.rate ?? 0);
  } else {
    gross = Math.round(sheet.hours * (task.rate ?? 0));
  }
  const whtRate = 0.05;
  const { whtAmount, net } = computeWht(gross, whtRate);

  // ARRAY FORM, NOT THE CALLBACK FORM. D1 does not support interactive
  // transactions at all - `$transaction(async tx => ...)` throws outright - so
  // the callback version meant this endpoint could never run in production.
  // Approving a timesheet is what mints a Payment, so nothing was payable.
  //
  // Neither statement depends on the other's result, so the batch form is a
  // straight swap and keeps the two writes atomic: a timesheet marked approved
  // with no Payment behind it is a worker who did the work and is owed nothing
  // on paper.
  const [updatedSheet, payment] = await prisma.$transaction([
    prisma.timesheet.update({
      where: { id: sheet.id },
      data: {
        status: "APPROVED",
        acceptedUnits,
        reviewNote,
        checks: criteria.length ? JSON.stringify(criteria) : null,
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
      },
    }),
    prisma.payment.create({
      data: {
        workerId: sheet.workerId,
        taskId: sheet.taskId,
        gross,
        whtRate,
        whtAmount,
        net,
        status: "APPROVED",
        approvedById: req.user!.id,
      },
    }),
  ]);
  const result = { updatedSheet, payment };

  // Acceptance releases the ring-fence, and this is where an hourly commitment
  // finally gets its number - taken from what was actually verified rather than
  // from anything estimated at the start.
  const liveContract = await prisma.contract.findFirst({
    where: { taskId: sheet.taskId, workerId: sheet.workerId },
    select: { id: true },
  });
  if (liveContract) {
    await releaseForContract(liveContract.id, result.payment.net, userActor(req.user!.id));
  }

  // Acceptance criteria met, so money becomes owed. VERIFIED is the state the
  // Payment hangs off - it is created in the same transaction above.
  await advanceContract(sheet.taskId, sheet.workerId, "VERIFIED", userActor(req.user!.id), {
    via: "timesheet-approved",
    timesheetId: sheet.id,
    paymentId: result.payment.id,
  });

  const crewPayments = liveContract
    ? await payCrew(liveContract.id, sheet.taskId, userActor(req.user!.id), { timesheetId: sheet.id })
    : [];

  res.json({
    ...result.updatedSheet,
    payment: result.payment,
    ...(crewPayments.length > 0 ? { crewPayments } : {}),
  });
});

/**
 * POST /api/timesheets/:id/rework {reason} -> send the work back.
 *
 * The reason is required and goes to the worker: "not good enough" with no
 * reason is a dispute waiting to happen. They fix it and hand in again, which
 * makes a new timesheet; this one stays as the record of the round.
 */
router.post("/:id/rework", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  if (!reason) return res.status(400).json({ error: "Say what needs fixing" });
  const sheet = await prisma.timesheet.findUnique({ where: { id: req.params.id }, include: { task: true } });
  if (!sheet) return res.status(404).json({ error: "Timesheet not found" });
  if (sheet.status !== "SUBMITTED") {
    return res.status(409).json({ error: "Only work waiting to be checked can be sent back" });
  }

  const updated = await prisma.timesheet.update({
    where: { id: sheet.id },
    data: { status: "REWORK", reviewNote: reason, reviewedById: req.user!.id, reviewedAt: new Date() },
  });
  await advanceContract(sheet.taskId, sheet.workerId, "REWORK", userActor(req.user!.id), {
    via: "timesheet-rework",
    timesheetId: sheet.id,
  });
  await writeAudit(userActor(req.user!.id), "timesheet.rework", "Timesheet", sheet.id, { reason });
  await notifyWorker(
    prisma,
    sheet.workerId,
    "Your work needs another look",
    `${sheet.task.title}: ${reason}`,
    { screen: "active", taskId: sheet.taskId },
    "notifTasks"
  ).catch(() => {});
  res.json(updated);
});

// POST /api/timesheets/:id/dispute → body {reason}
router.post("/:id/dispute", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const { reason } = req.body || {};
  const sheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
  if (!sheet) return res.status(404).json({ error: "Timesheet not found" });

  const updated = await prisma.timesheet.update({
    where: { id: sheet.id },
    data: { status: "DISPUTED", gpsNote: reason ? `DISPUTE: ${reason}` : sheet.gpsNote },
  });
  res.json(updated);
});

export default router;
