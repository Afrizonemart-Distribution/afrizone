// A fresh selfie before a large withdrawal, checked by a person
// (routes/wallet.ts, routes/adminWithdrawals.ts). Four flows: the D1 pool
// hangs past about five in one file.
import { describe, it, expect } from "vitest";
import { apiGet, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

const prisma = () => testPrisma() as any;
let n = 0;

/** A worker with ₦300,000 available and a bank account on file. */
async function richWorker() {
  const w = await createUserWithToken("WORKER");
  await prisma().user.update({ where: { id: w.user.id }, data: { bankMasked: "GTBank ••89" } });
  const admin = await prisma().user.findFirst({ where: { role: "SUPER_ADMIN" } });
  const task = await prisma().task.create({
    data: {
      title: "Paid job",
      description: "x",
      category: "Data",
      tier: "REMOTE",
      payModel: "FIXED",
      budget: 300000,
      startDate: new Date(),
      endDate: new Date(),
      locationType: "REMOTE",
      slots: 1,
      deadline: new Date(),
      createdById: admin?.id ?? w.user.id,
    },
  });
  await prisma().payment.create({
    data: { workerId: w.user.id, taskId: task.id, gross: 300000, whtAmount: 0, net: 300000, status: "RELEASED" },
  });
  return w;
}

async function selfie(userId: string, ageMs = 0) {
  n += 1;
  return prisma().kycDocument.create({
    data: {
      userId,
      docType: "PAYOUT_SELFIE",
      filename: `selfie-${Date.now()}-${n}.jpg`,
      path: "x",
      createdAt: new Date(Date.now() - ageMs),
    },
  });
}

const withdraw = (token: string, amount: number, extra: Record<string, unknown> = {}) =>
  apiPost("/api/wallet/withdraw", { amount, ...extra }, token);

describe("selfie before a large withdrawal", () => {
  it("asks for a selfie only at or above the line", async () => {
    await createUserWithToken("SUPER_ADMIN");
    const w = await richWorker();
    const small = await withdraw(w.token, 20000);
    expect(small.status).toBe(201);
    expect(small.body.status).toBe("PROCESSING");

    const big = await withdraw(w.token, 100000);
    expect(big.status).toBe(403);
    expect(big.body.code).toBe("SELFIE_REQUIRED");
    expect(big.body.selfieOver).toBe(100000);
  });

  it("holds a large withdrawal in review, and refuses stale, reused or borrowed selfies", async () => {
    const w = await richWorker();
    const other = await createUserWithToken("WORKER");

    const stale = await selfie(w.user.id, 20 * 60 * 1000);
    expect((await withdraw(w.token, 100000, { selfieDocumentId: stale.id })).status).toBe(403);
    const theirs = await selfie(other.user.id);
    expect((await withdraw(w.token, 100000, { selfieDocumentId: theirs.id })).status).toBe(403);

    const fresh = await selfie(w.user.id);
    const ok = await withdraw(w.token, 100000, { selfieDocumentId: fresh.id });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("REVIEW");
    expect(ok.body.review).toBe(true);

    expect((await withdraw(w.token, 100000, { selfieDocumentId: fresh.id })).status).toBe(403);
  });

  it("sends it once a Super Admin approves, and only once", async () => {
    const sa = await createUserWithToken("SUPER_ADMIN");
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await richWorker();
    const doc = await selfie(w.user.id);
    const wd = await withdraw(w.token, 150000, { selfieDocumentId: doc.id });

    const list = await apiGet("/api/admin/withdrawals", hr.token);
    const row = list.body.find((r: any) => r.id === wd.body.id);
    expect(row.payoutSelfieUrl).toBeTruthy();
    expect(row.worker.id).toBe(w.user.id);

    expect((await apiPost(`/api/admin/withdrawals/${wd.body.id}/approve`, {}, hr.token)).status).toBe(403);
    const approved = await apiPost(`/api/admin/withdrawals/${wd.body.id}/approve`, {}, sa.token);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("PROCESSING");
    expect((await apiPost(`/api/admin/withdrawals/${wd.body.id}/approve`, {}, sa.token)).status).toBe(409);
  });

  it("puts the money back in the wallet when the face does not match", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const w = await richWorker();
    const wd = await withdraw(w.token, 250000, { selfieDocumentId: (await selfie(w.user.id)).id });
    expect(wd.status).toBe(201);
    // Reserved while it waits: there isn't another 250,000 available.
    expect((await withdraw(w.token, 250000, { selfieDocumentId: (await selfie(w.user.id)).id })).status).toBe(400);

    expect((await apiPost(`/api/admin/withdrawals/${wd.body.id}/reject`, {}, hr.token)).status).toBe(400);
    const rejected = await apiPost(
      `/api/admin/withdrawals/${wd.body.id}/reject`,
      { reason: "Selfie does not match the verified face" },
      hr.token
    );
    expect(rejected.status).toBe(200);
    const again = await withdraw(w.token, 250000, { selfieDocumentId: (await selfie(w.user.id)).id });
    expect(again.status).toBe(201);
  });
});
