/**
 * Talking back to AfriZoneMart (MART_INTEGRATION.md §4, §5).
 *
 * Two things go the other way, and they are different in kind:
 *
 *   REPORTS are facts. "A courier picked this up." PartTime never asks
 *   permission and never waits for an answer - §4 is explicit that these are
 *   events, not requests. A report that fails to send must not undo the thing
 *   it was reporting, which is why every call here is fire-and-forget and
 *   returns whether it landed rather than throwing.
 *
 *   THE OTP CHECK is a question, and the only one PartTime asks. Mart generates
 *   the customer's code, delivers it, and verifies it; PartTime never stores it
 *   and never sees it except in transit. That removes the hardest data problem
 *   in delivery outright - a code belonging to somebody with no PartTime
 *   account, when PartTime's own OtpCode model is keyed to a user.
 *
 * ENV-GATED, the same way the CAC lookup and Smile Identity are. Unconfigured,
 * reports are skipped and the OTP check answers UNAVAILABLE - which the caller
 * must surface as "we cannot check this right now", never as a wrong code. A
 * courier told their customer typed it wrong, when in fact nothing was asked,
 * will argue with the customer on the doorstep.
 *
 * SEPARATE SECRET FROM THE INBOUND ONE. §2: one shared secret means a leak
 * either side compromises both directions.
 */
import crypto from "crypto";

/**
 * How long either call waits before giving up.
 *
 * There is no default timeout on fetch, and both callers are people waiting:
 * a shopkeeper tapping "accept" and a courier standing at a door with a
 * customer in front of them. An unbounded wait turns a slow dependency into an
 * app that appears frozen, which is worse than an honest "could not check".
 */
const TIMEOUT_MS = 8000;

/**
 * Read lazily, not at module load. Workers only populate process.env from
 * bindings once request handling begins; reading eagerly sees them unset
 * permanently. Same pattern as paystack.ts, smileIdentity.ts and
 * cacVerification.ts.
 */
export function config() {
  return {
    base: (process.env.MART_BASE_URL || "").replace(/\/+$/, ""),
    secret: process.env.MART_OUTBOUND_SECRET || "",
  };
}

export function isMartOutboundConfigured(): boolean {
  const { base, secret } = config();
  return !!(base && secret);
}

/** The events PartTime emits. MART_INTEGRATION.md §4. */
export const OUTBOUND_EVENTS = [
  "order.received",
  "order.store_accepted",
  "order.store_rejected",
  "order.prepared",
  "order.courier_assigned",
  "order.picked_up",
  "order.delivered",
  "order.delivery_failed",
] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];

/**
 * The same envelope Mart sends us, in the other direction, signed the same way:
 * HMAC-SHA256 over "{timestamp}.{rawBody}", with the timestamp INSIDE the
 * signed string rather than merely alongside it.
 */
export function sign(body: string, secret: string): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return { timestamp, signature };
}

export type ReportResult =
  | { sent: true }
  | { sent: false; reason: "NOT_CONFIGURED" | "REFUSED" | "UNREACHABLE"; detail?: string };

/**
 * Tell Mart something happened.
 *
 * `eventId` is ours and must be stable for the same fact, because §4 asks Mart
 * to make applying one idempotent on it. Derived from the order and the event
 * name rather than randomly, so a retry of the same report carries the same id
 * and is de-duplicated on their side instead of being applied twice.
 *
 * NEVER THROWS. The caller has already committed the state change this reports;
 * an exception here would unwind a delivery that genuinely happened.
 */
export async function reportToMart(
  event: OutboundEvent,
  martOrderId: string,
  data: Record<string, unknown> = {},
  /**
   * Makes the id distinct for a fact that can legitimately happen twice.
   * `order.courier_assigned` is the one that matters: a rider who accepts and
   * disappears re-opens the posting, and the SECOND assignment must not be
   * de-duplicated away as a repeat of the first - Mart would never learn who
   * is actually carrying the parcel. Pass the contract id.
   */
  idSuffix?: string
): Promise<ReportResult> {
  const { base, secret } = config();
  if (!base || !secret) return { sent: false, reason: "NOT_CONFIGURED" };

  const body = JSON.stringify({
    eventId: `pt_${martOrderId}_${event}${idSuffix ? `_${idSuffix}` : ""}`,
    type: event,
    occurredAt: new Date().toISOString(),
    data: { martOrderId, ...data },
  });
  const { timestamp, signature } = sign(body, secret);

  try {
    const res = await fetch(`${base}/parttime/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Afz-Timestamp": timestamp,
        "X-Afz-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { sent: false, reason: "REFUSED", detail: `${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      reason: "UNREACHABLE",
      detail: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

/**
 * VALID     - the customer gave the right code; the delivery may complete.
 * INVALID   - wrong code. `remainingAttempts` where Mart tells us.
 * UNAVAILABLE - we could not ask. NOT the same as a wrong code, and the two
 *               must never be shown to a courier the same way.
 */
export type OtpCheck =
  | { result: "VALID" }
  | { result: "INVALID"; remainingAttempts?: number }
  | { result: "UNAVAILABLE"; reason: "NOT_CONFIGURED" | "REFUSED" | "UNREACHABLE"; detail?: string };

/**
 * Ask Mart whether the code the customer read out is the right one.
 *
 * MART_INTEGRATION.md §6 D1 is still open: what happens when this cannot be
 * reached - a courier in a compound with one bar of signal, the customer
 * waiting, Mart's API not answering. Until that is decided, this reports
 * UNAVAILABLE honestly and the delivery stays PICKED_UP. It does not fail the
 * delivery, and it does not pass it: guessing either way is the failure mode
 * that decision exists to prevent.
 */
export async function verifyDeliveryOtp(martOrderId: string, code: string): Promise<OtpCheck> {
  const { base, secret } = config();
  if (!base || !secret) return { result: "UNAVAILABLE", reason: "NOT_CONFIGURED" };

  const body = JSON.stringify({ martOrderId, code });
  const { timestamp, signature } = sign(body, secret);

  try {
    const res = await fetch(`${base}/parttime/verify-delivery-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Afz-Timestamp": timestamp,
        "X-Afz-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { result: "UNAVAILABLE", reason: "REFUSED", detail: `${res.status}` };
    }
    const json = (await res.json()) as { valid?: unknown; remainingAttempts?: unknown };
    if (json?.valid === true) return { result: "VALID" };
    // Anything that is not an explicit `true` is treated as a wrong code rather
    // than as an outage, because Mart answered. A malformed body from a
    // responding service is their bug to fix and ours to not complete on.
    const remaining = Number(json?.remainingAttempts);
    return {
      result: "INVALID",
      ...(Number.isFinite(remaining) ? { remainingAttempts: remaining } : {}),
    };
  } catch (e) {
    return {
      result: "UNAVAILABLE",
      reason: "UNREACHABLE",
      detail: e instanceof Error ? e.message : "fetch failed",
    };
  }
}
