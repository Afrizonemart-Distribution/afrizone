/**
 * The worker's own Talent Profile (services/talentProfile.ts explains what it
 * is and why proven and claimed are kept apart).
 *
 * Mounted under /api/me. Every write is scoped by userId in the WHERE clause,
 * not checked after a read, so an id belonging to someone else is simply
 * "not found" and never a second query away from being edited.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../auth";
import { writeAudit, userActor } from "../util/audit";
import { buildProfile, mintSlug, OPEN_TO, VISIBILITIES } from "../services/talentProfile";
import { getFileBuffer } from "../services/storage";
import { aiEnabled, AiUnavailable, CV_TYPES, readCv } from "../services/ai";

const router = Router();

/* ── input helpers ─────────────────────────────────────────────────────────
   Each returns the clean value, null to clear, or undefined for "not sent".
   Throwing a BadInput is turned into a 400 by the handlers' wrapper. */

class BadInput extends Error {}

function text(v: unknown, field: string, max: number, required = false): string | null | undefined {
  if (v === undefined) return required ? fail(`${field} is required`) : undefined;
  if (v === null || v === "") return required ? fail(`${field} is required`) : null;
  if (typeof v !== "string") return fail(`${field} must be text`);
  const t = v.trim();
  if (!t) return required ? fail(`${field} is required`) : null;
  if (t.length > max) return fail(`${field} must be at most ${max} characters`);
  return t;
}

function date(v: unknown, field: string, required = false): Date | null | undefined {
  if (v === undefined) return required ? fail(`${field} is required`) : undefined;
  if (v === null || v === "") return required ? fail(`${field} is required`) : null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return fail(`${field} must be a date`);
  if (d.getTime() > Date.now() + 366 * 24 * 3600 * 1000) return fail(`${field} is too far in the future`);
  return d;
}

function year(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1950 || n > new Date().getFullYear() + 8) return fail(`${field} must be a year`);
  return n;
}

/** http(s) only: a javascript: link on a shared profile is an attack on whoever opens it. */
function link(v: unknown): string | null | undefined {
  const t = text(v, "url", 500);
  if (t == null) return t;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return fail("url must be a full link, starting with https://");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return fail("url must start with https://");
  return u.toString();
}

function fail(msg: string): never {
  throw new BadInput(msg);
}

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
// Express 4 does not catch a rejected async handler, so unexpected errors are
// passed to next() explicitly rather than rethrown into the void.
const handle = (fn: Handler) => async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof BadInput) return res.status(400).json({ error: e.message });
    next(e);
  }
};

/** A file the worker uploaded through /api/me/kyc/documents, of an allowed kind. */
async function ownDocument(userId: string, id: unknown, docTypes: string[]) {
  if (id === null || id === "") return null;
  if (typeof id !== "string") fail("document id must be text");
  const doc = await prisma.kycDocument.findFirst({ where: { id, userId } });
  if (!doc || !docTypes.includes(doc.docType)) fail("That file was not found. Upload it again.");
  return doc;
}

// Caps per section. A real CV has a handful; these bound abuse, not use.
const MAX_ITEMS = 30;

/* ── the profile ──────────────────────────────────────────────────────── */

router.get(
  "/profile",
  requireAuth,
  handle(async (req, res) => {
    const profile = await buildProfile(req.user!.id, "self");
    if (!profile) return res.status(404).json({ error: "User not found" });
    res.json(profile);
  })
);

/**
 * PATCH /api/me/profile
 * {headline?, bio?, location?, openTo?: OpenTo[], cvDocumentId?, visibility?}
 *
 * Turning sharing on (visibility LINK) mints the slug once. Turning it off
 * keeps the slug, so a link that was shared stops working rather than later
 * pointing at somebody else.
 */
router.patch(
  "/profile",
  requireAuth,
  handle(async (req, res) => {
    const userId = req.user!.id;
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};

    const headline = text(b.headline, "headline", 120);
    if (headline !== undefined) data.headline = headline;
    const bio = text(b.bio, "bio", 2000);
    if (bio !== undefined) data.bio = bio;
    const location = text(b.location, "location", 120);
    if (location !== undefined) data.location = location;

    if (b.openTo !== undefined) {
      if (!Array.isArray(b.openTo) || b.openTo.some((o: unknown) => !(OPEN_TO as readonly unknown[]).includes(o))) {
        fail(`openTo must be a list of ${OPEN_TO.join(", ")}`);
      }
      data.openTo = [...new Set(b.openTo as string[])].join(",");
    }

    if (b.cvDocumentId !== undefined) {
      const doc = await ownDocument(userId, b.cvDocumentId, ["CV"]);
      data.cvDocumentId = doc ? doc.id : null;
    }

    if (b.visibility !== undefined) {
      if (!(VISIBILITIES as readonly unknown[]).includes(b.visibility)) {
        fail(`visibility must be one of ${VISIBILITIES.join(", ")}`);
      }
      data.profileVisibility = b.visibility;
    }

    const before = await prisma.user.findUnique({ where: { id: userId } });
    if (!before) return res.status(404).json({ error: "User not found" });

    if (data.profileVisibility === "LINK" && !before.profileSlug) {
      // Retry on the (astronomically unlikely) collision rather than fail.
      for (let i = 0; i < 5 && !data.profileSlug; i++) {
        const slug = mintSlug(before.name);
        if (!(await prisma.user.findUnique({ where: { profileSlug: slug } }))) data.profileSlug = slug;
      }
    }

    await prisma.user.update({ where: { id: userId }, data });
    if (data.profileVisibility && data.profileVisibility !== before.profileVisibility) {
      await writeAudit(userActor(userId), "PROFILE_VISIBILITY_CHANGED", "User", userId, {
        from: before.profileVisibility,
        to: data.profileVisibility,
      });
    }
    res.json(await buildProfile(userId, "self"));
  })
);

