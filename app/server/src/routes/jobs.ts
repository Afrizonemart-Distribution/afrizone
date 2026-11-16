import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, isAdmin, AuthedRequest } from "../auth";
import { EMPLOYMENT_TYPES, JOB_STATUSES } from "../types";
import { writeAudit, userActor } from "../util/audit";
import { ALERT_AUDIENCES, AlertAudience, alertSummary, previewJobAlerts, queueJobAlerts } from "../services/jobAlerts";

/** Partner name/about: trimmed, capped, empty means "AfriZone itself". */
function partnerField(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}

const router = Router();

// Augment a job with candidateCount.
async function withCounts(job: any) {
  const candidateCount = await prisma.jobApplication.count({ where: { jobId: job.id } });
  return { ...job, candidateCount };
}

// GET /api/jobs → Job[] augmented with candidateCount
router.get("/", requireAuth, async (_req: AuthedRequest, res: Response) => {
  const jobs = await prisma.job.findMany({ orderBy: { createdAt: "desc" } });
  const augmented = await Promise.all(jobs.map(withCounts));
  res.json(augmented);
});

// POST /api/jobs → create
router.post("/", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const b = req.body || {};
  if (!b.title || !b.department || !b.location || !b.employmentType || !b.description) {
    return res
      .status(400)
      .json({ error: "title, department, location, employmentType, description are required" });
  }
  if (!EMPLOYMENT_TYPES.includes(b.employmentType)) {
    return res.status(400).json({ error: `employmentType must be one of ${EMPLOYMENT_TYPES.join(", ")}` });
  }
  try {
    const job = await prisma.job.create({
      data: {
        title: b.title,
        department: b.department,
        location: b.location,
        employmentType: b.employmentType,
        salaryMin: b.salaryMin ?? null,
        salaryMax: b.salaryMax ?? null,
        description: b.description,
        needsCv: b.needsCv ?? true,
        needsCover: b.needsCover ?? false,
        needsPortfolio: b.needsPortfolio ?? false,
        closingDate: b.closingDate ? new Date(b.closingDate) : new Date(),
        status: b.status || "OPEN",
        createdById: req.user!.id,
        partnerName: partnerField(b.partnerName, 120),
        partnerAbout: partnerField(b.partnerAbout, 1000),
      },
    });
    res.status(201).json(await withCounts(job));
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Could not create job" });
  }
});

// GET /api/jobs/:id → Job + candidates: JobApplication[]
router.get("/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { candidates: { orderBy: { createdAt: "desc" } } },
  });
  if (!job) return res.status(404).json({ error: "Job not found" });

  const { candidates, ...jobFields } = job as any;
  const counts = await withCounts(jobFields);
  // Workers browse job listings from the mobile Jobs tab, but the candidate
  // list is other applicants' names, emails, phone numbers and CV notes.
  if (!isAdmin(req.user?.role)) return res.json(counts);
  res.json({ ...counts, candidates });
});

// PATCH /api/jobs/:id → partial update (e.g. status)
router.patch("/:id", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const existing = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Job not found" });

  const b = req.body || {};
  if (b.status !== undefined && !JOB_STATUSES.includes(b.status)) {
    return res.status(400).json({ error: `status must be one of ${JOB_STATUSES.join(", ")}` });
  }
  if (b.employmentType !== undefined && !EMPLOYMENT_TYPES.includes(b.employmentType)) {
    return res.status(400).json({ error: `employmentType must be one of ${EMPLOYMENT_TYPES.join(", ")}` });
  }

  const data: any = {};
  const stringFields = ["title", "department", "location", "employmentType", "description", "status"];
  for (const f of stringFields) if (b[f] !== undefined) data[f] = b[f];
  const intFields = ["salaryMin", "salaryMax"];
  for (const f of intFields) if (b[f] !== undefined) data[f] = b[f];
  const boolFields = ["needsCv", "needsCover", "needsPortfolio"];
  for (const f of boolFields) if (b[f] !== undefined) data[f] = b[f];
  if (b.closingDate !== undefined) data.closingDate = new Date(b.closingDate);
  if (b.partnerName !== undefined) data.partnerName = partnerField(b.partnerName, 120);
  if (b.partnerAbout !== undefined) data.partnerAbout = partnerField(b.partnerAbout, 1000);

  const job = await prisma.job.update({ where: { id: req.params.id }, data });
  res.json(await withCounts(job));
});

/**
 * Job alerts. GET shows who an alert would reach and what has gone out so far;
 * POST queues it (the per-minute cron sends it). A second POST only reaches
 * people not already alerted, so pressing twice never sends anyone two.
 *
 *   GET  /api/jobs/:id/alerts?audience=MATCHING|EVERYONE
 *   POST /api/jobs/:id/alerts   { audience }
 */
function audienceOf(v: unknown): AlertAudience {
  return (ALERT_AUDIENCES as readonly string[]).includes(String(v)) ? (String(v) as AlertAudience) : "MATCHING";
}

router.get("/:id/alerts", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  const audience = audienceOf(req.query.audience);
  const [preview, sent] = await Promise.all([previewJobAlerts(prisma, job, audience), alertSummary(prisma, job.id)]);
  res.json({ audience, alertedAt: job.alertedAt, preview, sent });
});

router.post("/:id/alerts", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "OPEN") return res.status(400).json({ error: "Only open jobs can be sent out", code: "JOB_CLOSED" });
  const audience = audienceOf(req.body?.audience);
  const result = await queueJobAlerts(prisma, job, audience);
  await writeAudit(userActor(req.user!.id), "job.alert", "Job", job.id, { audience, ...result });
  res.status(202).json({ audience, ...result });
});

export default router;
