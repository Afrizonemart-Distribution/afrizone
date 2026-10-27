/**
 * Proof of work: photos with where and when (Blueprint §14).
 *
 * Until this existed, finishing a job was the worker saying so. A timesheet was
 * submitted, a delivery marked collected, an audit score typed in, and a person
 * at Afrizone either believed it or phoned somebody. Now each of those moments
 * needs a photo taken there and then, and the photo arrives with its position
 * and time - so most of what that phone call would have established is checked
 * the moment it lands.
 *
 * MISSING EVIDENCE REFUSES; DOUBTFUL EVIDENCE FLAGS. The gate is only "is there
 * a photo for this step at all". Whether the photo is convincing - taken at the
 * site, recently, with a decent fix - is written down as flags for a reviewer
 * and never blocks anybody: GPS drifts by a street indoors, phones keep the
 * wrong time, and a courier standing at the right door must not be stopped by
 * either. Blocking on a check that is wrong one time in twenty would teach
 * people to work around it.
 *
 * WHAT EACH KIND OF WORK NEEDS is the table below, and only that table. Every
 * gate asks `required(task, stage)` rather than knowing the rules itself, so a
 * change of policy is one edit.
 *
 * SIGNATURES SIT BESIDE THE PHOTOS at every handover (`signatureRequired`):
 * the photo shows what was there, the signature that somebody on the other
 * side agreed it happened. Same gate, same switch, same where-and-when checks.
 */
import { prisma } from "../prisma";
import { haversineMetres, isValidCoord, formatDistance } from "../util/geo";

export type EvidenceStage = "PICKUP" | "DROPOFF" | "CLOCK_IN" | "CLOCK_OUT" | "WORK" | "AUDIT";
export const EVIDENCE_STAGES: EvidenceStage[] = ["PICKUP", "DROPOFF", "CLOCK_IN", "CLOCK_OUT", "WORK", "AUDIT"];

/** What a person is told a stage is for. */
export const STAGE_LABEL: Record<EvidenceStage, string> = {
  PICKUP: "Collecting from the shop",
  DROPOFF: "At the customer's door",
  CLOCK_IN: "Clocking in",
  CLOCK_OUT: "Clocking out",
  WORK: "The finished work",
  AUDIT: "The store audit",
};

interface TaskShape {
  kind: string;
  payModel: string;
  locationType: string;
}

/**
 * How many photos this task needs for this stage. Zero means none.
 *
 * - Deliveries: one at the shop before it is marked collected, one at the door
 *   before the customer's code is checked.
 * - Store audits: three of the premises before the score is filed - one photo
 *   of a shop front says nothing about the shelves.
 * - Field and media work (MEDIA, and SOURCING on site): one of the result
 *   before the work is handed in.
 * - Hourly on-site work: one at clock-in and one at clock-out, alongside the
 *   geofence that already runs.
 */
export function required(task: TaskShape, stage: EvidenceStage): number {
  const onSite = task.locationType === "PHYSICAL";
  switch (stage) {
    case "PICKUP":
    case "DROPOFF":
      return task.kind === "DELIVERY" ? 1 : 0;
    case "AUDIT":
      return task.kind === "STORE_AUDIT" ? 3 : 0;
    case "WORK":
      return task.kind === "MEDIA" || (task.kind === "SOURCING" && onSite) ? 1 : 0;
    case "CLOCK_IN":
    case "CLOCK_OUT":
      return onSite && task.payModel === "HOURLY" && task.kind !== "DELIVERY" ? 1 : 0;
  }
}

/**
 * Whether this step also needs a signature from the other side of the handover.
 *
 * Every step that needs a photo, except clocking: the shop signs at pickup, the
 * customer at the door, the store manager on an audit, whoever the work was for
 * on field work. A clock-in has nobody on the other side to sign, and the
 * geofence and the photo already cover it.
 */
export function signatureRequired(task: TaskShape, stage: EvidenceStage): boolean {
  if (stage === "CLOCK_IN" || stage === "CLOCK_OUT") return false;
  return required(task, stage) > 0;
}

