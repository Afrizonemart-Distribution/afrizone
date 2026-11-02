// Crew contracts: a lead brings a crew to a fixed-price job and the pay is
// split (Blueprint §14, services/crew.ts).
//
// Five properties, and every test below is one of them:
//
//   THE LEAD PROPOSES A SPLIT THAT ADDS UP. Shares are whole naira, sum to the
//   budget exactly, and the crew fits the task's limit. Only tasks a manager
//   opened to crews take one.
//
//   EVERY MEMBER QUALIFIES ON THEIR OWN, when named and again at approval.
//
//   NOBODY IS SIGNED UP FOR AN AMOUNT THEY NEVER SAW. The manager cannot
//   approve until every member accepts; one decline withdraws the application.
//
//   ONE APPROVAL, A CONTRACT EACH. The crew takes one slot, and each member's
//   share is ring-fenced against their own contract.
//
//   THE LEAD HANDS IN ONCE AND EVERYBODY IS PAID. One approval makes a Payment
//   per person, at their share, each with its own withholding tax.
import { describe, it, expect, beforeAll } from "vitest";
import { apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { checkProposal, phoneVariants } from "../src/services/crew";

const prisma = () => testPrisma() as any;

beforeAll(async () => {
  await prisma().setting.upsert({
    where: { key: "eligibility.enforce" },
    create: { key: "eligibility.enforce", value: "on" },
    update: { value: "on" },
  });
});

let seq = 0;

async function makeTask(createdById: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return prisma().task.create({
    data: {
      title: `Audit sweep ${seq}`,
      description: "Audit five stores in Ikeja",
      category: "Retail",
      tier: "STUDENT",
      payModel: "FIXED",
      budget: 30000,
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 864e5),
      locationType: "PHYSICAL",
      slots: 1,
      status: "OPEN",
      deadline: new Date(Date.now() + 7 * 864e5),
      createdById,
      crewMax: 3,
      ...overrides,
    },
  });
}

async function makeTasker(opts: { tiers?: string } = {}) {
  seq += 1;
  const phone = `+23480${String(70000000 + seq).padStart(8, "0")}`;
  const t = await createUserWithToken("WORKER", { name: `Tasker ${seq}` });
  await prisma().user.update({
    where: { id: t.user.id },
    data: { tiers: opts.tiers ?? "STUDENT", kycStatus: "VERIFIED", phone },
  });
  return { ...t, phone };
}

describe("checkProposal", () => {
  const task = { payModel: "FIXED", budget: 30000, crewMax: 3 };

  it("accepts shares that add up to the budget within the limit", () => {
    expect(checkProposal(task, { leadShare: 12000, members: [{ phone: "a", share: 9000 }, { phone: "b", share: 9000 }] })).toBeNull();
  });

  it("refuses a split that does not add up, a crew too big, or a task closed to crews", () => {
    expect(checkProposal(task, { leadShare: 10000, members: [{ phone: "a", share: 9000 }] })).toMatch(/must add up/);
    expect(
      checkProposal(task, {
        leadShare: 7500,
        members: [{ phone: "a", share: 7500 }, { phone: "b", share: 7500 }, { phone: "c", share: 7500 }],
      })
    ).toMatch(/at most 3/);
    expect(checkProposal({ ...task, crewMax: 0 }, { leadShare: 15000, members: [{ phone: "a", share: 15000 }] })).toMatch(
      /does not take a crew/
    );
    expect(checkProposal(task, { leadShare: 30000, members: [{ phone: "a", share: 0 }] })).toMatch(/above zero/);
  });

  it("finds a Nigerian number however it was typed", () => {
    expect(phoneVariants("0803 123 4567")).toEqual(
      expect.arrayContaining(["+2348031234567", "08031234567", "2348031234567"])
    );
  });
});

