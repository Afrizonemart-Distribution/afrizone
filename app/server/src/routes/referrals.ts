import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { userActor, writeAudit } from "../util/audit";
import { rewardRule } from "../services/referrals";

const router = Router();

/**
 * GET /api/admin/referrals → every referral, newest first, with the reward
 * amounts in force. Who is bringing people in, and what it has cost.
 */
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"), async (_req: AuthedRequest, res: Response) => {
  const [rows, rewards] = await Promise.all([
    prisma.referral.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        referrer: { select: { id: true, name: true } },
        referredUser: { select: { id: true, name: true } },
        referredOrganization: { select: { id: true, name: true } },
      },
    }),
    rewardRule(),
  ]);
  res.json({
    rewards,
    paidOut: rows.filter((r) => r.status === "EARNED").reduce((s, r) => s + r.gross, 0),
    referrals: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      gross: r.gross,
      net: r.net,
      earnedAt: r.earnedAt,
      createdAt: r.createdAt,
      referrer: r.referrer,
      referred:
        r.kind === "STORE"
          ? { id: r.referredOrganization?.id ?? null, name: r.referredOrganization?.name ?? "Deleted store" }
          : { id: r.referredUser?.id ?? null, name: r.referredUser?.name ?? "Deleted account" },
    })),
  });
});

/**
 * POST /api/admin/referrals/:id/void → cancel a referral that is not genuine,
 * before it pays. An EARNED one is not voided here: the money is already in a
 * wallet, and taking it back is a clawback, which is a decision with a record
 * of its own rather than a status flipped.
 */
router.post("/:id/void", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const moved = await prisma.referral.updateMany({
    where: { id: req.params.id, status: "PENDING" },
    data: { status: "VOID" },
  });
  if (moved.count !== 1) {
    return res.status(409).json({ error: "Only a referral that has not paid yet can be cancelled" });
  }
  await writeAudit(userActor(req.user!.id), "referral.voided", "Referral", req.params.id, {
    reason: req.body?.reason ? String(req.body.reason) : null,
  });
  res.json({ id: req.params.id, status: "VOID" });
});

export default router;
