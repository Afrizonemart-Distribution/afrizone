import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest, publicUser } from "../auth";
import { loadStanding, loadStandings } from "../services/standing";
import { tiersToArray, tiersToString, TIERS, Tier, isCredentialValid, isCredentialExpiring } from "../types";
import { writeAudit, userActor } from "../util/audit";
import { resolveUrl } from "../services/storage";
import { notifyWorker } from "../services/push";
import { VEHICLE_LABEL, type VehicleType } from "../services/courier";

const router = Router();

// Derived wallet for a worker (matches GET /me/wallet semantics).
function wallet(
  payments: { net: number; status: string }[],
  withdrawals: { amount: number; status: string }[]
) {
  const pending = payments
    .filter((p) => p.status === "PENDING" || p.status === "APPROVED")
    .reduce((s, p) => s + p.net, 0);
  const released = payments.filter((p) => p.status === "RELEASED").reduce((s, p) => s + p.net, 0);
  const withdrawn = withdrawals
    .filter((w) => w.status !== "FAILED")
    .reduce((s, w) => s + w.amount, 0);
  return { pending, available: released - withdrawn, withdrawn };
}

// GET /api/workers → users where role=WORKER
// Admin-only: the full worker directory. Guarded per-handler to match the
// existing style in this file (the KYC-review routes below already do).
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"), async (_req: AuthedRequest, res: Response) => {
  const workers = await prisma.user.findMany({
    where: { role: "WORKER" },
    orderBy: { name: "asc" },
  });
  const standings = await loadStandings(workers);
  res.json(
    workers.map((w) => ({
      id: w.id,
      name: w.name,
      email: w.email,
      tiers: tiersToArray(w.tiers),
      kycStatus: w.kycStatus,
      completedCount: w.completedCount,
      rating: w.rating,
      standing: standings.get(w.id) ?? null,
    }))
  );
});

// GET /api/workers/:id → full worker + applications/payments summary + wallet
// Admin-only: returns the full user row (phone, TIN, bank details) plus every
// application, payment and a derived wallet for that worker.
router.get("/:id", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const worker = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      applications: { include: { task: true }, orderBy: { createdAt: "desc" } },
      payments: { include: { task: true }, orderBy: { createdAt: "desc" } },
      withdrawals: true,
      // A reviewer looking at a vehicle registration has to be able to see WHICH
      // vehicle it is claimed for. Without this the document and the plate on it
      // are two facts nobody can put side by side.
      courierProfile: true,
    },
  });
  if (!worker || worker.role !== "WORKER") return res.status(404).json({ error: "Worker not found" });

  res.json({
    ...publicUser(worker),
    standing: await loadStanding(worker),
    applications: worker.applications.map((a) => ({
      id: a.id,
      taskId: a.taskId,
      status: a.status,
      pitch: a.pitch,
      reason: a.reason,
      createdAt: a.createdAt,
      task: { id: a.task.id, title: a.task.title },
    })),
    payments: worker.payments.map((p) => ({
      id: p.id,
      taskId: p.taskId,
      gross: p.gross,
      whtRate: p.whtRate,
      whtAmount: p.whtAmount,
      net: p.net,
      status: p.status,
      createdAt: p.createdAt,
      task: { id: p.task.id, title: p.task.title },
    })),
    wallet: wallet(worker.payments, worker.withdrawals),
    courier: worker.courierProfile
      ? {
          vehicleType: worker.courierProfile.vehicleType,
          label: VEHICLE_LABEL[worker.courierProfile.vehicleType as VehicleType] ?? worker.courierProfile.vehicleType,
          plateNumber: worker.courierProfile.plateNumber,
        }
      : null,
  });
});

