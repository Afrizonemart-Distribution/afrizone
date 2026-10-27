import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireEvidence } from "../services/evidence";
import { loadStanding } from "../services/standing";
import { requireAuth, AuthedRequest } from "../auth";
import { tiersToArray, tiersToString, Tier, TIERS } from "../types";
import { isSmileConfigured, submitDocumentVerification, NgIdType, NG_ID_TYPES } from "../services/smileIdentity";
import { getFileBuffer } from "../services/storage";
import { requireAssignedTask } from "../util/assignment";
import { closeIfBothSidesRated, isRateable } from "../services/ratings";
import { commitmentLabel, commitmentSummary } from "../services/commitments";
import {
  courierReadiness,
  saveCourierVehicle,
  VEHICLE_LABEL,
  VEHICLE_TYPES,
  requiresPlate,
} from "../services/courier";
import { recordAudit } from "../services/storeAudit";
import { userActor } from "../util/audit";

const router = Router();

// Derived wallet for the acting worker.
//   pending   = net of payments earned but not yet released (PENDING/APPROVED)
//   withdrawn = sum of non-failed withdrawals (in-flight PROCESSING + settled PAID)
//   available = released earnings minus what's already been withdrawn
// FAILED withdrawals are excluded so they don't reduce the balance.
function walletFrom(
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
  const available = released - withdrawn;
  return { pending, available, withdrawn };
}

// Shared response shape for all /api/me endpoints that return the worker profile.
function formatUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    tiers: tiersToArray(user.tiers),
    // INDIVIDUAL | STORE | COURIER. The client's own User type has declared this
    // since the account-type work landed, and this endpoint never sent it - so
    // every screen branching on it silently took the INDIVIDUAL path. A field
    // the client believes it has and the server does not send is worse than an
    // absent one, because nothing errors.
    accountType: user.accountType,
    kycStatus: user.kycStatus,
    kycNote: user.kycNote ?? null,
    location: user.location,
    bankMasked: user.bankMasked,
    bankCode: user.bankCode ?? null,
    bankName: user.bankName ?? null,
    tin: user.tin ?? null,
    rating: user.rating,
    completedCount: user.completedCount,
    totpEnabled: user.totpEnabled,
    notifTasks: user.notifTasks,
    notifPay: user.notifPay,
    notifEmail: user.notifEmail,
  };
}

// GET /api/me → the authed worker profile.
router.get("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  // Standing is shown to the Tasker with what the next level needs; staff
  // accounts have no work record, so they get none.
  const standing = user.role === "WORKER" ? await loadStanding(user) : null;
  res.json({ ...formatUser(user), standing });
});

// PATCH /api/me → update profile fields: name, email, tin, bank details.
// Used after phone-OTP/Google signup and for profile edits in the mobile app.
router.patch("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const { name, email, tin, bankCode, bankAccountNumber, bankName, notifTasks, notifPay, notifEmail } = req.body || {};
  const data: Record<string, unknown> = {};

  if (name !== undefined) {
    const n = String(name).trim();
    if (n.length < 2) return res.status(400).json({ error: "Please enter your full name" });
    data.name = n;
  }
  if (email !== undefined) {
    const e = String(email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }
    const clash = await prisma.user.findUnique({ where: { email: e } });
    if (clash && clash.id !== req.user!.id) {
      return res.status(409).json({ error: "That email is already in use" });
    }
    data.email = e;
  }
  if (tin !== undefined) {
    const t = String(tin).trim();
    if (t.length > 0 && t.length < 8) {
      return res.status(400).json({ error: "TIN must be at least 8 characters" });
    }
    data.tin = t || null;
  }
  if (bankCode !== undefined) data.bankCode = String(bankCode).trim() || null;
  if (bankName !== undefined) data.bankName = String(bankName).trim() || null;
  if (bankAccountNumber !== undefined) {
    const acct = String(bankAccountNumber).replace(/\D/g, "");
    if (acct && acct.length !== 10) {
      return res.status(400).json({ error: "Account number must be exactly 10 digits" });
    }
    data.bankAccountNumber = acct || null;
    // Recompute masked form: "BankName ••XX"
    if (acct && (bankName || data.bankName)) {
      const bName = String(bankName ?? data.bankName ?? "");
      data.bankMasked = `${bName} ••${acct.slice(-2)}`;
    }
  }

  if (notifTasks !== undefined) data.notifTasks = Boolean(notifTasks);
  if (notifPay !== undefined) data.notifPay = Boolean(notifPay);
  if (notifEmail !== undefined) data.notifEmail = Boolean(notifEmail);

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const user = await prisma.user.update({ where: { id: req.user!.id }, data });
  res.json(formatUser(user));
});

