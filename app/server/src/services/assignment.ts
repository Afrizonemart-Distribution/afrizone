/**
 * The one place a worker becomes the person doing a task.
 *
 * routes/applications.ts used to carry this inline, with a comment saying the
 * delivery status move was "hung off approval rather than duplicated into a
 * delivery-specific claim route: there is one way work is assigned on this
 * platform, and a second one would eventually disagree with this one about who
 * holds a job." That was right, and self-claim is exactly the change that would
 * have broken it. So the body moved here instead of being copied: a courier
 * claiming an order and an admin approving an application now run the same
 * code, and the sentence stays true.
 *
 * Assigning is six things that must all happen or none of them usefully do:
 * the eligibility re-check, the APPROVED application with its frozen snapshot,
 * the slot, the contract, the ring-fenced pay, and - for a delivery - the order
 * moving to COURIER_ASSIGNED so the store and AfriZoneMart both stop waiting.
 *
 * WHAT IS DELIBERATELY NOT ATOMIC. These are separate writes against D1, not one
 * transaction, and the ordering is chosen so that every partial failure leaves a
 * state a person can finish rather than one they must unpick. The application is
 * APPROVED first because it is what requireAssignedTask() reads, so a worker
 * whose contract write failed can still be given one by hand and everything
 * downstream works. The delivery move is last and never fatal, because a courier
 * holding a signed contract for an order the board says nobody took is
 * recoverable, and refusing the whole assignment over a status field is not.
 */
import { prisma } from "../prisma";
import { notifyWorker } from "./push";
import { writeAudit, type AuditActor } from "../util/audit";
import { transitionDelivery } from "./delivery";
import { commitForContract, committableAmount } from "./commitments";
import { lockSurge } from "./surge";
import {
  blockingBlockers,
  decide,
  isEnforcing,
  loadTaskRequirements,
  loadWorkerProfile,
  snapshot,
  type Blocker,
  type Eligibility,
} from "./eligibility";

/**
 * How the assignment came about. Not cosmetic - it decides whether the
 * eligibility gate can be overridden, whether the slot is latched, and what the
 * worker is told afterwards.
 */
export type AssignSource = "ADMIN_APPROVAL" | "SELF_CLAIM";

export interface AssignInput {
  taskId: string;
  workerId: string;
  actor: AuditActor;
  source: AssignSource;
  /**
   * An admin approving somebody the gate refuses. Ignored for SELF_CLAIM: an
   * override is a person taking responsibility for a judgement the rules got
   * wrong, and a courier overriding their own missing licence is not that.
   */
  override?: boolean;
  /** The APPLIED row to promote. Self-claim has none; one is created APPROVED. */
  applicationId?: string;
  now?: Date;
}

export type AssignResult =
  | {
      ok: true;
      applicationId: string;
      contractId: string;
      taskFilled: boolean;
      eligibility: Eligibility;
      overridden: boolean;
    }
  | {
      ok: false;
      status: 400 | 404 | 409;
      error: string;
      blockers?: Blocker[];
      eligibility?: Eligibility;
      requiresOverride?: boolean;
    };

/**
 * Take the slot, or find out somebody else already did.
 *
 * ONLY FOR A ONE-SLOT POSTING, AND ONLY ON SELF-CLAIM. A conditional update is
 * the one thing here that is genuinely atomic - `updateMany` with `status:
 * "OPEN"` in the where clause either matches a row or does not, and exactly one
 * of two simultaneous claimants gets a count of 1. Reading the count of approved
 * applications and then writing FILLED, which is what the admin path does and
 * has always done, has a window between the two, and two couriers tapping at
 * once is not a rare case for a delivery - it is what a good posting looks like.
 *
 * The admin path is left on the old check on purpose. It currently permits a
 * second approval on a filled one-slot task, an admin can see they are doing it,
 * and quietly turning that into a 409 would break a workflow that is not what
 * this change is about.
 */
async function latchSlot(taskId: string): Promise<boolean> {
  const taken = await prisma.task.updateMany({
    where: { id: taskId, status: "OPEN" },
    data: { status: "FILLED" },
  });
  return taken.count === 1;
}

/** Give the slot back. Called only when a later step fails after latching. */
async function releaseSlot(taskId: string): Promise<void> {
  await prisma.task.updateMany({ where: { id: taskId, status: "FILLED" }, data: { status: "OPEN" } });
}

