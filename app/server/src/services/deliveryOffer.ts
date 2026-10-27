/**
 * Who a delivery is offered to, and what happens when nobody takes it
 * (MART_INTEGRATION.md §6 D4).
 *
 * D4 was open until now. The answer taken: offer to couriers near the shop
 * first, widen the circle on a timer, and once it has waited long enough raise
 * it on the operations board for a person. No automatic fee increase - that is
 * a pricing decision with real cost exposure, it belongs to Blueprint §10 surge
 * pay, and none of that is built.
 *
 * THE RADIUS IS A PROPERTY OF THE POSTING, NOT A QUERY OVER COURIERS, and that
 * is the load-bearing decision in this file. PartTime stores no courier
 * location: `User.location` is free text and `CourierProfile` holds a vehicle
 * and a plate. There is nothing to run a "who is nearest" query against, and
 * inventing one would mean collecting and retaining live positions for every
 * rider - a standing privacy liability, a §5-shaped retention problem, and a
 * mobile release, all to answer a question that can be answered without any of
 * it. So the posting carries a circle that grows with time, and a courier
 * asking what they can claim says where they are in that request. The position
 * is used to answer and never written down.
 *
 * That also matches how this codebase already works: routes/clock.ts takes the
 * device's coordinates per request for the geofence, and routes/organizations.ts
 * measures the store map from a point supplied per request. This is the third
 * use of the same shape rather than a new one.
 *
 * RANKING IS THE ONE EXCEPTION, AND IT IS OPT-IN. Asking the best-placed
 * courier first (services/ranking.ts) needs to know who is near before anybody
 * asks, and nothing per-request can answer that. So a courier who taps "Go
 * online" leaves one point in CourierPresence, overwritten by each heartbeat and
 * deleted when they go offline or go quiet. The circle below still reads only
 * the position sent with the request; the stored one is used to rank and for
 * nothing else.
 *
 * EVERYTHING HERE IS DERIVED AT READ TIME. There is no timer and no queue -
 * including for the ranked phase: whose turn it is is the same arithmetic. The
 * per-minute cron only SENDS the "it is your turn" push; if it stopped, turns
 * would still pass on time, just silently. The radius at any moment is arithmetic on how long the order has
 * been waiting, which means it cannot drift, cannot be stale, and cannot stop
 * firing - the failure mode the delivery purge needs an audit row to make
 * visible does not exist for this. It is the same reason expired postings and
 * lapsed credentials are computed rather than swept.
 */
import { haversineMetres, isValidCoord } from "../util/geo";

/**
 * The knobs, all `rules.DELIVERY.*` per the convention in taskRules.ts.
 *
 * Deliberately NOT added to `TaskRule` there. Those five fields describe what
 * any generated task pays and who is qualified for it, and every kind of work
 * has an answer for each. A claim radius is meaningless for a remote media task
 * and would appear as a dead field on its admin rules card. Same key prefix,
 * separate concern.
 */
export interface OfferRule {
  /** Off disables self-claim entirely and the platform falls back to an admin
   *  approving an application, which is what it did before this existed. */
  selfClaim: boolean;
  /** How close a courier must be when the posting first goes up. */
  baseRadiusMetres: number;
  /** How long each doubling of the circle takes. */
  stepMinutes: number;
  /** Where the widening stops. Beyond a point "nearby" stops meaning anything
   *  and the honest answer is that nobody is coming, which is what escalation
   *  is for. */
  maxRadiusMetres: number;
  /** How long an unclaimed order waits before the operations board flags it. */
  escalateAfterMinutes: number;
  /** How many of the best-placed online couriers get the order to themselves,
   *  one after another, before the circle opens. 0 switches ranking off and the
   *  board behaves exactly as it did before services/ranking.ts existed. */
  rankedCandidates: number;
  /** How long each of them has it. */
  rankedWindowMinutes: number;
}

/**
 * Defaults sized for a city motorcycle courier, not asserted as correct.
 *
 * 3 km is a few minutes' ride; doubling every 5 minutes reaches the 15 km cap
 * in 15 minutes; 20 minutes unclaimed is long enough that somebody should look
 * at it. Every one of these is a `Setting`, because the right numbers are an
 * operational fact nobody knows before the first week of real orders.
 */
