/**
 * One Mart order, from confirmed to delivered (MART_INTEGRATION.md §3.1, §4).
 *
 * `order.confirmed` has been answered 202 DEFERRED since the event bus shipped,
 * because there was no assignment path, no pickup and drop-off, and no way to
 * prove a customer got their goods. This is the first two. The third - the
 * customer OTP - is Mart's to generate and verify; see services/martOutbound.ts.
 *
 * THE STATUS AXIS HERE IS THE ORDER'S, NOT THE COURIER'S. `Contract.status`
 * already tracks one person's engagement with one posting, and it is the right
 * place for "in progress" and "paid". What it cannot hold is "the store has not
 * accepted this yet", a state that exists before any courier does and that can
 * end the order without one. Those need different people to act on them, and
 * collapsing them makes "did the rider fail, or did the store refuse?"
 * unanswerable.
 *
 * PREPARED IS A TIMESTAMP, NOT A STATE, for the same reason `Contract.signedAt`
 * is: whether the store has finished packing and how far the order has got are
 * two different questions, and a courier may well accept the job while the
 * shopkeeper is still bagging it. Making it a state forces an order through a
 * sequence that real shops do not respect.
 */
import { prisma } from "../prisma";
import { generateTask } from "./taskGenerator";
import { reportToMart, verifyDeliveryOtp, type OutboundEvent } from "./martOutbound";
import { auditData, writeAudit, type AuditActor } from "../util/audit";
import { freezeRanking } from "./ranking";

export type DeliveryState =
  | "RECEIVED"
  | "STORE_ACCEPTED"
  | "STORE_REJECTED"
  | "COURIER_ASSIGNED"
  | "PICKED_UP"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

export const DELIVERY_STATES: DeliveryState[] = [
  "RECEIVED",
  "STORE_ACCEPTED",
  "STORE_REJECTED",
  "COURIER_ASSIGNED",
  "PICKED_UP",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
];

/**
 * Legal moves. Read as "from → the states it may move to".
 *
 * The one that looks like a mistake and is not: COURIER_ASSIGNED can go back to
 * STORE_ACCEPTED. That is MART_INTEGRATION.md §6 D5 - a courier accepts and then
 * disappears - and the answer recorded there is that the posting re-opens. Every
 * other backwards move is absent deliberately: goods that have left the shop
 * cannot become goods that never left it.
 */
export const TRANSITIONS: Record<DeliveryState, DeliveryState[]> = {
  // Mart has confirmed it; the store has not answered. Nothing is posted yet.
  RECEIVED: ["STORE_ACCEPTED", "STORE_REJECTED", "CANCELLED"],

  // The store will fulfil. The courier posting exists from this point, and the
  // store may still be packing - see the note on preparedAt above.
  STORE_ACCEPTED: ["COURIER_ASSIGNED", "CANCELLED", "FAILED"],

  // A courier holds it. Back to STORE_ACCEPTED if they vanish.
  COURIER_ASSIGNED: ["PICKED_UP", "STORE_ACCEPTED", "CANCELLED", "FAILED"],

  // Goods are with the rider. There is no way back from here that is not a
  // failure, because the shop no longer has the order.
  PICKED_UP: ["DELIVERED", "FAILED"],

  // Terminal. Reached only through a verified customer code - see the
  // otpVerified guard in transitionDelivery.
  DELIVERED: [],
  // Terminal. The store cannot fulfil; §1 says Mart decides what happens next.
  STORE_REJECTED: [],
  // Terminal. Attempted and not completed, or abandoned before pickup.
  FAILED: [],
  // Terminal. Called off by Mart or by Afrizone.
  CANCELLED: [],
};

export const TERMINAL_STATES: DeliveryState[] = [
  "DELIVERED",
  "STORE_REJECTED",
  "FAILED",
  "CANCELLED",
];

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state as DeliveryState);
}

export function canTransition(from: string, to: string): boolean {
  if (!DELIVERY_STATES.includes(from as DeliveryState)) return false;
  if (!DELIVERY_STATES.includes(to as DeliveryState)) return false;
  return TRANSITIONS[from as DeliveryState].includes(to as DeliveryState);
}