describe("a crew job, end to end", () => {
  it("proposes, waits for every member, approves as one and pays each their share", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const task = await makeTask(admin.user.id);
    const lead = await makeTasker();
    const a = await makeTasker();
    const b = await makeTasker();

    // Typed the local way; stored as +234.
    const local = (p: string) => `0${p.slice(4)}`;
    const applied = await apiPost(
      "/api/applications",
      {
        taskId: task.id,
        crew: { leadShare: 12000, members: [{ phone: local(a.phone), share: 9000 }, { phone: b.phone, share: 9000 }] },
      },
      lead.token
    );
    expect(applied.status).toBe(201);
    expect(applied.body.crew.map((m: any) => m.status)).toEqual(["INVITED", "INVITED"]);

    // The manager cannot approve yet.
    const early = await apiPost(`/api/applications/${applied.body.id}/approve`, {}, admin.token);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/Waiting for/);

    for (const m of [a, b]) {
      const invites = await apiGet("/api/me/crew-invites", m.token);
      expect(invites.body[0]).toMatchObject({ share: 9000, status: "INVITED", lead: { name: lead.user.name } });
      const ok = await apiPost(`/api/me/crew-invites/${invites.body[0].id}/accept`, {}, m.token);
      expect(ok.body.status).toBe("ACCEPTED");
    }

    const queue = await apiGet(`/api/applications?taskId=${task.id}`, admin.token);
    expect(queue.body[0].crew).toMatchObject({ leadShare: 12000, ready: true });

    const approved = await apiPost(`/api/applications/${applied.body.id}/approve`, {}, admin.token);
    expect(approved.status).toBe(200);

    // One slot, a contract each, each share ring-fenced.
    expect((await prisma().task.findUnique({ where: { id: task.id } })).status).toBe("FILLED");
    const contracts = await prisma().contract.findMany({ where: { taskId: task.id } });
    expect(contracts).toHaveLength(3);
    const leadContract = contracts.find((c: any) => c.workerId === lead.user.id);
    expect(leadContract.share).toBe(12000);
    for (const c of contracts.filter((c: any) => c.workerId !== lead.user.id)) {
      expect(c).toMatchObject({ share: 9000, crewLeadContractId: leadContract.id });
    }
    const committed = await prisma().commitment.findMany({
      where: { contractId: { in: contracts.map((c: any) => c.id) } },
    });
    expect(committed.map((c: any) => c.amount).sort()).toEqual([12000, 9000, 9000].sort());

    // Members cannot hand in; the lead does, for everyone.
    const memberTry = await apiPost(
      "/api/timesheets",
      { taskId: task.id, periodStart: new Date().toISOString(), periodEnd: new Date().toISOString(), hours: 8 },
      a.token
    );
    expect(memberTry.status).toBe(403);

    await prisma().setting.upsert({
      where: { key: "evidence.enforce" },
      create: { key: "evidence.enforce", value: "off" },
      update: { value: "off" },
    });
    // The lead has started, as any solo Tasker would have by hand-in.
    await prisma().contract.update({ where: { id: leadContract.id }, data: { status: "IN_PROGRESS" } });
    const sheet = await apiPost(
      "/api/timesheets",
      { taskId: task.id, periodStart: new Date().toISOString(), periodEnd: new Date().toISOString(), hours: 8 },
      lead.token
    );
    expect(sheet.status).toBe(201);
    const afterSubmit = await prisma().contract.findMany({ where: { crewLeadContractId: leadContract.id } });
    expect(afterSubmit.map((c: any) => c.status)).toEqual(["SUBMITTED", "SUBMITTED"]);

    const paid = await apiPost(`/api/timesheets/${sheet.body.id}/approve`, {}, admin.token);
    expect(paid.status).toBe(200);
    expect(paid.body.payment).toMatchObject({ workerId: lead.user.id, gross: 12000, whtAmount: 600, net: 11400 });
    expect(paid.body.crewPayments).toHaveLength(2);
    for (const p of paid.body.crewPayments) expect(p).toMatchObject({ gross: 9000, whtAmount: 450, net: 8550 });

    const verified = await prisma().contract.findMany({ where: { taskId: task.id } });
    expect(verified.every((c: any) => c.status === "VERIFIED")).toBe(true);
  });

  it("withdraws the application when a member declines, and tells the lead who", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const task = await makeTask(admin.user.id);
    const lead = await makeTasker();
    const a = await makeTasker();

    const applied = await apiPost(
      "/api/applications",
      { taskId: task.id, crew: { leadShare: 15000, members: [{ phone: a.phone, share: 15000 }] } },
      lead.token
    );
    const invite = (await apiGet("/api/me/crew-invites", a.token)).body[0];
    await apiPost(`/api/me/crew-invites/${invite.id}/decline`, {}, a.token);

    const app = await prisma().application.findUnique({ where: { id: applied.body.id } });
    expect(app.status).toBe("REJECTED");
    expect(app.reason).toContain(a.user.name);
    const note = await prisma().notification.findFirst({
      where: { userId: lead.user.id, title: "Your crew application was withdrawn" },
    });
    expect(note).toBeTruthy();
  });

  it("refuses a member who does not qualify, and an unknown number", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const task = await makeTask(admin.user.id);
    const lead = await makeTasker();
    const wrongTier = await makeTasker({ tiers: "DISPATCH" });

    const blocked = await apiPost(
      "/api/applications",
      { taskId: task.id, crew: { leadShare: 15000, members: [{ phone: wrongTier.phone, share: 15000 }] } },
      lead.token
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/cannot join this job yet/);

    const unknown = await apiPost(
      "/api/applications",
      { taskId: task.id, crew: { leadShare: 15000, members: [{ phone: "+2348099999999", share: 15000 }] } },
      lead.token
    );
    expect(unknown.status).toBe(404);
    expect(await prisma().application.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("only lets a manager open fixed-price tasks to crews of 2 to 10", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const fixed = await makeTask(admin.user.id, { crewMax: 0 });
    expect((await apiPatch(`/api/tasks/${fixed.id}`, { crewMax: 4 }, admin.token)).status).toBe(200);
    expect((await apiPatch(`/api/tasks/${fixed.id}`, { crewMax: 1 }, admin.token)).status).toBe(400);

    const hourly = await makeTask(admin.user.id, { payModel: "HOURLY", rate: 1000, budget: null, crewMax: 0 });
    expect((await apiPatch(`/api/tasks/${hourly.id}`, { crewMax: 3 }, admin.token)).status).toBe(400);
  });
});