export const DEFAULT_OFFER_RULE: OfferRule = {
  selfClaim: true,
  baseRadiusMetres: 3_000,
  stepMinutes: 5,
  maxRadiusMetres: 15_000,
  escalateAfterMinutes: 20,
  // Three turns of two minutes: six minutes at most before the order opens to
  // everyone in range, which is short enough that a top three who are all
  // looking at something else cost the customer very little.
  rankedCandidates: 3,
  rankedWindowMinutes: 2,
};

const KEYS = {
  selfClaim: "rules.DELIVERY.selfClaim",
  baseRadiusMetres: "rules.DELIVERY.baseRadiusMetres",
  stepMinutes: "rules.DELIVERY.radiusStepMinutes",
  maxRadiusMetres: "rules.DELIVERY.maxRadiusMetres",
  escalateAfterMinutes: "rules.DELIVERY.escalateAfterMinutes",
  rankedCandidates: "rules.DELIVERY.rankedCandidates",
  rankedWindowMinutes: "rules.DELIVERY.rankedWindowMinutes",
} as const;

export const OFFER_SETTING_KEYS = Object.values(KEYS);

/**
 * The rule in force right now.
 *
 * `selfClaim` follows the `eligibility.enforce` precedent exactly: an absent row
 * means ON, and the literal string "off" is the only thing that disables it.
 * A kill-switch that needs a row to exist before it can be found is one nobody
 * finds at the moment they need it.
 */
export async function offerRule(p: any): Promise<OfferRule> {
  const rows = await p.setting.findMany({ where: { key: { in: OFFER_SETTING_KEYS } } });
  const set = new Map<string, string>(rows.map((r: any) => [r.key, String(r.value)]));

  const num = (key: string, fallback: number): number => {
    const raw = set.get(key);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    // A misconfigured number falls back rather than propagating. A radius of
    // NaN compares false against every distance, which would silently make
    // every delivery unclaimable and look exactly like an outage.
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  // Zero is a meaningful answer for a count - it switches ranking off - where
  // for a radius or a duration it would be a misconfiguration.
  const count = (key: string, fallback: number): number => {
    const raw = set.get(key);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };

  const claim = set.get(KEYS.selfClaim);
  return {
    selfClaim: claim === undefined ? true : claim.toLowerCase() !== "off",
    baseRadiusMetres: num(KEYS.baseRadiusMetres, DEFAULT_OFFER_RULE.baseRadiusMetres),
    stepMinutes: num(KEYS.stepMinutes, DEFAULT_OFFER_RULE.stepMinutes),
    maxRadiusMetres: num(KEYS.maxRadiusMetres, DEFAULT_OFFER_RULE.maxRadiusMetres),
    escalateAfterMinutes: num(
      KEYS.escalateAfterMinutes,
      DEFAULT_OFFER_RULE.escalateAfterMinutes
    ),
    rankedCandidates: count(KEYS.rankedCandidates, DEFAULT_OFFER_RULE.rankedCandidates),
    rankedWindowMinutes: num(KEYS.rankedWindowMinutes, DEFAULT_OFFER_RULE.rankedWindowMinutes),
  };
}

/**
 * How far along the escalation this order is.
 *
 * ESCALATED does NOT close the offer. It means a person should look, while the
 * job stays claimable by anyone in range - stopping couriers from taking an
 * order at the exact moment it is agreed nobody has taken it would be perverse.
 */
export type OfferStage = "RANKED" | "OFFERED" | "WIDENED" | "ESCALATED";

export interface OfferState {
  stage: OfferStage;
  /** The circle right now, in metres. */
  radiusMetres: number;
  /** How long it has been on the board. */
  waitingMinutes: number;
  /** How many times the circle has doubled. */
  widenings: number;
  /** The circle has stopped growing; distance will not help this order. */
  atMaxRadius: boolean;
  /** Long enough that operations should see it. */
  escalated: boolean;
  /** Wording for people. The enum name tells a courier nothing. */
  label: string;
  /** Whose turn it is, while the order is with its ranked candidates one at a
   *  time. Null once the circle is open to everyone. */
  turn: RankedTurn | null;
}

/** One candidate's exclusive window. */
export interface RankedTurn {
  /** Zero-based position in the frozen ranking. */
  index: number;
  workerId: string;
  /** Whole seconds left on this candidate's window. Seconds, not minutes: a
   *  two-minute window shown as "1 min" for its whole second half is useless
   *  to the person it belongs to. */
  secondsLeft: number;
  /** When the circle opens to everyone if none of the ranked candidates takes it. */
  opensToAllAt: Date;
}

/**
 * How many minutes the ranked phase lasts for a list of this length.
 *
 * Only as many turns as there are candidates: two couriers online is two turns,
 * not three with a dead one at the end that keeps everybody else waiting.
 */
export function rankedPhaseMinutes(rankedCount: number, rule: OfferRule): number {
  return Math.min(rankedCount, rule.rankedCandidates) * rule.rankedWindowMinutes;
}

/**
 * The frozen ranking as stored on the delivery. Tolerant by design: a column
 * that fails to parse means no ranking, which is the old open board, rather
 * than an order nobody can see.
 */
export function parseRanked(raw: string | null | undefined): { workerId: string; score: number; distanceMetres: number | null }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((c) => c && typeof c.workerId === "string") : [];
  } catch {
    return [];
  }
}

