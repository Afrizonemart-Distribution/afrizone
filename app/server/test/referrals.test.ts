// The referral loop: people earn for bringing in Taskers and stores that turn
// out real (Blueprint §14, services/referrals.ts).
//
// Five properties, and every test below is one of them:
//
//   ONE CODE, ONE CLAIM, EARLY. A Tasker says who sent them before their first
//   job and within the window, once, and never with their own code.
//
//   IT PAYS WHEN THE NEWCOMER IS REAL. A Tasker's first released payment; a
//   store's approval. Never twice.
//
//   OFF UNTIL SET. With no reward amount, nothing is earned.
//
//   THE BONUS IS MONEY. It lands in the wallet net of WHT and can be withdrawn,
//   through the same atomic balance check as earnings.
//
//   STORES COUNT TOO, but not when referred by one of their own members.
import { describe, it, expect, beforeEach } from "vitest";
import { apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { makeCode, normaliseCode } from "../src/services/referrals";

const prisma = () => testPrisma() as any;

async function setReward(key: string, value: string) {
  await prisma().setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

beforeEach(async () => {
  await setReward("referral.taskerReward", "6000");
  await setReward("referral.storeReward", "10000");
});

async function tasker() {
  const t = await createUserWithToken("WORKER");
  await prisma().user.update({ where: { id: t.user.id }, data: { bankMasked: "****1234", kycStatus: "VERIFIED" } });
  return t;
}

async function codeOf(t: { token: string }) {
  const res = await apiGet("/api/me/referral", t.token);
  expect(res.status).toBe(200);
  return res.body.code as string;
}

/** A released payment for this worker, through the real release route. */
async function payFirstJob(workerId: string, admin: { user: { id: string }; token: string }) {
  const task = await prisma().task.create({
    data: {
      title: "First job",
      description: "x",
      category: "Retail",
      tier: "STUDENT",
      payModel: "FIXED",
      budget: 4000,
      startDate: new Date(),
      endDate: new Date(),
      locationType: "REMOTE",
      slots: 1,
      status: "FILLED",
      deadline: new Date(),
      createdById: admin.user.id,
    },
  });
  const payment = await prisma().payment.create({
    data: { workerId, taskId: task.id, gross: 4000, whtRate: 0.05, whtAmount: 200, net: 3800, status: "APPROVED" },
  });
  const res = await apiPost(`/api/payments/${payment.id}/release`, {}, admin.token);
  expect(res.status).toBe(200);
}

describe("codes", () => {
  it("are six unambiguous characters, and typed loosely still match", () => {
    expect(makeCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normaliseCode(" ab-c 12 ")).toBe("ABC12");
  });

  it("stay the same once made, and staff have none", async () => {
    const t = await tasker();
    expect(await codeOf(t)).toBe(await codeOf(t));
    const admin = await createUserWithToken("SUPER_ADMIN");
    expect((await apiGet("/api/me/referral", admin.token)).status).toBe(404);
  });
});

describe("a Tasker referral", () => {
  it("pays the referrer once, on the newcomer's first released payment, and the bonus can be withdrawn", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const referrer = await tasker();
    const newcomer = await tasker();
    const code = await codeOf(referrer);

    const claimed = await apiPost("/api/me/referral", { code: code.toLowerCase() }, newcomer.token);
    expect(claimed.status).toBe(201);
    expect(claimed.body.referredBy.name).toBe(referrer.user.name);
    expect((await apiPost("/api/me/referral", { code }, newcomer.token)).status).toBe(409);

    expect((await apiGet("/api/me/referral", referrer.token)).body.referrals[0]).toMatchObject({
      kind: "TASKER",
      status: "PENDING",
      net: null,
    });

    await payFirstJob(newcomer.user.id, admin);
    await payFirstJob(newcomer.user.id, admin);

    const mine = (await apiGet("/api/me/referral", referrer.token)).body;
    expect(mine.earned).toBe(5700);
    expect(mine.referrals[0]).toMatchObject({ status: "EARNED", net: 5700 });

    const wallet = await apiGet("/api/me/wallet", referrer.token);
    expect(wallet.body).toMatchObject({ available: 5700, referrals: 5700 });

    const out = await apiPost("/api/wallet/withdraw", { amount: 5000 }, referrer.token);
    expect(out.status).toBe(201);
    expect((await apiPost("/api/wallet/withdraw", { amount: 5000 }, referrer.token)).status).toBe(400);
  });

  it("refuses your own code, a code after your first job, and an unknown code", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const a = await tasker();
    const b = await tasker();
    expect((await apiPost("/api/me/referral", { code: await codeOf(a) }, a.token)).status).toBe(400);
    expect((await apiPost("/api/me/referral", { code: "ZZZZZZ" }, a.token)).status).toBe(404);

    await prisma().contract.create({
      data: {
        workerId: b.user.id,
        status: "CLAIMED",
        taskId: (
          await prisma().task.create({
            data: {
              title: "t", description: "x", category: "Retail", tier: "STUDENT", payModel: "FIXED", budget: 1,
              startDate: new Date(), endDate: new Date(), locationType: "REMOTE", slots: 1, deadline: new Date(),
              createdById: admin.user.id,
            },
          })
        ).id,
      },
    });
    const late = await apiPost("/api/me/referral", { code: await codeOf(a) }, b.token);
    expect(late.status).toBe(400);
    expect(late.body.error).toMatch(/before your first job/);
  });

  it("earns nothing while the reward is off", async () => {
    await setReward("referral.taskerReward", "0");
    const admin = await createUserWithToken("SUPER_ADMIN");
    const referrer = await tasker();
    const newcomer = await tasker();
    await apiPost("/api/me/referral", { code: await codeOf(referrer) }, newcomer.token);
    await payFirstJob(newcomer.user.id, admin);
    const mine = (await apiGet("/api/me/referral", referrer.token)).body;
    expect(mine.earned).toBe(0);
    expect(mine.referrals[0].status).toBe("PENDING");
  });

  it("takes a code at email sign-up without letting a bad one block joining", async () => {
    const referrer = await tasker();
    const code = await codeOf(referrer);
    const email = `ref-${Date.now()}@afrizone.work`;
    const ok = await apiPost("/api/auth/register", { name: "Ngozi A", email, password: "longenough123", referralCode: code });
    expect(ok.status).toBe(200);
    expect(ok.body.referral).toEqual({ referredBy: referrer.user.name });

    const bad = await apiPost("/api/auth/register", {
      name: "Femi B",
      email: `ref2-${Date.now()}@afrizone.work`,
      password: "longenough123",
      referralCode: "NOPE99",
    });
    expect(bad.status).toBe(200);
    expect(bad.body.referral.error).toMatch(/not found/);
  });
});

