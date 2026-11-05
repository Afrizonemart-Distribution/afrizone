import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { TIERS, REVIEW_MODES, ISSUER_MODES, slugify } from "../types";

const router = Router();

const PAY_MODELS = ["HOURLY", "FIXED", "PER_UNIT"];

// ── Tax rates ─────────────────────────────────────────────────────────────────

// GET /api/settings/tax-rates → TaxRate[]
router.get("/tax-rates", requireAuth, async (_req: AuthedRequest, res: Response) => {
  const rates = await prisma.taxRate.findMany({ orderBy: { jurisdiction: "asc" } });
  res.json(rates);
});

// POST /api/settings/tax-rates → create (SUPER_ADMIN)
router.post(
  "/tax-rates",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const b = req.body || {};
    if (!b.jurisdiction || !b.category || b.whtRate == null || b.vatRate == null) {
      return res.status(400).json({ error: "jurisdiction, category, whtRate, vatRate are required" });
    }
    const rate = await prisma.taxRate.create({
      data: {
        jurisdiction: b.jurisdiction,
        category: b.category,
        whtRate: b.whtRate,
        vatRate: b.vatRate,
        active: b.active ?? true,
      },
    });
    res.status(201).json(rate);
  }
);

// PATCH /api/settings/tax-rates/:id → update whtRate, vatRate, active (SUPER_ADMIN)
router.patch(
  "/tax-rates/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const existing = await prisma.taxRate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Tax rate not found" });

    const b = req.body || {};
    const data: any = {};
    if (b.jurisdiction !== undefined) data.jurisdiction = b.jurisdiction;
    if (b.category !== undefined) data.category = b.category;
    if (b.whtRate !== undefined) data.whtRate = b.whtRate;
    if (b.vatRate !== undefined) data.vatRate = b.vatRate;
    if (b.active !== undefined) data.active = b.active;

    const rate = await prisma.taxRate.update({ where: { id: req.params.id }, data });
    res.json(rate);
  }
);

// ── Categories ────────────────────────────────────────────────────────────────

// GET /api/settings/categories → Category[]
router.get("/categories", requireAuth, async (_req: AuthedRequest, res: Response) => {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  res.json(categories);
});

// POST /api/settings/categories → create (SUPER_ADMIN)
router.post(
  "/categories",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const b = req.body || {};
    if (!b.name || !b.tier || !b.defaultPayModel) {
      return res.status(400).json({ error: "name, tier, defaultPayModel are required" });
    }
    if (!TIERS.includes(b.tier)) {
      return res.status(400).json({ error: `tier must be one of ${TIERS.join(", ")}` });
    }
    if (!PAY_MODELS.includes(b.defaultPayModel)) {
      return res.status(400).json({ error: `defaultPayModel must be one of ${PAY_MODELS.join(", ")}` });
    }
    const category = await prisma.category.create({
      data: {
        name: b.name,
        tier: b.tier,
        defaultPayModel: b.defaultPayModel,
        active: b.active ?? true,
      },
    });
    res.status(201).json(category);
  }
);

// PATCH /api/settings/categories/:id → update (SUPER_ADMIN)
router.patch(
  "/categories/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Category not found" });

    const b = req.body || {};
    if (b.tier !== undefined && !TIERS.includes(b.tier)) {
      return res.status(400).json({ error: `tier must be one of ${TIERS.join(", ")}` });
    }
    if (b.defaultPayModel !== undefined && !PAY_MODELS.includes(b.defaultPayModel)) {
      return res.status(400).json({ error: `defaultPayModel must be one of ${PAY_MODELS.join(", ")}` });
    }
    const data: any = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.tier !== undefined) data.tier = b.tier;
    if (b.defaultPayModel !== undefined) data.defaultPayModel = b.defaultPayModel;
    if (b.active !== undefined) data.active = b.active;

    const category = await prisma.category.update({ where: { id: req.params.id }, data });
    res.json(category);
  }
);

// ── Skills catalogue ──────────────────────────────────────────
//
// The Afrizone-controlled list of skills a worker may declare. Same shape as
// Categories above: readable by any authenticated user, writable by
// SUPER_ADMIN, soft-retired via `active` and never hard-deleted - a skill with
// workers attached must not vanish from under them.
//
// `slug` is the stable identifier; `name` is deliberately not unique, so a
// rename never orphans the WorkerSkill rows pointing at it.

// GET /api/settings/skills -> Skill[]. `?all=1` includes retired ones (admin UI).
router.get("/skills", requireAuth, async (req: AuthedRequest, res: Response) => {
  const includeRetired = req.query.all === "1";
  const skills = await prisma.skill.findMany({
    where: includeRetired ? undefined : { active: true },
    orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(skills);
});

// POST /api/settings/skills -> create (SUPER_ADMIN)
router.post(
  "/skills",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const b = req.body || {};
    const name = String(b.name ?? "").trim();
    const group = String(b.group ?? "").trim();
    if (!name || !group) {
      return res.status(400).json({ error: "name and group are required" });
    }
    const slug = String(b.slug ?? "").trim() || slugify(name);
    if (!slug) return res.status(400).json({ error: "Could not derive a slug from that name" });

    const clash = await prisma.skill.findUnique({ where: { slug } });
    if (clash) return res.status(409).json({ error: `A skill with slug "${slug}" already exists` });

    const skill = await prisma.skill.create({
      data: {
        name,
        slug,
        group,
        active: b.active ?? true,
        sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0,
      },
    });
    res.status(201).json(skill);
  }
);

// PATCH /api/settings/skills/:id -> update or retire (SUPER_ADMIN)
router.patch(
  "/skills/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const existing = await prisma.skill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Skill not found" });

    const b = req.body || {};
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      data.name = name;
    }
    if (b.group !== undefined) data.group = String(b.group).trim();
    if (b.active !== undefined) data.active = Boolean(b.active);
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    // slug is intentionally NOT editable: it is the stable identity that makes
    // renaming safe in the first place.

    const skill = await prisma.skill.update({ where: { id: existing.id }, data });
    res.json(skill);
  }
);

