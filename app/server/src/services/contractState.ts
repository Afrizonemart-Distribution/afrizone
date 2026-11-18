/**
 * The work lifecycle: one Partimer's engagement with one Task, start to finish.
 *
 * Blueprint §4.2 lists eleven states and asks for them to be modelled explicitly
 * "so payment, disputes and analytics all hang off clean transitions". This is
 * that model.
 *
 * WHY THIS LIVES ON Contract AND NOT ON Task, which is the one structural
 * decision worth understanding before changing anything here:
 *
 *   §4.2 describes two lifecycles as though they were one. "Published" and
 *   "Expired (unclaimed)" are facts about the POSTING. "Claimed", "In Progress",
 *   "Submitted" and "Paid" are facts about ONE PERSON doing the work. A task
 *   with five slots has one posting and five engagements, and they move
 *   independently - three people can be In Progress while a fourth is already
 *   Paid and the posting itself is still Published.
 *
 *   Blueprint §12 already resolves this: Contract "binds Task to Partimer". So the
 *   posting keeps Task.status and the work lives here, one row per person per
 *   task. Putting all eleven on Task would force slots to be 1 forever.
 *
 * EXPIRED IS NOT IN THIS ENUM, deliberately. A posting that nobody claimed
 * before its deadline is expired by the passage of time, not by anything anyone
 * did - so it is derived at read time from `deadline`, exactly as credential
 * expiry is derived rather than stored (see ARCHITECTURE.md §12). A stored
 * EXPIRED needs a scheduled job, and a job that fails to run leaves a dead task
 * looking live. There is now exactly one cron in this codebase - the delivery
 * customer-data purge, which exists because absence of data cannot be derived -
 * and this is still not a second reason to have one.
 */
import type { Prisma } from "@prisma/client";
import { auditData, type AuditActor } from "../util/audit";

export type ContractState =
  | "CLAIMED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "VERIFIED"
  | "PAID"
  | "CLOSED"
  | "REWORK"
  | "CANCELLED"
  | "DISPUTED";

export const CONTRACT_STATES: ContractState[] = [
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

/**
 * Legal moves. Anything not listed here cannot happen, and that is the point of
 * writing it down: the failure this prevents is a contract reaching PAID without
 * ever having been VERIFIED.
 *
 * Read as "from → the states it may move to".
 */
export const TRANSITIONS: Record<ContractState, ContractState[]> = {
  // Assigned, work not started. Signing does not change the state - a signature
  // is recorded on signedAt, because whether somebody signed and how far the
  // work has got are two different questions.
  CLAIMED: ["IN_PROGRESS", "CANCELLED", "DISPUTED"],

  // Work underway: clock-ins, geolocation, evidence.
  IN_PROGRESS: ["SUBMITTED", "CANCELLED", "DISPUTED"],

  // Partimer says it is done and has uploaded proof.
  SUBMITTED: ["VERIFIED", "REWORK", "CANCELLED", "DISPUTED"],

  // Failed acceptance and sent back. Returns to IN_PROGRESS, per §4.2, rather
  // than straight to SUBMITTED - the work has to actually be redone.
  REWORK: ["IN_PROGRESS", "CANCELLED", "DISPUTED"],

  // Acceptance criteria met. Money becomes owed at this point, not before.
  VERIFIED: ["PAID", "DISPUTED"],

  // Released. Deliberately NOT reversible: unwinding a payment is a refund or a
  // clawback, which is a new record rather than a state going backwards.
  PAID: ["CLOSED", "DISPUTED"],

  // Ratings exchanged, written to profile history. Terminal.
  CLOSED: [],

  // Terminal. Nothing is owed.
  CANCELLED: [],

  // Adjudication. Returns to whatever the outcome says it should be, which is
  // why this fans out wide - a dispute can end with the work accepted, sent
  // back, or cancelled outright.
  DISPUTED: ["IN_PROGRESS", "SUBMITTED", "VERIFIED", "PAID", "REWORK", "CANCELLED", "CLOSED"],
};

/** States after which no further work happens. */
export const TERMINAL_STATES: ContractState[] = ["CLOSED", "CANCELLED"];

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state as ContractState);
}

export function canTransition(from: string, to: string): boolean {
  if (!CONTRACT_STATES.includes(from as ContractState)) return false;
  if (!CONTRACT_STATES.includes(to as ContractState)) return false;
  return TRANSITIONS[from as ContractState].includes(to as ContractState);
}

/** Worker-facing wording. Never an enum name - "SUBMITTED" tells nobody anything. */
const LABELS: Record<ContractState, string> = {
  CLAIMED: "Yours to start",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Waiting to be checked",
  REWORK: "Needs another look",
  VERIFIED: "Approved",
  PAID: "Paid",
  CLOSED: "Finished",
  CANCELLED: "Cancelled",
  DISPUTED: "Being resolved",
};

export function stateLabel(state: string): string {
  return LABELS[state as ContractState] ?? state;
}

export type TransitionResult =
  | { ok: true; from: ContractState; to: ContractState }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Move one contract, or explain why not.
 *
 * Writes the contract and its audit row in ONE transaction. A state change that
 * lands without its audit row is exactly the gap that makes a money trail
 * unreconstructable later, and these are the transitions payment hangs off.
 *
 * Idempotent on a no-op: asking for the state it is already in succeeds and
 * writes nothing. A retried request must not be an error, and a duplicate audit
 * row would misrepresent one action as two.
 */
export async function transitionContract(
  prisma: any,
  contractId: string,
  to: ContractState,
  actor: AuditActor,
  meta: Record<string, unknown> = {}
): Promise<TransitionResult> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) return { ok: false, status: 404, error: "Contract not found" };

  const from = contract.status as ContractState;
  if (from === to) return { ok: true, from, to };

  if (!canTransition(from, to)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot go from ${stateLabel(from)} to ${stateLabel(to)}`,
    };
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.contract.update({ where: { id: contractId }, data: { status: to } }),
    prisma.auditLog.create({
      data: auditData(actor, "contract.state.changed", "Contract", contractId, {
        from,
        to,
        ...meta,
      }),
    }),
  ];
  await prisma.$transaction(ops);
  return { ok: true, from, to };
}

/**
 * Has this posting run out of time without being taken?
 *
 * Derived, never stored - see the note at the top of this file. A posting that
 * somebody has already claimed is not expired, however old the deadline is,
 * because the work is underway.
 */
export function isTaskExpired(
  task: { status: string; deadline: Date | string | null },
  claimedCount: number,
  now: Date = new Date()
): boolean {
  if (task.status !== "OPEN") return false;
  if (claimedCount > 0) return false;
  if (!task.deadline) return false;
  return new Date(task.deadline).getTime() < now.getTime();
}
