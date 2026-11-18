/**
 * Sending a withdrawal to the worker's bank. Shared by the worker's own
 * withdrawal (routes/wallet.ts) and by staff approving a large one after the
 * selfie check (routes/adminWithdrawals.ts), so the two can never pay out
 * differently.
 */
import { emailPartimer, partimerEmails, sendWelcomeIfDue } from "./partimerEmail";
import { prisma } from "../prisma";
import { paystack } from "./paystack";
import { notifyWorker } from "./push";
import { isMartPayoutConfigured, martPayouts, type MartPayoutAnswer } from "./martPayout";

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

export const TWO_PERSON_KEY = "payouts.twoPersonOver";
/** ₦. From this amount up, one admin signs a payout off and a different one pays it. 0 = every payout. */
export const DEFAULT_TWO_PERSON_LINE = 0;

export async function twoPersonLine(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: TWO_PERSON_KEY } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TWO_PERSON_LINE;
}

/**
 * Why `payerId` may not pay this withdrawal yet, or null when they may.
 * Shared by Pay and "Paid by bank transfer", so neither path is a way round it.
 */
export async function twoPersonProblem(
  w: { amount: number; signedOffById: string | null },
  payerId: string
): Promise<{ error: string; code: string } | null> {
  if (w.amount < (await twoPersonLine())) return null;
  if (!w.signedOffById) {
    return { code: "SIGN_OFF_NEEDED", error: "Another admin has to sign this payout off before it is paid." };
  }
  if (w.signedOffById === payerId) {
    return { code: "SAME_PERSON", error: "You signed this one off, so a different Super Admin has to pay it." };
  }
  return null;
}

type WithdrawalRow = { id: string; amount: number; reference: string | null; workerId: string };
type WorkerRow = { name: string; bankAccountNumber: string | null; bankCode: string | null; bankName?: string | null };

/**
 * What AfriZoneMart refusing a payout means for the withdrawal. Some refusals
 * are about the Tasker's bank details and need them to fix it: the money goes
 * back to their wallet. The rest are about us (payouts switched off, a limit,
 * Squad not answering a lookup): it goes back to the admin to try again.
 */
const TASKER_MUST_FIX = new Set(["NAME_MISMATCH", "BANK_UNSUPPORTED", "BAD_ACCOUNT"]);