/** Who signs at each step, as the Tasker is asked for it. */
export const SIGNER_LABEL: Partial<Record<EvidenceStage, string>> = {
  PICKUP: "Somebody at the shop",
  DROPOFF: "The customer",
  AUDIT: "The store manager",
  WORK: "Whoever the work was for",
};

/** The stages this task asks for, in the order they happen. */
export function stagesFor(
  task: TaskShape
): { stage: EvidenceStage; count: number; label: string; signature: boolean; signer: string | null }[] {
  return EVIDENCE_STAGES.map((stage) => {
    const signature = signatureRequired(task, stage);
    return {
      stage,
      count: required(task, stage),
      label: STAGE_LABEL[stage],
      signature,
      signer: signature ? SIGNER_LABEL[stage] ?? null : null,
    };
  }).filter((s) => s.count > 0);
}

export const ENFORCE_SETTING_KEY = "evidence.enforce";

/**
 * Whether missing evidence refuses the step.
 *
 * The same rule as `eligibility.enforce`: an absent row means ON and only the
 * literal "off" disables it. The switch exists for the day a phone camera bug
 * stops every courier in the city - turning the gate off then must be one row,
 * not a deploy - and a kill-switch that has to exist before it can be found is
 * one nobody finds at that moment.
 */
export async function isEnforcing(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: ENFORCE_SETTING_KEY } });
  return !row || String(row.value).toLowerCase() !== "off";
}

// ── The checks ───────────────────────────────────────────────────────────────

/** How far from the site a photo may be before it is flagged. */
const DELIVERY_TOLERANCE_METRES = 250;
const MIN_SITE_TOLERANCE_METRES = 150;
/** A photo taken longer ago than this before it arrived was not taken "then". */
const STALE_MINUTES = 15;
/** A phone clock this far ahead of ours is wrong, and so is its timestamp. */
const FUTURE_MINUTES = 5;
/** A fix worse than this does not say much about where anybody was. */
const POOR_ACCURACY_METRES = 100;

export interface Site {
  lat: number;
  lng: number;
  toleranceMetres: number;
  /** "the shop", "the customer's door", "the task site" - for the flag sentence. */
  name: string;
}

/**
 * Where this stage of this task should have happened, or null when there is no
 * answer - a remote task, or a place nobody gave coordinates for. No site means
 * no distance check, which is not the same as a failed one.
 */
export async function siteFor(
  task: { id: string; kind: string; locationType: string; lat: number | null; lng: number | null; geofenceRadius: number },
  stage: EvidenceStage
): Promise<Site | null> {
  if (stage === "PICKUP" || stage === "DROPOFF") {
    const d = await prisma.delivery.findUnique({
      where: { taskId: task.id },
      select: { pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true },
    });
    if (!d) return null;
    const [lat, lng] = stage === "PICKUP" ? [d.pickupLat, d.pickupLng] : [d.dropoffLat, d.dropoffLng];
    if (!isValidCoord(lat, lng)) return null;
    return {
      lat: lat as number,
      lng: lng as number,
      toleranceMetres: DELIVERY_TOLERANCE_METRES,
      name: stage === "PICKUP" ? "the shop" : "the customer's door",
    };
  }
  if (task.locationType !== "PHYSICAL" || !isValidCoord(task.lat, task.lng)) return null;
  return {
    lat: task.lat as number,
    lng: task.lng as number,
    toleranceMetres: Math.max(task.geofenceRadius, MIN_SITE_TOLERANCE_METRES),
    name: task.kind === "STORE_AUDIT" ? "the store" : "the task site",
  };
}

export interface CheckInput {
  lat: number | null;
  lng: number | null;
  accuracyMetres: number | null;
  capturedAt: Date | null;
}

/**
 * Pure. Every check that failed, as a sentence a reviewer can act on.
 *
 * Sentences rather than codes because the only consumer is a person deciding
 * whether to approve something, and "Taken 2.4 km from the shop" is the whole
 * judgement where `OFF_SITE` is the start of a lookup.
 */
