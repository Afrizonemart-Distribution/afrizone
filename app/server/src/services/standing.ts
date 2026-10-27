/**
 * A Tasker's standing: New, Bronze, Silver or Gold, and the badges that go with
 * it (Blueprint §9).
 *
 * NOT A TIER. "Tier" in this codebase is the kind of work somebody is cleared
 * for (STUDENT, DISPATCH...), granted by an admin. Standing is how well they
 * have done the work they took, earned and never granted. The two must never
 * share a name, a column or a check.
 *
 * DERIVED, NEVER STORED. Like a credential's expiry, standing is a function of
 * facts that already exist - finished and cancelled contracts, ratings - so it
 * is computed on read. A stored level would need a job to keep it true and an
 * answer for every time the job did not run.
 *
 * DISPLAY ONLY, ON PURPOSE. The rankings (services/ranking.ts,
 * services/applicantRanking.ts) already read the record standing is made from.
 * Feeding the level back in would count the same history twice, and nobody
 * gets work, or is refused it, because of a badge.
 *
 * EVERY LEVEL SAYS WHAT THE NEXT ONE NEEDS. A badge a Tasker cannot see a way
 * to improve is a label; one that says "6 more finished jobs" is a goal.
 */
import { NO_HISTORY, loadContractHistory, type ContractHistory } from "./ranking";

export type StandingLevel = "NEW" | "BRONZE" | "SILVER" | "GOLD";

export interface StandingFacts {
  completed: number;
  cancelled: number;
  /** Average rating received, or null before anybody has rated them. */
  rating: number | null;
  /** How many ratings that average is over. */
  ratingCount: number;
  completedByCategory: Map<string, number>;
}

export interface Badge {
  key: string;
  label: string;
}

export interface Standing {
  level: StandingLevel;
  label: string;
  /** Null at Gold. Otherwise what is still missing for the next level, in words. */
  next: { level: StandingLevel; label: string; needs: string[] } | null;
  badges: Badge[];
}

interface Threshold {
  level: StandingLevel;
  label: string;
  completed: number;
  /** Finished out of finished + cancelled. */
  finishRate: number;
  rating: number;
  ratingCount: number;
}

/**
 * Each level asks for more of the same three things. A rating needs enough
 * ratings behind it to mean something: one five-star job is not Gold.
 * Constants for now, like the ranking weights - there is not yet enough
 * history to know where real Taskers fall.
 */
export const THRESHOLDS: Threshold[] = [
  { level: "BRONZE", label: "Bronze", completed: 1, finishRate: 0, rating: 0, ratingCount: 0 },
  { level: "SILVER", label: "Silver", completed: 10, finishRate: 0.85, rating: 4.0, ratingCount: 5 },
  { level: "GOLD", label: "Gold", completed: 30, finishRate: 0.95, rating: 4.5, ratingCount: 15 },
];

/** Finished work in one category that earns a specialist badge. */
export const SPECIALIST_AT = 5;
/** Finished jobs, none dropped, that earn "Finishes every job". */
export const NEVER_DROPPED_AT = 10;

function finishRate(f: StandingFacts): number {
  const total = f.completed + f.cancelled;
  return total === 0 ? 0 : f.completed / total;
}

/** What is still missing for one threshold. Empty means it is met. */
function missing(f: StandingFacts, t: Threshold): string[] {
  const out: string[] = [];
  if (f.completed < t.completed) {
    const n = t.completed - f.completed;
    out.push(`${n} more finished job${n === 1 ? "" : "s"}`);
  }
  if (t.finishRate > 0 && finishRate(f) < t.finishRate) {
    out.push(`Finish at least ${Math.round(t.finishRate * 100)}% of the jobs you take`);
  }
  if (t.ratingCount > 0 && f.ratingCount < t.ratingCount) {
    const n = t.ratingCount - f.ratingCount;
    out.push(`${n} more rating${n === 1 ? "" : "s"}`);
  }
  if (t.rating > 0 && (f.rating === null || f.rating < t.rating)) {
    out.push(`An average rating of ${t.rating.toFixed(1)} or more`);
  }
  return out;
}

/** Pure. */
export function standingFor(f: StandingFacts): Standing {
  let level: StandingLevel = "NEW";
  let label = "New";
  let next: Standing["next"] = null;
  for (const t of THRESHOLDS) {
    const needs = missing(f, t);
    if (needs.length > 0) {
      next = { level: t.level, label: t.label, needs };
      break;
    }
    level = t.level;
    label = t.label;
  }

  const badges: Badge[] = [];
  const specialties = [...f.completedByCategory.entries()]
    .filter(([, n]) => n >= SPECIALIST_AT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [category] of specialties) {
    badges.push({ key: `specialist:${category}`, label: `${category} specialist` });
  }
  if (f.completed >= NEVER_DROPPED_AT && f.cancelled === 0) {
    badges.push({ key: "never-dropped", label: "Finishes every job" });
  }

  return { level, label, next, badges };
}

/** The user columns standing reads. completedCount is the number of ratings received. */
export interface StandingUser {
  id: string;
  rating: number | null;
  completedCount: number;
}

function factsFor(u: StandingUser, h: ContractHistory): StandingFacts {
  return {
    completed: h.completed,
    cancelled: h.cancelled,
    rating: u.rating,
    ratingCount: u.completedCount,
    completedByCategory: h.completedByCategory,
  };
}

/** Standing for many workers in one query, from user rows the caller already has. */
export async function loadStandings(users: StandingUser[]): Promise<Map<string, Standing>> {
  const history = await loadContractHistory(users.map((u) => u.id));
  const out = new Map<string, Standing>();
  for (const u of users) out.set(u.id, standingFor(factsFor(u, history.get(u.id) ?? NO_HISTORY)));
  return out;
}

export async function loadStanding(user: StandingUser): Promise<Standing> {
  return (await loadStandings([user])).get(user.id)!;
}
