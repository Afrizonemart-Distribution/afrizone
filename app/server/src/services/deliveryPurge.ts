/**
 * Deleting the customer data a delivery needed (MART_INTEGRATION.md §5).
 *
 * Per order, PartTime receives a display name, a contact number, a drop-off
 * address with coordinates, and delivery instructions. That is the whole list,
 * and the commitment made about it is precise:
 *
 *   - **Deleted seven days** after the order reaches a terminal state.
 *   - **Deleted means `DELETE`** - not a flag, not a filtered query. Data still
 *     in the database is still a liability.
 *   - **The purge is auditable and its failure visible.** A purge run is a
 *     recorded row, so a job that silently did not run is distinguishable from
 *     one that ran and found nothing.
 *
 * The third point is why this writes an audit row even when it changes nothing.
 * A promise to delete that nobody can prove was kept is not much of a promise,
 * and "no rows purged" and "the purge has not run since Tuesday" look identical
 * from the outside unless the quiet runs leave a trace too.
 *
 * THE ORDER ITSELF IS NOT DELETED. What is owed, to which store, on which
 * order, is a financial record and outlives the customer's details by design.
 * After a purge a Delivery row still says an order was placed at a shop, what it
 * was worth and who carried it - and no longer says who it went to.
 */
import { prisma } from "../prisma";
import { deleteEvidence } from "./storage";
import { writeAudit, type AuditActor } from "../util/audit";
import { TERMINAL_STATES } from "./delivery";

/** §5. Seven days after the order finishes, not seven days after it arrived. */
export const RETENTION_DAYS = 7;

/**
 * How many rows one run will touch.
 *
 * A cap rather than an unbounded sweep because this runs inside a Worker with a
 * wall-clock budget, and a run that is killed halfway leaves no record of having
 * started. A backlog is drained over consecutive runs; the audit row says how
 * much was left, so a cap that is permanently too small is visible rather than
 * silent.
 */
const BATCH = 200;

export interface PurgeResult {
  purged: number;
  /** Rows still eligible after this run. Non-zero means the batch cap was hit. */
  remaining: number;
  cutoff: Date;
}

/**
 * Delete the customer's details from every order that finished more than seven
 * days ago.
 *
 * `updatedAt` is the clock, and that is worth being explicit about: it is the
 * moment the row last changed, and for a terminal order the last change was
 * reaching a terminal state. Using `createdAt` would purge a long-running order
 * that is still live, and adding a dedicated `terminalAt` column would be a
 * third timestamp saying what the leg stamps already say.
 */
export async function purgeCustomerData(
  actor: AuditActor,
  now: Date = new Date()
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const where = {
    status: { in: TERMINAL_STATES },
    updatedAt: { lt: cutoff },
    // Already emptied. Without this the sweep re-finds the same rows forever
    // and every run reports work it did not do.
    customerPurgedAt: null,
  };

  const due = await prisma.delivery.findMany({
    where,
    select: { id: true, martOrderId: true, taskId: true },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
  });

  for (const row of due) {
    // Door photos first (services/evidence.ts). They show where the customer
    // lives, which is exactly what this sweep promises to stop holding. The
    // object goes before the row, so a failure in between leaves a row pointing
    // at nothing rather than an image nothing points at - the second would be
    // undeletable by anybody who did not already know its key. Pickup photos
    // show a shop, not a person, and are kept with the job.
    if (row.taskId) {
      const photos = await prisma.evidence.findMany({
        where: { taskId: row.taskId, stage: "DROPOFF" },
        select: { id: true, objectKey: true },
      });
      await deleteEvidence(photos.map((p) => p.objectKey));
      if (photos.length > 0) {
        await prisma.evidence.deleteMany({ where: { id: { in: photos.map((p) => p.id) } } });
      }
      // The customer's signature carries their name. Rows only, nothing in R2.
      await prisma.signature.deleteMany({ where: { taskId: row.taskId, stage: "DROPOFF" } });
    }
    await prisma.delivery.update({
      where: { id: row.id },
      data: {
        customerName: null,
        customerPhone: null,
        dropoffAddress: null,
        dropoffLat: null,
        dropoffLng: null,
        dropoffInstructions: null,
        // Set in the SAME write as the deletion. Two writes would leave a
        // window where the data is gone and nothing records that we removed it,
        // which is the state that cannot be told apart from data loss.
        customerPurgedAt: now,
      },
    });
  }

  const remaining = await prisma.delivery.count({ where });

  // Written on every run, including one that found nothing. See the note at the
  // top: a quiet run and a run that never happened must not look the same.
  await writeAudit(actor, "delivery.customerData.purged", "Delivery", "*", {
    purged: due.length,
    remaining,
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
    // The ids, not the data. Which orders were cleared is the auditable fact;
    // what was cleared out of them is the thing we just promised to delete.
    martOrderIds: due.map((d) => d.martOrderId),
  });

  return { purged: due.length, remaining, cutoff };
}

/**
 * What the purge would do right now, without doing it.
 *
 * For the admin screen: an operator asking "is the retention promise being
 * kept?" needs to see the backlog, and a number that only appears after you
 * press a button is not an answer to that question.
 */
export async function purgeStatus(now: Date = new Date()): Promise<{
  due: number;
  purgedTotal: number;
  oldestDue: Date | null;
  lastRunAt: Date | null;
  cutoff: Date;
}> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const where = {
    status: { in: TERMINAL_STATES },
    updatedAt: { lt: cutoff },
    customerPurgedAt: null,
  };

  const [due, purgedTotal, oldest, lastRun] = await Promise.all([
    prisma.delivery.count({ where }),
    prisma.delivery.count({ where: { customerPurgedAt: { not: null } } }),
    prisma.delivery.findFirst({ where, orderBy: { updatedAt: "asc" }, select: { updatedAt: true } }),
    prisma.auditLog.findFirst({
      where: { action: "delivery.customerData.purged" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    due,
    purgedTotal,
    oldestDue: oldest?.updatedAt ?? null,
    lastRunAt: lastRun?.createdAt ?? null,
    cutoff,
  };
}
