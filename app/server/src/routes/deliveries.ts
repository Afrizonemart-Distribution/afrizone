/**
 * Delivery, from the three sides that touch one (MART_INTEGRATION.md §3.1, §4).
 *
 * ONE ROUTER, THREE AUDIENCES, and each action names who may take it:
 *
 *   THE STORE accepts or refuses the order and says when it is packed. This is
 *   its own decision and nobody else's - PartTime holds no stock data, so the
 *   shop's answer is the only availability signal that exists.
 *
 *   THE COURIER, meaning the one person holding the contract on the posting,
 *   marks collection, completes against the customer's code, and reports a
 *   failed attempt. Not "any courier": the guard is the contract, because a
 *   worker who can name an id must not be able to mark somebody else's job
 *   collected.
 *
 *   AFRIZONE STAFF read every order and can cancel one, and can act for a store
 *   that answered by telephone. That last one is not a back door, it is the
 *   normal case for a shop that does not use the portal - and it is audited as
 *   having been done by staff, not by the store.
 *
 * THE CUSTOMER'S DETAILS ARE NOT ON THE POSTING. They are returned only to the
 * courier who holds the job and to staff. §5 lets PartTime hold a display name,
 * a number, a door and an instruction, for as long as it takes to deliver one
 * order - and a public task list is not that.
 */
import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { userActor, writeAudit } from "../util/audit";
import { requireOrgAccess } from "../util/organization";
import { formatDistance } from "../util/geo";
import { assignWorker } from "../services/assignment";
import {
  minutesUntilInRange,
  offerRule,
  offerStateAt,
  parseRanked,
  rankedPhaseMinutes,
  reach,
  type OfferRule,
  type OfferState,
} from "../services/deliveryOffer";
import {
  blockingBlockers,
  decide,
  isEnforcing,
  loadTaskRequirements,
  loadWorkerProfile,
} from "../services/eligibility";
import {
  DELIVERY_STATES,
  completeDelivery,
  isTerminal,
  markPrepared,
  postCourierTask,
  stateLabel,
  transitionDelivery,
} from "../services/delivery";
import { isMartOutboundConfigured } from "../services/martOutbound";
import { requireEvidence } from "../services/evidence";
import { passTurn } from "../services/ranking";
import { RETENTION_DAYS, purgeCustomerData, purgeStatus } from "../services/deliveryPurge";

const router = Router();
export const adminRouter = Router();

/**
 * Where this courier stands against the ranked phase of one order.
 *
 * OTHERS_TURN carries the words, because "somebody else has first refusal" and
 * "you are next, in about two minutes" are different things to be told, and
 * the second keeps a courier on the app.
 */
type TurnView =
  | { kind: "OPEN" }
  | { kind: "YOUR_TURN"; secondsLeft: number }
  | { kind: "OTHERS_TURN"; message: string; opensToYouInMinutes: number };

function turnFor(
  state: OfferState,
  ranked: { workerId: string }[],
  workerId: string,
  offeredAt: Date,
  rule: OfferRule,
  now: Date,
  skippedSeconds = 0
): TurnView {
  if (!state.turn) return { kind: "OPEN" };
  if (state.turn.workerId === workerId) {
    return { kind: "YOUR_TURN", secondsLeft: state.turn.secondsLeft };
  }

  const MINUTE = 60_000;
  const mine = ranked.findIndex((c) => c.workerId === workerId);
  const counted = Math.min(ranked.length, rule.rankedCandidates);
  if (mine > state.turn.index && mine < counted) {
    // Read from the same shifted clock as the turns: a pass ahead of you brings
    // your window forward.
    const startsAt =
      offeredAt.getTime() - skippedSeconds * 1000 + mine * rule.rankedWindowMinutes * MINUTE;
    const minutes = Math.max(1, Math.ceil((startsAt - now.getTime()) / MINUTE));
    return {
      kind: "OTHERS_TURN",
      message: `Offered to another courier first. If they pass, it is yours in about ${minutes} min`,
      opensToYouInMinutes: minutes,
    };
  }
  const opensAt = state.turn.opensToAllAt.getTime();
  const minutes = Math.max(1, Math.ceil((opensAt - now.getTime()) / MINUTE));
  return {
    kind: "OTHERS_TURN",
    // Passed or timed out, it is the same to them: their window is behind them.
    message:
      mine >= 0 && mine < state.turn.index
        ? `Your turn on this one has gone. It opens to everyone nearby in about ${minutes} min`
        : `Offered to the best-placed couriers first. Opens to everyone nearby in about ${minutes} min`,
    opensToYouInMinutes: minutes,
  };
}

