/**
 * Withdrawals waiting for an admin to press Pay. Every withdrawal lands here
 * in REVIEW (routes/wallet.ts); a large one also carries a fresh selfie to
 * compare with the KYC one. Nothing is sent until Pay.
 *
 *   GET  /api/admin/withdrawals?status=REVIEW|PROCESSING
 *   POST /api/admin/withdrawals/:id/sign-off    first of two people: it's right
 *   POST /api/admin/withdrawals/:id/approve     Pay: send the money (a different
 *                                               Super Admin from the sign-off)
 *   POST /api/admin/withdrawals/:id/reject      {reason} don't pay: the amount
 *                                               returns to the wallet
 *   POST /api/admin/withdrawals/:id/check       ask where a sent one stands
 *   POST /api/admin/withdrawals/:id/paid-manually {reference, note?}  we paid
 *                                               it by bank transfer ourselves
 *
 * Approving sends money, so it is SUPER_ADMIN only, as releasing a payment is.
 * HR can look.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { resolveUrl } from "../services/storage";
import { payoutHold } from "../services/identityGuard";
import { applyMartAnswer, sendPayout, twoPersonLine, twoPersonProblem } from "../services/payout";
import { martPayouts } from "../services/martPayout";
import { notifyWorker } from "../services/push";
import { userActor, writeAudit } from "../util/audit";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"));

const wrap =
  (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

router.get(
  "/",
  wrap(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "REVIEW";
    const rows = await prisma.withdrawal.findMany({
      where: { status },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: { worker: { select: { id: true, name: true, kycStatus: true, bankMasked: true } } },
    });
    const line = await twoPersonLine();
    const signerIds = [...new Set(rows.map((r) => r.signedOffById).filter((x): x is string => !!x))];
    const signers = signerIds.length
      ? await prisma.user.findMany({ where: { id: { in: signerIds } }, select: { id: true, name: true } })
      : [];
    const docIds = rows.map((r) => r.selfieDocumentId).filter((x): x is string => !!x);
    const workerIds = [...new Set(rows.map((r) => r.workerId))];
    const [payoutSelfies, kycSelfies] = await Promise.all([
      docIds.length ? prisma.kycDocument.findMany({ where: { id: { in: docIds } } }) : Promise.resolve([]),
      workerIds.length
        ? prisma.kycDocument.findMany({
            where: { userId: { in: workerIds }, docType: "SELFIE" },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);
    const out = [];
    for (const r of rows) {
      const fresh = payoutSelfies.find((d) => d.id === r.selfieDocumentId);
      // The selfie the account was verified with: what the new one must match.
      const enrolled = kycSelfies.find((d) => d.userId === r.workerId);
      out.push({
        id: r.id,
        amount: r.amount,
        bankMasked: r.bankMasked,
        status: r.status,
        provider: r.provider,
        failureReason: r.failureReason,
        hasSelfie: !!r.selfieDocumentId,
        needsTwo: r.amount >= line,
        signedOffById: r.signedOffById,
        signedOffBy: r.signedOffById ? (signers.find((u) => u.id === r.signedOffById)?.name ?? "An admin") : null,
        createdAt: r.createdAt,
        worker: r.worker,
        identityHold: await payoutHold(r.workerId),
        payoutSelfieUrl: fresh ? await resolveUrl(fresh.filename) : null,
        kycSelfieUrl: enrolled ? await resolveUrl(enrolled.filename) : null,
      });
    }
    res.json(out);
  })
);

router.post(
  "/:id/approve",
  requireRole("SUPER_ADMIN"),
  wrap(async (req, res) => {
    const w = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!w) return res.status(404).json({ error: "Withdrawal not found" });
    if (w.status !== "REVIEW") return res.status(409).json({ error: "This withdrawal is not waiting to be paid" });
    const hold = await payoutHold(w.workerId);
    if (hold) return res.status(409).json({ error: "This account has an identity case open; decide it first", code: "IDENTITY_HOLD" });
    const twoPerson = await twoPersonProblem(w, req.user!.id);
    if (twoPerson) return res.status(409).json(twoPerson);

    // Claim it first, so two admins approving at once cannot send it twice.
    const claimed = await prisma.withdrawal.updateMany({
      where: { id: w.id, status: "REVIEW" },
      data: { status: "PROCESSING", reviewedById: req.user!.id, reviewedAt: new Date() },
    });
    if (claimed.count === 0) return res.status(409).json({ error: "Somebody else has just decided this one" });
    await writeAudit(userActor(req.user!.id), "withdrawal.approved", "Withdrawal", w.id, {
      amount: w.amount,
      workerId: w.workerId,
    });

    const worker = await prisma.user.findUniqueOrThrow({
      where: { id: w.workerId },
      select: { name: true, bankAccountNumber: true, bankCode: true, bankName: true },
    });
    const admin = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true, name: true } });
    const fresh = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const out = await sendPayout(fresh, worker, admin?.email ?? admin?.name ?? req.user!.id);
    res.status(out.status === 201 ? 200 : out.status).json(out.body);
  })
);

router.post(
  "/:id/reject",
  wrap(async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    if (!reason) return res.status(400).json({ error: "Say why" });
    const w = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!w) return res.status(404).json({ error: "Withdrawal not found" });
    const hit = await prisma.withdrawal.updateMany({
      where: { id: w.id, status: "REVIEW" },
      // FAILED is not counted against the balance, so the amount is back in
      // the wallet straight away.
      data: { status: "FAILED", failureReason: reason, reviewedById: req.user!.id, reviewedAt: new Date() },
    });
    if (hit.count === 0) return res.status(409).json({ error: "This withdrawal is not waiting for a check" });
    await writeAudit(userActor(req.user!.id), "withdrawal.selfie_rejected", "Withdrawal", w.id, {
      amount: w.amount,
      workerId: w.workerId,
      reason,
    });
    await notifyWorker(
      prisma,
      w.workerId,
      "Withdrawal not sent",
      `Your ₦${w.amount.toLocaleString()} withdrawal was not sent: ${reason}. The money is back in your wallet.`,
      { screen: "wallet" },
      "notifPay"
    ).catch(() => {});
    res.json({ ok: true });
  })
);

/**
 * POST /:id/sign-off - the first of two people. A Super Admin or HR Admin says
 * this withdrawal is right (and, for a large one, that the selfie matches).
 * A different Super Admin then pays it. Nothing is sent here.
 */
