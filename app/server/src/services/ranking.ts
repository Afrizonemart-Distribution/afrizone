/**
 * Who gets a delivery first (Blueprint §11).
 *
 * Until this existed, an order went on the board to every qualified courier
 * inside a circle that widened with time, and the first to tap took it. That is
 * fair to couriers and blind to the customer: the rider two streets away with
 * nothing on and a clean record lost to whoever happened to be looking at their
 * phone. Now, before the circle opens, the order goes to the best-placed online
 * couriers one at a time, each with a short window to themselves.
 *
 * THE GATE IS STILL THE GATE. Ranking only ever orders couriers who already
 * pass services/eligibility.ts. Skill, tier and credentials decide who MAY do
 * the job; this decides who is asked first among them. A courier who scores well
 * and lacks a licence is not on the list at all.
 *
 * THE LIST IS FROZEN WHEN THE ORDER GOES UP. Re-ranking on every read would let
 * a courier's turn vanish mid-window because somebody else came online, which is
 * a worse experience than a slightly stale list, and it would make "whose turn
 * is it?" depend on when you asked. Whose turn it is stays arithmetic on
 * `offeredAt` - see offerStateAt in deliveryOffer.ts - so there is no queue and
 * nothing that can stop advancing. The one stored thing is how many candidates
 * have been told, because a notification is an event, and the per-minute cron
 * needs to know not to send it twice.
 *
 * NOBODY ONLINE IS NOT A FAILURE. An empty list means no ranked phase, and the
 * order goes straight to the open circle exactly as it did before. Ranking can
 * only ever add a few minutes in front of the old behaviour, never take it away.
 */
import { prisma } from "../prisma";
import { haversineMetres, isValidCoord } from "../util/geo";
import { sendPush } from "./push";
import { writeAudit, type AuditActor } from "../util/audit";
import { offerRule, offerStateAt, parseRanked, type OfferRule } from "./deliveryOffer";
import {
  blockingBlockers,
  decide,
  isEnforcing,
  loadTaskRequirements,
  loadWorkerProfile,
} from "./eligibility";

/** A heartbeat older than this means the courier is offline, whatever their row says. */
export const PRESENCE_TTL_MINUTES = 30;

const MINUTE = 60_000;

// ── The score ────────────────────────────────────────────────────────────────

/** Everything the score reads about one courier. */
export interface CandidateFacts {
  /** Null when the shop has no coordinates; nobody is nearer than anybody. */
  distanceMetres: number | null;
  /** Contracts that reached VERIFIED, PAID or CLOSED. */
  completed: number;
  /** Contracts that ended CANCELLED. */
  cancelled: number;
  /** Their average OF_WORKER rating, 1-5, or null before anybody has rated them. */
  rating: number | null;
  /** Jobs they are holding right now and have not finished. */
  activeLoad: number;
}

/**
 * The weights. Distance leads because a delivery is mostly a question of who
 * can get to the shop; reliability next because a courier who takes jobs and
 * drops them costs more than one who is a little further away. Rating and load
 * break the rest. They sum to 1, so a score reads as a percentage.
 *
 * Constants, not Settings, on purpose: four interacting weights on an admin
 * screen invite somebody to tune one at a time and wonder why it got worse. When
 * there is a week of real orders to tune against, that is the time to expose them.
 */
export const WEIGHTS = { distance: 0.45, reliability: 0.25, rating: 0.15, load: 0.15 } as const;

/**
 * Pure. 0 to 1, higher is better.
 *
 * EVERY UNKNOWN IS NEUTRAL, NOT ZERO. A courier on their first day has no
 * rating and no history, and scoring that as "worst" would mean a new rider
 * never gets an offer and so never builds the record that would get them one.
 */