/**
 * The order as everyone but the assigned courier and staff sees it: where it
 * came from, what state it is in, and nothing about the person waiting for it.
 */
function publicDelivery(d: any) {
  return {
    id: d.id,
    martOrderId: d.martOrderId,
    organizationId: d.organizationId,
    storeName: d.organization?.name ?? null,
    taskId: d.taskId,
    stockSource: d.stockSource,
    items: safeItems(d.items),
    pickupAddress: d.pickupAddress,
    pickupLat: d.pickupLat,
    pickupLng: d.pickupLng,
    goodsTotal: d.goodsTotal,
    deliveryFee: d.deliveryFee,
    expectedBy: d.expectedBy,
    status: d.status,
    statusLabel: stateLabel(d.status),
    preparedAt: d.preparedAt,
    storeDecidedAt: d.storeDecidedAt,
    storeNote: d.storeNote,
    assignedAt: d.assignedAt,
    pickedUpAt: d.pickedUpAt,
    deliveredAt: d.deliveredAt,
    failedAt: d.failedAt,
    failureReason: d.failureReason,
    createdAt: d.createdAt,
  };
}

/**
 * The same order, plus where it is going and who is waiting.
 *
 * `customerPurged` is returned explicitly rather than leaving the fields simply
 * null, because "we deleted this seven days ago, as promised" and "this order
 * never had a contact" are different facts and a blank field says neither.
 */
function withCustomer(d: any) {
  return {
    ...publicDelivery(d),
    dropoffAddress: d.dropoffAddress,
    dropoffLat: d.dropoffLat,
    dropoffLng: d.dropoffLng,
    dropoffInstructions: d.dropoffInstructions,
    customerName: d.customerName,
    customerPhone: d.customerPhone,
    customerPurged: !!d.customerPurgedAt,
  };
}

/** Items are stored as sent. A malformed blob must not break the whole screen. */
function safeItems(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Whether this user is Afrizone staff, for the routes both sides can call. */
function isStaff(req: AuthedRequest): boolean {
  return req.user?.role === "SUPER_ADMIN" || req.user?.role === "TASK_MANAGER";
}

/**
 * The store's own guard: a member of the organization this order belongs to, or
 * staff acting for a shop that answered by telephone.
 */
async function requireStoreSide(req: AuthedRequest, deliveryId: string) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { organization: true },
  });
  // 404 rather than 403 for a delivery this caller cannot address, for the same
  // reason requireOrgAccess does: 403 confirms the row exists, which turns an id
  // parameter into a directory of every order on the platform.
  if (!delivery) return { ok: false as const, status: 404, error: "Not found" };
  if (isStaff(req)) return { ok: true as const, delivery, asStaff: true };

  const access = await requireOrgAccess(req.user!.id, delivery.organizationId);
  if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
  return { ok: true as const, delivery, asStaff: false };
}

/**
 * The courier's guard: the one person holding a contract on this order's
 * posting. Not a role check - every courier account answers that the same way.
 */
async function deliveryEvidence(taskId: string, workerId: string, stage: "PICKUP" | "DROPOFF") {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: true as const };
  return requireEvidence(task, workerId, stage);
}

async function requireAssignedCourier(req: AuthedRequest, deliveryId: string) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { organization: true },
  });
  if (!delivery) return { ok: false as const, status: 404, error: "Not found" };
  if (!delivery.taskId) return { ok: false as const, status: 404, error: "Not found" };

  const contract = await prisma.contract.findFirst({
    where: { taskId: delivery.taskId, workerId: req.user!.id },
    select: { id: true, status: true },
  });
  if (!contract) return { ok: false as const, status: 404, error: "Not found" };
  return { ok: true as const, delivery, contract };
}

// ── The store ────────────────────────────────────────────────────────────────

/**
 * GET /api/organizations/:id/deliveries?status=
 *
 * Lives here rather than in routes/organizations.ts so that everything about a
 * delivery is in one file. Mounted on the organizations path because that is
 * what it is scoped to, and the id in the path is what requireOrgAccess checks.
 */
