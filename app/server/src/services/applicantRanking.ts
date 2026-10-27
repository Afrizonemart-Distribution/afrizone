/**
 * Who should be approved first, for every task that is not a delivery
 * (Blueprint §11).
 *
 * Deliveries are offered (services/ranking.ts): an order cannot wait for a
 * human, so the platform picks and asks. Everything else is still
 * apply-then-approve, and stays that way - a store audit or a week of shelf
 * work is a decision a task manager should make with a name in front of them.
 * What was missing is ordering. The review queue was newest-first, so the
 * applicant with ten finished jobs in this category sat below whoever applied a
 * minute ago, and the manager had to open each one to find that out.
 *
 * THIS ORDERS; IT DOES NOT DECIDE. Nobody is approved, rejected or hidden by
 * a score. The manager sees the same applicants as before, best first, with the
 * reasons in words.
 *
 * THE GATE IS STILL THE GATE. An applicant who has stopped qualifying since
 * they applied - a credential lapsed, a tier withdrawn - is not scored. They are
 * listed after everybody who does qualify, with the blocker, because the
 * approval would refuse them anyway and the override is a separate, audited act.
 *
 * NO DISTANCE. Couriers send a position while online; other Taskers never do,
 * and `User.location` is free text. Proximity would be a guess dressed as a
 * number, so it is left out rather than faked. On-site work still has the
 * geofence at clock-in.
 *
 * COMPUTED ON READ, NOTHING STORED. Unlike a delivery, nobody holds a turn, so
 * there is nothing a re-rank could take away from anybody. A fresher order is
 * simply a better one.
 */
import { prisma } from "../prisma";
import {
  blockingBlockers,
  decide,
  isEnforcing,
  loadTaskRequirements,
  loadWorkerProfile,
} from "./eligibility";
import {
  NO_HISTORY,
  loadContractHistory,
  loadScore,
  ratingScore,
  reliabilityScore,
  type ContractHistory,
} from "./ranking";

// ── The score ────────────────────────────────────────────────────────────────

/** Everything the score reads about one applicant for one task. */
export interface ApplicantFacts {
  /** Self-reported years on each skill the task requires; null where they gave none. */
  skillYears: (number | null)[];
  /** Contracts they finished on tasks in this task's category. */
  categoryDone: number;
  completed: number;
  cancelled: number;
  rating: number | null;
  activeLoad: number;
}

/**
 * Fit leads because, with no distance to weigh, "has done this before" is the
 * best predictor there is; reliability is close behind for the same reason as
 * on deliveries. They sum to 1, so a score reads as a percentage. Constants,
 * for the reason given beside the delivery weights.
 */
export const APPLICANT_WEIGHTS = { fit: 0.35, reliability: 0.3, rating: 0.2, load: 0.15 } as const;

/** Years past this are not better for ranking; five years and twenty are both "experienced". */
const YEARS_CAP = 5;

/**
 * 0.5 to 1. EXPERIENCE CAN ONLY LIFT. Everybody qualifying starts at the
 * middle; years on the required skills and finished work in the category each
 * add up to a quarter. Somebody new, or on a task that asks for no skills,
 * sits at 0.5 rather than at the bottom - the same rule as every other unknown.
 */
export function fitScore(skillYears: (number | null)[], categoryDone: number): number {
  const years =
    skillYears.length === 0
      ? 0
      : skillYears.reduce<number>((sum, y) => sum + Math.min(Math.max(y ?? 0, 0), YEARS_CAP) / YEARS_CAP, 0) /
        skillYears.length;
  // n / (n + 2): one job is a third of the way, a handful is most of it.
  const done = categoryDone / (categoryDone + 2);
  return 0.5 + 0.25 * years + 0.25 * done;
}

/** Pure. 0 to 1, higher is better. */
export function scoreApplicant(f: ApplicantFacts): number {
  const score =
    APPLICANT_WEIGHTS.fit * fitScore(f.skillYears, f.categoryDone) +
    APPLICANT_WEIGHTS.reliability * reliabilityScore(f.completed, f.cancelled) +
    APPLICANT_WEIGHTS.rating * ratingScore(f.rating) +
    APPLICANT_WEIGHTS.load * loadScore(f.activeLoad);
  return Math.round(score * 1000) / 1000;
}

/**
 * The score in words, for the manager. Only what is actually known is said:
 * a line about somebody's rating when nobody has rated them would be invented.
 */
