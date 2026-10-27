import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, isAdmin, AuthedRequest } from "../auth";
import { tiersToArray, TIERS } from "../types";
import { userActor, writeAudit } from "../util/audit";
import {
  decide,
  loadTaskRequirements,
  loadWorkerProfile,
  loadWorkerProfiles,
  summarise,
  type TaskRequirements,
} from "../services/eligibility";

const router = Router();

/**
 * Applicant and filled counts for many tasks in ONE query.
 *
 * This replaced two counts per task. The list endpoint ran 2N+1 queries against
 * D1, which is a network round trip each - forty open tasks meant eighty-one
 * of them before a byte reached the phone. Tallying in JS is not a
 * micro-optimisation here; it is the difference between a feed that loads and
 * one that times out.
 */
async function countsFor(taskIds: string[]) {
  const counts = new Map<string, { filledCount: number; applicantCount: number }>();
  for (const id of taskIds) counts.set(id, { filledCount: 0, applicantCount: 0 });
  if (taskIds.length === 0) return counts;
  const rows = await prisma.application.findMany({
    where: { taskId: { in: taskIds } },
    select: { taskId: true, status: true },
  });
  for (const r of rows) {
    const c = counts.get(r.taskId);
    if (!c) continue;
    c.applicantCount += 1;
    if (r.status === "APPROVED") c.filledCount += 1;
  }
  return counts;
}

/** Single-task convenience over the batch version, for create/update responses. */
async function withCounts(task: any) {
  const counts = await countsFor([task.id]);
  return { ...task, ...counts.get(task.id)! };
}

/** The requirements block every task response carries, gated or not. */
function requirementsPayload(req: TaskRequirements) {
  return {
    requiresIdentityVerified: req.requiresIdentityVerified,
    skills: req.skills,
    credentialTypes: req.credentialTypes,
    version: req.version,
  };
}

/**
 * Validate requirement ids against the catalogue and reject unknown ones.
 *
 * Up front, before the task is written, so an FK violation can never land
 * halfway through. Retired (inactive) entries are refused too: an admin
 * building a task today must not be able to gate it behind a skill no worker
 * can add any more.
 */
async function resolveRequirementIds(
  skillIds: string[],
  credentialTypeIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (skillIds.length) {
    const found = await prisma.skill.findMany({
      where: { id: { in: skillIds }, active: true },
      select: { id: true },
    });
    if (found.length !== skillIds.length) {
      return { ok: false, error: "One or more skills are unknown or no longer offered" };
    }
  }
  if (credentialTypeIds.length) {
    const found = await prisma.credentialType.findMany({
      where: { id: { in: credentialTypeIds }, active: true },
      select: { id: true },
    });
    if (found.length !== credentialTypeIds.length) {
      return { ok: false, error: "One or more documents are unknown or no longer accepted" };
    }
  }
  return { ok: true };
}

/** Body -> a clean, de-duplicated id list, or null when the caller did not send the field at all. */
function idList(raw: unknown): string[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

/**
 * Replace a task's requirement rows and refresh its denormalised summary.
 *
 * deleteMany + createMany per table inside one $transaction. D1 does not
 * support interactive transactions, but the array form batches into a single
 * request, which is what keeps a half-written gate off the table.
 */
async function writeRequirements(
  taskId: string,
  skillIds: string[],
  credentialTypeIds: string[],
  requiresIdentityVerified: boolean,
  bumpVersion: boolean
) {
  const ops: any[] = [
    prisma.taskSkillRequirement.deleteMany({ where: { taskId } }),
    prisma.taskCredentialRequirement.deleteMany({ where: { taskId } }),
  ];
  if (skillIds.length) {
    ops.push(
      prisma.taskSkillRequirement.createMany({
        data: skillIds.map((skillId) => ({ taskId, skillId })),
      })
    );
  }
  if (credentialTypeIds.length) {
    ops.push(
      prisma.taskCredentialRequirement.createMany({
        data: credentialTypeIds.map((credentialTypeId) => ({ taskId, credentialTypeId })),
      })
    );
  }
  await prisma.$transaction(ops);

  // Re-read rather than compose the summary from the ids we were handed: the
  // names come from the catalogue, and reading them back is also the cheapest
  // proof the rows actually landed.
  const draft = await loadTaskRequirements(prisma, [
    { id: taskId, tier: "", requiresIdentityVerified, requirementsVersion: 0 },
  ]);
  const req = draft.get(taskId)!;
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      requirementsSummary: summarise(req),
      ...(bumpVersion ? { requirementsVersion: { increment: 1 } } : {}),
    },
    select: { tier: true, requirementsVersion: true },
  });
  // The draft above was loaded with placeholder tier/version so the summary
  // could be computed before the bump. Return the real ones - the caller sends
  // this straight back to the client as the task's current requirements.
  req.tier = updated.tier;
  req.version = updated.requirementsVersion;
  return req;
}