router.get("/organizations/:id/deliveries", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id);
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.delivery.findMany({
    where: {
      organizationId: access.org.id,
      ...(status && DELIVERY_STATES.includes(status as any) ? { status } : {}),
    },
    include: { organization: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  // The store gets the drop-off: they are packing the order and, for a
  // collection dispute, they need to be able to say where it was meant to go.
  res.json(rows.map(withCustomer));
});

/**
 * POST /api/deliveries/:id/accept → the store will fulfil this.
 *
 * Accepting is what posts the courier job, and the two are deliberately one
 * action rather than two: a store that accepted and then had to remember a
 * second step would leave orders sitting accepted and unposted, which looks
 * exactly like a delivery nobody wanted.
 */
router.post("/deliveries/:id/accept", requireAuth, async (req: AuthedRequest, res: Response) => {
  const guard = await requireStoreSide(req, req.params.id);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  const actor = userActor(req.user!.id);
  const moved = await transitionDelivery(guard.delivery.id, "STORE_ACCEPTED", actor, {
    meta: guard.asStaff ? { onBehalfOfStore: true } : {},
  });
  if (!moved.ok) return res.status(moved.status).json({ error: moved.error });

  const posted = await postCourierTask(guard.delivery.id, actor);
  const fresh = await prisma.delivery.findUnique({
    where: { id: guard.delivery.id },
    include: { organization: true },
  });

  // The order is accepted either way - that state change is committed. If the
  // posting failed, say so plainly rather than reporting success: an accepted
  // order with no job behind it is the failure that looks like nothing.
  res.json({
    ...withCustomer(fresh),
    posted: posted.posted || posted.reason === "ALREADY_POSTED",
    ...(posted.posted || posted.reason === "ALREADY_POSTED"
      ? {}
      : { warning: `The order is accepted but no courier job could be posted (${posted.reason}). Afrizone has been told.` }),
  });
});

/** POST /api/deliveries/:id/reject → the store cannot fulfil it. A reason is required. */
router.post("/deliveries/:id/reject", requireAuth, async (req: AuthedRequest, res: Response) => {
  const guard = await requireStoreSide(req, req.params.id);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  // Required, because rejection is the ONLY unavailability signal PartTime has -
  // it holds no stock data - and "no" without a reason tells Mart nothing they
  // can act on. §6 D3 leaves what they do with it to them.
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return res.status(400).json({ error: "Say why the order cannot be fulfilled" });

  const moved = await transitionDelivery(guard.delivery.id, "STORE_REJECTED", userActor(req.user!.id), {
    reason,
    meta: guard.asStaff ? { onBehalfOfStore: true } : {},
  });
  if (!moved.ok) return res.status(moved.status).json({ error: moved.error });

  const fresh = await prisma.delivery.findUnique({
    where: { id: guard.delivery.id },
    include: { organization: true },
  });
  res.json(withCustomer(fresh));
});

/** POST /api/deliveries/:id/prepared → packed and waiting for collection. */
router.post("/deliveries/:id/prepared", requireAuth, async (req: AuthedRequest, res: Response) => {
  const guard = await requireStoreSide(req, req.params.id);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  const marked = await markPrepared(guard.delivery.id, userActor(req.user!.id));
  if (!marked.ok) return res.status(marked.status).json({ error: marked.error });

  const fresh = await prisma.delivery.findUnique({
    where: { id: guard.delivery.id },
    include: { organization: true },
  });
  res.json(withCustomer(fresh));
});

// ── The courier, before the job is theirs ────────────────────────────────────

/**
 * GET /api/me/delivery-offers?lat=&lng= → what this courier can take right now.
 *
 * MART_INTEGRATION.md §6 D4. An order is offered in a circle around the shop
 * that widens as it waits; a courier says where they are and is told what is
 * within it. The position is used to answer this request and is never stored -
 * see the note at the top of services/deliveryOffer.ts for why the radius is a
 * property of the posting rather than a query over couriers.
 *
 * COORDINATES ARE OPTIONAL AND THE LIST IS STILL USEFUL WITHOUT THEM. A courier
 * whose phone refused location gets every offer with `claimable: false` and a
 * reason saying so, rather than an empty screen that looks like there is no work
 * - which is the same screen a courier sees on a quiet afternoon, and telling
 * the two apart matters to somebody deciding whether to go home.
 *
 * THE CUSTOMER IS NOT IN THIS RESPONSE. §5: the name, number and door go only to
 * the courier who holds the job. A list of jobs nobody has taken is not that.
 */
router.get("/me/delivery-offers", requireAuth, async (req: AuthedRequest, res: Response) => {
  const now = new Date();
  const rule = await offerRule(prisma);

  const open = await prisma.delivery.findMany({
    where: { status: "STORE_ACCEPTED", offeredAt: { not: null }, taskId: { not: null } },
    include: { organization: true },
    orderBy: { offeredAt: "asc" },
  });
  if (open.length === 0) return res.json({ selfClaim: rule.selfClaim, offers: [] });

  // Eligibility for every posting in one pass, the way the task feed does it.
  // Deciding per delivery would be a query per row on a screen a courier pulls
  // to refresh.
  const tasks = await prisma.task.findMany({
    where: { id: { in: open.map((d) => d.taskId!) }, status: "OPEN" },
  });
  const byTaskId = new Map(tasks.map((t) => [t.id, t]));

  const [profile, requirements, enforcing] = await Promise.all([
    loadWorkerProfile(prisma, req.user!.id, now),
    loadTaskRequirements(prisma, tasks),
    isEnforcing(prisma),
  ]);
  if (!profile) return res.status(404).json({ error: "Tasker not found" });

  const offers = open.flatMap((d) => {
    const task = byTaskId.get(d.taskId!);
    // The posting is gone or already filled. The delivery row lags by one write
    // in that window, and showing a job that cannot be taken is worse than
    // showing one fewer.
    if (!task) return [];

    const ranked = parseRanked(d.rankedCandidates);
    const state = offerStateAt(d.offeredAt, now, rule, ranked, d.rankedSkippedSeconds);
    if (!state) return [];

    const eligibility = decide(profile, requirements.get(task.id)!);
    const blockers = blockingBlockers(eligibility.blockers, enforcing);
    const near = reach(
      { lat: d.pickupLat, lng: d.pickupLng },
      { lat: req.query.lat, lng: req.query.lng },
      state
    );
    const turn = turnFor(state, ranked, req.user!.id, d.offeredAt!, rule, now, d.rankedSkippedSeconds);

    // One reason, and the most fixable one first. A courier looking at a job
    // they cannot take needs to know which single thing to do about it, not a
    // ranked list of everything wrong.
    let reason: string | null = null;
    if (!rule.selfClaim) reason = "Jobs are being assigned by the team just now";
    else if (blockers.length > 0) reason = blockers[0].message;
    else if (turn.kind === "OTHERS_TURN") reason = turn.message;
    else if (turn.kind === "OPEN" && !near.inRange) {
      reason = Number.isFinite(near.distanceMetres)
        ? `You are ${formatDistance(near.distanceMetres)} away; this job is open to couriers within ${formatDistance(near.radiusMetres)}`
        : "Turn on location to take jobs near you";
    }

    let waiting: number | null = null;
    if (turn.kind === "OTHERS_TURN") waiting = turn.opensToYouInMinutes;
    else if (turn.kind === "OPEN" && !near.inRange && Number.isFinite(near.distanceMetres)) {
      waiting = minutesUntilInRange(near.distanceMetres, d.offeredAt!, now, rule, ranked.length, d.rankedSkippedSeconds);
    }

    return [
      {
        ...publicDelivery({ ...d, organization: d.organization }),
        fee: task.budget,
        offer: state,
        distanceMetres: near.distanceMetres,
        distance:
          near.distanceMetres !== null && Number.isFinite(near.distanceMetres)
            ? formatDistance(near.distanceMetres)
            : null,
        // Your turn means it is yours to take wherever you are standing: you
        // were ranked from the position you went online with, and the circle is
        // for everyone else.
        claimable:
          rule.selfClaim &&
          blockers.length === 0 &&
          (turn.kind === "YOUR_TURN" || (turn.kind === "OPEN" && near.inRange)),
        reason,
        blockers,
        // Seconds left on a window held for this courier; null when it is not theirs.
        yourTurnSecondsLeft: turn.kind === "YOUR_TURN" ? turn.secondsLeft : null,
        // Null when they are outside even the widest circle this order will
        // reach. "Wait four minutes" keeps a courier on the app; a promise that
        // never comes true does not.
        opensToYouInMinutes: waiting,
      },
    ];
  });

  res.json({ selfClaim: rule.selfClaim, offers });
});

/**
 * POST /api/deliveries/:id/claim → this courier is taking it. Body {lat, lng}.
 *
 * The change this whole file was waiting for. Assignment on this platform has
 * always been an admin approving an application, which is correct for a
 * week-long task and much too slow for an order that has to move within the
 * hour.
 *
 * It goes through services/assignment.ts, the same function the admin approval
 * runs, and that is the point rather than an implementation detail: the comment
 * this replaced said a delivery-specific claim route "would eventually disagree
 * with this one about who holds a job". Sharing the body is how that stays
 * untrue - one contract, one commitment, one order status move, written once.
 *
 * EVERY REFUSAL HERE NAMES ITSELF. Too far, not qualified, already taken and
 * switched off are four different problems with four different things to do
 * about them, and a courier who taps Claim and gets one flat "cannot claim" will
 * try again, and again, on a job that will never be theirs.
 */
router.post("/deliveries/:id/claim", requireAuth, async (req: AuthedRequest, res: Response) => {
  const now = new Date();
  const rule = await offerRule(prisma);
  if (!rule.selfClaim) {
    return res.status(409).json({
      error: "Jobs are being assigned by the team just now",
      code: "SELF_CLAIM_OFF",
    });
  }

  const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!delivery || !delivery.taskId) return res.status(404).json({ error: "Not found" });
  if (delivery.status !== "STORE_ACCEPTED") {
    return res.status(409).json({
      error:
        delivery.status === "COURIER_ASSIGNED"
          ? "Somebody else took this job just now"
          : `This order is "${stateLabel(delivery.status)}"`,
      code: "NOT_AVAILABLE",
    });
  }

  const ranked = parseRanked(delivery.rankedCandidates);
  const state = offerStateAt(delivery.offeredAt, now, rule, ranked, delivery.rankedSkippedSeconds);
  if (!state) {
    return res.status(409).json({ error: "This job is not on the board", code: "NOT_OFFERED" });
  }

  // While the order is with its ranked candidates, only the one whose turn it
  // is may take it - that is what "offered to the best-placed courier" means.
  const turn = turnFor(state, ranked, req.user!.id, delivery.offeredAt!, rule, now, delivery.rankedSkippedSeconds);
  if (turn.kind === "OTHERS_TURN") {
    return res.status(409).json({
      error: turn.message,
      code: "RANKED_TURN",
      opensToYouInMinutes: turn.opensToYouInMinutes,
    });
  }

  // The distance gate, before the assignment. This is the only check the shared
  // assignment path does not make - it knows about qualifications and slots, and
  // nothing about where anybody is standing. Skipped on your own turn: you
  // were chosen for where you are, and the circle is for everyone else.
  const near = reach(
    { lat: delivery.pickupLat, lng: delivery.pickupLng },
    { lat: req.body?.lat, lng: req.body?.lng },
    state
  );
  if (turn.kind === "OPEN" && !near.inRange) {
    if (!Number.isFinite(near.distanceMetres)) {
      return res.status(400).json({
        error: "Turn on location to take jobs near you",
        code: "NO_LOCATION",
      });
    }
    const opensIn = minutesUntilInRange(near.distanceMetres, delivery.offeredAt!, now, rule, ranked.length, delivery.rankedSkippedSeconds);
    return res.status(403).json({
      error: `You are ${formatDistance(near.distanceMetres)} from the shop; this job is open to couriers within ${formatDistance(near.radiusMetres)}`,
      code: "TOO_FAR",
      distanceMetres: near.distanceMetres,
      radiusMetres: near.radiusMetres,
      opensToYouInMinutes: opensIn,
    });
  }

  const result = await assignWorker({
    taskId: delivery.taskId,
    workerId: req.user!.id,
    actor: userActor(req.user!.id),
    source: "SELF_CLAIM",
    now,
  });

  if (!result.ok) {
    return res.status(result.status).json({
      error: result.error,
      code: result.status === 409 ? "TAKEN" : "NOT_QUALIFIED",
      ...(result.blockers ? { blockers: result.blockers } : {}),
      ...(result.eligibility ? { eligibility: result.eligibility } : {}),
    });
  }

  await writeAudit(userActor(req.user!.id), "delivery.claimed", "Delivery", delivery.id, {
    martOrderId: delivery.martOrderId,
    taskId: delivery.taskId,
    contractId: result.contractId,
    waitingMinutes: state.waitingMinutes,
    radiusMetres: state.radiusMetres,
    distanceMetres: near.distanceMetres,
    // Which ranked candidate took it, or null if it went on the open board.
    rankedTurn: turn.kind === "YOUR_TURN" ? state.turn!.index : null,
  });

  // The full view, customer included - it is theirs now, and the next thing they
  // need is the door they are taking it to.
  const fresh = await prisma.delivery.findUnique({
    where: { id: delivery.id },
    include: { organization: true },
  });
  res.status(201).json({ ...withCustomer(fresh), contractId: result.contractId });
});