router.post(
  "/:id/sign-off",
  wrap(async (req, res) => {
    const w = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!w) return res.status(404).json({ error: "Withdrawal not found" });
    if (w.status !== "REVIEW") return res.status(409).json({ error: "This withdrawal is not waiting to be paid" });
    const hold = await payoutHold(w.workerId);
    if (hold) return res.status(409).json({ error: "This account has an identity case open; decide it first", code: "IDENTITY_HOLD" });
    const hit = await prisma.withdrawal.updateMany({
      where: { id: w.id, status: "REVIEW", signedOffById: null },
      data: { signedOffById: req.user!.id, signedOffAt: new Date() },
    });
    if (hit.count === 0) return res.status(409).json({ error: "Somebody has already signed this one off" });
    await writeAudit(userActor(req.user!.id), "withdrawal.signed_off", "Withdrawal", w.id, {
      amount: w.amount,
      workerId: w.workerId,
    });
    res.json(await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } }));
  })
);

/**
 * POST /:id/paid-manually {reference, note?}
 *
 * Afrizone paid this Tasker itself, by bank transfer from the company account,
 * and records it here. Nothing is sent from Part Time: this only marks the
 * withdrawal PAID with the bank's transfer reference, so the wallet and the
 * Tasker's statement are right.
 *
 * Never for one that may already have gone through Squad. A withdrawal that
 * was ever handed to AfriZoneMart is checked there first; if AfriZoneMart has
 * it in any state but FAILED, or cannot be asked, this refuses, because paying
 * it by hand as well would pay the Tasker twice.
 */
router.post(
  "/:id/paid-manually",
  requireRole("SUPER_ADMIN"),
  wrap(async (req, res) => {
    const reference = typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 120) : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
    if (reference.length < 4) {
      return res.status(400).json({ error: "Enter the bank's transfer reference (session ID) for this payment" });
    }
    const w = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!w) return res.status(404).json({ error: "Withdrawal not found" });
    if (w.status !== "REVIEW") return res.status(409).json({ error: "This withdrawal is not waiting to be paid" });
    const hold = await payoutHold(w.workerId);
    if (hold) return res.status(409).json({ error: "This account has an identity case open; decide it first", code: "IDENTITY_HOLD" });
    const twoPerson = await twoPersonProblem(w, req.user!.id);
    if (twoPerson) return res.status(409).json(twoPerson);

    if (w.provider === "afrizonemart") {
      const answer = await martPayouts.status(w.providerRef ?? w.reference ?? w.id);
      const neverSent = answer.kind === "REFUSED" && answer.code === "NOT_FOUND";
      const failed = answer.kind === "ACCEPTED" && answer.status === "FAILED";
      if (!neverSent && !failed) {
        return res.status(409).json({
          error:
            answer.kind === "ACCEPTED"
              ? `This one was already sent through Squad (${answer.status.toLowerCase()}). Don't pay it by hand as well.`
              : "Could not confirm with AfriZoneMart that this was never sent through Squad. Try again in a minute.",
          code: "MAYBE_SENT",
        });
      }
    }

    const hit = await prisma.withdrawal.updateMany({
      where: { id: w.id, status: "REVIEW" },
      data: {
        status: "PAID",
        provider: "manual",
        providerRef: reference,
        failureReason: null,
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
      },
    });
    if (hit.count === 0) return res.status(409).json({ error: "Somebody else has just decided this one" });
    await writeAudit(userActor(req.user!.id), "withdrawal.paid_manually", "Withdrawal", w.id, {
      amount: w.amount,
      workerId: w.workerId,
      reference,
      ...(note ? { note } : {}),
    });
    await notifyWorker(
      prisma,
      w.workerId,
      "Money sent ✅",
      `Afrizone has paid your ₦${w.amount.toLocaleString()} withdrawal by bank transfer (ref ${reference}).`,
      { screen: "wallet" },
      "notifPay"
    ).catch(() => {});
    res.json(await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } }));
  })
);

router.post(
  "/:id/check",
  wrap(async (req, res) => {
    const w = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!w) return res.status(404).json({ error: "Withdrawal not found" });
    if (w.status !== "PROCESSING" || w.provider !== "afrizonemart") {
      return res.json(w);
    }
    const answer = await martPayouts.status(w.providerRef ?? w.reference ?? w.id);
    if (answer.kind === "ACCEPTED") await applyMartAnswer(w, answer);
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    res.json({ ...row, answer });
  })
);

export default router;
