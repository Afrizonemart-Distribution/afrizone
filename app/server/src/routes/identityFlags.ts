/**
 * Staff review of accounts that share something only one person should have
 * (services/identityGuard.ts).
 *
 *   GET  /api/admin/identity-flags?status=OPEN   the cases, with each account
 *   POST /api/admin/identity-flags/:id/decide    {decision: CLEARED|CONFIRMED, note}
 *   POST /api/admin/identity-flags/scan          record every saved bank
 *                                                account once (SUPER_ADMIN), so
 *                                                accounts from before this
 *                                                feature are compared too
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { userActor, writeAudit } from "../util/audit";
import { KIND_LABEL, recordSignal, safeIds, type SignalKind } from "../services/identityGuard";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"));

const wrap =
  (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

router.get(
  "/",
  wrap(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "OPEN";
    const flags = await prisma.identityFlag.findMany({
      where: status === "ALL" ? undefined : { status },
      orderBy: [{ severity: "asc" }, { updatedAt: "desc" }],
      take: 200,
    });
    const ids = [...new Set(flags.flatMap((f) => safeIds(f.userIds)))];
    const users = ids.length
      ? await prisma.user.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            kycStatus: true,
            bankMasked: true,
            createdAt: true,
            completedCount: true,
          },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    res.json(
      flags.map((f) => ({
        id: f.id,
        kind: f.kind,
        label: KIND_LABEL[f.kind as SignalKind] ?? f.kind,
        severity: f.severity,
        status: f.status,
        note: f.note,
        decidedAt: f.decidedAt,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        // Payouts are held for these accounts while the case is open or confirmed.
        holdsPayouts: f.severity === "HIGH" && f.status !== "CLEARED",
        accounts: safeIds(f.userIds)
          .map((id) => byId.get(id))
          .filter(Boolean),
      }))
    );
  })
);

router.post(
  "/:id/decide",
  wrap(async (req, res) => {
    const decision = req.body?.decision;
    if (decision !== "CLEARED" && decision !== "CONFIRMED") {
      return res.status(400).json({ error: "decision must be CLEARED or CONFIRMED" });
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) : "";
    // A decision that lifts or stops someone's pay needs its reason written down.
    if (!note) return res.status(400).json({ error: "Say what you checked" });
    const flag = await prisma.identityFlag.findUnique({ where: { id: req.params.id } });
    if (!flag) return res.status(404).json({ error: "Case not found" });

    const updated = await prisma.identityFlag.update({
      where: { id: flag.id },
      data: { status: decision, note, decidedById: req.user!.id, decidedAt: new Date() },
    });
    await writeAudit(userActor(req.user!.id), "identity_flag.decided", "IdentityFlag", flag.id, {
      decision,
      note,
      kind: flag.kind,
      userIds: safeIds(flag.userIds),
    });
    res.json(updated);
  })
);

router.post(
  "/scan",
  requireRole("SUPER_ADMIN"),
  wrap(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { bankAccountNumber: { not: null }, bankCode: { not: null } },
      select: { id: true, bankAccountNumber: true, bankCode: true },
    });
    for (const u of users) await recordSignal(u.id, "BANK", `${u.bankCode}:${u.bankAccountNumber}`);
    const open = await prisma.identityFlag.count({ where: { status: "OPEN" } });
    await writeAudit(userActor(req.user!.id), "identity_flag.scan", "IdentityFlag", "-", { accounts: users.length });
    res.json({ scanned: users.length, openCases: open });
  })
);

export default router;
