import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, isAdmin, AuthedRequest } from "../auth";
import { writeAudit, userActor } from "../util/audit";
import { STAGES } from "../types";
import { notifyWorker } from "../services/push";

const router = Router();

function parseNotes(raw: string | null): { summary: string; strengths: string[]; gaps: string[] } {
  try {
    const n = JSON.parse(raw ?? "{}");
    return { summary: String(n.summary ?? ""), strengths: n.strengths ?? [], gaps: n.gaps ?? [] };
  } catch {
    return { summary: "", strengths: [], gaps: [] };
  }
}

/** Identity confirmed, by Smile ID (VERIFIED) or by a person (TIER_APPROVED). */
const IDENTITY_OK = new Set(["VERIFIED", "TIER_APPROVED"]);
const MIN_COVER = 30;
const MAX_TEXT = 4000;

/** What the worker is told when HR moves their application. */
const STAGE_MESSAGE: Record<string, string> = {
  INTERVIEW: "You've been shortlisted for an interview. HR will be in touch with the details.",
  OFFER: "Good news: you're getting an offer. HR will contact you shortly.",
  HIRED: "Congratulations, you've been hired!",
  REJECTED: "Thank you for applying. This one didn't work out this time; keep your profile up to date for the next role.",
};

/**
 * A job left with the default closing date (the moment it was created) was
 * never given a real one, so only a closing date somebody actually set is
 * enforced.
 */
function closed(job: { status: string; closingDate: Date; createdAt: Date }): boolean {
  if (job.status !== "OPEN") return true;
  const setDeliberately = job.closingDate.getTime() - job.createdAt.getTime() > 60 * 60 * 1000;
  return setDeliberately && job.closingDate.getTime() < Date.now();
}

// GET /api/candidates?jobId= → JobApplication[] joined with job {id,title}
// Admin-only: candidate rows carry name, email, phone and CV notes.
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const jobId = req.query.jobId ? String(req.query.jobId) : undefined;
  const candidates = await prisma.jobApplication.findMany({
    where: jobId ? { jobId } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      job: true,
      user: { select: { headline: true, cvDocumentId: true, kycStatus: true } },
    },
  });
  res.json(
    candidates.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      name: c.name,
      email: c.email,
      phone: c.phone,
      stage: c.stage,
      cvNote: c.cvNote,
      coverNote: c.coverNote,
      rating: c.rating,
      // Partner jobs: whether the worker agreed to their profile going to the
      // partner, and whether HR has sent it.
      shareConsentAt: c.shareConsentAt,
      sharedAt: c.sharedAt,
      // AI shortlisting: a suggestion with reasons, never a decision.
      ai: c.aiScoredAt ? { score: c.aiScore, ...parseNotes(c.aiNotes), scoredAt: c.aiScoredAt } : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      // Set when they applied from the app: HR opens their full Hiring
      // profile (CV, history, verified work) from this id.
      userId: c.userId,
      profile: c.user
        ? { headline: c.user.headline, hasCv: !!c.user.cvDocumentId, kycStatus: c.user.kycStatus }
        : null,
      job: { id: c.job.id, title: c.job.title, partnerName: c.job.partnerName },
    }))
  );
});

/**
 * POST /api/candidates
 *
 * A worker applies as themselves: name, email and phone come from their
 * account, never the body, and their Hiring profile (CV, history, portfolio)
 * is what HR reads. Checked here rather than only in the app: identity
 * confirmed, the CV or portfolio the job asks for is on the profile, a cover
 * letter when one is asked for, and one application per job.
 *
 * Staff can still add a candidate by hand (someone who applied by email), as
 * before.
 */
