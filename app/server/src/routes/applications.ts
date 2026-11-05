import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { tiersToArray } from "../types";
import { notifyWorker } from "../services/push";
import { userActor } from "../util/audit";
import { assignWorker } from "../services/assignment";
import { rankApplications, type ApplicantRank } from "../services/applicantRanking";
import { loadStandings } from "../services/standing";
import { assignCrew, checkCrewForApproval, inviteCrew, resolveCrew } from "../services/crew";
import {
  blockingBlockers,
  decide,
  isEnforcing,
  loadTaskRequirements,
  loadWorkerProfile,
} from "../services/eligibility";
import { readAnswers, readQuestions, validateAnswers } from "../services/taskQuestions";

const router = Router();

// GET /api/applications?status=APPLIED&taskId=... → joined with worker + task
// Admin-only: the worker's own view is GET /api/me/applications, already scoped.
//
// Pending applications carry a `rank` (services/applicantRanking.ts) and come
// back grouped by task - the task with the newest application first - and best
// applicant first within each. Decided ones keep newest-first and `rank: null`.
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const taskId = req.query.taskId ? String(req.query.taskId) : undefined;
  const apps = await prisma.application.findMany({
    where: { ...(status ? { status } : {}), ...(taskId ? { taskId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      worker: true,
      task: true,
      crewInvites: { include: { worker: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });

  // NEVER FATAL, like the delivery ranking: a queue without an order is the
  // queue as it always was, and one that fails to load is not.
  let ranks = new Map<string, ApplicantRank>();
  try {
    ranks = await rankApplications(apps.filter((a) => a.status === "APPLIED"));
  } catch (e) {
    console.error(`[applicantRanking] ${e instanceof Error ? e.message : String(e)}`);
  }

  // Display only: the rank above does not read it. See services/standing.ts.
  const standings = await loadStandings([...new Map(apps.map((a) => [a.worker.id, a.worker])).values()]);

  // findMany is newest-first, so a task's first appearance is its newest application.
  const taskOrder = new Map<string, number>();
  apps.forEach((a) => {
    if (!taskOrder.has(a.taskId)) taskOrder.set(a.taskId, taskOrder.size);
  });
  const slot = (a: (typeof apps)[number]) => {
    const r = ranks.get(a.id);
    return r ? (r.position ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  };
  const ordered = apps
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        taskOrder.get(x.a.taskId)! - taskOrder.get(y.a.taskId)! ||
        slot(x.a) - slot(y.a) ||
        x.i - y.i
    )
    .map((x) => x.a);

  res.json(
    ordered.map((a) => ({
      id: a.id,
      taskId: a.taskId,
      workerId: a.workerId,
      pitch: a.pitch,
      answers: readAnswers(a.answers),
      status: a.status,
      reason: a.reason,
      createdAt: a.createdAt,
      rank: ranks.get(a.id) ?? null,
      // Null when applying alone. The manager approves the crew as one, and
      // only once every member has accepted their share.
      crew:
        a.crewLeadShare == null
          ? null
          : {
              leadShare: a.crewLeadShare,
              ready: a.crewInvites.every((i) => i.status === "ACCEPTED"),
              members: a.crewInvites.map((i) => ({
                workerId: i.workerId,
                name: i.worker.name,
                share: i.share,
                status: i.status,
              })),
            },
      worker: {
        id: a.worker.id,
        name: a.worker.name,
        tiers: tiersToArray(a.worker.tiers),
        kycStatus: a.worker.kycStatus,
        rating: a.worker.rating,
        standing: standings.get(a.worker.id) ?? null,
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

  // The task's own questions. Checked after eligibility, so a worker who
  // cannot take the task is not asked to fill anything in first.
  const answers = validateAnswers(readQuestions(task.questions), req.body?.answers);
  if (!answers.ok) return res.status(400).json({ error: answers.error, code: "ANSWERS_INVALID" });

  // A crew, when the lead brings one. Everybody named is checked before
  // anything is written, so a refusal leaves nothing half-made.
  const crewBody = req.body?.crew;
  let crew: { leadShare: number; members: { workerId: string; name: string; share: number }[] } | null = null;
  if (crewBody) {
    const proposal = {
      leadShare: Number(crewBody.leadShare),
      members: Array.isArray(crewBody.members)
        ? crewBody.members.map((m: any) => ({ phone: String(m?.phone ?? ""), share: Number(m?.share) }))
        : [],
    };
    const resolved = await resolveCrew(task, workerId, proposal);
    if (!resolved.ok) {
      return res.status(resolved.status).json({
        error: resolved.error,
        ...(resolved.blockers ? { blockers: resolved.blockers } : {}),
      });
    }
    crew = { leadShare: proposal.leadShare, members: resolved.members };
  }

  const created = await prisma.application.create({
    data: {
      taskId: task.id,
      workerId,
      pitch: pitch ? String(pitch) : null,
      answers: answers.value.length ? JSON.stringify(answers.value) : null,
      status: "APPLIED",
      crewLeadShare: crew ? crew.leadShare : null,
    },
  });
  if (crew) {
    await inviteCrew(created.id, task, { id: workerId, name: profile.name }, crew.members);
  }
  res.status(201).json({
    ...created,
    answers: readAnswers(created.answers),
    crew: crew ? crew.members.map((m) => ({ workerId: m.workerId, name: m.name, share: m.share, status: "INVITED" })) : null,
  });
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
  // A crew is approved as one, and only once every member has said yes to
  // their share and still qualifies. See services/crew.ts.
  const crewProblem = await checkCrewForApproval(app.id, app.task);
  if (crewProblem) {
    return res.status(crewProblem.status).json({
      error: crewProblem.error,
      ...(crewProblem.blockers ? { blockers: crewProblem.blockers } : {}),
    });
  }

  const result = await assignWorker({
    taskId: app.taskId,
    workerId: app.workerId,
    applicationId: app.id,
    actor: userActor(req.user!.id),
    source: "ADMIN_APPROVAL",
    override: req.body?.override === true,
    share: app.crewLeadShare ?? undefined,
  });

  if (!result.ok) {
    return res.status(result.status).json({
      error: result.error,
      ...(result.blockers ? { blockers: result.blockers } : {}),
      ...(result.eligibility ? { eligibility: result.eligibility } : {}),
      ...(result.requiresOverride ? { requiresOverride: true } : {}),
    });
  }

  if (app.crewLeadShare != null) {
    await assignCrew(app.id, result.contractId, app.task, userActor(req.user!.id));
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