// GET /api/me/applications → worker's applications joined with task summary + paymentId.
router.get("/applications", requireAuth, async (req: AuthedRequest, res: Response) => {
  const [apps, payments] = await Promise.all([
    prisma.application.findMany({
      where: { workerId: req.user!.id },
      orderBy: { createdAt: "desc" },
      include: { task: true },
    }),
    prisma.payment.findMany({
      where: { workerId: req.user!.id },
      select: { id: true, taskId: true },
    }),
  ]);
  const paymentByTask = Object.fromEntries(payments.map((p) => [p.taskId, p.id]));
  const uniqueTaskIds = [...new Set(apps.map((a) => a.taskId))];
  const filledCounts = await Promise.all(
    uniqueTaskIds.map((taskId) =>
      prisma.application.count({ where: { taskId, status: "APPROVED" } })
    )
  );
  const filledByTask = Object.fromEntries(uniqueTaskIds.map((id, i) => [id, filledCounts[i]]));
  res.json(
    apps.map((a) => ({
      id: a.id,
      taskId: a.taskId,
      pitch: a.pitch,
      status: a.status,
      reason: a.reason,
      createdAt: a.createdAt,
      paymentId: paymentByTask[a.taskId] ?? null,
      task: {
        id: a.task.id,
        title: a.task.title,
        category: a.task.category,
        tier: a.task.tier,
        payModel: a.task.payModel,
        rate: a.task.rate,
        budget: a.task.budget,
        status: a.task.status,
        address: a.task.address,
        locationType: a.task.locationType,
        startDate: a.task.startDate,
        endDate: a.task.endDate,
        slots: a.task.slots,
        filledCount: filledByTask[a.taskId] ?? 0,
      },
    }))
  );
});

// GET /api/me/wallet → {pending, available, withdrawn}.
router.get("/wallet", requireAuth, async (req: AuthedRequest, res: Response) => {
  const [payments, withdrawals] = await Promise.all([
    prisma.payment.findMany({ where: { workerId: req.user!.id } }),
    prisma.withdrawal.findMany({ where: { workerId: req.user!.id } }),
  ]);
  res.json(walletFrom(payments, withdrawals));
});

// GET /api/me/transactions → merged earnings + withdrawals, newest-first.
router.get("/transactions", requireAuth, async (req: AuthedRequest, res: Response) => {
  const [payments, withdrawals] = await Promise.all([
    prisma.payment.findMany({
      where: { workerId: req.user!.id },
      include: { task: true },
    }),
    prisma.withdrawal.findMany({ where: { workerId: req.user!.id } }),
  ]);
  const earnings = payments.map((p) => ({
    id: p.id,
    kind: "earning" as const,
    title: p.task.title,
    amount: p.net,
    status: p.status,
    createdAt: p.createdAt,
  }));
  const wds = withdrawals.map((w) => ({
    id: w.id,
    kind: "withdrawal" as const,
    title: `Withdrawal to ${w.bankMasked}`,
    amount: w.amount,
    status: w.status,
    createdAt: w.createdAt,
  }));
  const merged = [...earnings, ...wds].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(merged);
});