/** Wording for people. Never the enum name - "STORE_ACCEPTED" tells nobody anything. */
const LABELS: Record<DeliveryState, string> = {
  RECEIVED: "Waiting for the store",
  STORE_ACCEPTED: "Store is packing",
  STORE_REJECTED: "Store cannot fulfil",
  COURIER_ASSIGNED: "Courier on the way to collect",
  PICKED_UP: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED: "Not completed",
  CANCELLED: "Cancelled",
};

export function stateLabel(state: string): string {
  return LABELS[state as DeliveryState] ?? state;
}

/**
 * Which column records the moment of each move. A state change that does not
 * stamp its own time leaves "how long did the store take?" answerable only by
 * reading the audit log, which is not a query operations should have to write.
 */
const STAMP: Partial<Record<DeliveryState, string>> = {
  STORE_ACCEPTED: "storeDecidedAt",
  STORE_REJECTED: "storeDecidedAt",
  COURIER_ASSIGNED: "assignedAt",
  PICKED_UP: "pickedUpAt",
  DELIVERED: "deliveredAt",
  FAILED: "failedAt",
};

/**
 * What Mart is told when a delivery reaches each state (MART_INTEGRATION.md §4).
 *
 * CANCELLED has no entry on purpose: §4 lists no event for it, because an order
 * called off was called off by Mart or by Afrizone and both already know. There
 * is nothing to report that the other side did not initiate.
 */
const REPORTS: Partial<Record<DeliveryState, OutboundEvent>> = {
  STORE_ACCEPTED: "order.store_accepted",
  STORE_REJECTED: "order.store_rejected",
  COURIER_ASSIGNED: "order.courier_assigned",
  PICKED_UP: "order.picked_up",
  DELIVERED: "order.delivered",
  FAILED: "order.delivery_failed",
};

// ── The order as Mart sends it ───────────────────────────────────────────────

export const STOCK_SOURCES = ["CONSIGNMENT", "OWN_STOCK"] as const;
export type StockSource = (typeof STOCK_SOURCES)[number];

export interface ParsedOrder {
  martOrderId: string;
  storeSlug: string;
  stockSource: StockSource;
  items: unknown[];
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  dropoffInstructions: string | null;
  customerName: string | null;
  customerPhone: string | null;
  goodsTotal: number;
  deliveryFee: number;
  expectedBy: Date | null;
}

/** Thrown for a payload we understood well enough to refuse. Becomes a 400. */
export class OrderRejected extends Error {}