const MINUTE = 60_000;

/**
 * The offer as it stands at `now`.
 *
 * `offeredAt` null means the posting is not on the board - the store has not
 * accepted, or a courier already holds it. That is not the same as a circle of
 * zero, so it is refused rather than defaulted: a zero radius would render as a
 * live offer nobody on Earth is inside.
 */
export function offerStateAt(
  offeredAt: Date | null | undefined,
  now: Date,
  rule: OfferRule,
  ranked: { workerId: string }[] = [],
  skippedSeconds = 0
): OfferState | null {
  if (!offeredAt) return null;

  const elapsed = Math.max(0, now.getTime() - offeredAt.getTime());
  const waitingMinutes = Math.floor(elapsed / MINUTE);

  // PASSES MOVE THE TURN CLOCK, NOT THE CUSTOMER'S. Every window a courier
  // passed on ended early by the seconds they did not use, so the turns and the
  // circle are read from offeredAt shifted by that much. Escalation and
  // waitingMinutes stay on `elapsed`: nobody passing makes the customer's wait
  // any shorter.
  const skipped = Math.max(0, skippedSeconds) * 1000;
  const turnClock = elapsed + skipped;
  const turnsFrom = offeredAt.getTime() - skipped;

  // THE RANKED PHASE COMES FIRST, AND THE CIRCLE WAITS FOR IT. Escalation is
  // still measured from offeredAt - a customer waiting is a customer waiting,
  // whoever the order was with - but the circle only starts widening once it
  // opens to everyone. Otherwise six minutes of exclusive offers would open the
  // board at double the radius, to couriers twice as far away as it needed.
  const hold = rankedPhaseMinutes(ranked.length, rule) * MINUTE;
  if (turnClock < hold) {
    const index = Math.floor(turnClock / (rule.rankedWindowMinutes * MINUTE));
    const windowEnds = turnsFrom + (index + 1) * rule.rankedWindowMinutes * MINUTE;
    const escalated = waitingMinutes >= rule.escalateAfterMinutes;
    return {
      stage: escalated ? "ESCALATED" : "RANKED",
      radiusMetres: rule.baseRadiusMetres,
      waitingMinutes,
      widenings: 0,
      atMaxRadius: false,
      escalated,
      label: escalated
        ? `Unclaimed for ${waitingMinutes} min - needs a person`
        : `Offered to the best-placed courier (${index + 1} of ${Math.min(ranked.length, rule.rankedCandidates)})`,
      turn: {
        index,
        workerId: ranked[index].workerId,
        secondsLeft: Math.max(0, Math.ceil((windowEnds - now.getTime()) / 1000)),
        opensToAllAt: new Date(turnsFrom + hold),
      },
    };
  }

  const open = turnClock - hold;

  // Doubling rather than adding, because a courier who is not in the first
  // circle is usually well outside it, and stepping out in equal increments
  // spends the whole escalation window covering ground nobody is standing on.
  const steps = Math.floor(open / (rule.stepMinutes * MINUTE));
  const uncapped = rule.baseRadiusMetres * Math.pow(2, steps);
  const radiusMetres = Math.min(uncapped, rule.maxRadiusMetres);
  const atMaxRadius = uncapped >= rule.maxRadiusMetres;
  const widenings = Math.max(
    0,
    Math.round(Math.log2(radiusMetres / rule.baseRadiusMetres))
  );

  const escalated = waitingMinutes >= rule.escalateAfterMinutes;
  const stage: OfferStage = escalated ? "ESCALATED" : widenings > 0 ? "WIDENED" : "OFFERED";

  return {
    stage,
    radiusMetres,
    waitingMinutes,
    widenings,
    atMaxRadius,
    escalated,
    label: escalated
      ? `Unclaimed for ${waitingMinutes} min - needs a person`
      : widenings > 0
        ? `Offered ${waitingMinutes} min ago, circle widened`
        : "Offered to couriers nearby",
    turn: null,
  };
}