// GET /api/me/clock/:taskId → resume state for the active-task screen.
router.get("/clock/:taskId", requireAuth, async (req: AuthedRequest, res: Response) => {
  const last = await prisma.clockEvent.findFirst({
    where: { workerId: req.user!.id, taskId: req.params.taskId },
    orderBy: { createdAt: "desc" },
  });
  if (!last) {
    return res.json({ clockedIn: false, lastEventAt: null, elapsedSeconds: 0 });
  }
  const clockedIn = last.type === "IN";
  const elapsedSeconds = clockedIn
    ? Math.max(0, Math.floor((Date.now() - new Date(last.createdAt).getTime()) / 1000))
    : 0;
  res.json({ clockedIn, lastEventAt: last.createdAt, elapsedSeconds });
});

// GET /api/me/payments/:id → full payment detail for the authenticated worker.
router.get("/payments/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { task: true },
  });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (payment.workerId !== req.user!.id) return res.status(403).json({ error: "Forbidden" });

  res.json({
    id: payment.id,
    gross: payment.gross,
    whtRate: payment.whtRate,
    whtAmount: payment.whtAmount,
    net: payment.net,
    status: payment.status,
    createdAt: payment.createdAt,
    task: { id: payment.task.id, title: payment.task.title },
  });
});

// GET /api/me/timesheets → worker's own timesheet history, newest-first.
router.get("/timesheets", requireAuth, async (req: AuthedRequest, res: Response) => {
  const timesheets = await prisma.timesheet.findMany({
    where: { workerId: req.user!.id },
    orderBy: { createdAt: "desc" },
    include: { task: true },
  });
  res.json(
    timesheets.map((ts) => ({
      id: ts.id,
      taskId: ts.taskId,
      periodStart: ts.periodStart,
      periodEnd: ts.periodEnd,
      hours: ts.hours,
      status: ts.status,
      createdAt: ts.createdAt,
      task: { id: ts.task.id, title: ts.task.title },
    }))
  );
});

// GET /api/me/ratings → worker's individual ratings, newest-first.
router.get("/ratings", requireAuth, async (req: AuthedRequest, res: Response) => {
  const ratings = await prisma.rating.findMany({
    // Ratings OF this worker only. Without the direction filter this would also
    // return the ones they wrote about their own jobs, which is not what "your
    // ratings" means to anybody.
    where: { workerId: req.user!.id, direction: "OF_WORKER" },
    orderBy: { createdAt: "desc" },
    include: { task: true },
  });
  res.json(
    ratings.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      score: r.score,
      note: r.note,
      createdAt: r.createdAt,
      task: { id: r.task.id, title: r.task.title },
    }))
  );
});

/**
 * POST /api/me/ratings → the Tasker rates the job back. Body {taskId, score, note?}.
 *
 * The other half of Blueprint §9. Guarded on two things, both of which matter:
 *
 *   They must have actually been given the task. Otherwise anyone could rate any
 *   job they had merely seen, and the resulting scores would describe nothing.
 *
 *   The work must be far enough along to have an opinion about. Rating a job on
 *   the morning you claimed it is not feedback about the job.
 */