router.post("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const b = req.body || {};
  if (!b.jobId) return res.status(400).json({ error: "jobId is required" });
  const job = await prisma.job.findUnique({ where: { id: String(b.jobId) } });
  if (!job) return res.status(404).json({ error: "Job not found" });

  if (isAdmin(req.user?.role)) {
    if (!b.name || !b.email) return res.status(400).json({ error: "name and email are required" });
    try {
      const candidate = await prisma.jobApplication.create({
        data: {
          jobId: job.id,
          name: String(b.name),
          email: String(b.email),
          phone: b.phone ?? null,
          cvNote: b.cvNote ?? null,
          stage: "SCREENING",
        },
      });
      return res.status(201).json(candidate);
    } catch (e: any) {
      return res.status(400).json({ error: e.message || "Could not create candidate" });
    }
  }

  const userId = req.user!.id;
  if (closed(job)) return res.status(400).json({ error: "Applications for this job have closed", code: "JOB_CLOSED" });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true, kycStatus: true, cvDocumentId: true },
  });
  if (!user) return res.status(404).json({ error: "Account not found" });

  if (!IDENTITY_OK.has(user.kycStatus)) {
    return res.status(403).json({ error: "Confirm your identity before applying for jobs", code: "KYC_REQUIRED" });
  }
  const existing = await prisma.jobApplication.findFirst({ where: { jobId: job.id, userId }, select: { id: true } });
  if (existing) return res.status(409).json({ error: "You've already applied for this job", code: "ALREADY_APPLIED" });

  if (job.needsCv && !user.cvDocumentId) {
    return res.status(400).json({ error: "Add your CV to your Hiring profile first", code: "CV_REQUIRED" });
  }
  if (job.needsPortfolio) {
    const items = await prisma.portfolioItem.count({ where: { userId } });
    if (items === 0) {
      return res.status(400).json({ error: "Add some of your work to your Hiring profile first", code: "PORTFOLIO_REQUIRED" });
    }
  }
  const coverNote = typeof b.coverNote === "string" ? b.coverNote.trim().slice(0, MAX_TEXT) : "";
  if (job.needsCover && coverNote.length < MIN_COVER) {
    return res.status(400).json({ error: "This job asks for a short cover letter", code: "COVER_REQUIRED" });
  }
  const note = typeof b.cvNote === "string" ? b.cvNote.trim().slice(0, MAX_TEXT) : "";
  // A partner job means their profile will go to another company. Under the
  // NDPR that needs their clear yes, given here, before anything is shared.
  if (job.partnerName && b.consentToShare !== true) {
    return res.status(400).json({
      error: `Agree to share your Hiring profile with ${job.partnerName} to apply`,
      code: "CONSENT_REQUIRED",
    });
  }

  try {
    const candidate = await prisma.jobApplication.create({
      data: {
        jobId: job.id,
        userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        coverNote: coverNote || null,
        cvNote: note || null,
        stage: "SCREENING",
        shareConsentAt: job.partnerName ? new Date() : null,
      },
    });
    res.status(201).json(candidate);
  } catch (e: any) {
    // Two taps racing past the check above meet the unique index here.
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ error: "You've already applied for this job", code: "ALREADY_APPLIED" });
    }
    throw e;
  }
});

// POST /api/candidates/:id/move → body {stage}; writes AuditLog "candidate.move"
router.post("/:id/move", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const { stage } = req.body || {};
  if (!stage || !STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of ${STAGES.join(", ")}` });
  }
  const candidate = await prisma.jobApplication.findUnique({
    where: { id: req.params.id },
    include: { job: { select: { title: true } } },
  });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const updated = await prisma.jobApplication.update({
    where: { id: candidate.id },
    data: { stage },
  });
  await writeAudit(userActor(req.user!.id), "candidate.move", "JobApplication", candidate.id, {
    from: candidate.stage,
    to: stage,
    jobId: candidate.jobId,
  });
  // People who applied from the app hear where they stand without chasing HR.
  if (candidate.userId && stage !== candidate.stage && STAGE_MESSAGE[stage]) {
    await notifyWorker(prisma, candidate.userId, candidate.job.title, STAGE_MESSAGE[stage], {
      screen: "job",
      id: candidate.jobId,
    }, "notifTasks").catch(() => {});
  }
  res.json(updated);
});

/**
 * POST /api/candidates/:id/share: HR records that this applicant's Hiring
 * profile went to the partner company. Refused without the worker's consent
 * (given when they applied), and only for partner jobs. The worker is told,
 * and it is audited, so there is always an answer to "who has my data?".
 */
router.post("/:id/share", requireAuth, requireRole("SUPER_ADMIN", "HR_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const c = await prisma.jobApplication.findUnique({
    where: { id: req.params.id },
    include: { job: { select: { id: true, title: true, partnerName: true } } },
  });
  if (!c) return res.status(404).json({ error: "Candidate not found" });
  if (!c.job.partnerName) {
    return res.status(400).json({ error: "This is an AfriZone job; there is no partner to share with", code: "NOT_PARTNER_JOB" });
  }
  if (!c.userId || !c.shareConsentAt) {
    return res.status(403).json({ error: "This applicant hasn't agreed to their profile being shared", code: "NO_CONSENT" });
  }
  if (c.sharedAt) return res.json(c);

  const updated = await prisma.jobApplication.update({
    where: { id: c.id },
    data: { sharedAt: new Date(), sharedById: req.user!.id },
  });
  await writeAudit(userActor(req.user!.id), "candidate.share", "JobApplication", c.id, {
    jobId: c.jobId,
    partner: c.job.partnerName,
    userId: c.userId,
  });
  await notifyWorker(
    prisma,
    c.userId,
    c.job.title,
    `Your Hiring profile has been shared with ${c.job.partnerName}, as you agreed when you applied.`,
    { screen: "job", id: c.jobId },
    "notifTasks"
  ).catch(() => {});
  res.json(updated);
});

export default router;
