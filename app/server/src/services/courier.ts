/**
 * Courier onboarding (Blueprint §3.2, §15).
 *
 * A courier is a Partimer with a vehicle. Everything that makes them employable -
 * a verified identity, a licence, papers, insurance - already has machinery:
 * KYC, `Credential`, and the eligibility engine. What was missing was the
 * vehicle itself and, more importantly, a way for a rider to see how far along
 * they are.
 *
 * READINESS IS NOT ELIGIBILITY, and conflating them would be a mistake worth
 * naming. `services/eligibility.ts` answers "can this person take THIS task",
 * against that task's own requirements, and it is the only thing that may refuse
 * work. This answers "is this person set up to be offered delivery work at all",
 * which is an onboarding checklist. A courier who is fully ready here can still
 * be turned down for a particular delivery, and that is correct.
 *
 * Nothing in this file gates anything. It is a progress report.
 */
import { prisma } from "../prisma";
import { isCredentialValid } from "../types";

/**
 * FOOT and BICYCLE are here deliberately. Inner-city drops on foot are real
 * work, and a courier forced to invent a vehicle to finish sign-up will type
 * something false into the plate field - which is worse than the truth.
 */
export const VEHICLE_TYPES = [
  "MOTORCYCLE",
  "TRICYCLE",
  "CAR",
  "VAN",
  "BICYCLE",
  "FOOT",
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/** The ones the law expects to carry a plate. */
const PLATED: VehicleType[] = ["MOTORCYCLE", "TRICYCLE", "CAR", "VAN"];

export function requiresPlate(vehicleType: string): boolean {
  return PLATED.includes(vehicleType as VehicleType);
}

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  MOTORCYCLE: "Motorcycle",
  TRICYCLE: "Tricycle (keke)",
  CAR: "Car",
  VAN: "Van",
  BICYCLE: "Bicycle",
  FOOT: "On foot",
};

/**
 * Plates are written every way a human writes them - "ABC 123 DE", "abc-123de".
 * Normalised for storage so the unique index sees two spellings of one plate as
 * one plate.
 */
