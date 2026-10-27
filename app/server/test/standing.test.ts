// A Tasker's standing: New, Bronze, Silver, Gold, and badges (Blueprint §9,
// services/standing.ts).
//
// Four properties, and every test below is one of them:
//
//   EARNED FROM THE RECORD. Finished jobs, the share of taken jobs finished,
//   and a rating with enough ratings behind it. One five-star job is not Gold.
//
//   EVERY LEVEL SAYS WHAT THE NEXT NEEDS, in words a Tasker can act on.
//
//   BADGES ARE FOR SOMETHING SPECIFIC: a category done often, or never
//   dropping a job.
//
//   SHOWN WHERE A PERSON DECIDES. The Tasker's own profile, the worker
//   directory and the applicant queue - and never to staff about themselves.
import { describe, it, expect } from "vitest";
import { apiGet } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { standingFor, type StandingFacts } from "../src/services/standing";

const prisma = () => testPrisma() as any;

const base: StandingFacts = {
  completed: 0,
  cancelled: 0,
  rating: null,
  ratingCount: 0,
  completedByCategory: new Map(),
};

describe("standingFor", () => {
  it("starts everybody at New, with the first job as the way up", () => {
    const s = standingFor(base);
    expect(s.level).toBe("NEW");
    expect(s.next).toEqual({ level: "BRONZE", label: "Bronze", needs: ["1 more finished job"] });
    expect(s.badges).toEqual([]);
  });

  it("is Bronze after one finished job, whatever else is true", () => {
    expect(standingFor({ ...base, completed: 1, cancelled: 3, rating: 1.5, ratingCount: 1 }).level).toBe("BRONZE");
  });

  it("needs enough ratings, not just a good average", () => {
    const s = standingFor({ ...base, completed: 12, rating: 5, ratingCount: 2 });
    expect(s.level).toBe("BRONZE");
    expect(s.next?.level).toBe("SILVER");
    expect(s.next?.needs).toEqual(["3 more ratings"]);
  });

  it("holds a Tasker who drops work at their level, and says so", () => {
    const s = standingFor({ ...base, completed: 12, cancelled: 4, rating: 4.6, ratingCount: 10 });
    expect(s.level).toBe("BRONZE");
    expect(s.next?.needs).toEqual(["Finish at least 85% of the jobs you take"]);
  });

  it("reaches Silver, then Gold, then has nothing next", () => {
    const silver = standingFor({ ...base, completed: 15, cancelled: 1, rating: 4.2, ratingCount: 8 });
    expect(silver.level).toBe("SILVER");
    expect(silver.next?.level).toBe("GOLD");
    expect(silver.next?.needs).toEqual(
      expect.arrayContaining(["15 more finished jobs", "7 more ratings", "An average rating of 4.5 or more"])
    );

    const gold = standingFor({ ...base, completed: 40, cancelled: 1, rating: 4.7, ratingCount: 20 });
    expect(gold).toMatchObject({ level: "GOLD", label: "Gold", next: null });
  });

  it("gives a specialist badge per category done often, and one for never dropping", () => {
    const s = standingFor({
      ...base,
      completed: 12,
      completedByCategory: new Map([
        ["Logistics", 5],
        ["Retail", 7],
        ["Media", 2],
      ]),
    });
    expect(s.badges.map((b) => b.label)).toEqual([
      "Retail specialist",
      "Logistics specialist",
      "Finishes every job",
    ]);
    expect(standingFor({ ...base, completed: 12, cancelled: 1 }).badges).toEqual([]);
  });
});

async function finishedJobs(workerId: string, createdById: string, category: string, n: number) {
  for (let i = 0; i < n; i++) {
    const t = await prisma().task.create({
      data: {
        title: `Standing job ${i}`,
        description: "A task",
        category,
        tier: "STUDENT",
        payModel: "FIXED",
        budget: 3000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 864e5),
        locationType: "REMOTE",
        slots: 1,
        status: "FILLED",
        deadline: new Date(Date.now() + 864e5),
        createdById,
      },
    });
    await prisma().contract.create({ data: { taskId: t.id, workerId, status: "PAID" } });
  }
}

describe("where standing is shown", () => {
  it("is on the Tasker's own profile with what comes next", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const w = await createUserWithToken("WORKER");
    await finishedJobs(w.user.id, admin.user.id, "Retail", 2);

    const res = await apiGet("/api/me", w.token);
    expect(res.status).toBe(200);
    expect(res.body.standing.level).toBe("BRONZE");
    expect(res.body.standing.next.level).toBe("SILVER");
  });

  it("is null for staff", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const res = await apiGet("/api/me", admin.token);
    expect(res.status).toBe(200);
    expect(res.body.standing).toBeNull();
  });

  it("is in the worker directory, the worker detail and the applicant queue", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const w = await createUserWithToken("WORKER");
    await finishedJobs(w.user.id, admin.user.id, "Media", 5);

    const list = await apiGet("/api/workers", admin.token);
    expect(list.status).toBe(200);
    const row = list.body.find((x: any) => x.id === w.user.id);
    expect(row.standing.level).toBe("BRONZE");
    expect(row.standing.badges.map((b: any) => b.label)).toContain("Media specialist");

    const detail = await apiGet(`/api/workers/${w.user.id}`, admin.token);
    expect(detail.body.standing.level).toBe("BRONZE");

    const t = await prisma().task.findFirst({ where: { contracts: { some: { workerId: w.user.id } } } });
    await prisma().application.create({ data: { taskId: t.id, workerId: w.user.id, status: "APPLIED" } });
    const queue = await apiGet(`/api/applications?taskId=${t.id}`, admin.token);
    expect(queue.body[0].worker.standing.level).toBe("BRONZE");
  });
});