export function applicantReasons(f: ApplicantFacts, category: string): string[] {
  const out: string[] = [];
  if (f.categoryDone > 0) out.push(`${f.categoryDone} done in ${category}`);
  const years = f.skillYears.filter((y): y is number => y !== null && y > 0);
  if (years.length > 0) out.push(`${Math.max(...years)} yr${Math.max(...years) === 1 ? "" : "s"} on a required skill`);
  if (f.completed + f.cancelled === 0) out.push("No finished jobs yet");
  else {
    out.push(`${f.completed} finished`);
    if (f.cancelled > 0) out.push(`${f.cancelled} cancelled`);
  }
  if (f.rating !== null) out.push(`Rated ${f.rating.toFixed(1)}`);
  if (f.activeLoad > 0) out.push(`${f.activeLoad} job${f.activeLoad === 1 ? "" : "s"} in hand`);
  return out;
}

// ── Ranking a queue ──────────────────────────────────────────────────────────

export type ApplicantRank =
  | { eligible: true; position: number; score: number; reasons: string[] }
  | { eligible: false; position: null; score: null; reasons: string[] };

export interface RankableApplication {
  id: string;
  taskId: string;
  workerId: string;
  createdAt: Date;
  task: { id: string; category: string; tier: string; requiresIdentityVerified: boolean; requirementsVersion: number };
  worker: { rating: number | null };
}

/**
 * Best first. Ties go to whoever applied first, then to the id, so the same
 * facts always give the same order.
 */
export function orderApplicants<T extends { score: number; createdAt: Date; id: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      b.score - a.score ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );
}

/**
 * Rank every application handed in, within its own task. Callers pass only
 * pending (APPLIED) applications; a decided one has nothing left to order.
 *
 * A fixed number of queries for the queue plus one profile per distinct
 * applicant - the same trade rankCouriers makes, for the same reason.
 */
export async function rankApplications(
  apps: RankableApplication[],
  now: Date = new Date()
): Promise<Map<string, ApplicantRank>> {
  const out = new Map<string, ApplicantRank>();
  if (apps.length === 0) return out;

  const tasks = [...new Map(apps.map((a) => [a.task.id, a.task])).values()];
  const workerIds = [...new Set(apps.map((a) => a.workerId))];

  const [requirements, enforcing, history, skills] = await Promise.all([
    loadTaskRequirements(prisma, tasks),
    isEnforcing(prisma),
    loadContractHistory(workerIds),
    prisma.workerSkill.findMany({
      where: { workerId: { in: workerIds } },
      select: { workerId: true, skillId: true, years: true },
    }),
  ]);

  const years = new Map<string, number | null>();
  for (const s of skills) years.set(`${s.workerId}:${s.skillId}`, s.years);

  const profiles = new Map<string, Awaited<ReturnType<typeof loadWorkerProfile>>>();
  for (const id of workerIds) profiles.set(id, await loadWorkerProfile(prisma, id, now));

  const byTask = new Map<string, RankableApplication[]>();
  for (const a of apps) {
    const list = byTask.get(a.taskId) ?? [];
    list.push(a);
    byTask.set(a.taskId, list);
  }

  for (const [taskId, list] of byTask) {
    const reqs = requirements.get(taskId)!;
    const scored: { id: string; createdAt: Date; score: number; reasons: string[] }[] = [];

    for (const a of list) {
      const profile = profiles.get(a.workerId);
      const blocking = profile ? blockingBlockers(decide(profile, reqs).blockers, enforcing) : [];
      if (!profile || blocking.length > 0) {
        out.set(a.id, {
          eligible: false,
          position: null,
          score: null,
          reasons: [profile ? `No longer qualifies: ${blocking[0].message}` : "Tasker not found"],
        });
        continue;
      }

      const h: ContractHistory = history.get(a.workerId) ?? NO_HISTORY;
      const facts: ApplicantFacts = {
        skillYears: reqs.skills.map((s) => years.get(`${a.workerId}:${s.id}`) ?? null),
        categoryDone: h.completedByCategory.get(a.task.category) ?? 0,
        completed: h.completed,
        cancelled: h.cancelled,
        rating: a.worker.rating,
        activeLoad: h.live,
      };
      scored.push({
        id: a.id,
        createdAt: a.createdAt,
        score: scoreApplicant(facts),
        reasons: applicantReasons(facts, a.task.category),
      });
    }

    orderApplicants(scored).forEach((s, i) =>
      out.set(s.id, { eligible: true, position: i + 1, score: s.score, reasons: s.reasons })
    );
  }

  return out;
}
