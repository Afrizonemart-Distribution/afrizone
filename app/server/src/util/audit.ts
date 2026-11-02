import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ActorType } from "../types";

/**
 * Who an audited action is attributed to.
 *
 *   { type: "USER", userId }  - a human; AuditLog.actorId FKs to their User row.
 *   { type: <other>, ref }    - an automation with no User row at all; the ref
 *                               is recorded in AuditLog.actorRef instead.
 *
 * AuditLog.actorId used to be REQUIRED and foreign-keyed to User, so anything
 * not initiated by a logged-in human could not write an audit row - the insert
 * simply failed. That made every webhook, scheduled job and integration
 * unauditable, which is a hard blocker for the fulfilment work where most
 * actions are system-initiated.
 */
export type AuditActor =
  | { type: "USER"; userId: string; ref?: undefined }
  | { type: Exclude<ActorType, "USER">; ref: string; userId?: string };

/**
 * Canonical refs for the platform's automated actors. Register new automations
 * here rather than passing ad-hoc strings, so the trail stays greppable and a
 * typo cannot silently invent a second "actor".
 */
export const SYSTEM_ACTORS = {
  paystackWebhook: { type: "WEBHOOK", ref: "paystack" },
  smileWebhook: { type: "WEBHOOK", ref: "smile-identity" },
  /// The scheduled sweep that deletes delivery customer data (§5). A JOB rather
  /// than a SYSTEM actor because it is a thing that runs on a clock and can
  /// fail to run, which is exactly what its audit rows are read to check.
  deliveryPurge: { type: "JOB", ref: "delivery-purge" },
  /// A referral bonus earned as a side effect of a payment release or a store
  /// approval (services/referrals.ts). The human who pressed the button is on
  /// that action's own audit row.
  referrals: { type: "SYSTEM", ref: "referrals" },
} as const satisfies Record<string, AuditActor>;

export function userActor(userId: string): AuditActor {
  return { type: "USER", userId };
}

/**
 * Builds the AuditLog row. Exported separately from writeAudit so a caller
 * already inside a prisma.$transaction can write through its own `tx` client
 * without duplicating the shape.
 */
export function auditData(
  actor: AuditActor,
  action: string,
  entity: string,
  entityId: string,
  meta?: Record<string, unknown>
): Prisma.AuditLogUncheckedCreateInput {
  return {
    actorId: actor.userId ?? null,
    actorType: actor.type,
    actorRef: actor.type === "USER" ? null : actor.ref,
    action,
    entity,
    entityId,
    meta: meta ? JSON.stringify(meta) : null,
  };
}

/**
 * Write an AuditLog entry. `meta` is serialized to a JSON string (SQLite has
 * no native Json type: see schema.prisma).
 */
export async function writeAudit(
  actor: AuditActor,
  action: string,
  entity: string,
  entityId: string,
  meta?: Record<string, unknown>
) {
  return prisma.auditLog.create({
    data: auditData(actor, action, entity, entityId, meta),
  });
}