function naira(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

async function tell(workerId: string, title: string, body: string) {
  await notifyWorker(prisma, workerId, title, body, { screen: "wallet" }, "notifPay").catch(() => {});
}

/**
 * Apply AfriZoneMart's answer to a PROCESSING withdrawal. Shared by Pay and by
 * the reconcile cron. Each write is conditional on the status it expects, so
 * two of them racing cannot both act.
 */
export async function applyMartAnswer(
  w: { id: string; amount: number; workerId: string },
  answer: MartPayoutAnswer
): Promise<"PAID" | "FAILED" | "PROCESSING" | "REVIEW"> {
  if (answer.kind === "ACCEPTED") {
    if (answer.status === "SUCCESS") {
      const hit = await prisma.withdrawal.updateMany({ where: { id: w.id, status: "PROCESSING" }, data: { status: "PAID" } });
      if (hit.count) {
        await tell(w.workerId, "Money sent ✅", `Your ${naira(w.amount)} withdrawal has been paid into your bank account.`);
        const row = await prisma.withdrawal.findUnique({ where: { id: w.id }, select: { bankMasked: true } });
        await emailPartimer(w.workerId, partimerEmails.withdrawalPaid(w.amount, row?.bankMasked ?? "your bank account"));
      }
      return "PAID";
    }
    if (answer.status === "FAILED") {
      const reason = answer.failureReason || "The bank transfer failed";
      const hit = await prisma.withdrawal.updateMany({
        where: { id: w.id, status: "PROCESSING" },
        data: { status: "FAILED", failureReason: reason },
      });
      if (hit.count) {
        await tell(w.workerId, "Withdrawal not sent", `Your ${naira(w.amount)} withdrawal failed at the bank. The money is back in your wallet.`);
        await emailPartimer(w.workerId, partimerEmails.withdrawalNotSent(w.amount, "the bank transfer failed."));
      }
      return "FAILED";
    }
    return "PROCESSING";
  }
  if (answer.kind === "REFUSED" && TASKER_MUST_FIX.has(answer.code)) {
    const hit = await prisma.withdrawal.updateMany({
      where: { id: w.id, status: "PROCESSING" },
      data: { status: "FAILED", failureReason: answer.error },
    });
    if (hit.count) {
      await tell(
        w.workerId,
        "Check your bank details",
        `Your ${naira(w.amount)} withdrawal was not sent: ${answer.error} The money is back in your wallet; update your bank details and try again.`
      );
      await emailPartimer(w.workerId, partimerEmails.withdrawalNotSent(w.amount, answer.error));
    }
    return "FAILED";
  }
  // Nothing was sent, or we cannot tell yet: back to the admin. AfriZoneMart
  // never sends the same reference twice, so pressing Pay again is safe.
  const note = answer.kind === "REFUSED" ? answer.error : `Could not reach AfriZoneMart (${answer.detail}). Press Pay again.`;
  await prisma.withdrawal.updateMany({ where: { id: w.id, status: "PROCESSING" }, data: { status: "REVIEW", failureReason: note } });
  return "REVIEW";
}

/**
 * Send a PROCESSING withdrawal. Only ever called after an admin pressed Pay
 * (routes/adminWithdrawals.ts). Through AfriZoneMart's Squad account when that
 * link is configured; otherwise Paystack if set; otherwise simulated.
 */
export async function sendPayout(
  withdrawal: WithdrawalRow & Record<string, unknown>,
  worker: WorkerRow,
  approvedBy = "system"
): Promise<{ status: number; body: unknown }> {
  // Real payout requires a NUBAN account + bank code on the worker.
  if ((isMartPayoutConfigured() || paystack.enabled) && (!worker.bankAccountNumber || !worker.bankCode)) {
    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: "FAILED", failureReason: "Missing payout account number / bank code" },
    });
    return {
      status: 400,
      body: { error: "Add a payout bank account (account number + bank code) before withdrawing." },
    };
  }

  if (isMartPayoutConfigured()) {
    const reference = withdrawal.reference ?? withdrawal.id;
    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { provider: "afrizonemart", providerRef: reference, failureReason: null },
    });
    const answer = await martPayouts.send({
      reference,
      workerId: withdrawal.workerId,
      amountNgn: withdrawal.amount,
      bankCode: worker.bankCode!,
      bankName: worker.bankName ?? "",
      accountNumber: worker.bankAccountNumber!,
      expectedName: worker.name,
      approvedBy,
    });
    const outcome = await applyMartAnswer(withdrawal, answer);
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
    if (outcome === "REVIEW") return { status: 502, body: { error: row.failureReason ?? "Not sent", withdrawal: row } };
    if (outcome === "FAILED") return { status: 422, body: { error: row.failureReason ?? "Not sent", withdrawal: row } };
    return { status: 201, body: row };
  }

  if (!paystack.enabled) return { status: 201, body: { ...withdrawal, simulated: true } };

  try {
    const recipientCode = await paystack.createRecipient({
      name: worker.name,
      accountNumber: worker.bankAccountNumber!,
      bankCode: worker.bankCode!,
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

/**
 * Ask AfriZoneMart where each sent payout stands (cron, every 5 minutes, and
 * the admin's "Check now"). Squad settles in seconds to hours.
 */
export async function reconcileMartPayouts(limit = 25): Promise<{ checked: number; paid: number; failed: number }> {
  if (!isMartPayoutConfigured()) return { checked: 0, paid: 0, failed: 0 };
  const rows = await prisma.withdrawal.findMany({
    where: { status: "PROCESSING", provider: "afrizonemart" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let paid = 0;
  let failed = 0;
  for (const w of rows) {
    const answer = await martPayouts.status(w.providerRef ?? w.reference ?? w.id);
    // Not knowing is not a failure: it was sent, so it stays PROCESSING.
    if (answer.kind !== "ACCEPTED") continue;
    const out = await applyMartAnswer(w, answer);
    if (out === "PAID") paid++;
    if (out === "FAILED") failed++;
  }
  return { checked: rows.length, paid, failed };
}
