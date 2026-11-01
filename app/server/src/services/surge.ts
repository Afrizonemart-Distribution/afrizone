/**
 * Surge pay: a delivery nobody has taken pays more the longer it waits
 * (Blueprint §10).
 *
 * DELIVERIES ONLY. They are the one kind of work with a clock on it; any
 * other task's budget is already a field an admin can edit, and the applicant
 * queue is how those fill.
 *
 * OFF UNTIL SOMEBODY SWITCHES IT ON. Every naira of surge comes out of
 * Afrizone's margin - the courier's pay is the task budget, not the delivery
 * fee Mart charges the customer - so the platform does not start spending it
 * because a deploy happened. No steps configured means no surge, and the board
 * behaves exactly as it did before this file.
 *
 * ARITHMETIC ON `offeredAt`, LIKE THE CIRCLE. How much an order is paying right
 * now is a function of how long it has waited; nothing is swept and nothing
 * can stop advancing. It is measured on the real time waited, not the ranked
 * turn clock: a courier passing does not make the order any less late.
 *
 * LOCKED WHEN IT IS TAKEN. The courier sees a figure and claims at that figure.
 * services/assignment.ts writes it into the task budget at the claim, before
 * the pay is ring-fenced, so the contract, the commitment and the payment all
 * read the same number. The surge part is kept on the Delivery, so a re-open
 * can take it back off and the next courier's surge starts from the base rather
 * than on top of the last one.
 */
import { prisma } from "../prisma";
import { writeAudit, type AuditActor } from "../util/audit";

export interface SurgeStep {
  /** Minutes on the board before this step applies. */
  afterMinutes: number;
  /** Extra pay, as a percentage of the base fee. */
  percent: number;
}

export interface SurgeRule {
  /** Ascending by time, and never falling. Empty means surge is off. */
  steps: SurgeStep[];
  /** A ceiling on the extra in naira whatever the percentage says; 0 means none. */
  maxNaira: number;
}

export const SURGE_KEYS = {
  steps: "rules.DELIVERY.surgeSteps",
  maxNaira: "rules.DELIVERY.surgeMaxNaira",
} as const;

export const DEFAULT_SURGE_RULE: SurgeRule = { steps: [], maxNaira: 0 };

/** Surge is paid in whole ₦50s, rounded down so a step never exceeds its percentage. */
const ROUND_TO = 50;

const MINUTE = 60_000;

/**
 * "10:10,20:25" → after 10 minutes +10%, after 20 minutes +25%.
 *
 * Forgiving of spacing, strict about meaning. A step that is not two positive
 * numbers is dropped, and so is one that would pay LESS than the step before
 * it: an order that has waited longer must never become cheaper to take, or a
 * courier who held off would be punished for it. Percentages over 100 are
 * capped there - doubling the pay is already a decision, not a nudge.
 */
export function parseSurgeSteps(raw: string | undefined | null): SurgeStep[] {
  if (!raw) return [];
  const parsed: SurgeStep[] = [];
  for (const part of raw.split(",")) {
    const [m, p] = part.split(":").map((s) => Number(s.trim()));
    if (!Number.isFinite(m) || !Number.isFinite(p) || m <= 0 || p <= 0) continue;
    parsed.push({ afterMinutes: m, percent: Math.min(p, 100) });
  }
  parsed.sort((a, b) => a.afterMinutes - b.afterMinutes);
  const out: SurgeStep[] = [];
  for (const s of parsed) {
    const last = out[out.length - 1];
    if (last && (s.afterMinutes === last.afterMinutes || s.percent <= last.percent)) continue;
    out.push(s);
  }
  return out;
}

export function formatSurgeSteps(steps: SurgeStep[]): string {
  return steps.map((s) => `${s.afterMinutes}:${s.percent}`).join(",");
}

export async function surgeRule(p: any): Promise<SurgeRule> {
  const rows = await p.setting.findMany({ where: { key: { in: Object.values(SURGE_KEYS) } } });
  const set = new Map<string, string>(rows.map((r: any) => [r.key, String(r.value)]));
  const max = Number(set.get(SURGE_KEYS.maxNaira));
  return {
    steps: parseSurgeSteps(set.get(SURGE_KEYS.steps)),
    maxNaira: Number.isInteger(max) && max > 0 ? max : 0,
  };
}

export interface SurgeState {
  /** The percentage in force, 0 before the first step. */
  percent: number;
  /** Extra naira on top of the base fee, after rounding and the ceiling. */
  amount: number;
  /** The next step up, or null when there is none (off, or at the top). */
  next: { afterMinutes: number; percent: number; inMinutes: number } | null;
}

export const NO_SURGE: SurgeState = { percent: 0, amount: 0, next: null };

/** Pure. */
export function surgeAt(
  baseFee: number,
  offeredAt: Date | null | undefined,
  now: Date,
  rule: SurgeRule
): SurgeState {
  if (!offeredAt || rule.steps.length === 0 || baseFee <= 0) return NO_SURGE;
  const waited = Math.max(0, (now.getTime() - offeredAt.getTime()) / MINUTE);

  let percent = 0;
  let next: SurgeState["next"] = null;
  for (const s of rule.steps) {
    if (waited >= s.afterMinutes) percent = s.percent;
    else {
      next = { afterMinutes: s.afterMinutes, percent: s.percent, inMinutes: Math.ceil(s.afterMinutes - waited) };
      break;
    }
  }

  let amount = Math.floor((baseFee * percent) / 100 / ROUND_TO) * ROUND_TO;
  if (rule.maxNaira > 0) amount = Math.min(amount, rule.maxNaira);
  // A ceiling reached means further steps change nothing, so do not promise one.
  if (next && rule.maxNaira > 0 && amount >= rule.maxNaira) next = null;
  return { percent, amount, next };
}

/** What the posting pays before any surge: the budget minus a surge already locked into it. */
export function baseFee(budget: number | null | undefined, lockedSurge: number): number {
  return Math.max(0, (budget ?? 0) - lockedSurge);
}

/**
 * Write the surge in force into the posting's budget at the moment it is taken,
 * and return the budget that now applies. Called by services/assignment.ts
 * before the pay is ring-fenced.
 *
 * Steps only ever rise, so a courier who claims a moment after looking gets at
 * least the figure they saw, never less.
 */
export async function lockSurge(
  task: { id: string; budget: number | null },
  actor: AuditActor,
  now: Date
): Promise<number | null> {
  const delivery = await prisma.delivery.findUnique({
    where: { taskId: task.id },
    select: { id: true, offeredAt: true, surgeAmount: true },
  });
  if (!delivery) return task.budget;

  const base = baseFee(task.budget, delivery.surgeAmount);
  const state = surgeAt(base, delivery.offeredAt, now, await surgeRule(prisma));
  const budget = base + state.amount;
  if (budget === task.budget && state.amount === delivery.surgeAmount) return task.budget;

  await prisma.task.update({ where: { id: task.id }, data: { budget } });
  await prisma.delivery.update({ where: { id: delivery.id }, data: { surgeAmount: state.amount } });
  if (state.amount > 0) {
    await writeAudit(actor, "delivery.surge.locked", "Delivery", delivery.id, {
      baseFee: base,
      percent: state.percent,
      surgeAmount: state.amount,
    });
  }
  return budget;
}