export async function assignWorker(input: AssignInput): Promise<AssignResult> {
  const now = input.now ?? new Date();
  const { taskId, workerId, actor, source } = input;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, status: 404, error: "Task not found" };

  const [profile, requirements, enforcing] = await Promise.all([
    loadWorkerProfile(prisma, workerId, now),
    loadTaskRequirements(prisma, [task]),
    isEnforcing(prisma),
  ]);
  if (!profile) return { ok: false, status: 404, error: "Worker not found" };

  const reqs = requirements.get(task.id)!;
  const eligibility = decide(profile, reqs);
  const blocking = blockingBlockers(eligibility.blockers, enforcing);

  // Re-checked here rather than trusted from the caller, even though the claim
  // route has already asked. Days pass between applying and being approved, and
  // a licence that expired in between is the case this gate exists for. On
  // self-claim the two checks are milliseconds apart and the second is free.
  const override = source === "ADMIN_APPROVAL" && input.override === true;
  if (blocking.length > 0 && !override) {
    return {
      ok: false,
      status: 400,
      error:
        source === "SELF_CLAIM"
          ? blocking[0].message
          : `${profile.name} no longer meets the requirements for this task`,
      blockers: blocking,
      eligibility,
      ...(source === "ADMIN_APPROVAL" ? { requiresOverride: true } : {}),
    };
  }

  // The slot before the writes, so a loser of the race has nothing to undo.
  let latched = false;
  if (source === "SELF_CLAIM") {
    if (task.status !== "OPEN") {
      return { ok: false, status: 409, error: "This job is no longer available" };
    }
    latched = await latchSlot(task.id);
    if (!latched) {
      return { ok: false, status: 409, error: "Somebody else took this job just now" };
    }
  }

  try {
    const frozen = snapshot(profile, reqs, eligibility, now);

    // A courier who applied the old way and has now claimed must not end up
    // with two applications on one task. `(taskId, workerId)` is indexed but not
    // unique, so this is a read-then-write rather than an upsert - safe here
    // only because the slot latch above has already made this the one claim in
    // flight for this posting.
    const prior =
      input.applicationId ??
      (
        await prisma.application.findFirst({
          where: { taskId: task.id, workerId },
          select: { id: true },
        })
      )?.id;

    const application = prior
      ? await prisma.application.update({
          where: { id: prior },
          data: { status: "APPROVED", reason: null, eligibilitySnapshot: frozen },
        })
      : await prisma.application.create({
          data: {
            taskId: task.id,
            workerId,
            status: "APPROVED",
            pitch: null,
            eligibilitySnapshot: frozen,
          },
        });

    if (blocking.length > 0) {
      await writeAudit(actor, "application.approved.override", "Application", application.id, {
        workerId,
        taskId: task.id,
        blockers: blocking.map((b) => ({ code: b.code, ref: b.ref })),
      });
    }

    // The admin path's original slot arithmetic, unchanged. Skipped when the
    // latch already took the slot, or it would count a filled task twice.
    let taskFilled = latched;
    if (!latched) {
      const filledCount = await prisma.application.count({
        where: { taskId: task.id, status: "APPROVED" },
      });
      if (filledCount >= task.slots && task.status === "OPEN") {
        await prisma.task.update({ where: { id: task.id }, data: { status: "FILLED" } });
        taskFilled = true;
      }
    }

    // Assignment is what mints the contract - the record binding this worker to
    // this task (Blueprint §12). It starts CLAIMED: assigned, not yet started.
    const existing = await prisma.contract.findFirst({ where: { taskId: task.id, workerId } });
    const contract =
      existing ?? (await prisma.contract.create({ data: { taskId: task.id, workerId, status: "CLAIMED" } }));

    // A delivery that waited pays its surge, and this is where the figure is
    // fixed: before the commitment, so the ring-fenced amount and the eventual
    // payment both read it. Only for a new contract - one that already existed
    // has had its pay committed. See services/surge.ts.
    const payable =
      task.kind === "DELIVERY" && !existing ? { ...task, budget: await lockSurge(task, actor, now) } : task;

    // The contract going live ring-fences the pay (Blueprint §10). A FIXED task
    // commits its budget; an HOURLY one commits no figure at all, because it is
    // not knowable until hours are submitted.
    await commitForContract(contract.id, workerId, committableAmount(payable), actor);

    // A delivery posting has an order behind it, on its own status axis that the
    // store and AfriZoneMart both watch. This is the moment it stops waiting.
    if (task.kind === "DELIVERY") {
      const delivery = await prisma.delivery.findUnique({
        where: { taskId: task.id },
        select: { id: true },
      });
      if (delivery) {
        const moved = await transitionDelivery(delivery.id, "COURIER_ASSIGNED", actor, {
          meta: { contractId: contract.id, workerId, source },
        });
        // Never fatal - see the note at the top of this file.
        if (!moved.ok) {
          console.error(`delivery ${delivery.id} could not be marked assigned: ${moved.error}`);
        } else {
          // The posting has left the board. Clearing this keeps "how long has
          // this been waiting for a rider?" honest on the operations board.
          await prisma.delivery.update({ where: { id: delivery.id }, data: { offeredAt: null } });
        }
      }
    }

    // Only on approval. A courier who has just tapped Claim and is looking at
    // the job does not need to be told they got it.
    if (source === "ADMIN_APPROVAL") {
      await notifyWorker(
        prisma,
        workerId,
        "Application approved 🎉",
        `You've been selected for "${task.title}". A contract is ready to sign.`,
        { screen: "tasks" },
        "notifTasks"
      );
    }

    return {
      ok: true,
      applicationId: application.id,
      contractId: contract.id,
      taskFilled,
      eligibility,
      overridden: blocking.length > 0,
    };
  } catch (err) {
    // A claim that latched the slot and then failed must not leave a posting
    // marked FILLED with nobody on it - that is an order that silently never
    // gets delivered, and nothing on any screen would say why.
    if (latched) await releaseSlot(task.id);
    throw err;
  }
}
