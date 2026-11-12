// Opportunities: job applications from the worker's own account and Hiring
// profile, and the one feed of tasks, hourly work and jobs. Four flows: the
// D1 pool hangs past about five in one file.
import { describe, it, expect } from "vitest";
import { apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

const prisma = () => testPrisma() as any;
let n = 0;

async function job(adminToken: string, extra: Record<string, unknown> = {}) {
  n += 1;
  const r = await apiPost(
    "/api/jobs",
    {
      title: `Store supervisor ${Date.now()}-${n}`,
      department: "Retail",
      location: "Lagos",
      employmentType: "FULL_TIME",
      description: "Run the floor",
      closingDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      ...extra,
    },
    adminToken
  );
  expect(r.status).toBe(201);
  return r.body;
}

describe("opportunities", () => {
  it("applies with the worker's own account and profile, after the checks", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await createUserWithToken("WORKER", { name: "Ada Real" });
    const j = await job(hr.token, { needsCv: true, needsCover: true });

    const tryApply = (body: Record<string, unknown> = {}) =>
      apiPost("/api/candidates", { jobId: j.id, name: "Someone Else", email: "fake@x.com", ...body }, w.token);

    expect((await tryApply()).body.code).toBe("KYC_REQUIRED");
    await prisma().user.update({ where: { id: w.user.id }, data: { kycStatus: "VERIFIED" } });
    expect((await tryApply()).body.code).toBe("CV_REQUIRED");

    const cv = await prisma().kycDocument.create({
      data: { userId: w.user.id, docType: "CV", filename: `cv-${Date.now()}.pdf`, path: "x" },
    });
    await prisma().user.update({ where: { id: w.user.id }, data: { cvDocumentId: cv.id } });
    expect((await tryApply({ coverNote: "Hi" })).body.code).toBe("COVER_REQUIRED");

    const ok = await tryApply({ coverNote: "I have run a busy supermarket floor in Ikeja for three years." });
    expect(ok.status).toBe(201);
    // Who they are comes from the account, never the form.
    expect(ok.body.name).toBe("Ada Real");
    expect(ok.body.email).not.toBe("fake@x.com");
    expect(ok.body.userId).toBe(w.user.id);

    expect((await tryApply({ coverNote: "Again, again, again, again, again, again." })).body.code).toBe("ALREADY_APPLIED");

    const list = await apiGet(`/api/candidates?jobId=${j.id}`, hr.token);
    expect(list.body[0].userId).toBe(w.user.id);
    expect(list.body[0].profile.hasCv).toBe(true);
    expect(list.body[0].coverNote).toContain("Ikeja");
  });

  it("refuses closed jobs and still lets staff add a candidate by hand", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await createUserWithToken("WORKER", { kycStatus: "TIER_APPROVED" });
    const j = await job(hr.token, { needsCv: false });
    await apiPatch(`/api/jobs/${j.id}`, { status: "CLOSED" }, hr.token);
    expect((await apiPost("/api/candidates", { jobId: j.id }, w.token)).body.code).toBe("JOB_CLOSED");

    const byHand = await apiPost("/api/candidates", { jobId: j.id, name: "Emailed In", email: "in@x.com" }, hr.token);
    expect(byHand.status).toBe(201);
    expect(byHand.body.userId).toBeNull();
  });

  it("moves an application and the worker can see where it stands", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await createUserWithToken("WORKER", { kycStatus: "VERIFIED" });
    const j = await job(hr.token, { needsCv: false });
    const app = await apiPost("/api/candidates", { jobId: j.id }, w.token);
    expect(app.status).toBe(201);

    expect((await apiPost(`/api/candidates/${app.body.id}/move`, { stage: "INTERVIEW" }, hr.token)).status).toBe(200);
    const mine = await apiGet("/api/opportunities/my-jobs", w.token);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].stage).toBe("INTERVIEW");
    expect(mine.body[0].job.title).toBe(j.title);
  });

  it("lists tasks, hourly work and jobs in one feed, marking what the worker is open to", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const w = await createUserWithToken("WORKER", { kycStatus: "VERIFIED" });
    await prisma().user.update({ where: { id: w.user.id }, data: { openTo: "FULL_TIME" } });
    const deadline = new Date(Date.now() + 864e5).toISOString();
    const base = { description: "x", category: "Feed", tier: "REMOTE", deadline };
    const hourly = await apiPost("/api/tasks", { ...base, title: `Hourly ${n}`, payModel: "HOURLY", rate: 2000 }, admin.token);
    const quick = await apiPost(
      "/api/tasks",
      { ...base, title: `Quick ${n}`, payModel: "PER_UNIT", rate: 100, unitLabel: "photo" },
      admin.token
    );
    const j = await job(admin.token, { needsCv: false });

    const all = await apiGet("/api/opportunities", w.token);
    expect(all.status).toBe(200);
    expect(all.body.openTo).toEqual(["FULL_TIME"]);
    const ids = all.body.items.map((i: any) => i.id);
    expect(ids).toEqual(expect.arrayContaining([hourly.body.id, quick.body.id, j.id]));
    const jobItem = all.body.items.find((i: any) => i.id === j.id);
    expect(jobItem.kind).toBe("JOB");
    expect(jobItem.forYou).toBe(true);
    expect(all.body.items.find((i: any) => i.id === quick.body.id).forYou).toBe(false);

    const onlyHourly = await apiGet("/api/opportunities?type=HOURLY", w.token);
    expect(onlyHourly.body.items.every((i: any) => i.type === "HOURLY")).toBe(true);
    expect(onlyHourly.body.items.some((i: any) => i.id === hourly.body.id)).toBe(true);

    await apiPost("/api/candidates", { jobId: j.id }, w.token);
    const jobs = await apiGet("/api/opportunities?type=JOBS", w.token);
    const applied = jobs.body.items.find((i: any) => i.id === j.id);
    expect(applied.applied).toBe(true);
    expect(applied.stage).toBe("SCREENING");
  });
});