// POST /api/workers/:id/kyc → body {decision:"TIER_APPROVED"|"REJECTED"}
// KYC overrides are Super Admin per design spec; HR_ADMIN also allowed to review.
router.post(
  "/:id/kyc",
  requireAuth,
  requireRole("SUPER_ADMIN", "HR_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const { decision } = req.body || {};
    if (decision !== "TIER_APPROVED" && decision !== "REJECTED") {
      return res.status(400).json({ error: "decision must be 'TIER_APPROVED' or 'REJECTED'" });
    }
    const worker = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!worker || worker.role !== "WORKER") return res.status(404).json({ error: "Worker not found" });

    const updated = await prisma.user.update({
      where: { id: worker.id },
      data: { kycStatus: decision },
    });
    await writeAudit(userActor(req.user!.id), "KYC_DECISION", "User", worker.id, { decision });

    await notifyWorker(
      prisma,
      worker.id,
      decision === "TIER_APPROVED" ? "Identity verified ✅" : "Verification not approved",
      decision === "TIER_APPROVED"
        ? "Your identity has been verified. You can now apply to tasks."
        : "Your verification wasn't approved. Check the app for details and re-verify.",
      { screen: "kyc" },
      "notifTasks"
    );

    res.json(publicUser(updated));
  }
);

/**
 * GET /api/workers/:id/profile
 *
 * The whole picture of one worker, for an admin deciding whether to give them
 * work: identity status, declared skills, and every credential with its
 * derived validity. Readable by all three admin roles - a task manager
 * choosing between applicants needs this, and it grants no power to change
 * anything.
 */
router.get(
  "/:id/profile",
  requireAuth,
  requireRole("SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const worker = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        skills: { include: { skill: true } },
        credentials: { include: { credentialType: true }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!worker || worker.role !== "WORKER") {
      return res.status(404).json({ error: "Worker not found" });
    }

    const now = new Date();
    res.json({
      ...publicUser(worker),
      skills: worker.skills.map((ws) => ({
        skillId: ws.skillId,
        slug: ws.skill.slug,
        name: ws.skill.name,
        group: ws.skill.group,
        years: ws.years,
        retired: !ws.skill.active,
        // Stated here too, because this screen is where somebody is most
        // tempted to read a skill as a checked fact: it is not one. Skills are
        // the worker's own word, and gate nothing.
        selfDeclared: true,
      })),
      credentials: worker.credentials.map((c) => ({
        id: c.id,
        title: c.title,
        issuer: c.issuer,
        referenceNumber: c.referenceNumber,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        status: c.status,
        valid: isCredentialValid(c, now),
        expiringSoon: isCredentialExpiring(c, 30, now),
        rejectionReason: c.rejectionReason,
        reviewedAt: c.reviewedAt,
        credentialType: c.credentialType,
      })),
    });
  }
);

/**
 * PATCH /api/workers/:id/tiers -> body {tiers: Tier[]}
 *
 * Fixes a standing defect: tiers were write-once at KYC submission and no
 * admin could grant or revoke one afterwards. Since applications.ts gates task
 * eligibility on exactly this column, that meant a worker who genuinely
 * qualified for a new tier had no route to it at all, and one who should lose
 * a tier could not be stopped.
 *
 * Validated against the real list, because `as Tier` is a compile-time cast
 * that does nothing at runtime - the same hole that was closed on the worker's
 * own KYC submission path.
 */
router.patch(
  "/:id/tiers",
  requireAuth,
  requireRole("SUPER_ADMIN", "HR_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const raw = req.body?.tiers;
    if (!Array.isArray(raw)) return res.status(400).json({ error: "tiers must be an array" });

    const tiers: Tier[] = [];
    for (const t of raw) {
      if (typeof t !== "string" || !TIERS.includes(t as Tier)) {
        return res.status(400).json({ error: `tiers must all be one of ${TIERS.join(", ")}` });
      }
      if (!tiers.includes(t as Tier)) tiers.push(t as Tier);
    }

    const worker = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!worker || worker.role !== "WORKER") {
      return res.status(404).json({ error: "Worker not found" });
    }

    const before = tiersToArray(worker.tiers);
    const updated = await prisma.user.update({
      where: { id: worker.id },
      data: { tiers: tiersToString(tiers) },
    });

    await writeAudit(userActor(req.user!.id), "WORKER_TIERS_SET", "User", worker.id, {
      before,
      after: tiers,
    });

    const granted = tiers.filter((t) => !before.includes(t));
    const revoked = before.filter((t) => !tiers.includes(t));
    if (granted.length || revoked.length) {
      await notifyWorker(
        prisma,
        worker.id,
        granted.length ? "New work unlocked" : "Your work categories changed",
        granted.length
          ? `You can now apply for ${granted.join(", ").toLowerCase()} work.`
          : `Your access to ${revoked.join(", ").toLowerCase()} work has been removed.`,
        { screen: "tasks" },
        "notifTasks"
      );
    }

    res.json(publicUser(updated));
  }
);