/**
 * POST /api/deliveries/:id/pass → the courier whose turn it is does not want it.
 *
 * Before this, the only way to say no was to let the two minutes run, which
 * held the order hostage to somebody who had already decided. Passing gives the
 * rest of the window to the next candidate, who is told at once, and passing as
 * the last one opens the circle. It does not take the passer off the order: once
 * it is open to everyone they may still claim it like anybody else in range.
 */
router.post("/deliveries/:id/pass", requireAuth, async (req: AuthedRequest, res: Response) => {
  const result = await passTurn(req.params.id, req.user!.id);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  res.json({ passed: true, nextTurn: result.nextTurn });
});

// ── The courier ──────────────────────────────────────────────────────────────

/**
 * GET /api/me/deliveries → the orders this courier is carrying.
 *
 * Keyed on the contracts they hold, not on their account type: what makes a
 * delivery theirs is having been given the job.
 */
router.get("/me/deliveries", requireAuth, async (req: AuthedRequest, res: Response) => {
  const contracts = await prisma.contract.findMany({
    where: { workerId: req.user!.id, task: { kind: "DELIVERY" } },
    select: { taskId: true, id: true, status: true },
  });
  if (contracts.length === 0) return res.json([]);

  const rows = await prisma.delivery.findMany({
    where: { taskId: { in: contracts.map((c) => c.taskId) } },
    include: { organization: true },
    orderBy: { createdAt: "desc" },
  });
  const byTask = new Map(contracts.map((c) => [c.taskId, c]));
  res.json(
    rows.map((d) => ({
      ...withCustomer(d),
      contractId: d.taskId ? byTask.get(d.taskId)?.id ?? null : null,
      contractStatus: d.taskId ? byTask.get(d.taskId)?.status ?? null : null,
    }))
  );
});

