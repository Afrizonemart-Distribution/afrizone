import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { tiersToArray } from "../types";
import { notifyWorker } from "../services/push";
import { userActor } from "../util/audit";
import { assignWorker } from "../services/assignment";
import {
  blockingBlockers,
  decide,
  isEnforcing,
  loadTaskRequirements,
  loadWorkerProfile,
} from "../services/eligibility";

const router = Router();

// GET /api/applications?status=APPLIED → joined with worker + task
// Admin-only: the worker's own view is GET /api/me/applications, already scoped.
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const apps = await prisma.application.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { worker: true, task: true },
  });
  res.json(
    apps.map((a) => ({
      id: a.id,
      taskId: a.taskId,
      workerId: a.workerId,
      pitch: a.pitch,
      status: a.status,
      reason: a.reason,
      createdAt: a.createdAt,
      worker: {
        id: a.worker.id,
        name: a.worker.name,
        tiers: tiersToArray(a.worker.tiers),
        kycStatus: a.worker.kycStatus,
        rating: a.worker.rating,
      },
      task: { id: a.task.id, title: a.task.title },
    }))
  );
});

/**
 * POST /api/applications - worker applies for a task. Acting worker = req.user.id.
 *
 * Guards: task exists and is OPEN, deadline not passed, no duplicate, and the
 * worker meets the task requirements.
 *
 * The hand-rolled tier check that used to live here is gone. It is now one
 * blocker among several, produced by services/eligibility, so this endpoint and
 * the card the worker tapped cannot drift apart. A card promising "you qualify"
 * and a server that then refuses is the one failure this feature must not have.
 */
router.post("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const workerId = req.user!.id;
  const { taskId, pitch } = req.body || {};
  if (!taskId) return res.status(400).json({ error: "taskId is required" });

  const task = await prisma.task.findUnique({ where: { id: String(taskId) } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (task.status !== "OPEN") return res.status(400).json({ error: "Task is not open for applications" });
  if (new Date(task.deadline).getTime() < Date.now()) {
    return res.status(400).json({ error: "Application deadline has passed" });
  }

  // Duplicate check BEFORE the requirements check. A worker who already applied
  // and has since let a credential lapse should be told they already applied,
  // not handed a list of things to fix for an application they cannot make a
  // second time anyway.
  const duplicate = await prisma.application.findFirst({ where: { taskId: task.id, workerId } });
  if (duplicate) return res.status(409).json({ error: "You have already applied to this task" });

  const [profile, requirements, enforcing] = await Promise.all([
    loadWorkerProfile(prisma, workerId),
    loadTaskRequirements(prisma, [task]),
    isEnforcing(prisma),
  ]);
  if (!profile) return res.status(404).json({ error: "Tasker not found" });

  const reqs = requirements.get(task.id)!;
  const eligibility = decide(profile, reqs);
  const blocking = blockingBlockers(eligibility.blockers, enforcing);
  if (blocking.length > 0) {
    return res.status(400).json({
      // The first blocker is the headline the app shows; the array is what it
      // renders as a checklist, each row carrying a route to fix that one.
      error: blocking[0].message,
      blockers: blocking,
      eligibility,
    });
  }

  const created = await prisma.application.create({
    data: { taskId: task.id, workerId, pitch: pitch ? String(pitch) : null, status: "APPLIED" },
  });
  res.status(201).json(created);
});

// POST /api/applications/:id/approve → bump task filled; if full → task FILLED
// Admin-only. Approving flips the task to FILLED and auto-creates a signed
// contract, so an unguarded version let a worker onboard themselves onto any
// task by approving their own application.
//
// The body of this used to live here. It is now services/assignment.ts, shared
// with the courier self-claim route, because a delivery a rider takes and an
// application an admin approves have to produce the same contract, the same
// commitment and the same order status - and two copies of that would drift.
router.post("/:id/approve", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const app = await prisma.application.findUnique({ where: { id: req.params.id }, include: { task: true } });
  if (!app) return res.status(404).json({ error: "Application not found" });
  if (app.status === "APPROVED") return res.status(400).json({ error: "Application already approved" });

  // An admin may still approve someone the gate refuses. They can see context
  // the rules cannot, and a platform where a human can never override is a
  // platform that strands people. But they have to say so explicitly, and the
  // override is audited: refusing silently and refusing unoverridably are both
  // worse than refusing loudly.
  const result = await assignWorker({
    taskId: app.taskId,
    workerId: app.workerId,
    applicationId: app.id,
    actor: userActor(req.user!.id),
    source: "ADMIN_APPROVAL",
    override: req.body?.override === true,
  });

  if (!result.ok) {
    return res.status(result.status).json({
      error: result.error,
      ...(result.blockers ? { blockers: result.blockers } : {}),
      ...(result.eligibility ? { eligibility: result.eligibility } : {}),
      ...(result.requiresOverride ? { requiresOverride: true } : {}),
    });
  }

  const updated = await prisma.application.findUnique({ where: { id: result.applicationId } });
  res.json(updated);
});

// POST /api/applications/:id/reject → body {reason}
router.post("/:id/reject", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const { reason } = req.body || {};
  const app = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!app) return res.status(404).json({ error: "Application not found" });

  const appWithTask = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: { task: true },
  });

  const updated = await prisma.application.update({
    where: { id: app.id },
    data: { status: "REJECTED", reason: reason ?? null },
  });

  // Notify worker: not selected this time
  if (appWithTask) {
    await notifyWorker(
      prisma,
      app.workerId,
      "Application update",
      `Your application for "${appWithTask.task.title}" was not selected this time. Keep applying!`,
      { screen: "tasks" },
      "notifTasks"
    );
  }

  res.json(updated);
});

export default router;
