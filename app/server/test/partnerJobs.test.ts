// Partner hiring and job alerts: AfriZone posts for a partner company, a
// worker's profile is shared only with their consent, and job alerts are
// queued and sent in batches. Five flows: the D1 pool hangs past about five.
import { describe, it, expect } from "vitest";
import { apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { sendDueJobAlerts } from "../src/services/jobAlerts";

const prisma = () => testPrisma() as any;
let n = 0;

async function job(token: string, extra: Record<string, unknown> = {}) {
  n += 1;
  const r = await apiPost(
    "/api/jobs",
    {
      title: `Warehouse lead ${Date.now()}-${n}`,
      department: "Logistics",
      location: "Lagos",
      employmentType: "FULL_TIME",
      description: "Run the warehouse",
      needsCv: false,
      ...extra,
    },
    token
  );
  expect(r.status).toBe(201);
  return r.body;
}

describe("partner jobs", () => {
  it("needs the worker's consent to apply, shows the partner, and HR records the share", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await createUserWithToken("WORKER", { kycStatus: "VERIFIED" });
    const j = await job(hr.token, { partnerName: "  Kola Foods Ltd  ", partnerAbout: "Food maker in Ikeja" });
    expect(j.partnerName).toBe("Kola Foods Ltd");

    const noConsent = await apiPost("/api/candidates", { jobId: j.id }, w.token);
    expect(noConsent.body.code).toBe("CONSENT_REQUIRED");

    const app = await apiPost("/api/candidates", { jobId: j.id, consentToShare: true }, w.token);
    expect(app.status).toBe(201);
    expect(app.body.shareConsentAt).toBeTruthy();

    const feed = await apiGet("/api/opportunities?type=JOBS", w.token);
    const item = feed.body.items.find((i: any) => i.id === j.id);
    expect(item.partnerName).toBe("Kola Foods Ltd");
    expect(item.subtitle).toContain("Kola Foods Ltd");

    const shared = await apiPost(`/api/candidates/${app.body.id}/share`, {}, hr.token);
    expect(shared.status).toBe(200);
    expect(shared.body.sharedAt).toBeTruthy();
    const inbox = await prisma().notification.findMany({ where: { userId: w.user.id } });
    expect(inbox.some((x: any) => x.body.includes("Kola Foods Ltd"))).toBe(true);

    const mine = await apiGet("/api/opportunities/my-jobs", w.token);
    expect(mine.body[0].sharedAt).toBeTruthy();
    expect(mine.body[0].job.partnerName).toBe("Kola Foods Ltd");
  });

  it("won't share for an AfriZone job, or without consent", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await createUserWithToken("WORKER", { kycStatus: "VERIFIED" });
    const own = await job(hr.token);
    const app = await apiPost("/api/candidates", { jobId: own.id }, w.token);
    expect(app.status).toBe(201);
    expect(app.body.shareConsentAt).toBeNull();
    expect((await apiPost(`/api/candidates/${app.body.id}/share`, {}, hr.token)).body.code).toBe("NOT_PARTNER_JOB");

    const partner = await job(hr.token, { partnerName: "Delta Logistics" });
    const byHand = await apiPost("/api/candidates", { jobId: partner.id, name: "Emailed In", email: "in@x.com" }, hr.token);
    const refused = await apiPost(`/api/candidates/${byHand.body.id}/share`, {}, hr.token);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("NO_CONSENT");
    // Workers can't share anything.
    expect((await apiPost(`/api/candidates/${app.body.id}/share`, {}, w.token)).status).toBe(403);
  });

  it("lets a worker withdraw an application, but not once hired", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await createUserWithToken("WORKER", { kycStatus: "VERIFIED" });
    const other = await createUserWithToken("WORKER", { kycStatus: "VERIFIED" });
    const j = await job(hr.token, { partnerName: "Sahel Retail" });
    const app = await apiPost("/api/candidates", { jobId: j.id, consentToShare: true }, w.token);

    expect((await apiPost(`/api/opportunities/my-jobs/${app.body.id}/withdraw`, {}, other.token)).status).toBe(404);
    const out = await apiPost(`/api/opportunities/my-jobs/${app.body.id}/withdraw`, {}, w.token);
    expect(out.status).toBe(200);
    expect(out.body.alreadyShared).toBe(false);
    expect((await apiGet("/api/opportunities/my-jobs", w.token)).body).toHaveLength(0);

    const again = await apiPost("/api/candidates", { jobId: j.id, consentToShare: true }, w.token);
    await apiPost(`/api/candidates/${again.body.id}/move`, { stage: "HIRED" }, hr.token);
    const hired = await apiPost(`/api/opportunities/my-jobs/${again.body.id}/withdraw`, {}, w.token);
    expect(hired.body.code).toBe("ALREADY_HIRED");
  });
});

