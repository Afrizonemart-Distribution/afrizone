/**
 * Sending a withdrawal to the worker's bank. Shared by the worker's own
 * withdrawal (routes/wallet.ts) and by staff approving a large one after the
 * selfie check (routes/adminWithdrawals.ts), so the two can never pay out
 * differently.
 */
import { prisma } from "../prisma";
import { paystack } from "./paystack";

export const SELFIE_LINE_KEY = "payouts.selfieOver";
/** ₦. A withdrawal this large or larger needs a fresh selfie checked by a person. */
export const DEFAULT_SELFIE_LINE = 100_000;
/** How recent the selfie must be: taken for this withdrawal, not dug out of the camera roll. */
export const SELFIE_MAX_AGE_MS = 15 * 60 * 1000;

export async function selfieLine(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: SELFIE_LINE_KEY } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SELFIE_LINE;
}

type WithdrawalRow = { id: string; amount: number; reference: string | null };
type WorkerRow = { name: string; bankAccountNumber: string | null; bankCode: string | null };

/**
 * Start the transfer for a PROCESSING withdrawal. Returns the HTTP answer for
 * the caller to send. In simulated mode (no Paystack) it stays PROCESSING
 * until the dev-settle endpoint or a real webhook settles it.
 */
export async function sendPayout(
  withdrawal: WithdrawalRow & Record<string, unknown>,
  worker: WorkerRow
): Promise<{ status: number; body: unknown }> {
  if (!paystack.enabled) return { status: 201, body: { ...withdrawal, simulated: true } };

  // Real payout requires a NUBAN account + bank code on the worker.
  if (!worker.bankAccountNumber || !worker.bankCode) {
    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: "FAILED", failureReason: "Missing payout account number / bank code" },
    });
    return {
      status: 400,
      body: { error: "Add a payout bank account (account number + bank code) before withdrawing." },
    };
  }
  try {
    const recipientCode = await paystack.createRecipient({
      name: worker.name,
      accountNumber: worker.bankAccountNumber,
      bankCode: worker.bankCode,
    });
    const transfer = await paystack.initiateTransfer({
      amountNaira: withdrawal.amount,
      recipientCode,
      reference: withdrawal.reference ?? withdrawal.id,
      reason: "AfriZone PartTime earnings payout",
    });
    const updated = await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { providerRef: transfer.transferCode },
    });
    // Paystack settles asynchronously; the webhook flips PROCESSING → PAID/FAILED.
    return { status: 201, body: updated };
  } catch (err: any) {
    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: "FAILED", failureReason: String(err?.message || err) },
    });
    return { status: 502, body: { error: `Payout failed: ${err?.message || "provider error"}` } };
  }
}
