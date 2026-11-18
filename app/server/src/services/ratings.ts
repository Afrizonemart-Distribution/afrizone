/**
 * Two-way ratings (Blueprint §9), and what happens once both sides have spoken.
 *
 * One rule runs through this file and it is the easy one to get wrong:
 *
 *   `Rating.workerId` is the worker in the engagement in BOTH directions. They
 *   are the subject when the direction is OF_WORKER and the author when it is
 *   OF_EXPERIENCE. So "ratings where workerId = X" now returns ratings of X AND
 *   ratings written by X, and any average taken over that set is wrong.
 *
 * `User.rating` is the number that matters here: it is shown on a profile and
 * used to rank people for work. recomputeWorkerRating() below is the only thing
 * that should ever write it, and it filters on direction for exactly that
 * reason.
 */
import { prisma } from "../prisma";
import { transitionContract } from "./contractState";
import { userActor, type AuditActor } from "../util/audit";

export type RatingDirection = "OF_WORKER" | "OF_EXPERIENCE";
export const RATING_DIRECTIONS: RatingDirection[] = ["OF_WORKER", "OF_EXPERIENCE"];

/** A contract has to be at least this far along before anyone can rate it. */
const RATEABLE_FROM = ["VERIFIED", "PAID", "CLOSED"];

export function isRateable(contractStatus: string): boolean {
  return RATEABLE_FROM.includes(contractStatus);
}

/**
 * Recompute the worker's public rating and completed count.
 *
 * **Only counts OF_WORKER rows.** Without that filter a Partimer who rated three
 * jobs one star would drag their own profile down to one star, which is both
 * absurd and the kind of bug that is very hard to see once the numbers are
 * merely plausible.
 */
export async function recomputeWorkerRating(workerId: string) {
  const received = await prisma.rating.findMany({
    where: { workerId, direction: "OF_WORKER" },
    select: { score: true },
  });
  const avg =
    received.length > 0 ? received.reduce((s, r) => s + r.score, 0) / received.length : null;
  return prisma.user.update({
    where: { id: workerId },
    data: {
      rating: avg !== null ? Math.round(avg * 10) / 10 : null,
      completedCount: received.length,
    },
  });
}

/**
 * Close the engagement once both sides have rated.
 *
 * Blueprint §4.2 defines Closed as "ratings exchanged; record written to profile
 * history". So closing is not a separate admin action anybody has to remember -
 * it is what the second rating means. A contract that stayed open because nobody
 * pressed a button would make "finished" a matter of admin diligence rather than
 * of the work being done.
 *
 * Only moves a contract that is actually finishable: PAID. A VERIFIED contract
 * with both ratings still has money outstanding, and calling that Closed would
 * hide an unpaid worker.
 */
export async function closeIfBothSidesRated(
  taskId: string,
  workerId: string,
  actor: AuditActor
): Promise<boolean> {
  const directions = await prisma.rating.findMany({
    where: { taskId, workerId },
    select: { direction: true },
  });
  const seen = new Set(directions.map((d) => d.direction));
  if (!seen.has("OF_WORKER") || !seen.has("OF_EXPERIENCE")) return false;

  const contract = await prisma.contract.findFirst({
    where: { taskId, workerId },
    select: { id: true, status: true },
  });
  if (!contract || contract.status !== "PAID") return false;

  const res = await transitionContract(prisma, contract.id, "CLOSED", actor, {
    via: "both-sides-rated",
  });
  return res.ok;
}

/** Convenience wrapper for the common case: the actor is a person. */
export function ratingActor(userId: string): AuditActor {
  return userActor(userId);
}