describe("job alerts", () => {
  it("queues matching workers by their choices, never twice, and sends in batches", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const fullTime = await createUserWithToken("WORKER");
    const tasksOnly = await createUserWithToken("WORKER");
    const unsaid = await createUserWithToken("WORKER");
    await prisma().user.update({
      where: { id: fullTime.user.id },
      data: { openTo: "FULL_TIME", jobAlertSms: true, phone: `+23480${Date.now() % 1e8}` },
    });
    await prisma().user.update({ where: { id: tasksOnly.user.id }, data: { openTo: "TASKS" } });
    const j = await job(hr.token, { partnerName: "Kano Mills" });

    const preview = await apiGet(`/api/jobs/${j.id}/alerts?audience=MATCHING`, hr.token);
    expect(preview.status).toBe(200);
    const everyone = await apiGet(`/api/jobs/${j.id}/alerts?audience=EVERYONE`, hr.token);
    expect(everyone.body.preview.people).toBeGreaterThan(preview.body.preview.people);

    const q = await apiPost(`/api/jobs/${j.id}/alerts`, { audience: "MATCHING" }, hr.token);
    expect(q.status).toBe(202);
    const rows = await prisma().jobAlert.findMany({ where: { jobId: j.id } });
    const to = (id: string) => rows.filter((r: any) => r.userId === id).map((r: any) => r.channel).sort();
    expect(to(fullTime.user.id)).toEqual(["EMAIL", "PUSH", "SMS"]);
    expect(to(unsaid.user.id)).toEqual(["EMAIL", "PUSH"]);
    expect(to(tasksOnly.user.id)).toEqual([]);

    // Pressing again reaches nobody new.
    expect((await apiPost(`/api/jobs/${j.id}/alerts`, { audience: "MATCHING" }, hr.token)).body.queued).toBe(0);
    // Workers can't send alerts.
    expect((await apiPost(`/api/jobs/${j.id}/alerts`, {}, fullTime.token)).status).toBe(403);

    // Drain everything queued (other files' rows included) until nothing is pending.
    for (let i = 0; i < 50; i++) {
      const left = await prisma().jobAlert.count({ where: { status: "PENDING" } });
      if (left === 0) break;
      await sendDueJobAlerts(prisma());
    }
    const after = await prisma().jobAlert.findMany({ where: { jobId: j.id, userId: fullTime.user.id } });
    const status = Object.fromEntries(after.map((r: any) => [r.channel, r.status]));
    expect(status.PUSH).toBe("SENT");
    // No email or SMS provider in tests: recorded as skipped, never as sent.
    expect(status.EMAIL).toBe("SKIPPED");
    expect(status.SMS).toBe("SKIPPED");
    const inbox = await prisma().notification.findMany({ where: { userId: fullTime.user.id } });
    expect(inbox.some((x: any) => x.title.includes(j.title))).toBe(true);

    const summary = await apiGet(`/api/jobs/${j.id}/alerts`, hr.token);
    expect(summary.body.alertedAt).toBeTruthy();
    expect(summary.body.sent.PUSH.SENT).toBeGreaterThan(0);
  });

  it("lets a worker choose their alert channels", async () => {
    const w = await createUserWithToken("WORKER");
    const before = await apiGet("/api/me", w.token);
    expect(before.body.jobAlertEmail).toBe(true);
    expect(before.body.jobAlertSms).toBe(false);
    const r = await apiPatch("/api/me", { jobAlertEmail: false, jobAlertWhatsapp: true }, w.token);
    expect(r.status).toBe(200);
    const after = await apiGet("/api/me", w.token);
    expect(after.body.jobAlertEmail).toBe(false);
    expect(after.body.jobAlertWhatsapp).toBe(true);
  });
});
