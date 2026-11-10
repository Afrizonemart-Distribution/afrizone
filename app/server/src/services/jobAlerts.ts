/**
 * Job alerts: tell people about a new job by push (with an inbox record),
 * email, SMS and WhatsApp.
 *
 * Two steps on purpose. HR presses "Send job alert" and `queueJobAlerts` writes
 * one JobAlert row per person per channel; the per-minute cron then sends a
 * batch at a time (`sendDueJobAlerts`). A send to thousands of workers would
 * not fit in one request (time and the Worker's subrequest budget), and the
 * rows give HR a count of what went out, what failed and what was skipped.
 *
 * Who hears about it:
 *   MATCHING  workers whose Hiring profile says they are open to this kind of
 *             work, plus everyone who has not said (we don't know, so we ask).
 *   EVERYONE  every worker, e.g. a full-time role worth telling everybody.
 * People who already applied are left out either way.
 *
 * Channels follow the person's choices (User.jobAlertEmail/Sms/Whatsapp).
 * Push always goes, because the inbox record is how the app shows it; the
 * push itself still respects their task-notification switch.
 */
import type { PrismaClient } from "@prisma/client";
import { email, isRealEmail } from "./email";
import { sms } from "./sms";
import { sendPush } from "./push";

/**
 * The worker's "open to" choices. Parsed here rather than imported from
 * talentProfile.ts, which pulls in the request-scoped prisma client: this
 * module is given its client, so the cron and the tests can both run it.
 */
function openToList(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const ALERT_AUDIENCES = ["MATCHING", "EVERYONE"] as const;
export type AlertAudience = (typeof ALERT_AUDIENCES)[number];
export type AlertChannel = "PUSH" | "EMAIL" | "SMS" | "WHATSAPP";

/** Which Hiring-profile "open to" choices a piece of work answers. */
export function opportunityAnswers(type: "TASKS" | "HOURLY" | "JOBS", employmentType?: string): string[] {
  if (type === "TASKS") return ["TASKS"];
  if (type === "HOURLY") return ["HOURLY"];
  if (employmentType === "CONTRACT") return ["CONTRACT"];
  if (employmentType === "PART_TIME") return ["HOURLY", "CONTRACT"];
  return ["FULL_TIME"];
}

interface AlertJob {
  id: string;
  title: string;
  location: string;
  employmentType: string;
  partnerName: string | null;
}

const EMPLOYMENT_WORDS: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
};

/** The words of one alert, the same on every channel. */
export function alertText(job: AlertJob) {
  const who = job.partnerName ? `${job.partnerName} (through AfriZone)` : "AfriZone";
  const kind = EMPLOYMENT_WORDS[job.employmentType] ?? job.employmentType;
  const title = `New job: ${job.title}`;
  const short = `${who} is hiring: ${job.title}, ${kind}, ${job.location}.`;
  return {
    title,
    short,
    sms: `${short} Apply in the AfriZone Part-Time app under Find work.`,
    emailSubject: `${job.title}: ${who} is hiring`,
    emailText: [
      `Hello,`,
      ``,
      `${who} is hiring for a new role:`,
      ``,
      `${job.title}`,
      `${kind} · ${job.location}`,
      ``,
      `To apply, open the AfriZone Part-Time app, go to Find work and tap the job. You apply with your Hiring profile, so keep your CV and work history up to date.`,
      ``,
      `You're getting this because job alerts are on in your app settings. Turn them off there at any time.`,
      ``,
      `AfriZone`,
    ].join("\n"),
  };
}

/** The workers an alert would reach. Shared by the preview count and the queue. */
async function audienceFor(prisma: PrismaClient, job: AlertJob, audience: AlertAudience) {
  const [workers, applied] = await Promise.all([
    prisma.user.findMany({
      where: { role: "WORKER", accountType: "INDIVIDUAL" },
      select: {
        id: true,
        email: true,
        phone: true,
        openTo: true,
        jobAlertEmail: true,
        jobAlertSms: true,
        jobAlertWhatsapp: true,
      },
    }),
    prisma.jobApplication.findMany({ where: { jobId: job.id, userId: { not: null } }, select: { userId: true } }),
  ]);
  const already = new Set(applied.map((a) => a.userId));
  const kinds = opportunityAnswers("JOBS", job.employmentType);
  return workers.filter((w) => {
    if (already.has(w.id)) return false;
    if (audience === "EVERYONE") return true;
    const openTo = openToList(w.openTo);
    return openTo.length === 0 || kinds.some((k) => openTo.includes(k));
  });
}

/** How many people, and messages per channel, an alert would send. */
export async function previewJobAlerts(prisma: PrismaClient, job: AlertJob, audience: AlertAudience) {
  const people = await audienceFor(prisma, job, audience);
  return {
    people: people.length,
    channels: {
      PUSH: people.length,
      EMAIL: people.filter((p) => p.jobAlertEmail && isRealEmail(p.email)).length,
      SMS: people.filter((p) => p.jobAlertSms && p.phone).length,
      WHATSAPP: people.filter((p) => p.jobAlertWhatsapp && p.phone).length,
    },
  };
}

/** D1 binds at most 100 values per statement; a JobAlert row binds about 6. */
const INSERT_CHUNK = 15;

