// Ranked applicants: every task that is not a delivery orders its pending
// applications best first for the manager (Blueprint §11,
// services/applicantRanking.ts).
//
// Four properties, and every test below is one of them:
//
//   EXPERIENCE AND A CLEAN RECORD COME FIRST. Finished work in the category,
//   years on the required skills, finishing what was taken and a good rating
//   all lift an applicant; jobs already in hand lower them.
//
//   AN UNKNOWN IS NEUTRAL, NEVER A PENALTY. Somebody new sits in the middle,
//   above a poor record, or they would never be approved and never build one.
//
//   THE GATE STILL DECIDES WHO MAY WORK. An applicant who no longer qualifies
//   is not scored and is listed after everybody who does.
//
//   IT ORDERS, IT DOES NOT DECIDE. Every application is still returned and
//   still approved by hand; the queue is grouped by task, best first in each.
import { describe, it, expect, beforeAll } from "vitest";
import { apiGet } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { reliabilityScore } from "../src/services/ranking";
import {
  fitScore,
  orderApplicants,
  scoreApplicant,
  type ApplicantFacts,
} from "../src/services/applicantRanking";

const prisma = () => testPrisma() as any;

beforeAll(async () => {
  // Enforcing, so a lapsed applicant is actually blocked.
  await prisma().setting.upsert({
    where: { key: "eligibility.enforce" },
    create: { key: "eligibility.enforce", value: "on" },
    update: { value: "on" },
  });
});

let seq = 0;

async function makeTask(createdById: string, opts: { category?: string; skillIds?: string[] } = {}) {
  seq += 1;
  const task = await prisma().task.create({
    data: {
      title: `Ranked task ${seq}`,
      description: "A task",
      category: opts.category ?? "Retail",
      tier: "STUDENT",
      payModel: "FIXED",
      budget: 5000,
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 864e5),
      locationType: "PHYSICAL",
      slots: 3,
      status: "OPEN",
      deadline: new Date(Date.now() + 7 * 864e5),
      createdById,
    },
  });
  for (const skillId of opts.skillIds ?? []) {
    await prisma().taskSkillRequirement.create({ data: { taskId: task.id, skillId } });
  }
  return task;
}

async function makeWorker(opts: { rating?: number | null; tiers?: string } = {}) {
  const w = await createUserWithToken("WORKER");
  await prisma().user.update({
    where: { id: w.user.id },
    data: { tiers: opts.tiers ?? "STUDENT", kycStatus: "VERIFIED", rating: opts.rating ?? null },
  });
  return w;
}

/** Past contracts on throwaway tasks, to give a worker a record. */
async function giveHistory(
  workerId: string,
  adminId: string,
  category: string,
  statuses: string[]
) {
  for (const status of statuses) {
    const t = await makeTask(adminId, { category });
    await prisma().task.update({ where: { id: t.id }, data: { status: "FILLED" } });
    await prisma().contract.create({ data: { taskId: t.id, workerId, status } });
  }
}

async function apply(taskId: string, workerId: string, minutesAgo: number) {
  return prisma().application.create({
    data: {
      taskId,
      workerId,
      status: "APPLIED",
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    },
  });
}

const base: ApplicantFacts = {
  skillYears: [],
  categoryDone: 0,
  completed: 0,
  cancelled: 0,
  rating: null,
  activeLoad: 0,
};

describe("the score", () => {
  it("lifts finished work in the category and years on the required skills", () => {
    expect(scoreApplicant({ ...base, categoryDone: 4 })).toBeGreaterThan(scoreApplicant(base));
    expect(scoreApplicant({ ...base, skillYears: [4] })).toBeGreaterThan(scoreApplicant({ ...base, skillYears: [1] }));
  });

  it("never scores fit below the middle, and caps years", () => {
    expect(fitScore([], 0)).toBe(0.5);
    expect(fitScore([null, 0], 0)).toBe(0.5);
    expect(fitScore([5], 0)).toBe(fitScore([20], 0));
  });

  it("ranks a new applicant above a poor record", () => {
    const fresh = scoreApplicant(base);
    const flaky = scoreApplicant({ ...base, completed: 1, cancelled: 4, rating: 2 });
    expect(fresh).toBeGreaterThan(flaky);
  });

  it("lowers an applicant already holding work", () => {
    expect(scoreApplicant({ ...base, activeLoad: 0 })).toBeGreaterThan(scoreApplicant({ ...base, activeLoad: 2 }));
  });

  it("shares the delivery ranking's reliability measure", () => {
    expect(reliabilityScore(0, 0)).toBe(0.5);
  });

  it("breaks ties by who applied first, then id", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 27, 10, m));
    const out = orderApplicants([
      { id: "b", score: 0.6, createdAt: at(5) },
      { id: "c", score: 0.6, createdAt: at(1) },
      { id: "a", score: 0.7, createdAt: at(9) },
    ]);
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
});

