/**
 * The referral loop: people earn for bringing in new Taskers and stores that
 * turn out to be real (Blueprint §14).
 *
 * THE SHAPE, AS DECIDED:
 *
 *   Anybody with a Tasker account - store members included, since they sign in
 *   the same way - has a short code to hand out. Staff do not.
 *
 *   A new Tasker enters the code at sign-up, or afterwards from their profile,
 *   but only before their first job and within REFERRAL_CLAIM_DAYS of joining.
 *   A store is attributed by the admin who registers it. Whoever is claimed
 *   first keeps it: one referral per newcomer, never re-pointed.
 *
 *   It pays only when the newcomer is real. A Tasker: their first payment is
 *   released. A store: an admin approves it, after its audit. A fake sign-up
 *   never earns, because a fake sign-up never does paid work.
 *
 *   Only the referrer earns, and only the referrer is told.
 *
 * OFF UNTIL SOMEBODY SETS AN AMOUNT. Every naira is Afrizone's, so both rewards
 * are settings that start at 0. A referral whose moment comes while the reward
 * is 0 stays PENDING; it is not owed anything, and turning rewards on later
 * pays new moments, not old ones.
 *
 * THE REWARD IS FIXED WHEN EARNED. The amount, its 5% withholding tax and the
 * net are written on the row the moment it is earned, so the wallet reads a
 * figure and never today's setting. It is paid like work: into the referrer's
 * available balance, withdrawn the same way. See walletFrom in routes/me.ts and
 * the balance check in routes/wallet.ts - all three places read EARNED net.
 */
import crypto from "crypto";
import { prisma } from "../prisma";
import { notifyWorker } from "./push";
import { SYSTEM_ACTORS, writeAudit, type AuditActor } from "../util/audit";
import { computeWht } from "../util/tax";

export const REFERRAL_KEYS = {
  taskerReward: "referral.taskerReward",
  storeReward: "referral.storeReward",
} as const;

/** How long after joining a Tasker may still say who sent them. */
export const REFERRAL_CLAIM_DAYS = 30;

const WHT_RATE = 0.05;

/** No 0/O or 1/I/L: a code is read out over the phone and typed on a market stall. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function normaliseCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
}

export interface RewardRule {
  taskerReward: number;
  storeReward: number;
}

export async function rewardRule(): Promise<RewardRule> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(REFERRAL_KEYS) } } });
  const set = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const amount = (k: string) => {
    const n = set.get(k);
    return n !== undefined && Number.isInteger(n) && n > 0 ? n : 0;
  };
  return { taskerReward: amount(REFERRAL_KEYS.taskerReward), storeReward: amount(REFERRAL_KEYS.storeReward) };
}

/** This person's code, made on first ask. Null for staff, who do not refer. */
export async function codeFor(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, referralCode: true } });
  if (!user || user.role !== "WORKER") return null;
  if (user.referralCode) return user.referralCode;
  // A collision on a 6-character code over 31 letters is rare, and the unique
  // index catches it; try again rather than reason about the odds.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const set = await prisma.user.updateMany({
      where: { id: userId, referralCode: null },
      data: { referralCode: code },
    }).catch(() => ({ count: 0 }));
    if (set.count === 1) return code;
    const now = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (now?.referralCode) return now.referralCode;
  }
  throw new Error("Could not make a referral code");
}

type Fail = { ok: false; status: 400 | 404 | 409; error: string };

async function referrerByCode(raw: unknown): Promise<{ id: string; name: string } | null> {
  const code = normaliseCode(raw);
  if (!code) return null;
  return prisma.user.findFirst({ where: { referralCode: code, role: "WORKER" }, select: { id: true, name: true } });
}

/**
 * A new Tasker says who sent them. Refused once they have had a job or are past
 * the claim window - by then they found the work themselves - and refused for
 * their own code.
 */
