import { Router, Response } from "express";
import crypto from "crypto";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { paystack } from "../services/paystack";

const router = Router();

const MIN_WITHDRAWAL = 5000; // ₦5,000 minimum.

// The available-balance calculation now lives inside the conditional INSERT in
// the withdraw handler below, so the check and the write are one atomic
// statement. The read-only version workers see is walletFrom() in routes/me.ts,
// which backs GET /api/me/wallet.
//
// Both express the same rule: Σ net of RELEASED payments − Σ non-FAILED
// withdrawals. If you change one, change the other.

// POST /api/wallet/withdraw → body {amount}. Acting worker = req.user.id.
// Guards: integer, ≥ ₦5,000, ≤ available. Creates a Withdrawal and (when
// PAYSTACK_SECRET is set) initiates a real Paystack transfer; otherwise runs
// in SIMULATED mode (status stays PROCESSING until settled).
router.post("/withdraw", requireAuth, async (req: AuthedRequest, res: Response) => {
  const workerId = req.user!.id;
  const { amount } = req.body || {};
  const amt = Number(amount);
  if (!Number.isInteger(amt)) {
    return res.status(400).json({ error: "amount must be a whole-Naira integer" });
  }
  if (amt < MIN_WITHDRAWAL) {
    return res.status(400).json({ error: `Minimum withdrawal is ₦${MIN_WITHDRAWAL}` });
  }

  const worker = await prisma.user.findUnique({ where: { id: workerId } });
  if (!worker) return res.status(404).json({ error: "Worker not found" });
  if (!worker.bankMasked) {
    return res.status(400).json({ error: "No bank account on file. Submit KYC first." });
  }

  const provider = paystack.enabled ? "paystack" : "simulated";

  // The reference doubles as the idempotency key and already carries a UNIQUE
  // constraint - but it used to be a fresh UUID per request, so the constraint
  // could never fire and a retry simply created a SECOND withdrawal. A courier
  // double-tapping on patchy data got paid twice. Deriving it from a
  // client-supplied key makes a retry collide with the original.
  const rawKey = (req.body || {}).idempotencyKey;
  const clientKey =
    typeof rawKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(rawKey) ? rawKey : null;
  // Scoped to the worker, so one worker's key can never collide with another's.
  const reference = clientKey
    ? `afz_wd_${workerId}_${clientKey}`
    : `afz_wd_${crypto.randomUUID()}`;

  if (clientKey) {
    // A retry of a request that already succeeded returns the original row
    // rather than a duplicate or an error.
    const existing = await prisma.withdrawal.findUnique({ where: { reference } });
    if (existing) return res.status(200).json(existing);
  }

  // Balance check and insert in ONE statement. Doing them separately let two
  // concurrent requests both read a sufficient balance and both insert,
  // overdrawing the wallet - and D1/SQLite has no row locks to hold between
  // them. The WHERE recomputes the balance at write time, so the second writer
  // sees the first one's row and inserts nothing.
  //
  // createdAt is bound as an ISO STRING, deliberately. The D1 adapter infers a
  // column's type from the runtime value and maps any number to Double, never
  // DateTime - and it picks a column's type from the first row in a result set,
  // so a single numeric createdAt would make reads of the whole Withdrawal
  // table type-unstable and break the wallet screen.
  const id = `wd_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  const inserted = await prisma.$executeRaw`
    INSERT INTO "Withdrawal" ("id", "workerId", "amount", "bankMasked", "status", "provider", "reference", "createdAt")
    SELECT ${id}, ${workerId}, ${amt}, ${worker.bankMasked}, 'PROCESSING', ${provider}, ${reference}, ${nowIso}
    WHERE (
      (SELECT COALESCE(SUM("net"), 0) FROM "Payment" WHERE "workerId" = ${workerId} AND "status" = 'RELEASED')
      - (SELECT COALESCE(SUM("amount"), 0) FROM "Withdrawal" WHERE "workerId" = ${workerId} AND "status" <> 'FAILED')
    ) >= ${amt}
  `;

  if (inserted === 0) {
    return res.status(400).json({ error: "Amount exceeds available balance" });
  }

  const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });

  if (paystack.enabled) {
    // Real payout requires a NUBAN account + bank code on the worker.
    if (!worker.bankAccountNumber || !worker.bankCode) {
      await prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: "FAILED", failureReason: "Missing payout account number / bank code" },
      });
      return res.status(400).json({
        error: "Add a payout bank account (account number + bank code) before withdrawing.",
      });
    }
    try {
      const recipientCode = await paystack.createRecipient({
        name: worker.name,
        accountNumber: worker.bankAccountNumber,
        bankCode: worker.bankCode,
      });
      const transfer = await paystack.initiateTransfer({
        amountNaira: amt,
        recipientCode,
        reference,
        reason: "AfriZone PartTime earnings payout",
      });
      const updated = await prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { providerRef: transfer.transferCode },
      });
      // Paystack settles asynchronously; the webhook flips PROCESSING → PAID/FAILED.
      return res.status(201).json(updated);
    } catch (err: any) {
      await prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: "FAILED", failureReason: String(err?.message || err) },
      });
      return res.status(502).json({ error: `Payout failed: ${err?.message || "provider error"}` });
    }
  }

  // SIMULATED mode (no PAYSTACK_SECRET): stays PROCESSING. Use the dev-settle
  // endpoint below (or a real webhook once live) to mark it PAID.
  return res.status(201).json({ ...withdrawal, simulated: true });
});

// DEV ONLY, ADMIN ONLY: settle PROCESSING withdrawals to PAID so the full
// wallet flow can be demoed without Paystack webhooks. Optionally scoped to one
// worker via body {workerId}; otherwise settles every PROCESSING withdrawal.
// Disabled in production and whenever Paystack is live (real settlement must
// come from the verified webhook).
router.post("/dev/settle", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthedRequest, res: Response) => {
  // Gate on the ENVIRONMENT, not on Paystack config. Keying it to
  // `paystack.enabled` meant that in exactly the deployments where withdrawals
  // are simulated (no PAYSTACK_SECRET), this endpoint was live - and being
  // self-scoped to req.user.id was the problem, not the protection: any worker
  // could mark their own withdrawals PAID.
  if (process.env.NODE_ENV === "production" || paystack.enabled) {
    return res.status(403).json({ error: "Live mode: settlement happens via the Paystack webhook." });
  }
  // Scoping to req.user.id would now settle the ADMIN's own withdrawals, which
  // is not what this endpoint is for. Take an explicit target instead.
  const { workerId } = req.body || {};
  const result = await prisma.withdrawal.updateMany({
    where: {
      status: "PROCESSING",
      ...(workerId ? { workerId: String(workerId) } : {}),
    },
    data: { status: "PAID" },
  });
  res.json({ settled: result.count });
});

export default router;
