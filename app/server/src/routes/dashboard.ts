import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";

/**
 * GET /api/dashboard/stats - the operations dashboard. Everything on it is
 * counted from the database; nothing is a fixed label. Months are calendar
 * months in Lagos time (UTC+1).
 *
 *   partimers   how many, how many verified, new this month, working right now
 *   tasks       open tasks, unfilled places, fill rate, time to fill
 *   money       earned this month, paid out this month, still owed to Partimers
 *   attention   every queue waiting on staff, with a count and where it lives
 *   byState     where Partimers live and where the work is
 *   activity    the latest sign-ups, applications, payments and payouts
 */
const router = Router();

function ago(date: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

const TONE_CYCLE = ["clay", "gold", "indigo", "forest", "money", "amber"];

/** Midnight on the 1st of this month in Lagos, as a UTC instant. */
function lagosMonthStart(now = new Date()): Date {
  const l = new Date(now.getTime() + 3_600_000);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - 3_600_000);
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;
const LIVE_WORK = ["CLAIMED", "IN_PROGRESS", "SUBMITTED", "REWORK"];

router.get(
  "/stats",
  requireAuth,
  requireRole("SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"),
  async (_req: AuthedRequest, res: Response) => {
    const monthStart = lagosMonthStart();
    const partimer = { role: "WORKER" };

    const [
      partimersTotal,
      partimersVerified,
      partimersNew,
      workingNow,
      openTasks,
      tasksThisMonth,
      tasksWithFirstApproval,
      paymentsThisMonth,
      readyToRelease,
      releasedAll,
      referralsEarned,
      withdrawalsHeld,
      paidOutMonth,
      appliedQueue,
      submittedSheets,
      kycPending,
      withdrawalsWaiting,
      identityOpen,
      openDisputes,
      partimersByState,
      tasksByState,
      liveCountries,
      recentSignups,
      recentApps,
      recentReleased,
      recentPaidOut,
    ] = await Promise.all([
      prisma.user.count({ where: partimer }),
      prisma.user.count({ where: { ...partimer, kycStatus: { in: ["VERIFIED", "TIER_APPROVED"] } } }),
      prisma.user.count({ where: { ...partimer, createdAt: { gte: monthStart } } }),
      prisma.contract.findMany({ where: { status: { in: LIVE_WORK } }, select: { workerId: true }, distinct: ["workerId"] }),
      prisma.task.findMany({ where: { status: "OPEN" }, select: { slots: true, _count: { select: { contracts: true } } } }),
      prisma.task.findMany({
        where: { createdAt: { gte: monthStart }, status: { not: "ARCHIVED" } },
        select: { status: true },
      }),
      prisma.task.findMany({
        where: { createdAt: { gte: monthStart }, applications: { some: { status: "APPROVED" } } },
        select: {
          createdAt: true,
          applications: { where: { status: "APPROVED" }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
        },
      }),
      prisma.payment.findMany({
        where: { createdAt: { gte: monthStart } },
        select: { gross: true, net: true, status: true, task: { select: { category: true } } },
      }),
      prisma.payment.aggregate({ where: { status: "APPROVED" }, _count: true, _sum: { net: true } }),
      prisma.payment.aggregate({ where: { status: "RELEASED" }, _sum: { net: true } }),
      prisma.referral.aggregate({ where: { status: "EARNED" }, _sum: { net: true } }),
      prisma.withdrawal.aggregate({ where: { status: { not: "FAILED" } }, _sum: { amount: true } }),
      prisma.withdrawal.aggregate({ where: { status: "PAID", createdAt: { gte: monthStart } }, _sum: { amount: true } }),
      prisma.application.count({ where: { status: "APPLIED" } }),
      prisma.timesheet.count({ where: { status: "SUBMITTED" } }),
      prisma.user.count({ where: { ...partimer, kycStatus: "PENDING" } }),
      prisma.withdrawal.aggregate({ where: { status: "REVIEW" }, _count: true, _sum: { amount: true } }),
      prisma.identityFlag.count({ where: { status: "OPEN" } }),
      prisma.dispute.count({ where: { status: "OPEN" } }),
      prisma.user.groupBy({ by: ["state"], where: partimer, _count: true }),
      prisma.task.groupBy({ by: ["state"], where: { status: "OPEN" }, _count: true }),
      prisma.country.findMany({ where: { live: true }, select: { name: true }, orderBy: { sortOrder: "asc" } }),
      prisma.user.findMany({ where: partimer, orderBy: { createdAt: "desc" }, take: 6, select: { name: true, state: true, createdAt: true } }),
      prisma.application.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { status: true, createdAt: true, worker: { select: { name: true } }, task: { select: { title: true } } },
      }),
      prisma.payment.findMany({
        where: { status: "RELEASED" },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { net: true, createdAt: true, worker: { select: { name: true } }, task: { select: { title: true } } },
      }),
      prisma.withdrawal.findMany({
        where: { status: "PAID" },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { amount: true, createdAt: true, worker: { select: { name: true } } },
      }),
    ]);

    // ── Tasks ────────────────────────────────────────────────────────────
    const openSlots = openTasks.reduce((s, t) => s + Math.max(0, t.slots - t._count.contracts), 0);
    const filledThisMonth = tasksThisMonth.filter((t) => t.status === "FILLED" || t.status === "CLOSED").length;
    const fillRate = tasksThisMonth.length > 0 ? Math.round((filledThisMonth / tasksThisMonth.length) * 100) : null;
    const ttf = tasksWithFirstApproval
      .filter((t) => t.applications.length > 0)
      .map((t) => (t.applications[0].createdAt.getTime() - t.createdAt.getTime()) / 3_600_000);
    const avgTimeToFillHours = ttf.length ? Math.round((ttf.reduce((s, h) => s + h, 0) / ttf.length) * 10) / 10 : null;

    // ── Money ────────────────────────────────────────────────────────────
    const earnedThisMonth = paymentsThisMonth.filter((p) => p.status === "RELEASED").reduce((s, p) => s + p.net, 0);
    const committedThisMonth = paymentsThisMonth.reduce((s, p) => s + p.gross, 0);
    const owedToPartimers = Math.max(
      0,
      (releasedAll._sum.net ?? 0) + (referralsEarned._sum.net ?? 0) - (withdrawalsHeld._sum.amount ?? 0)
    );

    const byCategory = new Map<string, number>();
    for (const p of paymentsThisMonth) {
      const label = p.task?.category || "Other";
      byCategory.set(label, (byCategory.get(label) || 0) + p.gross);
    }
    const totalGross = committedThisMonth || 1;
    const spendByCategory = Array.from(byCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, gross], i) => ({ label, value: Math.round((gross / totalGross) * 100), tone: TONE_CYCLE[i % TONE_CYCLE.length] }));

    // ── Needs attention ──────────────────────────────────────────────────
    const attention = [
      {
        type: "payments",
        count: readyToRelease._count,
        title: `${readyToRelease._count} payment${readyToRelease._count === 1 ? "" : "s"} ready to release`,
        sub: `${naira(readyToRelease._sum.net ?? 0)} net`,
        to: "/payments",
      },
      {
        type: "withdrawals",
        count: withdrawalsWaiting._count,
        title: `${withdrawalsWaiting._count} withdrawal${withdrawalsWaiting._count === 1 ? "" : "s"} waiting to be paid`,
        sub: naira(withdrawalsWaiting._sum.amount ?? 0),
        to: "/withdrawals",
      },
      { type: "applications", count: appliedQueue, title: `${appliedQueue} application${appliedQueue === 1 ? "" : "s"} to review`, sub: "Applications", to: "/applications" },
      { type: "timesheets", count: submittedSheets, title: `${submittedSheets} timesheet${submittedSheets === 1 ? "" : "s"} to check`, sub: "Timesheets", to: "/timesheets" },
      { type: "kyc", count: kycPending, title: `${kycPending} Partimer${kycPending === 1 ? "" : "s"} waiting for ID checks`, sub: "Verification", to: "/verification" },
      { type: "identity", count: identityOpen, title: `${identityOpen} identity case${identityOpen === 1 ? "" : "s"} open`, sub: "Shared bank or ID", to: "/identity" },
      { type: "dispute", count: openDisputes, title: `${openDisputes} open dispute${openDisputes === 1 ? "" : "s"}`, sub: "Raised by Partimers", to: "/disputes" },
    ].filter((a) => a.count > 0);

    // ── Where ────────────────────────────────────────────────────────────
    const stateRows = (rows: { state: string | null; _count: number }[]) =>
      rows
        .map((r) => ({ state: r.state ?? "Not set", count: r._count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

    // ── Activity ─────────────────────────────────────────────────────────
    const activity = [
      ...recentSignups.map((u) => ({
        icon: "user",
        at: u.createdAt,
        title: `${u.name} joined`,
        sub: u.state ? `Partimer · ${u.state}` : "New Partimer",
      })),
      ...recentApps.map((a) => ({
        icon: a.status === "APPROVED" ? "check" : "apply",
        at: a.createdAt,
        title: `${a.worker.name} ${a.status === "APPROVED" ? "was approved" : a.status === "REJECTED" ? "was not picked" : "applied"}`,
        sub: a.task.title,
      })),
      ...recentReleased.map((p) => ({
        icon: "payment",
        at: p.createdAt,
        title: `${naira(p.net)} released to ${p.worker.name}`,
        sub: p.task?.title ?? "Payment",
      })),
      ...recentPaidOut.map((w) => ({
        icon: "payout",
        at: w.createdAt,
        title: `${naira(w.amount)} paid out to ${w.worker.name}`,
        sub: "Withdrawal",
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 10)
      .map(({ at, ...rest }) => ({ ...rest, ago: ago(at) }));

    res.json({
      liveIn: liveCountries.map((c) => c.name),
      partimers: {
        total: partimersTotal,
        verified: partimersVerified,
        newThisMonth: partimersNew,
        workingNow: workingNow.length,
      },
      tasks: {
        open: openTasks.length,
        openSlots,
        createdThisMonth: tasksThisMonth.length,
        filledThisMonth,
        fillRate,
        avgTimeToFillHours,
      },
      money: {
        earnedThisMonth,
        committedThisMonth,
        paidOutThisMonth: paidOutMonth._sum.amount ?? 0,
        owedToPartimers,
      },
      spendByCategory,
      attention,
      partimersByState: stateRows(partimersByState as any),
      tasksByState: stateRows(tasksByState as any),
      activity,
    });
  }
);

export default router;
