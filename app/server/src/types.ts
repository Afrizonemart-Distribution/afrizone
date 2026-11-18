// Enum union types (SQLite stores these as String: see schema.prisma notes).

export type Role = "SUPER_ADMIN" | "TASK_MANAGER" | "HR_ADMIN" | "WORKER";
/** A tier key. The five built-ins plus any an admin adds (services/tiers.ts). */
export type Tier = string;
export type BuiltInTier = "STUDENT" | "DISPATCH" | "REMOTE" | "PROMO" | "TRADE";
export type KycStatus = "PENDING" | "VERIFIED" | "TIER_APPROVED" | "REJECTED";
export type PayModel = "HOURLY" | "FIXED";
export type LocationType = "PHYSICAL" | "REMOTE";
export type TaskStatus = "OPEN" | "FILLED" | "CLOSED" | "ARCHIVED";
export type AppStatus = "APPLIED" | "APPROVED" | "REJECTED";
export type TimesheetStatus = "SUBMITTED" | "APPROVED" | "DISPUTED";
export type PaymentStatus = "PENDING" | "APPROVED" | "RELEASED" | "DISPUTED";

// ── v2 enums ──────────────────────────────────────────────────────────────────
export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT";
export type JobStatus = "OPEN" | "CLOSED";
export type Stage = "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED";

export const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT"];
export const JOB_STATUSES: JobStatus[] = ["OPEN", "CLOSED"];
export const STAGES: Stage[] = ["SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];

export const ROLES: Role[] = ["SUPER_ADMIN", "TASK_MANAGER", "HR_ADMIN", "WORKER"];
/** The tiers that always exist. Validate against services/tiers.ts isTierKey, not this. */
export const BUILT_IN_TIERS: BuiltInTier[] = ["STUDENT", "DISPATCH", "REMOTE", "PROMO", "TRADE"];
/** @deprecated The built-ins only; admins can add tiers. Use services/tiers.ts. */
export const TIERS: Tier[] = BUILT_IN_TIERS;

/**
 * What kind of outside party an account is. A DIFFERENT AXIS FROM `Role`.
 *
 * `Role` mixes Afrizone staff (SUPER_ADMIN, TASK_MANAGER, HR_ADMIN) with one
 * participant value (WORKER). Putting STORE and COURIER in there too would
 * merge "who works at Afrizone" with "what kind of outside party you are", and
 * every requireRole guard already written would have to be re-reasoned against
 * the new values.
 *
 * NOTE THE TRAP: `DISPATCH` already exists as a Tier, and it is NOT this.
 * A tier answers "what work can you take"; an account type answers "what kind
 * of entity are you". An Individual User may well take dispatch work without
 * being a registered courier business. Do not collapse the two.
 */
export type AccountType = "INDIVIDUAL" | "STORE" | "COURIER";
export const ACCOUNT_TYPES: AccountType[] = ["INDIVIDUAL", "STORE", "COURIER"];

// ── v3 enums (worker-facing mobile app) ────────────────────────────────────────
export type ClockType = "IN" | "OUT";
export type WithdrawalStatus = "PROCESSING" | "PAID" | "FAILED";
/**
 * The work lifecycle for one Partimer on one Task (Blueprint §4.2).
 *
 * This used to hold the SIGNATURE state. It no longer does - whether somebody
 * signed is read from Contract.signedAt, because "has it been signed" and "how
 * far has the work got" are different questions and conflating them meant a
 * signed contract could not say whether anyone had started.
 *
 * The transitions live in services/contractState.ts, which is the only thing
 * allowed to move a contract between them.
 */
export type ContractStatus =
  | "CLAIMED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "VERIFIED"
  | "PAID"
  | "CLOSED"
  | "REWORK"
  | "CANCELLED"
  | "DISPUTED";

export const CLOCK_TYPES: ClockType[] = ["IN", "OUT"];
export const WITHDRAWAL_STATUSES: WithdrawalStatus[] = ["PROCESSING", "PAID", "FAILED"];
export const CONTRACT_STATUSES: ContractStatus[] = [
  "CLAIMED",
  "IN_PROGRESS",
  "SUBMITTED",
  "VERIFIED",
  "PAID",
  "CLOSED",
  "REWORK",
  "CANCELLED",
  "DISPUTED",
];

// ── auth enums ──────────────────────────────────────────────────────────────
export type OtpPurpose = "login";
export const OTP_PURPOSES: OtpPurpose[] = ["login"];

// ── audit ────────────────────────────────────────────────────────────────────
// Who performed an audited action. USER is a human logged into the platform
// (AuditLog.actorId FKs to their User row). Every other value is an automated
// actor with no User row at all, identified by AuditLog.actorRef instead.
export type ActorType = "USER" | "SYSTEM" | "WEBHOOK" | "JOB" | "INTEGRATION";
export const ACTOR_TYPES: ActorType[] = ["USER", "SYSTEM", "WEBHOOK", "JOB", "INTEGRATION"];

// tiers <-> comma-separated string helpers (SQLite has no scalar lists).
export function tiersToArray(s: string | null | undefined): Tier[] {
  if (!s) return [];
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean) as Tier[];
}

export function tiersToString(arr: Tier[] | string | null | undefined): string {
  if (!arr) return "";
  if (Array.isArray(arr)) return arr.join(",");
  return arr;
}

// ── Talent profile: skills and credentials ───────────────────────────────────

/** Does a person check the document before the credential counts? */
export type ReviewMode = "ADMIN_REVIEW" | "SELF_DECLARED";
export const REVIEW_MODES: ReviewMode[] = ["ADMIN_REVIEW", "SELF_DECLARED"];

/**
 * THIRD_PARTY: issued by someone else, evidenced by their document.
 * AFRIZONE: issued by Afrizone itself, evidenced by platform history. This is
 * the route by which a competent worker holding no formal paper can still pass
 * a gate - without it the platform could only ever ratify credentials people
 * already had.
 */
export type IssuerMode = "THIRD_PARTY" | "AFRIZONE";
export const ISSUER_MODES: IssuerMode[] = ["THIRD_PARTY", "AFRIZONE"];

/**
 * Stored credential status. Note the absence of EXPIRED: expiry is DERIVED at
 * read time from expiresAt (see isCredentialValid), never stored, so a
 * background job that fails to run cannot leave a lapsed licence reading as
 * valid.
 */
export type CredentialStatus = "PENDING" | "VERIFIED" | "REJECTED" | "REVOKED";
export const CREDENTIAL_STATUSES: CredentialStatus[] = [
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "REVOKED",
];

/**
 * Is this credential something the platform can currently rely on?
 *
 * VERIFIED and either open-ended or not yet past its expiry date. Deriving it
 * here, in one place, is what makes the "no stored EXPIRED status" decision
 * safe - every reader gets the same answer, computed against the clock at the
 * moment it is asked.
 */
export function isCredentialValid(
  c: { status: string; expiresAt: Date | string | null },
  now: Date = new Date()
): boolean {
  if (c.status !== "VERIFIED") return false;
  if (!c.expiresAt) return true;
  return new Date(c.expiresAt).getTime() > now.getTime();
}

/** VERIFIED, in date, but lapsing within `days`. Drives the review queue's "expiring" filter. */
export function isCredentialExpiring(
  c: { status: string; expiresAt: Date | string | null },
  days = 30,
  now: Date = new Date()
): boolean {
  if (!isCredentialValid(c, now)) return false;
  if (!c.expiresAt) return false;
  return new Date(c.expiresAt).getTime() <= now.getTime() + days * 24 * 60 * 60 * 1000;
}

/** URL-safe stable identifier derived from a display name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