// ── Credential types catalogue ─────────────────────────────────
//
// What Afrizone recognises as a checkable credential, and what each one needs
// from the worker. Unlike skills, these are the things that can gate access -
// see the note on the Credential model in schema.prisma.

// GET /api/settings/credential-types -> CredentialType[]
router.get("/credential-types", requireAuth, async (req: AuthedRequest, res: Response) => {
  const includeRetired = req.query.all === "1";
  const types = await prisma.credentialType.findMany({
    where: includeRetired ? undefined : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(types);
});

// POST /api/settings/credential-types -> create (SUPER_ADMIN)
router.post(
  "/credential-types",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const b = req.body || {};
    const name = String(b.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const reviewMode = b.reviewMode ?? "ADMIN_REVIEW";
    const issuerMode = b.issuerMode ?? "THIRD_PARTY";
    if (!REVIEW_MODES.includes(reviewMode)) {
      return res.status(400).json({ error: `reviewMode must be one of ${REVIEW_MODES.join(", ")}` });
    }
    if (!ISSUER_MODES.includes(issuerMode)) {
      return res.status(400).json({ error: `issuerMode must be one of ${ISSUER_MODES.join(", ")}` });
    }

    const slug = String(b.slug ?? "").trim() || slugify(name);
    if (!slug) return res.status(400).json({ error: "Could not derive a slug from that name" });
    const clash = await prisma.credentialType.findUnique({ where: { slug } });
    if (clash) {
      return res.status(409).json({ error: `A credential type with slug "${slug}" already exists` });
    }

    // An Afrizone-issued credential is evidenced by platform history, not by a
    // document the worker uploads - so requiring a file would make it
    // impossible to grant. Force the flag rather than trusting the caller.
    const requiresFile = issuerMode === "AFRIZONE" ? false : (b.requiresFile ?? true);

    const type = await prisma.credentialType.create({
      data: {
        name,
        slug,
        reviewMode,
        issuerMode,
        requiresExpiry: Boolean(b.requiresExpiry ?? false),
        requiresReference: Boolean(b.requiresReference ?? false),
        requiresFile: Boolean(requiresFile),
        issuerHint: b.issuerHint ? String(b.issuerHint).trim() : null,
        active: b.active ?? true,
        sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0,
      },
    });
    res.status(201).json(type);
  }
);

// PATCH /api/settings/credential-types/:id -> update or retire (SUPER_ADMIN)
router.patch(
  "/credential-types/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const existing = await prisma.credentialType.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Credential type not found" });

    const b = req.body || {};
    if (b.reviewMode !== undefined && !REVIEW_MODES.includes(b.reviewMode)) {
      return res.status(400).json({ error: `reviewMode must be one of ${REVIEW_MODES.join(", ")}` });
    }
    if (b.issuerMode !== undefined && !ISSUER_MODES.includes(b.issuerMode)) {
      return res.status(400).json({ error: `issuerMode must be one of ${ISSUER_MODES.join(", ")}` });
    }

    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = String(b.name).trim();
    if (b.reviewMode !== undefined) data.reviewMode = b.reviewMode;
    if (b.issuerMode !== undefined) data.issuerMode = b.issuerMode;
    if (b.requiresExpiry !== undefined) data.requiresExpiry = Boolean(b.requiresExpiry);
    if (b.requiresReference !== undefined) data.requiresReference = Boolean(b.requiresReference);
    if (b.requiresFile !== undefined) data.requiresFile = Boolean(b.requiresFile);
    if (b.issuerHint !== undefined) data.issuerHint = b.issuerHint ? String(b.issuerHint).trim() : null;
    if (b.active !== undefined) data.active = Boolean(b.active);
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;

    // Same invariant as on create, including when issuerMode is being changed
    // to AFRIZONE in this very request.
    const effectiveIssuerMode = (data.issuerMode as string) ?? existing.issuerMode;
    if (effectiveIssuerMode === "AFRIZONE") data.requiresFile = false;

    const type = await prisma.credentialType.update({ where: { id: existing.id }, data });
    res.json(type);
  }
);

// ── Templates (Setting key/value) ───────────────────────────────────────────────

// GET /api/settings/templates → {key,value}[]
router.get("/templates", requireAuth, async (_req: AuthedRequest, res: Response) => {
  const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  res.json(settings.map((s) => ({ key: s.key, value: s.value })));
});

// PUT /api/settings/templates/:key → body {value} (SUPER_ADMIN)
router.put(
  "/templates/:key",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const { value } = req.body || {};
    if (value === undefined) return res.status(400).json({ error: "value is required" });

    const setting = await prisma.setting.upsert({
      where: { key: req.params.key },
      update: { value: String(value) },
      create: { key: req.params.key, value: String(value) },
    });
    res.json({ key: setting.key, value: setting.value });
  }
);

export default router;
