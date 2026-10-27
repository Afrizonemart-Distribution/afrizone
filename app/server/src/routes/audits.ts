/**
 * GET /api/admin/audits -> every store audit finding, for the admin screen
 * (services/storeAudit.ts records them).
 *
 * Until this, a finding was visible in one place: the latest one, on the store
 * it belongs to. That answers "can I approve this shop?" and nothing else -
 * not "which shops failed this month?", not "is this auditor's work holding
 * up?". This is the list those questions need.
 *
 * WHAT THE AUDITOR LEFT BEHIND TRAVELS WITH EACH ROW, as counts: how many
 * photos, whether the store signed, how many checks failed. A score of 95 with
 * no photos and no signature (filed before the gate, or with it switched off)
 * is a different thing from a 95 with three clean photos and a manager's name,
 * and a reviewer scanning the list should see that without opening every one.
 * The photos and signature themselves are behind the proof-of-work dialog,
 * which already exists (GET /api/admin/evidence).
 */
import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { AUDIT_OUTCOMES, type AuditOutcome } from "../services/storeAudit";
import { parseFlags } from "../services/evidence";

const adminRouter = Router();

/** Newest first, and a screen's worth. Old findings are history, not a queue. */
const LIMIT = 200;

adminRouter.get(
  "/",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const raw = typeof req.query.outcome === "string" ? req.query.outcome.toUpperCase() : null;
    const outcome = raw && AUDIT_OUTCOMES.includes(raw as AuditOutcome) ? raw : null;

    const [rows, grouped] = await Promise.all([
      prisma.storeAudit.findMany({
        where: outcome ? { outcome } : {},
        include: {
          organization: { select: { id: true, name: true, status: true, address: true } },
          auditor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
      }),
      prisma.storeAudit.groupBy({ by: ["outcome"], _count: { _all: true } }),
    ]);

    // Proof for every listed audit in two queries, not two per row.
    const taskIds = rows.map((r) => r.taskId).filter((id): id is string => !!id);
    const [photos, signatures] = taskIds.length
      ? await Promise.all([
          prisma.evidence.findMany({
            where: { taskId: { in: taskIds }, stage: "AUDIT" },
            select: { taskId: true, workerId: true, flags: true },
          }),
          prisma.signature.findMany({
            where: { taskId: { in: taskIds }, stage: "AUDIT" },
            select: { taskId: true, workerId: true, flags: true },
          }),
        ])
      : [[], []];

    // Per auditor on the task: a re-audit by somebody else is not this one's proof.
    const key = (taskId: string, workerId: string) => `${taskId}:${workerId}`;
    const proofOf = (taskId: string | null, auditorId: string | null) => {
      if (!taskId || !auditorId) return { photos: 0, signed: false, flagged: 0 };
      const k = key(taskId, auditorId);
      const mine = photos.filter((p) => key(p.taskId, p.workerId) === k);
      const sig = signatures.find((s) => key(s.taskId, s.workerId) === k);
      const flagged =
        mine.filter((p) => parseFlags(p.flags).length > 0).length + (sig && parseFlags(sig.flags).length > 0 ? 1 : 0);
      return { photos: mine.length, signed: !!sig, flagged };
    };

    const counts: Record<string, number> = { ALL: 0, PASS: 0, FAIL: 0 };
    for (const g of grouped) {
      counts[g.outcome] = g._count._all;
      counts.ALL += g._count._all;
    }

    res.json({
      counts,
      audits: rows.map((r) => ({
        id: r.id,
        score: r.score,
        outcome: r.outcome,
        notes: r.notes,
        createdAt: r.createdAt,
        taskId: r.taskId,
        organization: r.organization,
        auditor: r.auditor,
        proof: proofOf(r.taskId, r.auditorId),
      })),
    });
  }
);

export default adminRouter;