describe("GET /api/applications", () => {
  it("returns a task's applicants best first, with reasons, the unqualified last", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    seq += 1;
    const skill = await prisma().skill.create({
      data: { name: "Merchandising", slug: `rank-skill-${seq}`, group: "Retail", active: true },
    });
    const task = await makeTask(admin.user.id, { skillIds: [skill.id] });

    const veteran = await makeWorker({ rating: 4.8 });
    await prisma().workerSkill.create({ data: { workerId: veteran.user.id, skillId: skill.id, years: 4 } });
    await giveHistory(veteran.user.id, admin.user.id, "Retail", ["PAID", "PAID", "CLOSED"]);

    const fresh = await makeWorker();
    await prisma().workerSkill.create({ data: { workerId: fresh.user.id, skillId: skill.id } });

    const flaky = await makeWorker({ rating: 2.1 });
    await prisma().workerSkill.create({ data: { workerId: flaky.user.id, skillId: skill.id } });
    await giveHistory(flaky.user.id, admin.user.id, "Logistics", ["PAID", "CANCELLED", "CANCELLED", "CANCELLED"]);

    // Qualified when they applied; the skill has since been removed.
    const lapsed = await makeWorker({ rating: 5 });

    // Applied in the reverse of the order they should come back in.
    const aVeteran = await apply(task.id, veteran.user.id, 1);
    const aFresh = await apply(task.id, fresh.user.id, 2);
    const aFlaky = await apply(task.id, flaky.user.id, 3);
    const aLapsed = await apply(task.id, lapsed.user.id, 4);

    const res = await apiGet(`/api/applications?status=APPLIED&taskId=${task.id}`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body.map((a: any) => a.id)).toEqual([aVeteran.id, aFresh.id, aFlaky.id, aLapsed.id]);

    const [v, f, , l] = res.body;
    expect(v.rank).toMatchObject({ eligible: true, position: 1 });
    expect(v.rank.reasons).toEqual(expect.arrayContaining(["3 done in Retail", "Rated 4.8"]));
    expect(f.rank.reasons).toContain("No finished jobs yet");
    expect(l.rank).toMatchObject({ eligible: false, position: null, score: null });
    expect(l.rank.reasons[0]).toMatch(/^No longer qualifies/);
  });

  it("ranks each task separately and leaves decided applications unranked", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const t1 = await makeTask(admin.user.id);
    const t2 = await makeTask(admin.user.id);
    const w1 = await makeWorker();
    const w2 = await makeWorker();
    await apply(t1.id, w1.user.id, 10);
    await apply(t2.id, w2.user.id, 5);
    const rejected = await prisma().application.create({
      data: { taskId: t1.id, workerId: w2.user.id, status: "REJECTED", reason: "Not a fit" },
    });

    const res = await apiGet(`/api/applications`, admin.token);
    expect(res.status).toBe(200);
    const mine = res.body.filter((a: any) => a.taskId === t1.id || a.taskId === t2.id);
    const pending = mine.filter((a: any) => a.status === "APPLIED");
    expect(pending.every((a: any) => a.rank?.position === 1)).toBe(true);
    expect(mine.find((a: any) => a.id === rejected.id).rank).toBeNull();
  });

  it("is still admin-only", async () => {
    const w = await makeWorker();
    const res = await apiGet(`/api/applications`, w.token);
    expect(res.status).toBe(403);
  });
});