/* ── sections ─────────────────────────────────────────────────────────────
   One generic create/update/delete per section. The section-specific part is
   only "which fields, validated how". */

interface Section {
  path: string;
  count: (userId: string) => Promise<number>;
  parse: (b: any, userId: string, creating: boolean) => Promise<Record<string, unknown>>;
  create: (data: any) => Promise<unknown>;
  update: (id: string, userId: string, data: any) => Promise<{ count: number }>;
  remove: (id: string, userId: string) => Promise<{ count: number }>;
}

const SECTIONS: Section[] = [
  {
    path: "experience",
    count: (userId) => prisma.workExperience.count({ where: { userId } }),
    parse: async (b, _userId, creating) => {
      const d: Record<string, unknown> = {
        title: text(b.title, "title", 120, creating),
        company: text(b.company, "company", 120, creating),
        location: text(b.location, "location", 120),
        startDate: date(b.startDate, "startDate", creating),
        endDate: date(b.endDate, "endDate"),
        description: text(b.description, "description", 2000),
      };
      if (d.startDate && d.endDate && (d.endDate as Date) < (d.startDate as Date)) fail("endDate is before startDate");
      return d;
    },
    create: (data) => prisma.workExperience.create({ data }),
    update: (id, userId, data) => prisma.workExperience.updateMany({ where: { id, userId }, data }),
    remove: (id, userId) => prisma.workExperience.deleteMany({ where: { id, userId } }),
  },
  {
    path: "education",
    count: (userId) => prisma.education.count({ where: { userId } }),
    parse: async (b, _userId, creating) => {
      const d: Record<string, unknown> = {
        institution: text(b.institution, "institution", 160, creating),
        qualification: text(b.qualification, "qualification", 120, creating),
        field: text(b.field, "field", 120),
        startYear: year(b.startYear, "startYear"),
        endYear: year(b.endYear, "endYear"),
      };
      if (d.startYear && d.endYear && (d.endYear as number) < (d.startYear as number)) fail("endYear is before startYear");
      return d;
    },
    create: (data) => prisma.education.create({ data }),
    update: (id, userId, data) => prisma.education.updateMany({ where: { id, userId }, data }),
    remove: (id, userId) => prisma.education.deleteMany({ where: { id, userId } }),
  },
  {
    path: "portfolio",
    count: (userId) => prisma.portfolioItem.count({ where: { userId } }),
    parse: async (b, userId, creating) => {
      const d: Record<string, unknown> = {
        title: text(b.title, "title", 120, creating),
        description: text(b.description, "description", 1000),
        url: link(b.url),
      };
      if (b.documentId !== undefined) {
        const doc = await ownDocument(userId, b.documentId, ["PORTFOLIO", "DOCS", "CV"]);
        d.documentId = doc ? doc.id : null;
      }
      if (creating && !d.url && !d.documentId) fail("Add a link or a file");
      return d;
    },
    create: (data) => prisma.portfolioItem.create({ data }),
    update: (id, userId, data) => prisma.portfolioItem.updateMany({ where: { id, userId }, data }),
    remove: (id, userId) => prisma.portfolioItem.deleteMany({ where: { id, userId } }),
  },
];

const strip = (d: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));

for (const s of SECTIONS) {
  router.post(
    `/${s.path}`,
    requireAuth,
    handle(async (req, res) => {
      const userId = req.user!.id;
      if ((await s.count(userId)) >= MAX_ITEMS) fail(`You can add up to ${MAX_ITEMS} entries here`);
      const data = strip(await s.parse(req.body ?? {}, userId, true));
      await s.create({ ...data, userId });
      res.status(201).json(await buildProfile(userId, "self"));
    })
  );

  router.patch(
    `/${s.path}/:id`,
    requireAuth,
    handle(async (req, res) => {
      const userId = req.user!.id;
      const data = strip(await s.parse(req.body ?? {}, userId, false));
      const { count } = await s.update(req.params.id, userId, data);
      if (!count) return res.status(404).json({ error: "Not found" });
      res.json(await buildProfile(userId, "self"));
    })
  );

  router.delete(
    `/${s.path}/:id`,
    requireAuth,
    handle(async (req, res) => {
      const userId = req.user!.id;
      const { count } = await s.remove(req.params.id, userId);
      if (!count) return res.status(404).json({ error: "Not found" });
      res.json(await buildProfile(userId, "self"));
    })
  );
}