router.post("/ratings", requireAuth, async (req: AuthedRequest, res: Response) => {
  const workerId = req.user!.id;
  const { taskId, score, note } = req.body || {};

  const scoreNum = Number(score);
  if (!Number.isInteger(scoreNum) || scoreNum < 1 || scoreNum > 5) {
    return res.status(400).json({ error: "Give a score between 1 and 5" });
  }

  const assignment = await requireAssignedTask(workerId, taskId);
  if (!assignment.ok) return res.status(assignment.status).json({ error: assignment.error });
  const { task } = assignment;

  const contract = await prisma.contract.findFirst({
    where: { taskId: task.id, workerId },
    select: { id: true, status: true },
  });
  if (!contract || !isRateable(contract.status)) {
    return res.status(400).json({ error: "You can rate this once the work has been approved" });
  }

  const rating = await prisma.rating.upsert({
    where: {
      workerId_taskId_direction: { workerId, taskId: task.id, direction: "OF_EXPERIENCE" },
    },
    update: { score: scoreNum, note: note ? String(note).trim() : null },
    create: {
      workerId,
      taskId: task.id,
      direction: "OF_EXPERIENCE",
      score: scoreNum,
      note: note ? String(note).trim() : null,
      // The Tasker is the author here, which is the whole difference between
      // the two directions.
      createdById: workerId,
    },
  });

  // Blueprint §4.2: Closed means "ratings exchanged".
  const closed = await closeIfBothSidesRated(task.id, workerId, userActor(workerId));

  res.status(201).json({
    id: rating.id,
    taskId: rating.taskId,
    score: rating.score,
    note: rating.note,
    createdAt: rating.createdAt,
    contractClosed: closed,
  });
});

/**
 * GET /api/me/commitments -> what is ring-fenced for this worker.
 *
 * Blueprint §10's guarantee, made visible. "Set aside for you" is the whole
 * point of escrow from a worker's side, and a promise nobody can see is not one.
 */
router.get("/commitments", requireAuth, async (req: AuthedRequest, res: Response) => {
  const workerId = req.user!.id;
  const [rows, summary] = await Promise.all([
    prisma.commitment.findMany({
      where: { workerId },
      orderBy: { committedAt: "desc" },
      include: { contract: { include: { task: true } } },
    }),
    commitmentSummary(workerId),
  ]);

  res.json({
    ...summary,
    items: rows.map((c) => ({
      id: c.id,
      status: c.status,
      state: commitmentLabel(c.status),
      // Null means hourly work whose hours are not in yet. The client shows
      // that as "to be confirmed" rather than as zero.
      amount: c.amount,
      reason: c.reason,
      committedAt: c.committedAt,
      releasedAt: c.releasedAt,
      paidAt: c.paidAt,
      task: c.contract?.task ? { id: c.contract.task.id, title: c.contract.task.title } : null,
    })),
  });
});

/**
 * POST /api/me/audits -> the Auditor records what they found. Body {taskId, score, notes?}.
 *
 * Guarded on being assigned the task, like every other piece of work: an
 * inspection report from somebody who was never sent is not evidence of
 * anything. The task also has to be a STORE_AUDIT and know which store it is
 * about, or there is nothing to file the finding against.
 */
router.post("/audits", requireAuth, async (req: AuthedRequest, res: Response) => {
  const workerId = req.user!.id;
  const score = Number(req.body?.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: "Give a score between 0 and 100" });
  }

  const assignment = await requireAssignedTask(workerId, req.body?.taskId);
  if (!assignment.ok) return res.status(assignment.status).json({ error: assignment.error });
  const { task } = assignment;

  if (task.kind !== "STORE_AUDIT" || !task.organizationId) {
    return res.status(400).json({ error: "That task is not a store audit" });
  }

  // A score with nothing behind it is an opinion. Photos of the premises first.
  const shown = await requireEvidence(task, workerId, "AUDIT");
  if (!shown.ok) return res.status(400).json(shown);

  const row = await recordAudit({
    organizationId: task.organizationId,
    taskId: task.id,
    auditorId: workerId,
    score,
    notes: req.body?.notes ? String(req.body.notes) : null,
    actor: userActor(workerId),
  });

  res.status(201).json({
    id: row.id,
    score: row.score,
    outcome: row.outcome,
    createdAt: row.createdAt,
  });
});

// GET /api/me/contracts -> worker's contracts joined with task summary.
router.get("/contracts", requireAuth, async (req: AuthedRequest, res: Response) => {
  const contracts = await prisma.contract.findMany({
    where: { workerId: req.user!.id },
    orderBy: { createdAt: "desc" },
    include: { task: true },
  });
  res.json(
    contracts.map((c) => ({
      id: c.id,
      status: c.status,
      signedAt: c.signedAt,
      task: { id: c.task.id, title: c.task.title },
    }))
  );
});