// GET /api/tasks
// Each task augmented with filledCount, applicantCount, requirements, and -
// for a worker - their own eligibility. Constant query count regardless of N.
router.get("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const tasks = await prisma.task.findMany({ orderBy: { createdAt: "desc" } });
  const ids = tasks.map((t) => t.id);

  // Admins see requirements but not an eligibility verdict: they are not the
  // ones applying, and a verdict computed against an admin account would be
  // meaningless noise on the screen.
  const asWorker = !isAdmin(req.user?.role);
  const now = new Date();
  const [counts, requirements, profile] = await Promise.all([
    countsFor(ids),
    loadTaskRequirements(prisma, tasks),
    asWorker ? loadWorkerProfile(prisma, req.user!.id, now) : Promise.resolve(null),
  ]);

  res.json(
    tasks.map((t) => {
      const reqs = requirements.get(t.id)!;
      return {
        ...t,
        ...counts.get(t.id)!,
        requirements: requirementsPayload(reqs),
        eligibility: profile ? decide(profile, reqs) : null,
      };
    })
  );
});

// POST /api/tasks → create
// Admin-only. Guarded per-handler, NOT at the router: GET / and GET /:id below
// are the mobile app's task feed and must stay open to workers.
// createdById is attribution, not authorization - an unguarded version let a
// worker mint a task with any budget and then apply to it.
router.post("/", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const b = req.body || {};
  if (!b.title || !b.description || !b.category || !b.tier || !b.payModel) {
    return res.status(400).json({ error: "title, description, category, tier, payModel are required" });
  }
  if (b.payModel === "HOURLY" && b.rate == null) {
    return res.status(400).json({ error: "rate is required for HOURLY tasks" });
  }
  if (b.payModel === "FIXED" && b.budget == null) {
    return res.status(400).json({ error: "budget is required for FIXED tasks" });
  }

  const skillIds = idList(b.skillIds) ?? [];
  const credentialTypeIds = idList(b.credentialTypeIds) ?? [];
  const resolved = await resolveRequirementIds(skillIds, credentialTypeIds);
  if (!resolved.ok) return res.status(400).json({ error: resolved.error });

  try {
    const task = await prisma.task.create({
      data: {
        title: b.title,
        description: b.description,
        category: b.category,
        tier: b.tier,
        payModel: b.payModel,
        rate: b.rate ?? null,
        budget: b.budget ?? null,
        startDate: b.startDate ? new Date(b.startDate) : new Date(),
        endDate: b.endDate ? new Date(b.endDate) : new Date(),
        locationType: b.locationType || "PHYSICAL",
        address: b.address ?? null,
        lat: b.lat != null ? Number(b.lat) : null,
        lng: b.lng != null ? Number(b.lng) : null,
        geofenceRadius: b.geofenceRadius ?? 100,
        slots: b.slots ?? 1,
        status: b.status || "OPEN",
        deadline: b.deadline ? new Date(b.deadline) : new Date(),
        createdById: req.user!.id,
        requiresIdentityVerified: b.requiresIdentityVerified === true,
      },
    });

    let reqs: TaskRequirements;
    try {
      reqs = await writeRequirements(
        task.id,
        skillIds,
        credentialTypeIds,
        task.requiresIdentityVerified,
        false
      );
    } catch (e) {
      // A task whose requirements failed to write is an UNGATED task - the gate
      // would fail open, which is the wrong direction. Nothing can reference a
      // task created milliseconds ago, so undoing it is safe and is the only
      // outcome that does not silently publish unguarded work.
      await prisma.task.delete({ where: { id: task.id } }).catch(() => {});
      throw e;
    }

    const created = await prisma.task.findUnique({ where: { id: task.id } });
    res.status(201).json({
      ...(await withCounts(created)),
      requirements: requirementsPayload(reqs),
      eligibility: null,
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Could not create task" });
  }
});

/**
 * POST /api/tasks/qualifying-count → {total, qualifying, blockedBy[]}
 *
 * How many workers could actually take this task, for requirements that do not
 * exist yet. The admin sees the number move as they add each requirement, which
 * is the only moment the trade-off is legible - afterwards it shows up as an
 * empty applicant list a week later, with no clue which requirement caused it.
 *
 * Declared before /:id so the path can never be read as a task id.
 */
router.post(
  "/qualifying-count",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const b = req.body || {};
    if (!b.tier || !TIERS.includes(b.tier)) {
      return res.status(400).json({ error: "A valid tier is required" });
    }
    const skillIds = idList(b.skillIds) ?? [];
    const credentialTypeIds = idList(b.credentialTypeIds) ?? [];

    const [profiles, skills, credentialTypes] = await Promise.all([
      loadWorkerProfiles(prisma),
      skillIds.length
        ? prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      credentialTypeIds.length
        ? prisma.credentialType.findMany({
            where: { id: { in: credentialTypeIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const hypothetical: TaskRequirements = {
      taskId: "",
      tier: String(b.tier),
      requiresIdentityVerified: b.requiresIdentityVerified === true,
      skills,
      credentialTypes,
      version: 0,
    };

    // Which requirement is doing the excluding, counted independently. A
    // straight "3 of 40 qualify" says nothing about which line to reconsider.
    const blockedBy = new Map<string, { label: string; count: number }>();
    let qualifying = 0;
    let inTier = 0;
    for (const p of profiles) {
      const el = decide(p, hypothetical);
      if (el.eligible) qualifying += 1;
      const outOfTier = el.blockers.some((x) => x.code === "TIER");
      if (outOfTier) continue;
      inTier += 1;
      // Only workers in the tier are tallied. A line reading "6 excluded"
      // beside a pool of 2 is not a detail - it is the panel contradicting
      // itself, and the admin cannot tell which of the two numbers to trust.
      for (const blocker of el.blockers) {
        const key = `${blocker.code}:${blocker.ref ?? ""}`;
        const label = labelForBlocker(blocker.code, blocker.ref, hypothetical);
        const entry = blockedBy.get(key) ?? { label, count: 0 };
        entry.count += 1;
        blockedBy.set(key, entry);
      }
    }

    res.json({
      total: profiles.length,
      // The honest denominator. Tier is not a requirement the admin is choosing
      // in this form - it is who the task is for - so measuring the new
      // requirements against everyone would overstate their cost.
      inTier,
      qualifying,
      blockedBy: [...blockedBy.values()].sort((a, b2) => b2.count - a.count),
    });
  }
);

function labelForBlocker(code: string, ref: string | null, req: TaskRequirements): string {
  if (code === "TIER") return "Not in this tier";
  if (code === "IDENTITY") return "ID not confirmed";
  if (code === "SKILL") return req.skills.find((s) => s.id === ref)?.name ?? "Missing skill";
  const name = req.credentialTypes.find((c) => c.id === ref)?.name ?? "document";
  if (code === "CREDENTIAL_PENDING") return `${name} (being checked)`;
  if (code === "CREDENTIAL_EXPIRED") return `${name} (expired)`;
  return name;
}

/**
 * GET /api/tasks/:id/eligibility → this worker, this task, right now.
 *
 * Separate from the task payload so the mobile app can re-check after a worker
 * fixes something without re-fetching the whole task, and so the answer is
 * never served from a cached task body.
 */
router.get("/:id/eligibility", requireAuth, async (req: AuthedRequest, res: Response) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    select: { id: true, tier: true, requiresIdentityVerified: true, requirementsVersion: true },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });

  const workerId = req.user!.id;
  const [profile, requirements] = await Promise.all([
    loadWorkerProfile(prisma, workerId),
    loadTaskRequirements(prisma, [task]),
  ]);
  if (!profile) return res.status(404).json({ error: "Tasker not found" });

  const reqs = requirements.get(task.id)!;
  res.json({
    taskId: task.id,
    requirements: requirementsPayload(reqs),
    eligibility: decide(profile, reqs),
  });
});

// GET /api/tasks/:id → Task + applications (with worker summary)
router.get("/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      applications: {
        orderBy: { createdAt: "desc" },
        include: { worker: true },
      },
    },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });

  const applications = task.applications.map((a) => ({
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
  }));

  const { applications: _drop, ...taskFields } = task as any;
  const asWorker = !isAdmin(req.user?.role);
  const [counts, requirements, profile] = await Promise.all([
    withCounts(taskFields),
    loadTaskRequirements(prisma, [task]),
    asWorker ? loadWorkerProfile(prisma, req.user!.id) : Promise.resolve(null),
  ]);
  const reqs = requirements.get(task.id)!;
  const base = {
    ...counts,
    requirements: requirementsPayload(reqs),
    eligibility: profile ? decide(profile, reqs) : null,
  };

  // Workers legitimately read this route (the mobile task-detail screen), but
  // must not see who else applied - the applicant list carries other workers'
  // names, tiers, KYC status and ratings. Allow-by-list, not
  // `role === "WORKER"`: a deny-by-exception check fails open for any
  // unexpected role value.
  if (!isAdmin(req.user?.role)) return res.json(base);
  res.json({ ...base, applications });
});