export async function queueJobAlerts(prisma: PrismaClient, job: AlertJob, audience: AlertAudience) {
  const people = await audienceFor(prisma, job, audience);
  const rows: { jobId: string; userId: string; channel: AlertChannel }[] = [];
  for (const p of people) {
    rows.push({ jobId: job.id, userId: p.id, channel: "PUSH" });
    if (p.jobAlertEmail && isRealEmail(p.email)) rows.push({ jobId: job.id, userId: p.id, channel: "EMAIL" });
    if (p.jobAlertSms && p.phone) rows.push({ jobId: job.id, userId: p.id, channel: "SMS" });
    if (p.jobAlertWhatsapp && p.phone) rows.push({ jobId: job.id, userId: p.id, channel: "WHATSAPP" });
  }
  // Someone already queued for this job on a channel (an earlier send) is not
  // queued again: the unique index would refuse it, and they don't need two.
  const existing = await prisma.jobAlert.findMany({ where: { jobId: job.id }, select: { userId: true, channel: true } });
  const have = new Set(existing.map((e) => `${e.userId}:${e.channel}`));
  const fresh = rows.filter((r) => !have.has(`${r.userId}:${r.channel}`));
  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    await prisma.jobAlert.createMany({ data: fresh.slice(i, i + INSERT_CHUNK) });
  }
  await prisma.job.update({ where: { id: job.id }, data: { alertedAt: new Date() } });
  return { people: people.length, queued: fresh.length };
}

/** Per cron run: one push batch, one email batch, and a few texts each. */
const BATCH = { PUSH: 100, EMAIL: 100, SMS: 20, WHATSAPP: 20 } as const;

type Row = {
  id: string;
  user: { id: string; email: string; phone: string | null; pushToken: string | null; notifTasks: boolean };
  job: AlertJob;
};

async function claim(prisma: PrismaClient, channel: AlertChannel): Promise<Row[]> {
  const rows = await prisma.jobAlert.findMany({
    where: { channel, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: BATCH[channel],
    select: {
      id: true,
      user: { select: { id: true, email: true, phone: true, pushToken: true, notifTasks: true } },
      job: { select: { id: true, title: true, location: true, employmentType: true, partnerName: true } },
    },
  });
  if (rows.length === 0) return [];
  // Claim before sending, so an overlapping run can't send the same rows.
  const ids = rows.map((r) => r.id);
  const claimed = await prisma.jobAlert.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "SENDING" } });
  return claimed.count === rows.length ? rows : [];
}

async function mark(prisma: PrismaClient, ids: string[], status: "SENT" | "FAILED" | "SKIPPED", error?: string) {
  if (ids.length === 0) return;
  await prisma.jobAlert.updateMany({
    where: { id: { in: ids } },
    data: { status, error: error ? error.slice(0, 300) : null, sentAt: status === "SENT" ? new Date() : null },
  });
}

export async function sendDueJobAlerts(prisma: PrismaClient) {
  const tally = { sent: 0, failed: 0, skipped: 0 };
  const done = async (ids: string[], status: "SENT" | "FAILED" | "SKIPPED", error?: string) => {
    await mark(prisma, ids, status, error);
    tally[status === "SENT" ? "sent" : status === "FAILED" ? "failed" : "skipped"] += ids.length;
  };

  // Push: the inbox record is the delivery; the push on top follows their switch.
  const push = await claim(prisma, "PUSH");
  if (push.length) {
    await prisma.notification.createMany({
      data: push.map((r) => {
        const t = alertText(r.job);
        return { userId: r.user.id, title: t.title, body: t.short, data: JSON.stringify({ screen: "job", id: r.job.id }) };
      }),
    });
    const messages = push
      .filter((r) => r.user.pushToken && r.user.notifTasks)
      .map((r) => {
        const t = alertText(r.job);
        return { to: r.user.pushToken!, title: t.title, body: t.short, data: { screen: "job", id: r.job.id }, sound: "default" as const };
      });
    await sendPush(messages, prisma).catch(() => {});
    await done(push.map((r) => r.id), "SENT");
  }

  const mail = await claim(prisma, "EMAIL");
  if (mail.length) {
    try {
      const went = await email.sendBatch(
        mail.map((r) => {
          const t = alertText(r.job);
          return { to: r.user.email, subject: t.emailSubject, text: t.emailText };
        })
      );
      await done(mail.map((r) => r.id), went ? "SENT" : "SKIPPED", went ? undefined : "Email is not set up");
    } catch (e) {
      await done(mail.map((r) => r.id), "FAILED", e instanceof Error ? e.message : String(e));
    }
  }

  for (const channel of ["SMS", "WHATSAPP"] as const) {
    const texts = await claim(prisma, channel);
    for (const r of texts) {
      if (!r.user.phone) {
        await done([r.id], "SKIPPED", "No phone number");
        continue;
      }
      try {
        const body = alertText(r.job).sms;
        const went = channel === "SMS" ? await sms.sendText(r.user.phone, body) : await sms.sendWhatsapp(r.user.phone, body);
        await done([r.id], went ? "SENT" : "SKIPPED", went ? undefined : `${channel === "SMS" ? "SMS" : "WhatsApp"} is not set up`);
      } catch (e) {
        await done([r.id], "FAILED", e instanceof Error ? e.message : String(e));
      }
    }
  }
  return tally;
}

/** What happened to a job's alerts, by channel, for the admin. */
export async function alertSummary(prisma: PrismaClient, jobId: string) {
  const rows = await prisma.jobAlert.groupBy({ by: ["channel", "status"], where: { jobId }, _count: { _all: true } });
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    out[r.channel] ??= {};
    out[r.channel][r.status] = r._count._all;
  }
  return out;
}