export function scoreCandidate(f: CandidateFacts, rule: Pick<OfferRule, "maxRadiusMetres">): number {
  const distance =
    f.distanceMetres === null
      ? 0.5
      : Math.max(0, 1 - f.distanceMetres / rule.maxRadiusMetres);

  // Laplace-smoothed: no history reads as 50%, and one cancelled job out of one
  // is not treated the same as ten out of ten.
  const reliability = (f.completed + 1) / (f.completed + f.cancelled + 2);

  // A 1-5 scale onto 0-1. Unrated sits at 3.5, the middle of what real ratings
  // look like rather than the middle of the scale.
  const rating = ((f.rating ?? 3.5) - 1) / 4;

  // One job in hand halves it, two or more and they should finish what they
  // have. Not an exclusion: in a quiet hour a busy courier is still better than
  // nobody, and the eligibility gate - not this - is what says who may work.
  const load = f.activeLoad <= 0 ? 1 : f.activeLoad === 1 ? 0.5 : 0;

  const score =
    WEIGHTS.distance * distance +
    WEIGHTS.reliability * reliability +
    WEIGHTS.rating * Math.min(1, Math.max(0, rating)) +
    WEIGHTS.load * load;
  return Math.round(score * 1000) / 1000;
}

export interface RankedCandidate {
  workerId: string;
  score: number;
  distanceMetres: number | null;
}

/**
 * Best first. Ties go to the nearer courier, then to the id, so the same facts
 * always produce the same order - a list that reshuffles between two identical
 * runs is one nobody can reason about when a courier asks why they were skipped.
 */
export function orderCandidates(list: RankedCandidate[]): RankedCandidate[] {
  return [...list].sort(
    (a, b) =>
      b.score - a.score ||
      (a.distanceMetres ?? Infinity) - (b.distanceMetres ?? Infinity) ||
      a.workerId.localeCompare(b.workerId)
  );
}

// ── Who is online ────────────────────────────────────────────────────────────

export function presenceCutoff(now: Date): Date {
  return new Date(now.getTime() - PRESENCE_TTL_MINUTES * MINUTE);
}

/** Delete every row whose heartbeat has lapsed. Idempotent; safe to miss. */
export async function sweepPresence(now: Date = new Date()): Promise<number> {
  const gone = await prisma.courierPresence.deleteMany({
    where: { seenAt: { lt: presenceCutoff(now) } },
  });
  return gone.count;
}

// ── Ranking an order ─────────────────────────────────────────────────────────

const DONE_STATES = ["VERIFIED", "PAID", "CLOSED"];
const LIVE_STATES = ["CLAIMED", "IN_PROGRESS", "REWORK"];

/**
 * Score every online courier who may take this posting.
 *
 * Returns the whole ordered list; the caller keeps as many as the rule asks for.
 * Anybody who already has a contract on this task is left out. That is the
 * courier a re-opened order was taken from - the re-open does not cancel their
 * contract, it puts the order back on the board - and an order a rider
 * abandoned should not be offered straight back to them.
 */
export async function rankCouriers(
  taskId: string,
  pickup: { lat: number | null; lng: number | null },
  now: Date,
  rule: OfferRule
): Promise<RankedCandidate[]> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return [];

  const online = await prisma.courierPresence.findMany({
    where: { seenAt: { gte: presenceCutoff(now) } },
    include: { user: { select: { id: true, role: true, rating: true } } },
  });
  if (online.length === 0) return [];

  const [requirements, enforcing, dropped] = await Promise.all([
    loadTaskRequirements(prisma, [task]),
    isEnforcing(prisma),
    prisma.contract.findMany({ where: { taskId }, select: { workerId: true } }),
  ]);
  const reqs = requirements.get(task.id)!;
  const excluded = new Set(dropped.map((c) => c.workerId));
  const located = isValidCoord(pickup.lat, pickup.lng);

  const pool = online.filter((p) => p.user.role === "WORKER" && !excluded.has(p.userId));
  if (pool.length === 0) return [];
  const ids = pool.map((p) => p.userId);

  // History for the whole pool in one query rather than one per courier.
  const contracts = await prisma.contract.findMany({
    where: { workerId: { in: ids } },
    select: { workerId: true, status: true },
  });
  const history = new Map<string, { completed: number; cancelled: number; live: number }>();
  for (const c of contracts) {
    const h = history.get(c.workerId) ?? { completed: 0, cancelled: 0, live: 0 };
    if (DONE_STATES.includes(c.status)) h.completed += 1;
    else if (c.status === "CANCELLED") h.cancelled += 1;
    else if (LIVE_STATES.includes(c.status)) h.live += 1;
    history.set(c.workerId, h);
  }

  const ranked: RankedCandidate[] = [];
  for (const p of pool) {
    const distanceMetres = located
      ? haversineMetres(p.lat, p.lng, pickup.lat as number, pickup.lng as number)
      : null;
    // Further than the widest circle the order will ever reach is further than
    // anybody would be asked to ride for it on the open board, so they are not
    // asked first either.
    if (distanceMetres !== null && distanceMetres > rule.maxRadiusMetres) continue;

    // One profile per candidate. The pool is the couriers online at this moment,
    // which is small; if it stops being small, loadWorkerProfiles is the batch form.
    const profile = await loadWorkerProfile(prisma, p.userId, now);
    if (!profile) continue;
    if (blockingBlockers(decide(profile, reqs).blockers, enforcing).length > 0) continue;

    const h = history.get(p.userId) ?? { completed: 0, cancelled: 0, live: 0 };
    ranked.push({
      workerId: p.userId,
      distanceMetres: distanceMetres === null ? null : Math.round(distanceMetres),
      score: scoreCandidate(
        {
          distanceMetres,
          completed: h.completed,
          cancelled: h.cancelled,
          rating: p.user.rating,
          activeLoad: h.live,
        },
        rule
      ),
    });
  }

  return orderCandidates(ranked);
}