// PATCH /api/tasks/:id → partial update
// Admin-only: rate, budget and status are writable here, so an unguarded
// version let any worker rewrite a task's pay before claiming it.
router.patch("/:id", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Task not found" });

  const b = req.body || {};
  const data: any = {};
  const stringFields = ["title", "description", "category", "tier", "payModel", "locationType", "address", "status"];
  for (const f of stringFields) if (b[f] !== undefined) data[f] = b[f];
  const intFields = ["rate", "budget", "geofenceRadius", "slots"];
  for (const f of intFields) if (b[f] !== undefined) data[f] = b[f];
  if (b.lat !== undefined) data.lat = b.lat != null ? Number(b.lat) : null;
  if (b.lng !== undefined) data.lng = b.lng != null ? Number(b.lng) : null;
  const dateFields = ["startDate", "endDate", "deadline"];
  for (const f of dateFields) if (b[f] !== undefined) data[f] = new Date(b[f]);
  if (b.requiresIdentityVerified !== undefined) {
    data.requiresIdentityVerified = b.requiresIdentityVerified === true;
  }

  // Requirements are touched only when the caller actually sent the fields.
  // Omitting them must leave the gate alone: a PATCH that only moves a deadline
  // should never quietly strip a task of every requirement it had.
  const skillIds = idList(b.skillIds);
  const credentialTypeIds = idList(b.credentialTypeIds);
  const touchingRequirements =
    skillIds !== null || credentialTypeIds !== null || b.requiresIdentityVerified !== undefined;

  if (skillIds !== null || credentialTypeIds !== null) {
    const resolved = await resolveRequirementIds(skillIds ?? [], credentialTypeIds ?? []);
    if (!resolved.ok) return res.status(400).json({ error: resolved.error });
  }

  const task = await prisma.task.update({ where: { id: req.params.id }, data });

  let reqs: TaskRequirements;
  if (touchingRequirements) {
    // Whichever side the caller omitted is carried over unchanged, so a PATCH
    // that adds a credential requirement does not drop the skill requirements.
    let currentSkillIds: string[];
    if (skillIds !== null) {
      currentSkillIds = skillIds;
    } else {
      const rows = await prisma.taskSkillRequirement.findMany({
        where: { taskId: task.id },
        select: { skillId: true },
      });
      currentSkillIds = rows.map((r) => r.skillId);
    }
    let currentCredIds: string[];
    if (credentialTypeIds !== null) {
      currentCredIds = credentialTypeIds;
    } else {
      const rows = await prisma.taskCredentialRequirement.findMany({
        where: { taskId: task.id },
        select: { credentialTypeId: true },
      });
      currentCredIds = rows.map((r) => r.credentialTypeId);
    }
    reqs = await writeRequirements(
      task.id,
      currentSkillIds,
      currentCredIds,
      task.requiresIdentityVerified,
      true
    );
    // Changing what a task demands after workers have already applied is worth
    // a trail: it is the explanation for an applicant who was eligible on
    // Monday and is not on Tuesday.
    await writeAudit(userActor(req.user!.id), "task.requirements.updated", "Task", task.id, {
      requiresIdentityVerified: task.requiresIdentityVerified,
      skillIds: currentSkillIds,
      credentialTypeIds: currentCredIds,
    });
  } else {
    reqs = (await loadTaskRequirements(prisma, [task])).get(task.id)!;
  }

  const fresh = await prisma.task.findUnique({ where: { id: task.id } });
  res.json({
    ...(await withCounts(fresh)),
    requirements: requirementsPayload(reqs),
    eligibility: null,
  });
});

export default router;
