/**
 * Tiers and places (services/tiers.ts, services/places.ts).
 *
 *   GET   /api/reference/tiers            active tiers (?all=1 for staff: every tier)
 *   POST  /api/reference/tiers            {label, description?, docLabel?}   SUPER_ADMIN
 *   PATCH /api/reference/tiers/:key       {label?, description?, docLabel?, active?, sortOrder?}  SUPER_ADMIN
 *   GET   /api/reference/places           countries (live or coming soon) and states. Public.
 *   PATCH /api/reference/countries/:code  {live}   SUPER_ADMIN
 */
import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { listTiers, tierKeyFrom } from "../services/tiers";
import { listCountries, STATES } from "../services/places";
import { userActor, writeAudit } from "../util/audit";

const router = Router();
const wrap =
  (fn: (req: any, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const STAFF = ["SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

router.get(
  "/tiers",
  requireAuth,
  wrap(async (req: AuthedRequest, res) => {
    const all = req.query.all === "1" && STAFF.includes(req.user!.role);
    res.json(await listTiers({ activeOnly: !all }));
  })
);

router.post(
  "/tiers",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  wrap(async (req: AuthedRequest, res) => {
    const label = text(req.body?.label, 40);
    if (label.length < 2) return res.status(400).json({ error: "Give the tier a name" });
    const key = tierKeyFrom(label);
    if (!key) return res.status(400).json({ error: "Use letters or numbers in the name" });
    const existing = await prisma.tier.findUnique({ where: { key } });
    if (existing) return res.status(409).json({ error: `There is already a tier called ${existing.label}` });
    const last = await prisma.tier.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const tier = await prisma.tier.create({
      data: {
        key,
        label,
        description: text(req.body?.description, 200) || null,
        docLabel: text(req.body?.docLabel, 120) || null,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    await writeAudit(userActor(req.user!.id), "tier.created", "Tier", key, { label });
    res.status(201).json(tier);
  })
);

router.patch(
  "/tiers/:key",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  wrap(async (req: AuthedRequest, res) => {
    const existing = await prisma.tier.findUnique({ where: { key: req.params.key } });
    if (!existing) return res.status(404).json({ error: "Tier not found" });
    const b = req.body || {};
    const data: Record<string, unknown> = {};
    if (b.label !== undefined) {
      const label = text(b.label, 40);
      if (label.length < 2) return res.status(400).json({ error: "Give the tier a name" });
      data.label = label;
    }
    if (b.description !== undefined) data.description = text(b.description, 200) || null;
    if (b.docLabel !== undefined) data.docLabel = text(b.docLabel, 120) || null;
    if (b.active !== undefined) data.active = b.active === true;
    if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) data.sortOrder = b.sortOrder;
    const tier = await prisma.tier.update({ where: { key: existing.key }, data });
    await writeAudit(userActor(req.user!.id), "tier.updated", "Tier", existing.key, data);
    res.json(tier);
  })
);

router.get(
  "/places",
  wrap(async (_req, res) => {
    res.json({ countries: await listCountries(), states: STATES });
  })
);

router.patch(
  "/countries/:code",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  wrap(async (req: AuthedRequest, res) => {
    const code = req.params.code.toUpperCase();
    const existing = await prisma.country.findUnique({ where: { code } });
    if (!existing) return res.status(404).json({ error: "Country not found" });
    if (typeof req.body?.live !== "boolean") return res.status(400).json({ error: "live must be true or false" });
    const country = await prisma.country.update({ where: { code }, data: { live: req.body.live } });
    await writeAudit(userActor(req.user!.id), "country.live_changed", "Country", code, { live: country.live });
    res.json(country);
  })
);

export default router;