/**
 * Rank the order that has just gone on the board, freeze the list on it, and
 * tell the first candidate.
 *
 * Call it every time `offeredAt` is set - first posting and re-open alike. NEVER
 * FATAL: an order whose ranking failed is an order on the old open board, which
 * is a working state. One that failed to post because ranking threw is not.
 */
export async function freezeRanking(
  deliveryId: string,
  actor: AuditActor,
  now: Date = new Date()
): Promise<RankedCandidate[]> {
  try {
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery?.taskId || !delivery.offeredAt) return [];

    const rule = await offerRule(prisma);
    const top =
      rule.rankedCandidates > 0
        ? (await rankCouriers(delivery.taskId, { lat: delivery.pickupLat, lng: delivery.pickupLng }, now, rule)).slice(
            0,
            rule.rankedCandidates
          )
        : [];

    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { rankedCandidates: JSON.stringify(top), rankedNotified: 0, rankedSkippedSeconds: 0 },
    });
    await writeAudit(actor, "delivery.ranked", "Delivery", deliveryId, {
      candidates: top.map((c) => ({ workerId: c.workerId, score: c.score })),
    });

    await notifyTurn(deliveryId, now);
    return top;
  } catch (e) {
    console.error(`[ranking] delivery ${deliveryId}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * Tell whoever's turn it is, if they have not been told.
 *
 * The conditional update is what makes this safe to call from the cron and from
 * freezeRanking at once: only one caller moves the counter past this candidate,
 * and only that caller sends.
 *
 * Returns null when nobody was told. Otherwise the push in flight, so a
 * scheduled handler can keep the Worker alive until it has gone - resolved
 * already for somebody with no push token, who still has the inbox record.
 */
export async function notifyTurn(
  deliveryId: string,
  now: Date = new Date()
): Promise<{ workerId: string; push: Promise<void> } | null> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { organization: { select: { name: true } } },
  });
  if (!delivery || delivery.status !== "STORE_ACCEPTED") return null;

  const rule = await offerRule(prisma);
  const ranked = parseRanked(delivery.rankedCandidates);
  const state = offerStateAt(delivery.offeredAt, now, rule, ranked, delivery.rankedSkippedSeconds);
  if (!state?.turn || state.turn.index < delivery.rankedNotified) return null;

  const moved = await prisma.delivery.updateMany({
    where: { id: deliveryId, rankedNotified: delivery.rankedNotified },
    data: { rankedNotified: state.turn.index + 1 },
  });
  if (moved.count !== 1) return null;

  const workerId = state.turn.workerId;
  const minutes = Math.max(1, Math.ceil(state.turn.secondsLeft / 60));
  const title = "A delivery is yours to take";
  const body =
    `Pick up from ${delivery.organization?.name ?? "the shop"}. ` +
    `It is held for you for ${minutes} min, then offered to the next courier.`;
  const data = { screen: "deliveries", deliveryId };

  // notifyWorker's two channels, written out rather than called, because this is
  // the one caller that must hold on to the push: see the return value above.
  const user = await prisma.user.findUnique({
    where: { id: workerId },
    select: { pushToken: true, notifTasks: true },
  });
  if (!user) return null;
  await prisma.notification.create({
    data: { userId: workerId, title, body, data: JSON.stringify(data) },
  });
  if (!user.pushToken || !user.notifTasks) return { workerId, push: Promise.resolve() };
  return {
    workerId,
    push: sendPush([{ to: user.pushToken, title, body, data, sound: "default" }], prisma),
  };
}

export type PassResult =
  | { ok: true; nextTurn: { index: number } | null }
  | { ok: false; status: number; code: string; error: string };

/**
 * The courier whose turn it is gives it up before their window runs out.
 *
 * What is left of their window goes into `rankedSkippedSeconds`, which moves
 * the turn clock straight to the start of the next one; nothing else about the
 * ranked phase changes shape. The update is conditional on the value read, the
 * same guard notifyTurn uses, so a pass that races another pass, or the window
 * ending, cannot skip a candidate who never had their turn.
 */
export async function passTurn(
  deliveryId: string,
  workerId: string,
  now: Date = new Date()
): Promise<PassResult> {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return { ok: false, status: 404, code: "NOT_FOUND", error: "Not found" };
  if (delivery.status !== "STORE_ACCEPTED") {
    return { ok: false, status: 409, code: "NOT_AVAILABLE", error: "This job is no longer on the board" };
  }

  const rule = await offerRule(prisma);
  const ranked = parseRanked(delivery.rankedCandidates);
  const state = offerStateAt(delivery.offeredAt, now, rule, ranked, delivery.rankedSkippedSeconds);
  if (!state?.turn || state.turn.workerId !== workerId) {
    return { ok: false, status: 409, code: "NOT_YOUR_TURN", error: "This job is not being held for you" };
  }

  const moved = await prisma.delivery.updateMany({
    where: { id: deliveryId, rankedSkippedSeconds: delivery.rankedSkippedSeconds },
    data: { rankedSkippedSeconds: delivery.rankedSkippedSeconds + state.turn.secondsLeft },
  });
  if (moved.count !== 1) {
    return { ok: false, status: 409, code: "NOT_YOUR_TURN", error: "This job is not being held for you" };
  }

  await writeAudit({ type: "USER", userId: workerId }, "delivery.passed", "Delivery", deliveryId, {
    rankedTurn: state.turn.index,
    secondsLeft: state.turn.secondsLeft,
  });

  // Tell the next candidate now rather than at the next cron tick: the point
  // of passing is that they get the whole of their window. A miss here is
  // caught by the cron within the minute.
  const told = await notifyTurn(deliveryId, now);
  return { ok: true, nextTurn: told ? { index: state.turn.index + 1 } : null };
}

/**
 * The per-minute job: move every ranked order on to its next candidate, and
 * forget couriers who stopped sending heartbeats.
 *
 * Only orders still inside a possible ranked phase are read, so this stays a
 * handful of rows however long the platform runs.
 */
export async function advanceRankedOffers(now: Date = new Date()): Promise<{
  notified: number;
  pushes: Promise<void>[];
  swept: number;
}> {
  const rule = await offerRule(prisma);
  const longestPhase = rule.rankedCandidates * rule.rankedWindowMinutes * MINUTE;

  const live =
    longestPhase > 0
      ? await prisma.delivery.findMany({
          where: {
            status: "STORE_ACCEPTED",
            offeredAt: { gte: new Date(now.getTime() - longestPhase) },
            rankedCandidates: { not: null },
          },
          select: { id: true },
        })
      : [];

  const pushes: Promise<void>[] = [];
  let notified = 0;
  for (const d of live) {
    const told = await notifyTurn(d.id, now);
    if (told) {
      notified += 1;
      pushes.push(told.push);
    }
  }

  const swept = await sweepPresence(now);
  return { notified, pushes, swept };
}
