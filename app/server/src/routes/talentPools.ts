/**
 * Talent pools: named groups of workers HR keeps, e.g. "Verified Lagos
 * drivers" or "Hausa-speaking agents". A pool is a short list HR trusts; a job
 * alert can go to one pool (POST /api/jobs/:id/alerts { audience: "POOL" }).
 *
 *   GET    /api/talent-pools                      pools with member counts
 *   POST   /api/talent-pools                      { name, note? }
 *   PATCH  /api/talent-pools/:id                  { name?, note? }
 *   DELETE /api/talent-pools/:id
 *   GET    /api/talent-pools/:id                  pool + members (with standing)
 *   POST   /api/talent-pools/:id/members          { userIds: string[] }
 *   DELETE /api/talent-pools/:id/members/:userId
 *
 * Only workers can be members. Adding someone twice is a no-op.
 */
import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { userActor, writeAudit } from "../util/audit";
import { loadStandings, type Standing } from "../services/standing";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"));

const NAME_MAX = 80;
const NOTE_MAX = 500;
/** Per request, and under D1's 100-binds-a-statement limit. */
const ADD_MAX = 90;

function text(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}

router.get("/", async (_req: AuthedRequest, res: Response) => {
  const pools = await prisma.talentPool.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  res.json(pools.map(({ _count, ...p }) => ({ ...p, memberCount: _count.members })));
});

router.post("/", async (req: AuthedRequest, res: Response) => {
  const name = text(req.body?.name, NAME_MAX);
  if (!name) return res.status(400).json({ error: "Give the pool a name", code: "NAME_REQUIRED" });
  const clash = await prisma.talentPool.findUnique({ where: { name } });
  if (clash) return res.status(409).json({ error: "A pool with that name already exists", code: "NAME_TAKEN" });
  const pool = await prisma.talentPool.create({
    data: { name, note: text(req.body?.note, NOTE_MAX), createdById: req.user!.id },
  });
  await writeAudit(userActor(req.user!.id), "talentPool.create", "TalentPool", pool.id, { name });
  res.status(201).json({ ...pool, memberCount: 0 });
});

router.patch("/:id", async (req: AuthedRequest, res: Response) => {
  const pool = await prisma.talentPool.findUnique({ where: { id: req.params.id } });
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  const data: { name?: string; note?: string | null } = {};
  if (req.body?.name !== undefined) {
    const name = text(req.body.name, NAME_MAX);
    if (!name) return res.status(400).json({ error: "Give the pool a name", code: "NAME_REQUIRED" });
    if (name !== pool.name && (await prisma.talentPool.findUnique({ where: { name } }))) {
      return res.status(409).json({ error: "A pool with that name already exists", code: "NAME_TAKEN" });
    }
    data.name = name;
  }
  if (req.body?.note !== undefined) data.note = text(req.body.note, NOTE_MAX);
  const updated = await prisma.talentPool.update({ where: { id: pool.id }, data });
  await writeAudit(userActor(req.user!.id), "talentPool.update", "TalentPool", pool.id, data);
  res.json(updated);
});

router.delete("/:id", async (req: AuthedRequest, res: Response) => {
  const pool = await prisma.talentPool.findUnique({ where: { id: req.params.id } });
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  await prisma.talentPool.delete({ where: { id: pool.id } });
  await writeAudit(userActor(req.user!.id), "talentPool.delete", "TalentPool", pool.id, { name: pool.name });
  res.status(204).end();
});

router.get("/:id", async (req: AuthedRequest, res: Response) => {
  const pool = await prisma.talentPool.findUnique({
    where: { id: req.params.id },
    include: {
      members: {
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true, kycStatus: true, rating: true, completedCount: true },
          },
        },
      },
    },
  });
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  const users = pool.members.map((m) => m.user);
  const standings = new Map<string, Standing>();
  for (let i = 0; i < users.length; i += ADD_MAX) {
    for (const [id, st] of await loadStandings(users.slice(i, i + ADD_MAX))) standings.set(id, st);
  }
  res.json({
    ...pool,
    members: pool.members.map((m) => ({
      userId: m.userId,
      addedAt: m.createdAt,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      kycStatus: m.user.kycStatus,
      rating: m.user.rating,
      standing: standings.get(m.userId) ?? null,
    })),
  });
});

router.post("/:id/members", async (req: AuthedRequest, res: Response) => {
  const pool = await prisma.talentPool.findUnique({ where: { id: req.params.id } });
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  const raw: unknown[] = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  const ids = [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (ids.length === 0) return res.status(400).json({ error: "Pick at least one worker", code: "NO_USERS" });
  if (ids.length > ADD_MAX) return res.status(400).json({ error: `Add at most ${ADD_MAX} at a time`, code: "TOO_MANY" });

  const [workers, existing] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids }, role: "WORKER" }, select: { id: true } }),
    prisma.talentPoolMember.findMany({ where: { poolId: pool.id, userId: { in: ids } }, select: { userId: true } }),
  ]);
  const have = new Set(existing.map((e) => e.userId));
  const fresh = workers.map((w) => w.id).filter((id) => !have.has(id));
  // D1: ~4 binds a row, so 20 rows a statement stays under the limit.
  for (let i = 0; i < fresh.length; i += 20) {
    await prisma.talentPoolMember.createMany({
      data: fresh.slice(i, i + 20).map((userId) => ({ poolId: pool.id, userId, addedById: req.user!.id })),
    });
  }
  await prisma.talentPool.update({ where: { id: pool.id }, data: { updatedAt: new Date() } });
  await writeAudit(userActor(req.user!.id), "talentPool.addMembers", "TalentPool", pool.id, { added: fresh.length });
  res.json({ added: fresh.length, skipped: ids.length - fresh.length });
});

router.delete("/:id/members/:userId", async (req: AuthedRequest, res: Response) => {
  const { count } = await prisma.talentPoolMember.deleteMany({
    where: { poolId: req.params.id, userId: req.params.userId },
  });
  if (count === 0) return res.status(404).json({ error: "Not in this pool" });
  await writeAudit(userActor(req.user!.id), "talentPool.removeMember", "TalentPool", req.params.id, {
    userId: req.params.userId,
  });
  res.status(204).end();
});

export default router;