/** GET /api/deliveries/:id → one order, to the courier holding it. */
router.get("/deliveries/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const guard = await requireAssignedCourier(req, req.params.id);
  if (!guard.ok) {
    // Fall back to the store side, so a shopkeeper opening a link to their own
    // order is not told it does not exist.
    const store = await requireStoreSide(req, req.params.id);
    if (!store.ok) return res.status(store.status).json({ error: store.error });
    const full = await prisma.delivery.findUnique({
      where: { id: store.delivery.id },
      include: { organization: true },
    });
    return res.json(withCustomer(full));
  }
  const full = await prisma.delivery.findUnique({
    where: { id: guard.delivery.id },
    include: { organization: true },
  });
  res.json({ ...withCustomer(full), contractId: guard.contract.id });
});

/** POST /api/deliveries/:id/picked-up → the goods have left the shop. */
router.post("/deliveries/:id/picked-up", requireAuth, async (req: AuthedRequest, res: Response) => {
  const guard = await requireAssignedCourier(req, req.params.id);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  // A photo at the shop, so "collected" is something a store can be shown.
  const shown = await deliveryEvidence(guard.delivery.taskId!, req.user!.id, "PICKUP");
  if (!shown.ok) return res.status(400).json(shown);

  const moved = await transitionDelivery(guard.delivery.id, "PICKED_UP", userActor(req.user!.id), {
    meta: { contractId: guard.contract.id },
  });
  if (!moved.ok) return res.status(moved.status).json({ error: moved.error });

  const fresh = await prisma.delivery.findUnique({
    where: { id: guard.delivery.id },
    include: { organization: true },
  });
  res.json(withCustomer(fresh));
});

