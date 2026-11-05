// Proof-to-pay (services/proof.ts): acceptance checks, pay per unit, sending
// work back, one payment per fixed-price job, and a second person for large
// releases. Kept to five flows: the D1 pool hangs past about that many.
import { describe, it, expect } from "vitest";
import { apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

const prisma = () => testPrisma() as any;
let seq = 0;

/** A task through the API (so its validation runs), a worker approved onto it. */
async function assigned(task: Record<string, unknown>) {
  seq += 1;
  const admin = await createUserWithToken("SUPER_ADMIN");
  const worker = await createUserWithToken("WORKER");
  await prisma().user.update({ where: { id: worker.user.id }, data: { tiers: "REMOTE", kycStatus: "VERIFIED" } });
  const created = await apiPost(
    "/api/tasks",
    {
      title: `Proof task ${seq}`,
      description: "x",
      category: "Data",
      tier: "REMOTE",
      locationType: "REMOTE",
      slots: 3,
      deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
      requiresIdentityVerified: false,
      ...task,
    },
    admin.token
  );
  expect(created.status).toBe(201);
  const application = await prisma().application.create({
    data: { taskId: created.body.id, workerId: worker.user.id, status: "APPLIED" },
  });
  const ok = await apiPost(`/api/applications/${application.id}/approve`, {}, admin.token);
  expect(ok.status).toBe(200);
  return { admin, worker, task: created.body };
}

const handIn = (taskId: string, token: string, extra: Record<string, unknown> = {}) =>
  apiPost(
    "/api/timesheets",
    { taskId, periodStart: new Date().toISOString(), periodEnd: new Date().toISOString(), ...extra },
    token
  );

describe("proof-to-pay", () => {
  it("validates per-unit tasks and pays only the units accepted", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const base = {
      title: "Label photos",
      description: "x",
      category: "Data",
      tier: "REMOTE",
      payModel: "PER_UNIT",
      deadline: new Date(Date.now() + 864e5).toISOString(),
    };
    expect((await apiPost("/api/tasks", { ...base, rate: 200 }, admin.token)).status).toBe(400); // no unit
    expect((await apiPost("/api/tasks", { ...base, unitLabel: "photo" }, admin.token)).status).toBe(400); // no rate

    const { admin: a, worker, task } = await assigned({ payModel: "PER_UNIT", rate: 200, unitLabel: "photo", maxUnits: 50 });
    expect(task.unitLabel).toBe("photo");

    expect((await handIn(task.id, worker.token)).status).toBe(400); // no count
    expect((await handIn(task.id, worker.token, { units: 51 })).status).toBe(400); // over the cap
    const sheet = await handIn(task.id, worker.token, { units: 40, note: "Batch 1" });
    expect(sheet.status).toBe(201);
    // One waiting at a time.
    expect((await handIn(task.id, worker.token, { units: 5 })).status).toBe(409);

    expect((await apiPost(`/api/timesheets/${sheet.body.id}/approve`, { acceptedUnits: 41 }, a.token)).status).toBe(400);
    const ok = await apiPost(`/api/timesheets/${sheet.body.id}/approve`, { acceptedUnits: 35 }, a.token);
    expect(ok.status).toBe(200);
    expect(ok.body.payment.gross).toBe(35 * 200);
    expect(ok.body.payment.approvedById).toBe(a.user.id);
  });

  it("refuses approval until every acceptance check is confirmed", async () => {
    const criteria = ["All 20 rows filled", "Sources linked"];
    const { admin, worker, task } = await assigned({ payModel: "FIXED", budget: 8000, acceptanceCriteria: criteria });
    expect(task.acceptanceCriteria).toEqual(criteria);

    const sheet = await handIn(task.id, worker.token, { hours: 2 });
    expect(sheet.status).toBe(201);
    const partial = await apiPost(`/api/timesheets/${sheet.body.id}/approve`, { checks: [criteria[0]] }, admin.token);
    expect(partial.status).toBe(400);
    expect(partial.body.code).toBe("CHECKS_INCOMPLETE");
    expect(partial.body.unconfirmed).toEqual(["Sources linked"]);

    const ok = await apiPost(`/api/timesheets/${sheet.body.id}/approve`, { checks: criteria }, admin.token);
    expect(ok.status).toBe(200);
    const row = await prisma().timesheet.findUnique({ where: { id: sheet.body.id } });
    expect(JSON.parse(row.checks)).toEqual(criteria);
    expect(row.reviewedById).toBe(admin.user.id);
  });

  it("sends work back with a reason, then takes the second hand-in", async () => {
    const { admin, worker, task } = await assigned({ payModel: "FIXED", budget: 6000 });
    const first = await handIn(task.id, worker.token, { hours: 1 });
    expect((await apiPost(`/api/timesheets/${first.body.id}/rework`, {}, admin.token)).status).toBe(400);
    const back = await apiPost(`/api/timesheets/${first.body.id}/rework`, { reason: "Photos are blurry" }, admin.token);
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("REWORK");
    const contract = await prisma().contract.findFirst({ where: { taskId: task.id, workerId: worker.user.id } });
    expect(contract.status).toBe("REWORK");

    const second = await handIn(task.id, worker.token, { hours: 1 });
    expect(second.status).toBe(201);
    const c2 = await prisma().contract.findFirst({ where: { taskId: task.id, workerId: worker.user.id } });
    expect(c2.status).toBe("SUBMITTED");
    expect((await apiPost(`/api/timesheets/${second.body.id}/approve`, {}, admin.token)).status).toBe(200);

    // Approved: nothing more can be handed in for a fixed price.
    expect((await handIn(task.id, worker.token, { hours: 1 })).status).toBe(409);
  });

  it("never pays a fixed price twice, even with two hand-ins on the books", async () => {
    const { admin, worker, task } = await assigned({ payModel: "FIXED", budget: 9000 });
    // Two rows as they could exist from before the one-at-a-time rule.
    const mk = () =>
      prisma().timesheet.create({
        data: { taskId: task.id, workerId: worker.user.id, periodStart: new Date(), periodEnd: new Date(), hours: 1 },
      });
    const [s1, s2] = [await mk(), await mk()];
    expect((await apiPost(`/api/timesheets/${s1.id}/approve`, {}, admin.token)).status).toBe(200);
    const again = await apiPost(`/api/timesheets/${s2.id}/approve`, {}, admin.token);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_PAID");
  });

  it("makes a different admin release a large payment", async () => {
    const { admin, worker, task } = await assigned({ payModel: "FIXED", budget: 120000 });
    const sheet = await handIn(task.id, worker.token, { hours: 3 });
    const ok = await apiPost(`/api/timesheets/${sheet.body.id}/approve`, {}, admin.token);
    const paymentId = ok.body.payment.id;

    const self = await apiPost(`/api/payments/${paymentId}/release`, {}, admin.token);
    expect(self.status).toBe(409);
    expect(self.body.code).toBe("SECOND_APPROVER_REQUIRED");

    const other = await createUserWithToken("SUPER_ADMIN");
    const released = await apiPost(`/api/payments/${paymentId}/release`, {}, other.token);
    expect(released.status).toBe(200);
    const contract = await prisma().contract.findFirst({ where: { taskId: task.id, workerId: worker.user.id } });
    expect(contract.status).toBe("PAID");
  });
});