// Builds the rendered contract section array from task + worker data.
function buildContractSections(
  task: any,
  worker: any,
  signedAt: Date | null,
  signerName?: string | null
): { heading: string; body: string }[] {
  const fmt = (d: Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : "TBD";
  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(n);

  const pay =
    task.payModel === "HOURLY"
      ? `${fmtMoney(task.rate ?? 0)} per hour`
      : `${fmtMoney(task.budget ?? 0)} fixed price`;

  const location =
    task.locationType === "REMOTE"
      ? "Remote: no fixed site required"
      : task.address
      ? `Physical site: ${task.address}`
      : "Physical site (address to be confirmed)";

  const workerName = worker.name ?? "The Contractor";
  const workerContact = worker.email ?? worker.phone ?? "on file";

  return [
    {
      heading: "1. Parties",
      body: `This Independent Contractor Service Agreement ("Agreement") is entered into between:\n\n• AfriZone PartTime ("Afrizone", "the Platform"), acting as the service marketplace; and\n• ${workerName} ("Contractor"), contact: ${workerContact}.\n\nThis Agreement governs the Contractor's engagement on the task described below.`,
    },
    {
      heading: "2. Scope of Work",
      body: `Task: ${task.title}\nCategory: ${task.category}\nTier: ${task.tier}\n\n${task.description ?? "The Contractor shall perform all duties assigned under this task to the standard required by Afrizone and the task requester."}`,
    },
    {
      heading: "3. Location",
      body: location,
    },
    {
      heading: "4. Schedule",
      body: `Start date: ${fmt(task.startDate)}\nEnd date:   ${fmt(task.endDate)}\n\nThe Contractor must clock in and clock out via the Afrizone mobile app at the start and end of each shift. Failure to record attendance may affect payment.`,
    },
    {
      heading: "5. Compensation",
      body: `Rate: ${pay}\nWithholding Tax (WHT): 5% of gross earnings will be deducted and remitted to the FIRS on the Contractor's behalf. Net earnings are credited to the Contractor's wallet upon timesheet approval.\n\nPayment is released within 3 business days of an approved timesheet.`,
    },
    {
      heading: "6. Independent Contractor Status",
      body: `The Contractor is engaged as an independent contractor and not as an employee of Afrizone or the task requester. The Contractor is responsible for their own professional indemnity, health and safety compliance, and any taxes beyond WHT already remitted by Afrizone. No employment benefits, pension contributions, or leave entitlements arise under this Agreement.`,
    },
    {
      heading: "7. Contractor Obligations",
      body: `The Contractor agrees to:\n• Arrive punctually and complete all scheduled shifts.\n• Clock in/out accurately via the Afrizone app for each shift.\n• Submit a timesheet at the end of the engagement period.\n• Maintain professional conduct and comply with the task requester's site rules.\n• Notify Afrizone Support at least 24 hours in advance if unable to attend a shift.`,
    },
    {
      heading: "8. Termination",
      body: `Either party may terminate this Agreement with 24 hours' written notice. Afrizone may terminate immediately for gross misconduct, fraudulent clock events, or material breach of this Agreement. Earnings accrued for completed, approved shifts will be paid regardless of early termination.`,
    },
    {
      heading: "9. Confidentiality",
      body: `The Contractor shall not disclose any confidential information belonging to Afrizone, the task requester, or their customers that is encountered during the engagement. This obligation survives termination of this Agreement.`,
    },
    {
      heading: "10. Governing Law",
      body: `This Agreement is governed by the laws of the Federal Republic of Nigeria. Any dispute shall first be subject to good-faith negotiation; failing resolution, the parties submit to the jurisdiction of the courts of Lagos State.`,
    },
    {
      heading: "11. Entire Agreement",
      body: `This Agreement constitutes the entire agreement between the parties regarding the task and supersedes all prior discussions. It may only be amended in writing signed by both parties.\n\n${signedAt ? `Digitally signed by ${signerName || workerName} on ${fmt(signedAt)}.` : "This Agreement takes effect upon the Contractor's typed-name digital signature via the Afrizone app."}`,
    },
  ];
}

// GET /api/me/contracts/:id → full contract detail with generated sections.
router.get("/contracts/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: { task: true, worker: true },
  });
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  if (contract.workerId !== req.user!.id) {
    return res.status(403).json({ error: "Not your contract" });
  }

  const sections = buildContractSections(contract.task, contract.worker, contract.signedAt, contract.signerName);
  res.json({
    id: contract.id,
    status: contract.status,
    signedAt: contract.signedAt,
    signerName: contract.signerName,
    createdAt: contract.createdAt,
    task: {
      id: contract.task.id,
      title: contract.task.title,
      category: contract.task.category,
      tier: contract.task.tier,
    },
    sections,
  });
});