/**
 * POST /api/deliveries/:id/complete → the customer's code, checked with Mart.
 *
 * The only route that can produce a delivered order. See completeDelivery: a
 * courier tapping a button is not a delivery, and 503 here means "we could not
 * ask", which is not the same as a wrong code and must not be shown as one.
 */
router.post("/deliveries/:id/complete", requireAuth, async (req: AuthedRequest, res: Response) => {
  const guard = await requireAssignedCourier(req, req.params.id);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  // The door photo BEFORE the code, which spends one of the customer's
  // attempts at Mart - asking for the photo afterwards would burn an attempt
  // on a completion that was always going to be refused.
  const shown = await deliveryEvidence(guard.delivery.taskId!, req.user!.id, "DROPOFF");
  if (!shown.ok) return res.status(400).json(shown);

  const result = await completeDelivery(
    guard.delivery.id,
    String(req.body?.code ?? ""),
    userActor(req.user!.id)
  );
  if (!result.ok) {
    return res.status(result.status).json({
      error: result.error,
      ...(result.remainingAttempts !== undefined
        ? { remainingAttempts: result.remainingAttempts }
        : {}),
      ...(result.status === 503 ? { retryable: true } : {}),
    });
  }

  const fresh = await prisma.delivery.findUnique({
    where: { id: guard.delivery.id },
    include: { organization: true },
  });
  res.json(withCustomer(fresh));
});