export async function claimForTasker(
  userId: string,
  rawCode: unknown,
  now: Date = new Date()
): Promise<{ ok: true; referrerName: string } | Fail> {
  const referrer = await referrerByCode(rawCode);
  if (!referrer) return { ok: false, status: 404, error: "That referral code was not found" };
  if (referrer.id === userId) return { ok: false, status: 400, error: "You cannot use your own code" };

  const [user, existing, contracts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, role: true } }),
    prisma.referral.findUnique({ where: { referredUserId: userId } }),
    prisma.contract.count({ where: { workerId: userId } }),
  ]);
  if (!user || user.role !== "WORKER") return { ok: false, status: 404, error: "Tasker not found" };
  if (existing) return { ok: false, status: 409, error: "You have already said who referred you" };
  if (contracts > 0) {
    return { ok: false, status: 400, error: "A referral code can only be added before your first job" };
  }
  const days = (now.getTime() - user.createdAt.getTime()) / 864e5;
  if (days > REFERRAL_CLAIM_DAYS) {
    return {
      ok: false,
      status: 400,
      error: `A referral code can only be added in your first ${REFERRAL_CLAIM_DAYS} days`,
    };
  }

  try {
    await prisma.referral.create({ data: { kind: "TASKER", referrerId: referrer.id, referredUserId: userId } });
  } catch {
    return { ok: false, status: 409, error: "You have already said who referred you" };
  }
  await writeAudit({ type: "USER", userId }, "referral.claimed", "User", userId, { referrerId: referrer.id });
  return { ok: true, referrerName: referrer.name };
}

/** An admin registering a store records who brought it in. */
export async function claimForStore(
  organizationId: string,
  rawCode: unknown,
  actor: AuditActor
): Promise<{ ok: true; referrerName: string } | Fail> {
  const referrer = await referrerByCode(rawCode);
  if (!referrer) return { ok: false, status: 404, error: "That referral code was not found" };
  const member = await prisma.organizationMember.findFirst({
    where: { organizationId, userId: referrer.id },
    select: { id: true },
  });
  if (member) return { ok: false, status: 400, error: "A store cannot be referred by one of its own members" };
  const existing = await prisma.referral.findUnique({ where: { referredOrganizationId: organizationId } });
  if (existing) return { ok: false, status: 409, error: "This store already has a referrer" };

  await prisma.referral.create({
    data: { kind: "STORE", referrerId: referrer.id, referredOrganizationId: organizationId },
  });
  await writeAudit(actor, "referral.claimed", "Organization", organizationId, { referrerId: referrer.id });
  return { ok: true, referrerName: referrer.name };
}

/**
 * The moment a referral proves real. Idempotent and never fatal: a payment
 * release or a store approval must not fail because a bonus could not be
 * written, and calling this twice pays once.
 */
async function earn(
  where: { referredUserId: string } | { referredOrganizationId: string },
  amount: number,
  what: string
): Promise<void> {
  try {
    const referral = await prisma.referral.findFirst({ where: { ...where, status: "PENDING" } });
    if (!referral || amount <= 0) return;
    const { whtAmount, net } = computeWht(amount, WHT_RATE);
    const moved = await prisma.referral.updateMany({
      where: { id: referral.id, status: "PENDING" },
      data: { status: "EARNED", gross: amount, whtAmount, net, earnedAt: new Date() },
    });
    if (moved.count !== 1) return;
    await writeAudit(SYSTEM_ACTORS.referrals, "referral.earned", "Referral", referral.id, {
      referrerId: referral.referrerId,
      gross: amount,
      net,
    });
    await notifyWorker(
      prisma,
      referral.referrerId,
      "You earned a referral bonus 🎉",
      `${what}. ₦${net.toLocaleString("en-NG")} has been added to your wallet.`,
      { screen: "wallet" },
      "notifPay"
    );
  } catch (e) {
    console.error(`[referrals] ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A Tasker's payment was released; if it is their first, their referrer earns. */
export async function onPaymentReleased(workerId: string): Promise<void> {
  const released = await prisma.payment.count({ where: { workerId, status: "RELEASED" } });
  if (released < 1) return;
  const rule = await rewardRule();
  const user = await prisma.user.findUnique({ where: { id: workerId }, select: { name: true } });
  await earn({ referredUserId: workerId }, rule.taskerReward, `${user?.name ?? "Someone you referred"} was paid for their first job`);
}

/** A store was approved; its referrer earns. */
export async function onStoreApproved(organizationId: string): Promise<void> {
  const rule = await rewardRule();
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  await earn({ referredOrganizationId: organizationId }, rule.storeReward, `${org?.name ?? "A store you referred"} was approved`);
}

/** What this person has earned from referrals and can spend: the wallet's third input. */
export async function referralEarnings(userId: string): Promise<number> {
  const agg = await prisma.referral.aggregate({ where: { referrerId: userId, status: "EARNED" }, _sum: { net: true } });
  return agg._sum.net ?? 0;
}
