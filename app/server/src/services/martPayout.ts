/**
 * Paying a Tasker through AfriZoneMart's Squad account (decided 2026-11-18).
 *
 * Part Time runs on Cloudflare Workers, which have no fixed outbound IP, so it
 * cannot hold a transfer key itself: payment providers only accept transfers
 * from whitelisted servers. AfriZoneMart's API can, and already pays interns
 * through Squad. So a payout is a signed request there (afrizonemart-api
 * modules/parttime/payouts.ts), made only after a Part Time admin presses Pay.
 *
 * AfriZoneMart keys a payout on our withdrawal reference and never sends one
 * twice, so repeating a request after a timeout is always safe.
 */
import { config, sign } from "./martOutbound";

export type MartPayoutStatus = "SENDING" | "PENDING" | "SUCCESS" | "FAILED";

export type MartPayoutAnswer =
  /** AfriZoneMart has it. SUCCESS and FAILED are final; the others are in flight. */
  | { kind: "ACCEPTED"; status: MartPayoutStatus; failureReason: string | null }
  /** AfriZoneMart said no and sent nothing. `code` says why. */
  | { kind: "REFUSED"; code: string; error: string }
  /** No answer. Nothing is known; asking again is safe. */
  | { kind: "UNREACHABLE"; detail: string };

/** A send waits on Squad twice (account check, then transfer). */
const SEND_TIMEOUT_MS = 45_000;
const STATUS_TIMEOUT_MS = 20_000;

export function isMartPayoutConfigured(): boolean {
  const { base, secret } = config();
  return !!(base && secret);
}

async function call(path: string, payload: unknown, timeoutMs: number): Promise<MartPayoutAnswer> {
  const { base, secret } = config();
  if (!base || !secret) return { kind: "UNREACHABLE", detail: "MART_BASE_URL or MART_OUTBOUND_SECRET is not set" };
  const body = JSON.stringify(payload);
  const { timestamp, signature } = sign(body, secret);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Afz-Timestamp": timestamp, "X-Afz-Signature": signature },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { kind: "UNREACHABLE", detail: e instanceof Error ? e.message : "fetch failed" };
  }
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    failureReason?: string | null;
    code?: string;
    error?: string;
    message?: string;
  };
  if (res.ok && typeof json.status === "string") {
    return { kind: "ACCEPTED", status: json.status as MartPayoutStatus, failureReason: json.failureReason ?? null };
  }
  // A coded 4xx or 503 is a considered refusal; anything else (a 5xx, a bad
  // signature, a body we cannot read) is treated as no answer.
  if (json.code && (res.status === 503 || (res.status >= 400 && res.status < 500 && res.status !== 401))) {
    return { kind: "REFUSED", code: json.code, error: json.error ?? json.message ?? `HTTP ${res.status}` };
  }
  return { kind: "UNREACHABLE", detail: json.error ?? json.message ?? `HTTP ${res.status}` };
}

export const martPayouts = {
  send(input: {
    reference: string;
    workerId: string;
    amountNgn: number;
    bankCode: string;
    bankName: string;
    accountNumber: string;
    expectedName: string;
    approvedBy: string;
  }) {
    return call("/parttime/payouts", input, SEND_TIMEOUT_MS);
  },
  status(reference: string) {
    return call("/parttime/payouts/status", { reference }, STATUS_TIMEOUT_MS);
  },
};