/**
 * POST /api/deliveries/:id/failed → attempted and not completed.
 *
 * MART_INTEGRATION.md §6 D6 is open: whether a failed attempt is paid, who
 * decides, and whether returning the goods is a second paid leg. Nothing here
 * answers that - it records the fact and tells Mart, and the contract stays
 * where it is so that whoever decides has something to decide about.
 */
router.post("/deliveries/:id/failed", requireAuth, async (req: AuthedRequest, res: Response) => {
  const guard = await requireAssignedCourier(req, req.params.id);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return res.status(400).json({ error: "Say what happened" });

  const moved = await transitionDelivery(guard.delivery.id, "FAILED", userActor(req.user!.id), {
    reason,
    meta: { contractId: guard.contract.id },
  });
  if (!moved.ok) return res.status(moved.status).json({ error: moved.error });

  const fresh = await prisma.delivery.findUnique({
    where: { id: guard.delivery.id },
    include: { organization: true },
  });
  res.json(withCustomer(fresh));
});

// ── Afrizone staff ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/deliveries?status=&storeId=
 *
 * The operations board. `stuck=1` narrows it to orders that are live and are
 * waiting on somebody - which is the list an operator actually works from,
 * rather than every order ever placed.
 *
 * `escalated=1` is the answer to the second half of MART_INTEGRATION.md §6 D4:
 * the circle has widened as far as it is going to and nobody has taken the job,
 * so a person has to. Derived from how long the posting has been up rather than
 * flagged by a sweep - there is no timer here and nothing to fall behind, which
 * matters because an escalation that quietly stops firing is an order nobody is
 * told about.
 */