export function checkEvidence(
  input: CheckInput,
  site: Site | null,
  receivedAt: Date,
  what: "photo" | "signature" = "photo"
): { flags: string[]; distanceMetres: number | null } {
  const flags: string[] = [];
  let distanceMetres: number | null = null;
  // A signature is signed, not taken; the sentence should say which it was.
  const done = what === "photo" ? "Taken" : "Signed";

  const located = isValidCoord(input.lat, input.lng);
  if (!located) {
    flags.push(`No location with the ${what}`);
  } else if (site) {
    distanceMetres = Math.round(haversineMetres(input.lat as number, input.lng as number, site.lat, site.lng));
    if (distanceMetres > site.toleranceMetres) {
      flags.push(`${done} ${formatDistance(distanceMetres)} from ${site.name}`);
    }
  }

  if (located && input.accuracyMetres != null && input.accuracyMetres > POOR_ACCURACY_METRES) {
    flags.push(`Location was only accurate to about ${formatDistance(input.accuracyMetres)}`);
  }

  if (!input.capturedAt) {
    flags.push(`No time with the ${what}`);
  } else {
    const ageMinutes = (receivedAt.getTime() - input.capturedAt.getTime()) / 60_000;
    if (ageMinutes > STALE_MINUTES) {
      flags.push(`${done} ${Math.round(ageMinutes)} min before it was sent`);
    } else if (ageMinutes < -FUTURE_MINUTES) {
      flags.push("The phone's clock is ahead, so its time cannot be trusted");
    }
  }

  return { flags, distanceMetres };
}

// ── Gates ────────────────────────────────────────────────────────────────────

export type GateResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: "EVIDENCE_REQUIRED" | "SIGNATURE_REQUIRED";
      stage: EvidenceStage;
      needed: number;
      have: number;
    };

/**
 * Has this worker shown enough for this stage of this task?
 *
 * Counted per worker, not per task: on a task with several slots, one person's
 * photos are not another's proof. Photos are asked for before the signature,
 * because that is the order a handover happens in: the goods, then the
 * person agreeing they changed hands.
 */
export async function requireEvidence(
  task: TaskShape & { id: string },
  workerId: string,
  stage: EvidenceStage
): Promise<GateResult> {
  const needed = required(task, stage);
  if (needed === 0) return { ok: true };
  if (!(await isEnforcing())) return { ok: true };

  const have = await prisma.evidence.count({ where: { taskId: task.id, workerId, stage } });
  if (have >= needed) {
    if (!signatureRequired(task, stage)) return { ok: true };
    const signed = await prisma.signature.count({ where: { taskId: task.id, workerId, stage } });
    if (signed > 0) return { ok: true };
    return {
      ok: false,
      code: "SIGNATURE_REQUIRED",
      stage,
      needed: 1,
      have: 0,
      error: `Get a signature first (${(SIGNER_LABEL[stage] ?? "the other person").toLowerCase()})`,
    };
  }

  const missing = needed - have;
  return {
    ok: false,
    code: "EVIDENCE_REQUIRED",
    stage,
    needed,
    have,
    error:
      needed === 1
        ? `Take a photo first (${STAGE_LABEL[stage].toLowerCase()})`
        : `Take ${missing} more photo${missing === 1 ? "" : "s"} first (${STAGE_LABEL[stage].toLowerCase()}: ${have} of ${needed})`,
  };
}

/** How recently a clock photo must have been taken to clock with it. */
const CLOCK_PHOTO_MINUTES = 15;

/**
 * The photo a clock event is made with: this worker's, this task's, this
 * direction's, recent, and not already used. Clocking needs a fresh photo every
 * time rather than a count, because "one photo at some point" would let the
 * first day's clock-in photo cover the rest of the month.
 */