function coord(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function naira(v: unknown): number {
  const n = Math.trunc(Number(v));
  // Negative money is not a rounding question, it is a corrupt payload, and
  // storing it would put a negative line into a settlement report.
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Validate one `order.confirmed` payload, or say why not.
 *
 * `stockSource` is the field the whole integration document exists for: it
 * carries the money consequence, PartTime cannot infer it, and an absent value
 * is REJECTED rather than defaulted. A wrong default is a store paid twice or
 * not at all, discovered weeks later in reconciliation, where reconstructing
 * the truth from receipts is a project rather than a fix.
 */
export function parseOrder(data: Record<string, any>): ParsedOrder {
  const martOrderId = typeof data?.martOrderId === "string" ? data.martOrderId.trim() : "";
  if (!martOrderId) throw new OrderRejected("martOrderId is required");

  const storeSlug =
    typeof data?.fulfilment?.storeSlug === "string" ? data.fulfilment.storeSlug.trim() : "";
  if (!storeSlug) throw new OrderRejected("fulfilment.storeSlug is required");

  const stockSource = data?.fulfilment?.stockSource;
  if (!STOCK_SOURCES.includes(stockSource)) {
    throw new OrderRejected(
      `fulfilment.stockSource must be one of ${STOCK_SOURCES.join(", ")} - it is never defaulted`
    );
  }

  const dropoffAddress =
    typeof data?.dropoff?.address === "string" ? data.dropoff.address.trim() : "";
  if (!dropoffAddress) throw new OrderRejected("dropoff.address is required");

  const expectedBy = data?.expectedBy ? new Date(String(data.expectedBy)) : null;
  if (expectedBy && Number.isNaN(expectedBy.getTime())) {
    throw new OrderRejected("expectedBy is not a date");
  }

  return {
    martOrderId,
    storeSlug,
    stockSource,
    items: Array.isArray(data?.items) ? data.items : [],
    dropoffAddress,
    dropoffLat: coord(data?.dropoff?.lat),
    dropoffLng: coord(data?.dropoff?.lng),
    dropoffInstructions:
      typeof data?.dropoff?.instructions === "string" ? data.dropoff.instructions : null,
    customerName: typeof data?.customer?.displayName === "string" ? data.customer.displayName : null,
    customerPhone: typeof data?.customer?.phone === "string" ? data.customer.phone : null,
    goodsTotal: naira(data?.money?.goodsTotal),
    deliveryFee: naira(data?.money?.deliveryFee),
    expectedBy,
  };
}

export type IntakeOutcome =
  | { created: true; deliveryId: string }
  | { created: false; reason: "DUPLICATE"; deliveryId: string };

/**
 * Record a confirmed order.
 *
 * De-duplicated on `martOrderId`, not on the event id: Mart may legitimately
 * re-confirm an order under a new event, and that must find this row rather
 * than dispatch a second courier to the same address.
 *
 * NO TASK IS CREATED HERE. The posting waits for the store to accept, because a
 * courier sent to collect from a shop that has not agreed to pack the order
 * rides to a closed door. That is the store's decision and it has its own
 * screen.
 */
export async function recordOrder(order: ParsedOrder, actor: AuditActor): Promise<IntakeOutcome> {
  const existing = await prisma.delivery.findUnique({
    where: { martOrderId: order.martOrderId },
    select: { id: true },
  });
  if (existing) return { created: false, reason: "DUPLICATE", deliveryId: existing.id };

  const store = await prisma.organization.findUnique({
    where: { slug: order.storeSlug },
    select: { id: true, address: true, lat: true, lng: true, status: true },
  });
  // A headless order - one belonging to no store we know - is worse than a
  // refused one: nobody can be asked to pack it and nobody is accountable for
  // it. Refusing puts the problem back where the store list is maintained.
  if (!store) throw new OrderRejected(`No store with slug "${order.storeSlug}"`);

  const delivery = await prisma.delivery.create({
    data: {
      martOrderId: order.martOrderId,
      organizationId: store.id,
      stockSource: order.stockSource,
      items: JSON.stringify(order.items),
      // Copied, not joined: a store that moves must not rewrite where
      // deliveries already made actually went.
      pickupAddress: store.address,
      pickupLat: store.lat,
      pickupLng: store.lng,
      dropoffAddress: order.dropoffAddress,
      dropoffLat: order.dropoffLat,
      dropoffLng: order.dropoffLng,
      dropoffInstructions: order.dropoffInstructions,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      goodsTotal: order.goodsTotal,
      deliveryFee: order.deliveryFee,
      expectedBy: order.expectedBy,
      status: "RECEIVED",
    },
  });

  await writeAudit(actor, "delivery.received", "Delivery", delivery.id, {
    martOrderId: order.martOrderId,
    storeSlug: order.storeSlug,
    stockSource: order.stockSource,
    // Deliberately NOT the customer's name, number or door. An audit row is
    // kept indefinitely and §5 commits us to deleting those seven days after
    // the order finishes; copying them here would quietly defeat the purge.
    storeStatus: store.status,
  });

  // "Queued", per §4. Mart already knows it sent this - our 201 says as much -
  // but the report is what their fulfilment view keys on, and skipping it would
  // leave PartTime the only system that knows the order landed.
  await reportToMart("order.received", order.martOrderId, { deliveryId: delivery.id });

  return { created: true, deliveryId: delivery.id };
}

// ── Moving one along ─────────────────────────────────────────────────────────

export type TransitionResult =
  | { ok: true; from: DeliveryState; to: DeliveryState }
  | { ok: false; status: 400 | 404 | 409; error: string };

export interface TransitionOptions {
  /** Recorded on the row, for FAILED and STORE_REJECTED. */
  reason?: string;
  /**
   * Set only after Mart has verified the customer's code.
   * MART_INTEGRATION.md §4: "there is no path where a courier tapping a button
   * produces order.delivered". This flag is that sentence, enforced.
   */
  otpVerified?: boolean;
  meta?: Record<string, unknown>;
}

/**
 * Move one delivery, or explain why not.
 *
 * The row and its audit entry are written in ONE transaction. A state change
 * that lands without its audit row is exactly the gap that makes a delivery
 * dispute unreconstructable, and these are the transitions a courier's pay
 * hangs off.
 *
 * Idempotent on a no-op: asking for the state it is already in succeeds and
 * writes nothing, so a retried tap on a bad connection is not an error and does
 * not produce a second audit row describing one action as two.
 */
export async function transitionDelivery(
  deliveryId: string,
  to: DeliveryState,
  actor: AuditActor,
  options: TransitionOptions = {}
): Promise<TransitionResult> {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return { ok: false, status: 404, error: "Delivery not found" };

  const from = delivery.status as DeliveryState;
  if (from === to) return { ok: true, from, to };

  if (!canTransition(from, to)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot go from "${stateLabel(from)}" to "${stateLabel(to)}"`,
    };
  }

  if (to === "DELIVERED" && !options.otpVerified) {
    return {
      ok: false,
      status: 400,
      error: "A delivery is completed by verifying the customer's code, not by marking it done",
    };
  }

  const data: Record<string, unknown> = { status: to };
  const stamp = STAMP[to];
  if (stamp) data[stamp] = new Date();
  if (to === "FAILED") data.failureReason = options.reason ?? null;
  if (to === "STORE_REJECTED") data.storeNote = options.reason ?? null;
  // Going back to STORE_ACCEPTED means the courier is gone. Clearing the stamp
  // keeps "how long has this been waiting for a rider?" honest - otherwise the
  // board shows an assignment time for an order nobody is holding.
  //
  // And the wait starts again from now, rather than from when the order was
  // first posted. The courier who vanished did take it, and counting the time
  // they held it as time nobody wanted the job would put a re-opened order
  // straight into escalation at its widest circle - see §6 D4 and the note on
  // `offeredAt` in the schema.
  if (to === "STORE_ACCEPTED" && from === "COURIER_ASSIGNED") {
    data.assignedAt = null;
    data.offeredAt = new Date();
    // And it is ranked afresh. The old list was for a different moment and
    // includes the courier who just vanished; postCourierTask sees the empty
    // column and ranks it again.
    data.rankedCandidates = null;
    data.rankedNotified = 0;
    data.rankedSkippedSeconds = 0;
  }

  await prisma.$transaction([
    prisma.delivery.update({ where: { id: deliveryId }, data }),
    prisma.auditLog.create({
      data: auditData(actor, "delivery.state.changed", "Delivery", deliveryId, {
        from,
        to,
        martOrderId: delivery.martOrderId,
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.meta ?? {}),
      }),
    }),
  ]);

  const event = REPORTS[to];
  // Not on a re-open. Going back to STORE_ACCEPTED means the courier vanished,
  // and §4 has no event for that - re-sending order.store_accepted would tell
  // Mart the shop accepted it twice. What they see instead is the next
  // order.courier_assigned, which carries its own contract id.
  if (event && !(to === "STORE_ACCEPTED" && from === "COURIER_ASSIGNED")) {
    await reportToMart(
      event,
      delivery.martOrderId,
      { ...(options.reason ? { reason: options.reason } : {}), ...(options.meta ?? {}) },
      to === "COURIER_ASSIGNED" ? (options.meta?.contractId as string | undefined) : undefined
    );
  }

  return { ok: true, from, to };
}

// ── Putting it in front of couriers ──────────────────────────────────────────

export type PostResult =
  | { posted: true; taskId: string }
  | { posted: false; reason: "ALREADY_POSTED"; taskId: string }
  | { posted: false; reason: "NOT_ACCEPTED" | "NO_CREATOR" | "UNGATED_REFUSED"; taskId: null };

/**
 * Post the courier job for an order the store has agreed to fulfil.
 *
 * Goes through services/taskGenerator.ts rather than creating a Task directly,
 * and that is the point: the fee, the tier, the credential gate and the claim
 * window all come from `rules.DELIVERY`, which an admin edits on a screen.
 * Writing a Task here would be a second definition of what a delivery pays, and
 * the day somebody raised the fee only one of them would move.
 *
 * THE TASK CARRIES THE PICKUP, NOT THE DROP-OFF. A task has one site, and the
 * one that matters to the platform is where the work begins: it is what the
 * geofenced clock-in checks and what "how far is this from me?" should mean to
 * a courier deciding whether to take it. The customer's door is on the Delivery,
 * shown once the job is theirs - which is also the §5 posture, since the
 * drop-off is customer data and a public posting is not the place for it.
 */
export async function postCourierTask(deliveryId: string, actor: AuditActor): Promise<PostResult> {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return { posted: false, reason: "NOT_ACCEPTED", taskId: null };
  if (delivery.taskId) {
    // A re-opened order comes back this way: it keeps its posting, and
    // transitionDelivery cleared its ranking along with the courier who
    // vanished. Rank it again so the next-best courier is asked first. An order
    // already ranked is left alone, so nobody is told twice it is their turn.
    if (delivery.status === "STORE_ACCEPTED" && delivery.offeredAt && delivery.rankedCandidates === null) {
      await freezeRanking(deliveryId, actor);
    }
    return { posted: false, reason: "ALREADY_POSTED", taskId: delivery.taskId };
  }
  if (delivery.status !== "STORE_ACCEPTED") {
    return { posted: false, reason: "NOT_ACCEPTED", taskId: null };
  }

  const store = await prisma.organization.findUnique({
    where: { id: delivery.organizationId },
    select: { name: true },
  });
  const storeName = store?.name ?? "the store";
  const title = `Deliver order ${delivery.martOrderId}`;

  const result = await generateTask({
    kind: "DELIVERY",
    title,
    // No customer name, number or door here. A task description is visible to
    // every courier who can see the posting, and only the person who takes it
    // has any business knowing where it is going.
    description:
      `Collect from ${storeName}${delivery.pickupAddress ? ` (${delivery.pickupAddress})` : ""} ` +
      `and deliver to the customer. The drop-off address and contact are on the job once it is ` +
      `yours. Completing it needs the code the customer receives from AfriZoneMart.`,
    category: "Delivery",
    organizationId: delivery.organizationId,
    address: delivery.pickupAddress,
    lat: delivery.pickupLat,
    lng: delivery.pickupLng,
    locationType: "PHYSICAL",
    // Deduped on the order, NOT on the store: a busy shop has several orders
    // out at once, and deduping on organizationId would post the first and
    // silently swallow the rest.
    dedupe: { field: "title", value: title },
    actor,
  });

  if (!result.created) {
    if (result.reason === "DUPLICATE") {
      // A posting for this order already exists but was not linked - the link
      // write failed last time, or somebody created it by hand. Adopt it rather
      // than making a second.
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: { taskId: result.taskId, offeredAt: delivery.offeredAt ?? new Date() },
      });
      // Ranked only if it has not been already, so nobody is told twice that
      // it is their turn.
      if (delivery.rankedCandidates === null) await freezeRanking(deliveryId, actor);
      return { posted: false, reason: "ALREADY_POSTED", taskId: result.taskId };
    }
    return { posted: false, reason: result.reason, taskId: null };
  }

  // The moment the wait starts. Every escalation number in
  // services/deliveryOffer.ts is measured from here.
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { taskId: result.taskId, offeredAt: new Date() },
  });
  await writeAudit(actor, "delivery.posted", "Delivery", deliveryId, {
    martOrderId: delivery.martOrderId,
    taskId: result.taskId,
  });
  // Who gets it first. Never fatal - see freezeRanking.
  await freezeRanking(deliveryId, actor);
  return { posted: true, taskId: result.taskId };
}

/**
 * The store has finished packing.
 *
 * Not a state - see the note at the top of this file. Recording it is what lets
 * `order.prepared` be reported to Mart, and what tells a courier already holding
 * the job that it is worth setting off.
 */
export async function markPrepared(
  deliveryId: string,
  actor: AuditActor
): Promise<TransitionResult> {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return { ok: false, status: 404, error: "Delivery not found" };

  const state = delivery.status as DeliveryState;
  if (state === "RECEIVED") {
    return { ok: false, status: 409, error: "The store has not accepted this order yet" };
  }
  if (isTerminal(state)) {
    return { ok: false, status: 409, error: `This order is already "${stateLabel(state)}"` };
  }
  if (delivery.preparedAt) return { ok: true, from: state, to: state };

  await prisma.$transaction([
    prisma.delivery.update({ where: { id: deliveryId }, data: { preparedAt: new Date() } }),
    prisma.auditLog.create({
      data: auditData(actor, "delivery.prepared", "Delivery", deliveryId, {
        martOrderId: delivery.martOrderId,
      }),
    }),
  ]);
  await reportToMart("order.prepared", delivery.martOrderId);
  return { ok: true, from: state, to: state };
}

/**
 * The customer read out their code. Check it, and only then complete.
 *
 * MART_INTEGRATION.md §4: "order.delivered is only ever emitted after a
 * successful OTP verification. There is no path where a courier tapping a
 * button produces it." This function is that sentence, and transitionDelivery
 * refuses DELIVERED to anyone who has not come through here.
 *
 * THREE OUTCOMES, NOT TWO. A wrong code and an unreachable verifier are
 * different facts and a courier must be told which: somebody who tells a
 * customer they typed it wrong, when nothing was actually asked, will argue on
 * a doorstep about a check that never happened.
 */
export async function completeDelivery(
  deliveryId: string,
  code: string,
  actor: AuditActor
): Promise<
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string; remainingAttempts?: number }
> {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return { ok: false, status: 404, error: "Delivery not found" };
  if (delivery.status === "DELIVERED") return { ok: true };
  if (delivery.status !== "PICKED_UP") {
    return {
      ok: false,
      status: 409,
      error: `This order is "${stateLabel(delivery.status)}" - it has not been collected yet`,
    };
  }

  const trimmed = String(code ?? "").trim();
  if (!trimmed) return { ok: false, status: 400, error: "Enter the code the customer received" };

  const check = await verifyDeliveryOtp(delivery.martOrderId, trimmed);

  if (check.result === "UNAVAILABLE") {
    // Deliberately NOT recorded as a failed attempt: nothing was checked, and
    // counting it would let an outage exhaust a customer's tries. §6 D1 is the
    // open decision about what should happen here; until it is made, the honest
    // answer is that we could not ask.
    await writeAudit(actor, "delivery.otp.unavailable", "Delivery", deliveryId, {
      martOrderId: delivery.martOrderId,
      reason: check.reason,
    });
    return {
      ok: false,
      status: 503,
      error: "We could not check the code with AfriZoneMart just now. Do not leave the goods.",
    };
  }

  if (check.result === "INVALID") {
    await writeAudit(actor, "delivery.otp.rejected", "Delivery", deliveryId, {
      martOrderId: delivery.martOrderId,
      // The code itself is never written down. It belongs to the customer, it
      // is single-use, and an audit row outlives the order by design.
      remainingAttempts: check.remainingAttempts ?? null,
    });
    return {
      ok: false,
      status: 400,
      error: "That is not the right code",
      ...(check.remainingAttempts !== undefined
        ? { remainingAttempts: check.remainingAttempts }
        : {}),
    };
  }

  const moved = await transitionDelivery(deliveryId, "DELIVERED", actor, { otpVerified: true });
  if (!moved.ok) return moved;
  return { ok: true };
}