// ── Notification inbox ───────────────────────────────────────────────────────
//
// The durable side of worker notifications. Push is best-effort and silently
// fails for anyone who declined the permission; these endpoints are how a
// worker finds out what happened regardless. See services/push.ts.

const INBOX_PAGE_SIZE = 50;

function formatNotification(n: {
  id: string;
  title: string;
  body: string;
  data: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  let data: unknown = null;
  if (n.data) {
    // Stored as a String because SQLite has no Json type. A row written by an
    // older or hand-edited path could be unparseable, and one bad row must not
    // take down the whole inbox - the notification still has a title and body,
    // which is the part the worker actually needs.
    try {
      data = JSON.parse(n.data);
    } catch {
      data = null;
    }
  }
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    data,
    read: n.readAt !== null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

// GET /api/me/notifications → newest-first page of this worker's notifications,
// plus the unread count for the badge.
router.get("/notifications", requireAuth, async (req: AuthedRequest, res: Response) => {
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: INBOX_PAGE_SIZE,
    }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ items: items.map(formatNotification), unreadCount });
});

// GET /api/me/notifications/unread-count → just the badge number.
// Separate from the list because the badge is polled far more often than the
// inbox is opened, and this is answered from an index without reading rows.
router.get("/notifications/unread-count", requireAuth, async (req: AuthedRequest, res: Response) => {
  const unreadCount = await prisma.notification.count({
    where: { userId: req.user!.id, readAt: null },
  });
  res.json({ unreadCount });
});

// POST /api/me/notifications/:id/read → mark one as read. Idempotent.
router.post("/notifications/:id/read", requireAuth, async (req: AuthedRequest, res: Response) => {
  // Scoped by userId in the WHERE rather than fetched-then-checked, so one
  // worker cannot mark another's notification read - and an id belonging to
  // someone else is indistinguishable from one that does not exist.
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    // Either already read, or not theirs. Confirm the row is genuinely theirs
    // before answering 200, so a foreign id still gets a 404.
    const exists = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ error: "Not found" });
  }
  const unreadCount = await prisma.notification.count({
    where: { userId: req.user!.id, readAt: null },
  });
  res.json({ ok: true, unreadCount });
});

// POST /api/me/notifications/read-all → clear the badge.
router.post("/notifications/read-all", requireAuth, async (req: AuthedRequest, res: Response) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true, marked: result.count, unreadCount: 0 });
});

// PATCH /api/me/push-token → body {pushToken}. Upserts the Expo push token for this worker.
router.patch("/push-token", requireAuth, async (req: AuthedRequest, res: Response) => {
  const { pushToken } = req.body || {};
  if (!pushToken || typeof pushToken !== "string") {
    return res.status(400).json({ error: "pushToken is required" });
  }
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { pushToken },
  });
  res.json({ ok: true });
});