describe("a store referral", () => {
  it("pays the referrer when the store is approved, and not to the store's own member", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const referrer = await tasker();
    const code = await codeOf(referrer);

    const created = await apiPost(
      "/api/admin/organizations",
      { name: `Referred Mart ${Date.now()}`, kind: "STORE", address: "1 Allen Avenue", referralCode: code },
      admin.token
    );
    expect(created.status).toBe(201);
    expect(created.body.referralWarning).toBeNull();

    const approved = await apiPatch(`/api/admin/organizations/${created.body.id}`, { status: "ACTIVE" }, admin.token);
    expect(approved.status).toBe(200);
    expect((await apiGet("/api/me/referral", referrer.token)).body.earned).toBe(9500);

    const list = await apiGet("/api/admin/referrals", admin.token);
    expect(list.body.referrals.find((r: any) => r.referred.id === created.body.id)).toMatchObject({
      kind: "STORE",
      status: "EARNED",
      gross: 10000,
    });

    // One of the store's own people cannot be its referrer.
    const owner = await tasker();
    const ownStore = await apiPost(
      "/api/admin/organizations",
      {
        name: `Own Mart ${Date.now()}`,
        kind: "STORE",
        ownerEmail: owner.user.email,
        referralCode: await codeOf(owner),
      },
      admin.token
    );
    expect(ownStore.body.referralWarning).toMatch(/its own members/);
  });
});