/* ── CV reading (AI) ──────────────────────────────────────────────────────
   Two steps on purpose. /cv/read returns a DRAFT and saves nothing: the
   worker checks it in the app, fixes what the AI got wrong, then sends what
   they kept to /cv/import. A CV read wrongly never lands on a profile HR sees
   without the worker having looked at it. */

/** Reads per worker per day: each one is a paid AI call. */
const CV_READS_PER_DAY = 5;
/** Larger than any CV; bounds what we send. */
const CV_MAX_BYTES = 10 * 1024 * 1024;

router.post(
  "/profile/cv/read",
  requireAuth,
  handle(async (req, res) => {
    const userId = req.user!.id;
    if (!aiEnabled()) {
      return res.status(503).json({ error: "Reading CVs automatically isn't switched on yet", code: "AI_OFF" });
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { cvDocumentId: true } });
    const doc = user?.cvDocumentId
      ? await prisma.kycDocument.findFirst({ where: { id: user.cvDocumentId, userId } })
      : null;
    if (!doc) return res.status(400).json({ error: "Upload your CV first", code: "NO_CV" });
    const mime = (doc.mimeType || "").toLowerCase();
    if (!(CV_TYPES as readonly string[]).includes(mime)) {
      return res.status(415).json({ error: "Only PDF or photo CVs can be read. Fill in your profile by hand.", code: "CV_TYPE" });
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const used = await prisma.auditLog.count({ where: { actorId: userId, action: "cv.read", createdAt: { gte: since } } });
    if (used >= CV_READS_PER_DAY) {
      return res.status(429).json({ error: "You've read your CV a few times today. Try again tomorrow.", code: "CV_READ_LIMIT" });
    }

    const bytes = await getFileBuffer(doc.filename);
    if (bytes.byteLength > CV_MAX_BYTES) return res.status(413).json({ error: "That CV file is too large to read", code: "CV_TOO_LARGE" });
    // Counted before the call, so a failing call can't be retried without limit.
    await writeAudit(userActor(userId), "cv.read", "KycDocument", doc.id);
    try {
      const draft = await readCv(new Uint8Array(bytes), mime);
      res.json({ draft });
    } catch (e) {
      if (e instanceof AiUnavailable) return res.status(502).json({ error: e.message, code: e.code });
      console.error(`[cv.read] ${e instanceof Error ? e.message : String(e)}`);
      return res.status(502).json({ error: "Couldn't read your CV just now. Try again later.", code: "AI_FAILED" });
    }
  })
);

/**
 * POST /api/me/profile/cv/import
 * { headline?, bio?, experience?: [...], education?: [...] }
 *
 * Saves what the worker kept from the draft, through the same checks as adding
 * each entry by hand. An entry that fails them (say, a job with no start date)
 * is skipped and reported, so one bad line doesn't lose the rest.
 */
router.post(
  "/profile/cv/import",
  requireAuth,
  handle(async (req, res) => {
    const userId = req.user!.id;
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};
    const headline = text(b.headline, "headline", 120);
    if (headline) data.headline = headline;
    const bio = text(b.bio, "bio", 2000);
    if (bio) data.bio = bio;
    if (Object.keys(data).length) await prisma.user.update({ where: { id: userId }, data });

    const added: Record<string, number> = { experience: 0, education: 0 };
    const skipped: { section: string; index: number; error: string }[] = [];
    for (const path of ["experience", "education"] as const) {
      const rows = Array.isArray(b[path]) ? b[path] : [];
      const section = SECTIONS.find((s) => s.path === path)!;
      let room = MAX_ITEMS - (await section.count(userId));
      for (let i = 0; i < rows.length; i++) {
        if (room <= 0) {
          skipped.push({ section: path, index: i, error: `You can add up to ${MAX_ITEMS} entries here` });
          continue;
        }
        try {
          const parsed = strip(await section.parse(rows[i] ?? {}, userId, true));
          await section.create({ ...parsed, userId });
          added[path] += 1;
          room -= 1;
        } catch (e) {
          if (!(e instanceof BadInput)) throw e;
          skipped.push({ section: path, index: i, error: e.message });
        }
      }
    }
    await writeAudit(userActor(userId), "cv.import", "User", userId, { ...added, skipped: skipped.length });
    res.json({ added, skipped, profile: await buildProfile(userId, "self") });
  })
);

export default router;