// POST /api/me/kyc/submit → body {tin?, bankMasked?, bankCode?, bankAccountNumber?, bankName?, tier?, idType?}.
// When Smile ID is configured (see services/smileIdentity.ts) and the worker has
// uploaded both an ID and a selfie document, this also runs an automated Document
// Verification pass: a final REJECTED result short-circuits straight to kycStatus
// REJECTED (with the real reason in kycNote), a final approval moves to kycStatus
// VERIFIED: still awaiting an admin's own TIER_APPROVED call. Any failure to reach
// Smile (missing docs, no idType, network error) falls back to the pre-existing
// manual-review flow (kycStatus stays PENDING for an admin to decide).
router.post("/kyc/submit", requireAuth, async (req: AuthedRequest, res: Response) => {
  const { tin, bankMasked, bankCode, bankAccountNumber, bankName, tier, idType } = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  // `tier as Tier` is a compile-time cast that does nothing at runtime, so this
  // previously accepted ANY string off the request body. That mattered because
  // applications.ts gates task eligibility solely on this column: a worker
  // could self-assert whatever tier a task required and apply to it
  // immediately. Validate against the real list before storing.
  //
  // NOTE: this still lets a worker self-declare a VALID tier without admin
  // approval, which the mobile KYC copy ("an admin still needs to approve your
  // tier") promises does not happen. Closing that properly means promoting
  // tiers only on admin approval - a behavioural change to the worker journey,
  // so it needs product sign-off rather than being slipped into a security fix.
  let tiers = tiersToArray(user.tiers);
  if (tier !== undefined && tier !== null && tier !== "") {
    if (!TIERS.includes(tier as Tier)) {
      return res.status(400).json({ error: "Invalid tier" });
    }
    if (!tiers.includes(tier as Tier)) {
      tiers = [...tiers, tier as Tier];
    }
  }

  let kycStatus = "PENDING";
  let kycNote: string | null = null;

  if (isSmileConfigured() && NG_ID_TYPES.includes(idType)) {
    const docs = await prisma.kycDocument.findMany({
      where: { userId: user.id, docType: { in: ["ID", "SELFIE"] } },
      orderBy: { createdAt: "desc" },
    });
    const idDoc = docs.find((d) => d.docType === "ID");
    const selfieDoc = docs.find((d) => d.docType === "SELFIE");

    if (idDoc && selfieDoc) {
      const jobId = `kyc_${user.id}_${Date.now()}`;
      try {
        const [idBuf, selfieBuf] = await Promise.all([
          getFileBuffer(idDoc.filename),
          getFileBuffer(selfieDoc.filename),
        ]);
        // See webhooks.ts for why these casts: worker-configuration.d.ts's
        // global `Buffer: any` shadows @types/node's real Buffer type,
        // hiding the encoding-aware toString() overload at compile time only.
        const result = await submitDocumentVerification({
          jobId,
          userId: user.id,
          idType: idType as NgIdType,
          idFrontBase64: (idBuf as any).toString("base64"),
          selfieBase64: (selfieBuf as any).toString("base64"),
        });

        await prisma.kycVerification.create({
          data: {
            workerId: user.id,
            jobId,
            smileJobId: result.smileJobId,
            status: result.final ? (result.approved ? "APPROVED" : "REJECTED") : "PENDING",
            resultCode: result.resultCode,
            resultText: result.resultText,
            raw: JSON.stringify(result.raw),
          },
        });

        if (result.final) {
          kycStatus = result.approved ? "VERIFIED" : "REJECTED";
          kycNote = result.approved
            ? null
            : result.resultText ||
              "Automated verification did not pass. Please re-check your documents and try again.";
        }
      } catch (err) {
        console.error("[smileIdentity] verification failed, falling back to manual review:", err);
      }
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      tin: tin != null ? String(tin) : user.tin,
      bankMasked: bankMasked != null ? String(bankMasked) : user.bankMasked,
      bankCode: bankCode != null ? String(bankCode) : user.bankCode,
      bankAccountNumber: bankAccountNumber != null ? String(bankAccountNumber) : user.bankAccountNumber,
      bankName: bankName != null ? String(bankName) : user.bankName,
      tiers: tiersToString(tiers),
      kycStatus,
      kycNote,
    },
  });
  res.json(formatUser(updated));
});