adminRouter.get(
  "/",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const storeId = typeof req.query.storeId === "string" ? req.query.storeId : undefined;
    const stuck = req.query.stuck === "1" || req.query.stuck === "true";
    const escalatedOnly = req.query.escalated === "1" || req.query.escalated === "true";

    const rows = await prisma.delivery.findMany({
      where: {
        ...(status && DELIVERY_STATES.includes(status as any) ? { status } : {}),
        ...(storeId ? { organizationId: storeId } : {}),
        ...(stuck
          ? { status: { in: ["RECEIVED", "STORE_ACCEPTED", "COURIER_ASSIGNED", "PICKED_UP"] } }
          : {}),
        // Unclaimed only. An order a courier is already carrying is not waiting
        // for one, however long ago it was posted.
        ...(escalatedOnly ? { status: "STORE_ACCEPTED", offeredAt: { not: null } } : {}),
      },
      include: { organization: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const now = new Date();
    const rule = await offerRule(prisma);
    const decorated = rows.map((d) => ({
      ...withCustomer(d),
      // Null for anything not on the board, which is most of them.
      offer: offerStateAt(d.offeredAt, now, rule, parseRanked(d.rankedCandidates), d.rankedSkippedSeconds),
    }));

    res.json({
      // Whether the other half of the integration is wired up. An operator
      // looking at an order that will not complete needs to know the difference
      // between a courier problem and an unconfigured verifier.
      martConfigured: isMartOutboundConfigured(),
      // Off means couriers cannot take jobs themselves and every order is
      // waiting on an approval. The board is where somebody would notice.
      selfClaim: rule.selfClaim,
      // The count an operator acts on, and it is over the whole board rather
      // than this page of it - a filtered view must not report "nothing is
      // escalated" because the escalated ones are on page two.
      escalatedCount: await countEscalated(now, rule),
      deliveries: escalatedOnly ? decorated.filter((d) => d.offer?.escalated) : decorated,
    });
  }
);

/**
 * How many unclaimed orders have waited past the escalation threshold.
 *
 * Counted with a date bound in the query rather than by loading rows and
 * filtering them, so it stays one indexed count no matter how busy the platform
 * gets. `Delivery_status_offeredAt_idx` is what makes it cheap.
 */
async function countEscalated(now: Date, rule: { escalateAfterMinutes: number }): Promise<number> {
  const threshold = new Date(now.getTime() - rule.escalateAfterMinutes * 60_000);
  return prisma.delivery.count({
    where: { status: "STORE_ACCEPTED", offeredAt: { not: null, lte: threshold } },
  });
}

/**
 * GET /api/admin/deliveries/purge → is the retention promise being kept?
 *
 * MART_INTEGRATION.md §5: "the purge is auditable and its failure visible". A
 * screen showing the backlog and when the sweep last ran is what makes it
 * visible; without one, a cron that stopped firing in March is discovered by
 * somebody asking an awkward question in November.
 *
 * ABOVE /:id, because Express matches in order and "purge" would otherwise be
 * read as a delivery id.
 */
adminRouter.get(
  "/purge",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (_req: AuthedRequest, res: Response) => {
    const status = await purgeStatus();
    res.json({ ...status, retentionDays: RETENTION_DAYS });
  }
);

/**
 * POST /api/admin/deliveries/purge → run the sweep now.
 *
 * SUPER_ADMIN only. The scheduled run is what actually keeps the promise; this
 * is for draining a backlog after an outage, and for proving to somebody asking
 * that the thing works. It does exactly what the cron does, including writing
 * its audit row.
 */
adminRouter.post(
  "/purge",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const result = await purgeCustomerData(userActor(req.user!.id));
    res.json({ ...result, retentionDays: RETENTION_DAYS });
  }
);

/** GET /api/admin/deliveries/:id → one order, with its trail. */
adminRouter.get(
  "/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { organization: true, task: true },
    });
    if (!delivery) return res.status(404).json({ error: "Not found" });

    const trail = await prisma.auditLog.findMany({
      where: { entity: "Delivery", entityId: delivery.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const contracts = delivery.taskId
      ? await prisma.contract.findMany({
          where: { taskId: delivery.taskId },
          include: { worker: { select: { id: true, name: true, phone: true } } },
        })
      : [];

    res.json({
      ...withCustomer(delivery),
      task: delivery.task
        ? { id: delivery.task.id, title: delivery.task.title, status: delivery.task.status }
        : null,
      couriers: contracts.map((c) => ({
        contractId: c.id,
        status: c.status,
        workerId: c.workerId,
        name: c.worker?.name ?? null,
        phone: c.worker?.phone ?? null,
      })),
      trail: trail.map((t) => ({
        id: t.id,
        action: t.action,
        createdAt: t.createdAt,
        meta: t.meta,
      })),
    });
  }
);

/**
 * POST /api/admin/deliveries/:id/cancel → called off.
 *
 * Staff only, and terminal. Mart is NOT told: §4 lists no event for it, because
 * an order called off was called off by one of the two systems and both already
 * know.
 */
adminRouter.post(
  "/:id/cancel",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Say why it is being cancelled" });

    const moved = await transitionDelivery(req.params.id, "CANCELLED", userActor(req.user!.id), {
      reason,
    });
    if (!moved.ok) return res.status(moved.status).json({ error: moved.error });

    const fresh = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { organization: true },
    });
    res.json(withCustomer(fresh));
  }
);

/**
 * POST /api/admin/deliveries/:id/reopen → the courier vanished; offer it again.
 *
 * §6 D5, the half that is settled: a courier who accepts and then disappears
 * releases the job. How long that takes before somebody notices is still open,
 * which is why this is a person pressing a button rather than a timer.
 */
adminRouter.post(
  "/:id/reopen",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
    if (!delivery) return res.status(404).json({ error: "Not found" });
    if (isTerminal(delivery.status)) {
      return res.status(409).json({ error: `This order is already "${stateLabel(delivery.status)}"` });
    }

    const actor = userActor(req.user!.id);
    const moved = await transitionDelivery(delivery.id, "STORE_ACCEPTED", actor, {
      reason: String(req.body?.reason ?? "").trim() || "The courier did not collect",
    });
    if (!moved.ok) return res.status(moved.status).json({ error: moved.error });

    // The posting has to go back on the board, or a re-opened order is one
    // nobody can see. postCourierTask adopts the existing task where there is
    // one, so this does not mint a second job for the same order.
    //
    // The task is reopened FIRST: posting ranks the order and tells the first
    // candidate it is theirs, and a courier who taps straight away must not
    // find the slot still marked filled.
    if (delivery.taskId) {
      await prisma.task.update({ where: { id: delivery.taskId }, data: { status: "OPEN" } });
    }
    const posted = await postCourierTask(delivery.id, actor);

    const fresh = await prisma.delivery.findUnique({
      where: { id: delivery.id },
      include: { organization: true },
    });
    res.json({ ...withCustomer(fresh), taskId: posted.taskId ?? delivery.taskId });
  }
);

export default router;
