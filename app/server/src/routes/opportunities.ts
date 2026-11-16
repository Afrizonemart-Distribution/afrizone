/**
 * One feed for everything a person can do for AfriZone: quick tasks (fixed or
 * per unit), hourly work, and jobs. The app used to split these across two
 * tabs with two shapes; this gives one list with one shape per item, and marks
 * what the worker said they are open to on their Hiring profile.
 *
 *   GET /api/opportunities?type=ALL|TASKS|HOURLY|JOBS
 *   GET /api/opportunities/my-jobs      the worker's own job applications
 *   POST /api/opportunities/my-jobs/:id/withdraw   take an application back
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../auth";
import { openToArray } from "../services/talentProfile";
import { opportunityAnswers as answers } from "../services/jobAlerts";
import { writeAudit, userActor } from "../util/audit";

const router = Router();
router.use(requireAuth);

const wrap =
  (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export type OpportunityType = "TASKS" | "HOURLY" | "JOBS";
const TYPES = ["ALL", "TASKS", "HOURLY", "JOBS"];

router.get(
  "/",
  wrap(async (req, res) => {
    const type = TYPES.includes(String(req.query.type)) ? String(req.query.type) : "ALL";
    const userId = req.user!.id;
    const now = new Date();

    const [user, tasks, jobs, myApps, myJobApps] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { openTo: true } }),
      type === "JOBS"
        ? Promise.resolve([])
        : prisma.task.findMany({
            where: {
              status: "OPEN",
              deadline: { gte: now },
              ...(type === "HOURLY" ? { payModel: "HOURLY" } : type === "TASKS" ? { payModel: { in: ["FIXED", "PER_UNIT"] } } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 200,
          }),
      type === "TASKS" || type === "HOURLY"
        ? Promise.resolve([])
        : prisma.job.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.application.findMany({ where: { workerId: userId }, select: { taskId: true } }),
      prisma.jobApplication.findMany({ where: { userId }, select: { jobId: true, stage: true } }),
    ]);

    const openTo = openToArray(user?.openTo ?? "");
    const appliedTasks = new Set(myApps.map((a) => a.taskId));
    const jobStage = new Map(myJobApps.map((a) => [a.jobId, a.stage]));
    const forYou = (kinds: string[]) => openTo.length > 0 && kinds.some((k) => openTo.includes(k as any));

    const items = [
      ...tasks.map((t) => {
        const itemType: OpportunityType = t.payModel === "HOURLY" ? "HOURLY" : "TASKS";
        return {
          kind: "TASK" as const,
          type: itemType,
          id: t.id,
          title: t.title,
          subtitle: t.category,
          payModel: t.payModel,
          rate: t.rate,
          budget: t.budget,
          unitLabel: t.unitLabel,
          remote: t.locationType === "REMOTE",
          location: t.locationType === "REMOTE" ? "Remote" : t.address,
          closesAt: t.deadline,
          createdAt: t.createdAt,
          applied: appliedTasks.has(t.id),
          stage: null as string | null,
          forYou: forYou(answers(itemType)),
        };
      }),
      ...jobs.map((j) => ({
        kind: "JOB" as const,
        type: "JOBS" as OpportunityType,
        id: j.id,
        title: j.title,
        // Who the job is really with: a partner company AfriZone is hiring
        // for, or AfriZone itself.
        subtitle: j.partnerName ? `${j.partnerName} · ${j.department}` : j.department,
        partnerName: j.partnerName,
        employmentType: j.employmentType,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        remote: j.location.toLowerCase().includes("remote"),
        location: j.location,
        closesAt: j.closingDate,
        createdAt: j.createdAt,
        applied: jobStage.has(j.id),
        stage: jobStage.get(j.id) ?? null,
        forYou: forYou(answers("JOBS", j.employmentType)),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ openTo, items });
  })
);

router.get(
  "/my-jobs",
  wrap(async (req, res) => {
    const rows = await prisma.jobApplication.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      include: {
        job: { select: { id: true, title: true, department: true, employmentType: true, status: true, partnerName: true } },
      },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        stage: r.stage,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        shareConsentAt: r.shareConsentAt,
        sharedAt: r.sharedAt,
        job: r.job,
      }))
    );
  })
);

/**
 * A worker can take back an application, and with it their consent to share,
 * at any time before they are hired (NDPR: consent can be withdrawn). If HR
 * already sent the profile to a partner, that can't be unsent, so they are
 * told how to ask for it to be deleted.
 */
router.post(
  "/my-jobs/:id/withdraw",
  wrap(async (req, res) => {
    const app = await prisma.jobApplication.findUnique({
      where: { id: req.params.id },
      include: { job: { select: { partnerName: true } } },
    });
    if (!app || app.userId !== req.user!.id) return res.status(404).json({ error: "Application not found" });
    if (app.stage === "HIRED") {
      return res.status(400).json({ error: "You've been hired for this job; talk to HR to leave it", code: "ALREADY_HIRED" });
    }
    await prisma.jobApplication.delete({ where: { id: app.id } });
    await writeAudit(userActor(req.user!.id), "candidate.withdraw", "JobApplication", app.id, {
      jobId: app.jobId,
      wasShared: !!app.sharedAt,
    });
    res.json({
      ok: true,
      alreadyShared: !!app.sharedAt,
      message: app.sharedAt
        ? `Application withdrawn. Your profile was already sent to ${app.job.partnerName}. Contact AfriZone HR if you want them to delete it.`
        : "Application withdrawn. Nothing was shared.",
    });
  })
);

export default router;