/**
 * POST /api/workers/:id/credentials -> body {credentialTypeId, title?, expiresAt?, note?}
 *
 * Grant an AFRIZONE-issued credential: one whose evidence is the worker's
 * history on this platform rather than a document somebody else issued.
 *
 * This is the route by which a worker who is plainly competent, but holds no
 * formal certificate, can pass a gate. Without it every requirement would be a
 * requirement to have already been credentialed by an institution, and the
 * platform could only ever ratify advantages people arrived with.
 *
 * It lands VERIFIED immediately, and that is correct: an admin granting it IS
 * the review, and there is no document for anyone to check afterwards.
 */
router.post(
  "/:id/credentials",
  requireAuth,
  requireRole("SUPER_ADMIN", "HR_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const b = req.body || {};
    const worker = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!worker || worker.role !== "WORKER") {
      return res.status(404).json({ error: "Worker not found" });
    }

    const type = await prisma.credentialType.findUnique({
      where: { id: String(b.credentialTypeId ?? "") },
    });
    if (!type || !type.active) {
      return res.status(400).json({ error: "That credential type is not available" });
    }
    if (type.issuerMode !== "AFRIZONE") {
      // A third-party credential must come from the worker with their evidence
      // attached, and go through the review desk. Granting one here would be
      // asserting a fact about a document nobody has seen.
      return res.status(400).json({
        error: "Only Afrizone-issued credentials can be granted. This one needs the worker to submit it.",
      });
    }

    let expiresAt: Date | null = null;
    if (b.expiresAt) {
      const d = new Date(String(b.expiresAt));
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "expiresAt is not a valid date" });
      if (d.getTime() <= Date.now()) {
        return res.status(400).json({ error: "That expiry date has already passed" });
      }
      expiresAt = d;
    }

    const existing = await prisma.credential.findFirst({
      where: { workerId: worker.id, credentialTypeId: type.id, status: "VERIFIED" },
    });
    if (existing) {
      return res.status(409).json({ error: "This worker already holds that credential" });
    }

    const created = await prisma.credential.create({
      data: {
        workerId: worker.id,
        credentialTypeId: type.id,
        title: b.title ? String(b.title).trim() : type.name,
        issuer: "Afrizone",
        expiresAt,
        status: "VERIFIED",
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
      },
      include: { credentialType: true },
    });

    await writeAudit(userActor(req.user!.id), "CREDENTIAL_GRANTED", "Credential", created.id, {
      credentialType: type.slug,
      workerId: worker.id,
      note: b.note ? String(b.note).trim() : undefined,
    });

    await notifyWorker(
      prisma,
      worker.id,
      `${type.name} awarded 🎉`,
      `Afrizone has awarded you "${created.title}" based on your work here.`,
      { screen: "credentials" },
      "notifTasks"
    );

    res.status(201).json(created);
  }
);

// GET /api/workers/:id/kyc/documents: admin view of a worker's uploaded KYC docs.
router.get(
  "/:id/kyc/documents",
  requireAuth,
  requireRole("SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const worker = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!worker || worker.role !== "WORKER") return res.status(404).json({ error: "Worker not found" });

    const docs = await prisma.kycDocument.findMany({
      where: { userId: req.params.id },
      orderBy: { createdAt: "asc" },
    });

    const enriched = await Promise.all(
      docs.map(async (d) => ({
        id: d.id,
        docType: d.docType,
        filename: d.filename,
        originalName: d.originalName,
        mimeType: d.mimeType,
        url: await resolveUrl(d.filename),
        createdAt: d.createdAt,
      }))
    );
    res.json(enriched);
  }
);

export default router;