export async function claimClockPhoto(
  task: TaskShape & { id: string },
  workerId: string,
  type: "IN" | "OUT",
  evidenceId: unknown,
  now: Date = new Date()
): Promise<{ ok: true; evidenceId: string | null } | Extract<GateResult, { ok: false }>> {
  const stage: EvidenceStage = type === "IN" ? "CLOCK_IN" : "CLOCK_OUT";
  if (required(task, stage) === 0) return { ok: true, evidenceId: null };
  const enforcing = await isEnforcing();

  const refuse = {
    ok: false as const,
    code: "EVIDENCE_REQUIRED" as const,
    stage,
    needed: 1,
    have: 0,
    error: `Take a photo to clock ${type === "IN" ? "in" : "out"}`,
  };

  if (typeof evidenceId !== "string" || !evidenceId) {
    return enforcing ? refuse : { ok: true, evidenceId: null };
  }
  const row = await prisma.evidence.findUnique({ where: { id: evidenceId } });
  const fresh = row && now.getTime() - row.createdAt.getTime() <= CLOCK_PHOTO_MINUTES * 60_000;
  if (!row || row.workerId !== workerId || row.taskId !== task.id || row.stage !== stage || row.clockEventId || !fresh) {
    return enforcing ? refuse : { ok: true, evidenceId: null };
  }
  return { ok: true, evidenceId: row.id };
}

// ── Reading it back ──────────────────────────────────────────────────────────

export function parseFlags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ── Signatures ───────────────────────────────────────────────────────────────

/** A long, careful signature is a few thousand characters; this is far past that. */
export const MAX_SIGNATURE_PATH = 50_000;

/**
 * Only absolute and relative move, line, quadratic and cubic commands, close,
 * and numbers. Whatever the client sends, what a reviewer's screen draws can
 * then only ever be lines - no markup, no references, nothing that loads.
 */
const PATH_DATA = /^[MLQCZmlqcz0-9eE.,\s-]+$/;

export function validSignaturePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= MAX_SIGNATURE_PATH &&
    /^\s*[Mm]/.test(path) &&
    /\d/.test(path) &&
    PATH_DATA.test(path)
  );
}

export function signatureView(s: {
  id: string;
  taskId: string;
  workerId: string;
  stage: string;
  signerName: string;
  path: string;
  width: number;
  height: number;
  lat: number | null;
  lng: number | null;
  accuracyMetres: number | null;
  capturedAt: Date | null;
  distanceMetres: number | null;
  flags: string | null;
  createdAt: Date;
}) {
  const flags = parseFlags(s.flags);
  return {
    id: s.id,
    taskId: s.taskId,
    workerId: s.workerId,
    stage: s.stage,
    stageLabel: STAGE_LABEL[s.stage as EvidenceStage] ?? s.stage,
    signerName: s.signerName,
    path: s.path,
    width: s.width,
    height: s.height,
    lat: s.lat,
    lng: s.lng,
    accuracyMetres: s.accuracyMetres,
    capturedAt: s.capturedAt,
    receivedAt: s.createdAt,
    distanceMetres: s.distanceMetres,
    distance: s.distanceMetres != null ? formatDistance(s.distanceMetres) : null,
    flags,
    flagged: flags.length > 0,
  };
}

/** One photo as it goes over the wire. The bytes are behind `url`, which checks who is asking. */
export function evidenceView(e: {
  id: string;
  taskId: string;
  workerId: string;
  stage: string;
  lat: number | null;
  lng: number | null;
  accuracyMetres: number | null;
  capturedAt: Date | null;
  distanceMetres: number | null;
  flags: string | null;
  createdAt: Date;
}) {
  const flags = parseFlags(e.flags);
  return {
    id: e.id,
    taskId: e.taskId,
    workerId: e.workerId,
    stage: e.stage,
    stageLabel: STAGE_LABEL[e.stage as EvidenceStage] ?? e.stage,
    url: `/api/evidence/${e.id}/file`,
    lat: e.lat,
    lng: e.lng,
    accuracyMetres: e.accuracyMetres,
    capturedAt: e.capturedAt,
    receivedAt: e.createdAt,
    distanceMetres: e.distanceMetres,
    distance: e.distanceMetres != null ? formatDistance(e.distanceMetres) : null,
    flags,
    flagged: flags.length > 0,
  };
}