/**
 * Whether this courier, standing here, may take this job.
 *
 * A POSTING WITH NO COORDINATES IS OPEN TO EVERYONE QUALIFIED, and that is
 * deliberate rather than an oversight. The pickup point is copied from the
 * store, and a real share of approved businesses have never had their position
 * set - the admin map counts them on its own screen. Refusing to let anyone
 * claim those would make every order from an un-located shop undeliverable
 * forever, discovered as orders quietly rotting on the board. An unknown
 * distance is not a failed distance check.
 */
export type ReachResult =
  | { inRange: true; distanceMetres: number | null; radiusMetres: number }
  | { inRange: false; distanceMetres: number; radiusMetres: number };

export function reach(
  pickup: { lat: number | null; lng: number | null },
  courier: { lat: unknown; lng: unknown },
  state: OfferState
): ReachResult {
  if (!isValidCoord(pickup.lat, pickup.lng)) {
    return { inRange: true, distanceMetres: null, radiusMetres: state.radiusMetres };
  }
  if (!isValidCoord(courier.lat, courier.lng)) {
    // The courier could not say where they are. Distinguished from being too
    // far away by the caller, because "turn your location on" and "you are too
    // far from this shop" are different problems with different fixes.
    return { inRange: false, distanceMetres: Infinity, radiusMetres: state.radiusMetres };
  }

  const distanceMetres = haversineMetres(
    Number(courier.lat),
    Number(courier.lng),
    pickup.lat as number,
    pickup.lng as number
  );
  return distanceMetres <= state.radiusMetres
    ? { inRange: true, distanceMetres, radiusMetres: state.radiusMetres }
    : { inRange: false, distanceMetres, radiusMetres: state.radiusMetres };
}

/**
 * When the circle will next reach this courier, in minutes, or null if it never
 * will.
 *
 * This is the difference between "you cannot have this" and "wait four minutes",
 * and a courier who is told the second will still be on the app when it comes
 * round. Null means they are outside even the maximum circle.
 */
export function minutesUntilInRange(
  distanceMetres: number,
  offeredAt: Date,
  now: Date,
  rule: OfferRule,
  rankedCount = 0,
  skippedSeconds = 0
): number | null {
  if (!Number.isFinite(distanceMetres)) return null;
  if (distanceMetres > rule.maxRadiusMetres) return null;

  const stepsNeeded = Math.max(
    0,
    Math.ceil(Math.log2(distanceMetres / rule.baseRadiusMetres))
  );
  const readyAt =
    offeredAt.getTime() -
    Math.max(0, skippedSeconds) * 1000 +
    rankedPhaseMinutes(rankedCount, rule) * MINUTE +
    stepsNeeded * rule.stepMinutes * MINUTE;
  return Math.max(0, Math.ceil((readyAt - now.getTime()) / MINUTE));
}