// GET /api/me/tax-statement?year=YYYY → CSV of released WHT payments for that year.
router.get("/tax-statement", requireAuth, async (req: AuthedRequest, res: Response) => {
  const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
  if (isNaN(year) || year < 2020 || year > 2099) {
    return res.status(400).json({ error: "Invalid year" });
  }
  const from = new Date(`${year}-01-01T00:00:00.000Z`);
  const to = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  const [user, payments] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user!.id } }),
    prisma.payment.findMany({
      where: { workerId: req.user!.id, status: "RELEASED", createdAt: { gte: from, lt: to } },
      include: { task: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const totalGross = payments.reduce((s, p) => s + p.gross, 0);
  const totalWht = payments.reduce((s, p) => s + p.whtAmount, 0);
  const totalNet = payments.reduce((s, p) => s + p.net, 0);

  const rows = [
    "AfriZone PartTime - Annual WHT Statement",
    `Tasker:,${user.name ?? "-"}`,
    `Email/Phone:,${user.email ?? user.phone ?? "-"}`,
    `TIN:,${user.tin ?? "Not provided"}`,
    `Year:,${year}`,
    "",
    "Date,Task,Gross (NGN),WHT 5% (NGN),Net (NGN)",
    ...payments.map((p) =>
      [
        new Date(p.createdAt).toISOString().slice(0, 10),
        `"${p.task.title.replace(/"/g, '""')}"`,
        p.gross,
        p.whtAmount,
        p.net,
      ].join(",")
    ),
    "",
    `TOTAL,,${totalGross},${totalWht},${totalNet}`,
  ];

  const safeName = (user.name ?? "statement")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `afrizone-wht-${year}-${safeName}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(rows.join("\r\n"));
});

/**
 * GET /api/me/courier -> how far along this courier is (Blueprint §3.2).
 *
 * OPEN TO ANY SIGNED-IN USER, not gated on accountType COURIER. Somebody
 * deciding whether to start delivering should be able to see what it would take
 * before they commit to being one, and a checklist that 403s until you have
 * already declared yourself is a door with the instructions on the inside.
 *
 * This is a progress report and gates nothing. Whether a courier may take a
 * particular delivery is services/eligibility.ts, and it stays that way.
 */
router.get("/courier", requireAuth, async (req: AuthedRequest, res: Response) => {
  const readiness = await courierReadiness(req.user!.id);
  res.json({
    ...readiness,
    // The catalogue travels with the answer so the client never hard-codes a
    // list of vehicles that then drifts from the server's.
    vehicleTypes: VEHICLE_TYPES.map((t) => ({
      value: t,
      label: VEHICLE_LABEL[t],
      requiresPlate: requiresPlate(t),
    })),
  });
});

/** PUT /api/me/courier/vehicle -> record or change what they deliver on. */
router.put("/courier/vehicle", requireAuth, async (req: AuthedRequest, res: Response) => {
  const vehicleType = String(req.body?.vehicleType ?? "");
  const plateNumber = req.body?.plateNumber != null ? String(req.body.plateNumber) : null;

  const result = await saveCourierVehicle(req.user!.id, vehicleType, plateNumber);
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  // The readiness is returned rather than just the row: changing the vehicle
  // changes which papers are required, and a client that has to ask again to
  // find that out will show a stale checklist in between.
  const readiness = await courierReadiness(req.user!.id);
  res.json({
    ...readiness,
    vehicleTypes: VEHICLE_TYPES.map((t) => ({
      value: t,
      label: VEHICLE_LABEL[t],
      requiresPlate: requiresPlate(t),
    })),
  });
});

export default router;
