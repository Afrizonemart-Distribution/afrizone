/**
 * Proof-to-pay: what a task must show before anyone is paid for it, and the
 * checks on the money once it is owed.
 *
 *   1. The task says what "done" means: acceptance criteria (sentences the
 *      reviewer confirms one by one) and how many photos of the finished work
 *      come with the hand-in (Task.proofPhotos, on top of services/evidence.ts).
 *   2. The worker hands in once per round, with units for PER_UNIT work.
 *   3. A reviewer approves (confirming every criterion, and for PER_UNIT how
 *      many units they accept) or sends it back with a reason.
 *   4. A payment at or over the second-approval line is released by somebody
 *      other than the person who approved the work.
 */
import { prisma } from "../prisma";

export const PAY_MODELS = ["HOURLY", "FIXED", "PER_UNIT"] as const;

export const MAX_CRITERIA = 10;
const MAX_CRITERION = 200;
export const MAX_PROOF_PHOTOS = 10;
const MAX_UNIT_LABEL = 30;
export const MAX_UNITS_CAP = 100_000;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCriteria(raw: unknown): Result<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "acceptanceCriteria must be a list" };
  const out = raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (out.length > MAX_CRITERIA) return { ok: false, error: `At most ${MAX_CRITERIA} acceptance checks` };
  if (out.some((x) => x.length > MAX_CRITERION)) return { ok: false, error: "An acceptance check is too long" };
  return { ok: true, value: [...new Set(out)] };
}

export function readCriteria(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const v = JSON.parse(stored);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseProofPhotos(raw: unknown): Result<number> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: 0 };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_PROOF_PHOTOS) {
    return { ok: false, error: `proofPhotos must be 0 to ${MAX_PROOF_PHOTOS}` };
  }
  return { ok: true, value: n };
}

/**
 * The pay fields for a task, checked together because they depend on each
 * other. `rate` is per hour for HOURLY and per unit for PER_UNIT.
 */
export function parsePay(b: {
  payModel?: unknown;
  rate?: unknown;
  budget?: unknown;
  unitLabel?: unknown;
  maxUnits?: unknown;
}): Result<{ unitLabel: string | null; maxUnits: number | null }> {
  if (!PAY_MODELS.includes(b.payModel as any)) {
    return { ok: false, error: `payModel must be one of ${PAY_MODELS.join(", ")}` };
  }
  if (b.payModel !== "PER_UNIT") return { ok: true, value: { unitLabel: null, maxUnits: null } };

  const rate = Number(b.rate);
  if (!Number.isInteger(rate) || rate <= 0) return { ok: false, error: "rate (₦ per unit) is required for PER_UNIT tasks" };
  const unitLabel = typeof b.unitLabel === "string" ? b.unitLabel.trim().replace(/\s+/g, " ") : "";
  if (!unitLabel || unitLabel.length > MAX_UNIT_LABEL) {
    return { ok: false, error: "Say what one unit is (e.g. photo, survey), up to 30 characters" };
  }
  let maxUnits: number | null = null;
  if (b.maxUnits !== undefined && b.maxUnits !== null && b.maxUnits !== "") {
    const n = Number(b.maxUnits);
    if (!Number.isInteger(n) || n < 1 || n > MAX_UNITS_CAP) {
      return { ok: false, error: `maxUnits must be 1 to ${MAX_UNITS_CAP}` };
    }
    maxUnits = n;
  }
  return { ok: true, value: { unitLabel, maxUnits } };
}

// ── Second approval ──────────────────────────────────────────────────────────

export const SECOND_APPROVAL_KEY = "payments.secondApprovalOver";
/** ₦ gross. A payment this large or larger needs a second person to release it. */
export const DEFAULT_SECOND_APPROVAL_OVER = 50_000;

export async function secondApprovalLine(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: SECOND_APPROVAL_KEY } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SECOND_APPROVAL_OVER;
}

/**
 * Why this person may not release this payment, or null if they may. The
 * person who approved the work cannot also release a large payment for it:
 * one compromised or mistaken account must not be able to both say the work
 * was done and send the money.
 */
export function releaseBlock(
  payment: { gross: number; approvedById: string | null },
  releaserId: string,
  line: number
): string | null {
  if (payment.gross < line) return null;
  if (payment.approvedById && payment.approvedById === releaserId) {
    return `Payments of ₦${line.toLocaleString()} or more must be released by a different admin from the one who approved the work`;
  }
  return null;
}