export function normalisePlate(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The papers a courier needs, by credential slug.
 *
 * Insurance is the one this build was missing. It is a `CredentialType` rather
 * than a column for the same reason a licence is: it expires, a person has to
 * look at it, and expiry has to be computed from the clock rather than stored -
 * otherwise a lapsed policy keeps reading as valid until some background job
 * remembers to run.
 */
export const COURIER_CREDENTIALS = [
  { slug: "drivers-licence", label: "Driver's licence" },
  { slug: "vehicle-registration", label: "Vehicle registration" },
  { slug: "vehicle-insurance", label: "Vehicle insurance" },
] as const;

/**
 * Which papers a given vehicle needs.
 *
 * A vehicle nobody needs a licence for needs no licence papers either.
 * Demanding a driver's licence from somebody delivering on foot is the kind of
 * checklist that gets ignored rather than satisfied, and an onboarding step a
 * person cannot complete is indistinguishable from a broken one.
 *
 * NULL - no vehicle recorded yet - also means none, and that is a decision
 * rather than a fallthrough. A checklist is a list of things to do, and every
 * item on it should be true; listing three documents before the courier has
 * said what they ride means listing three that vanish the moment they answer
 * "on foot". The vehicle step already says that choosing decides what follows.
 */
export function credentialsFor(vehicleType: string | null): { slug: string; label: string }[] {
  if (!vehicleType || vehicleType === "FOOT" || vehicleType === "BICYCLE") return [];
  return [...COURIER_CREDENTIALS];
}

export type StepState = "DONE" | "WAITING" | "TODO" | "PROBLEM";

export interface ReadinessStep {
  key: string;
  label: string;
  state: StepState;
  /** What the courier should do next. Written here; no client composes copy. */
  detail: string;
}

export interface Readiness {
  ready: boolean;
  /** Steps in the order they should be worked, not the order they were checked. */
  steps: ReadinessStep[];
  outstanding: number;
  vehicle: { type: string; label: string; plateNumber: string | null } | null;
}

/**
 * How far along a courier is.
 *
 * WAITING is its own state and is not a failure. A rider who has uploaded every
 * document and is waiting on Afrizone has nothing left to do, and a checklist
 * that shows those steps as incomplete tells them to try harder at something
 * that is not theirs to finish.
 */
export async function courierReadiness(userId: string, now: Date = new Date()): Promise<Readiness> {
  const [user, profile, credentials] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.courierProfile.findUnique({ where: { userId } }),
    prisma.credential.findMany({
      where: { workerId: userId },
      include: { credentialType: true },
    }),
  ]);

  const steps: ReadinessStep[] = [];

  // 1. Identity. First because everything else is a claim about a person nobody
  // has confirmed exists.
  const identityDone = user?.kycStatus === "VERIFIED" || user?.kycStatus === "TIER_APPROVED";
  steps.push({
    key: "identity",
    label: "Identity verified",
    state: identityDone ? "DONE" : user?.kycStatus === "REJECTED" ? "PROBLEM" : user ? "WAITING" : "TODO",
    detail: identityDone
      ? "Afrizone has confirmed who you are."
      : user?.kycStatus === "REJECTED"
        ? user.kycNote || "Your identity check was not accepted. Submit it again."
        : "Finish the identity check in the Afrizone app.",
  });

  // 2. The vehicle, because what it is decides which papers step 3 asks for.
  steps.push({
    key: "vehicle",
    label: "Vehicle details",
    state: profile ? "DONE" : "TODO",
    detail: profile
      ? `${VEHICLE_LABEL[profile.vehicleType as VehicleType] ?? profile.vehicleType}${
          profile.plateNumber ? ` · ${profile.plateNumber}` : ""
        }`
      : "Tell us what you deliver on. It decides which papers you need.",
  });

  // 3. The papers. Which ones depends on the answer to 2.
  const wanted = credentialsFor(profile?.vehicleType ?? null);
  for (const want of wanted) {
    const held = credentials.filter((c) => c.credentialType?.slug === want.slug);
    const valid = held.find((c) => isCredentialValid(c, now));
    const pending = held.find((c) => c.status === "PENDING");
    const rejected = held.find((c) => c.status === "REJECTED");
    const expired = held.find((c) => c.status === "VERIFIED" && !isCredentialValid(c, now));

    steps.push({
      key: want.slug,
      label: want.label,
      state: valid ? "DONE" : pending ? "WAITING" : rejected || expired ? "PROBLEM" : "TODO",
      detail: valid
        ? valid.expiresAt
          ? `Valid until ${new Date(valid.expiresAt).toISOString().slice(0, 10)}`
          : "Confirmed by Afrizone."
        : pending
          ? "With Afrizone. Nothing for you to do."
          : expired
            ? "This has expired. Upload the renewed one."
            : rejected
              ? rejected.rejectionReason || "Not accepted. Upload it again."
              : `Upload your ${want.label.toLowerCase()}.`,
    });
  }

  // WAITING does not count as outstanding: the courier has done their part and
  // telling them otherwise sends them looking for work that is not theirs.
  const outstanding = steps.filter((s) => s.state === "TODO" || s.state === "PROBLEM").length;

  return {
    ready: steps.every((s) => s.state === "DONE"),
    steps,
    outstanding,
    vehicle: profile
      ? {
          type: profile.vehicleType,
          label: VEHICLE_LABEL[profile.vehicleType as VehicleType] ?? profile.vehicleType,
          plateNumber: profile.plateNumber,
        }
      : null,
  };
}

export interface SaveFailure {
  ok: false;
  status: number;
  error: string;
}
export interface SaveSuccess {
  ok: true;
  profile: { vehicleType: string; plateNumber: string | null };
}

/** Record or change the vehicle somebody delivers on. */
export async function saveCourierVehicle(
  userId: string,
  vehicleType: string,
  plateRaw: string | null
): Promise<SaveSuccess | SaveFailure> {
  if (!VEHICLE_TYPES.includes(vehicleType as VehicleType)) {
    return { ok: false, status: 400, error: "Choose one of the listed vehicle types" };
  }

  const needsPlate = requiresPlate(vehicleType);
  const plate = plateRaw ? normalisePlate(plateRaw) : "";

  if (needsPlate && !plate) {
    return { ok: false, status: 400, error: "A plate number is needed for that vehicle" };
  }
  if (needsPlate && (plate.length < 4 || plate.length > 12)) {
    return { ok: false, status: 400, error: "That does not look like a plate number" };
  }

  // A plate belonging to somebody else is a real signal - the same machine
  // registered twice is either a mistake or a borrowed identity - so it refuses
  // with a sentence rather than a constraint violation.
  if (plate) {
    const clash = await prisma.courierProfile.findFirst({
      where: { plateNumber: plate, NOT: { userId } },
      select: { id: true },
    });
    if (clash) {
      return { ok: false, status: 409, error: "That plate is already registered to another courier" };
    }
  }

  const stored = needsPlate ? plate : null;
  const profile = await prisma.courierProfile.upsert({
    where: { userId },
    create: { userId, vehicleType, plateNumber: stored },
    // Switching from a van to a bicycle has to clear the plate, or the old one
    // stays attached to a vehicle that does not have it.
    update: { vehicleType, plateNumber: stored },
  });

  return { ok: true, profile: { vehicleType: profile.vehicleType, plateNumber: profile.plateNumber } };
}
