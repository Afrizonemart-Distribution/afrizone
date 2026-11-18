import { describe, it, expect } from "vitest";
import { apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

async function createTask() {
  const { user: admin } = await createUserWithToken("SUPER_ADMIN");
  return testPrisma().task.create({
    data: {
      title: "Wallet test task",
      description: "desc",
      category: "Promo",
      tier: "STUDENT",
      payModel: "FIXED",
      budget: 20000,
      startDate: new Date(),
      endDate: new Date(),
      locationType: "REMOTE",
      slots: 1,
      deadline: new Date(),
      createdById: admin.id,
    },
  });
}

describe("wallet withdrawals", () => {
  it("rejects a withdrawal with no bank account on file", async () => {
    const { token } = await createUserWithToken("WORKER");
    const res = await apiPost("/api/wallet/withdraw", { amount: 6000 }, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/KYC/i);
  });

  it("rejects a non-integer amount and an amount below the minimum", async () => {
    const { token } = await createUserWithToken("WORKER", { bankMasked: "****1234" });

    const notInt = await apiPost("/api/wallet/withdraw", { amount: 100.5 }, token);
    expect(notInt.status).toBe(400);

    const tooLow = await apiPost("/api/wallet/withdraw", { amount: 1000 }, token);
    expect(tooLow.status).toBe(400);
  });

  it("rejects a withdrawal above the available balance", async () => {
    const { token } = await createUserWithToken("WORKER", { bankMasked: "****1234" });
    const res = await apiPost("/api/wallet/withdraw", { amount: 6000 }, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds/i);
  });

  it("withdraws successfully against a released payment, then dev-settles it", async () => {
    const { token, user } = await createUserWithToken("WORKER", { bankMasked: "****1234" });
    const task = await createTask();
    await testPrisma().payment.create({
      data: {
        workerId: user.id,
        taskId: task.id,
        gross: 10000,
        whtAmount: 500,
        net: 9500,
        status: "RELEASED",
      },
    });

    const withdraw = await apiPost("/api/wallet/withdraw", { amount: 9500 }, token);
    expect(withdraw.status).toBe(201);
    // Every withdrawal waits for an admin to press Pay; nothing is sent yet.
    expect(withdraw.body.status).toBe("REVIEW");

    // Available balance is now fully committed: a second withdrawal should fail.
    const again = await apiPost("/api/wallet/withdraw", { amount: 5000 }, token);
    expect(again.status).toBe(400);

    // dev/settle is admin-only. It marks PROCESSING withdrawals PAID, and it
    // is self-scoped to the caller - so while a worker could reach it, a worker
    // could settle their own withdrawals. Previously this test asserted exactly
    // that, using the worker's own token.
    const workerSettle = await apiPost("/api/wallet/dev/settle", undefined, token);
    expect(workerSettle.status).toBe(403);

    const { token: adminToken } = await createUserWithToken("SUPER_ADMIN");
    const { token: signer } = await createUserWithToken("HR_ADMIN");
    await apiPost(`/api/admin/withdrawals/${withdraw.body.id}/sign-off`, {}, signer);
    const paid = await apiPost(`/api/admin/withdrawals/${withdraw.body.id}/approve`, {}, adminToken);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("PROCESSING");
    expect(paid.body.simulated).toBe(true);
    const settle = await apiPost("/api/wallet/dev/settle", { workerId: user.id }, adminToken);
    expect(settle.status).toBe(200);
    expect(settle.body.settled).toBe(1);

    const stored = await testPrisma().withdrawal.findFirst({ where: { workerId: user.id } });
    expect(stored?.status).toBe("PAID");
  });
});
