// Tasker payouts through AfriZoneMart's Squad account (services/payout.ts,
// services/martPayout.ts). Nothing is sent until an admin presses Pay; the
// request is signed; AfriZoneMart's answer decides PAID, FAILED or back to
// the admin.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { SELF } from "cloudflare:test";
import { createUserWithToken, testPrisma } from "./helpers";
import { reconcileMartPayouts } from "../src/services/payout";

const SECRET = "test-mart-outbound";
type Call = { url: string; body: any; ts: string; sig: string };

function mockMart(handler: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("http://mart.test/")) return real(input as any, init);
    const h = new Headers(init?.headers);
    const raw = String(init?.body ?? "");
    const call = { url, body: JSON.parse(raw), ts: h.get("x-afz-timestamp")!, sig: h.get("x-afz-signature")! };
    calls.push(call);
    const r = handler(call);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["MART_BASE_URL", "MART_OUTBOUND_SECRET"]) saved[k] = process.env[k];
  process.env.MART_BASE_URL = "http://mart.test/api/integrations";
  process.env.MART_OUTBOUND_SECRET = SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function setup(amount = 6000) {
  const prisma = testPrisma() as any;
  const { user: worker } = await createUserWithToken("WORKER", { name: "Ada Obi", bankMasked: "GTBank ••89" });
  await prisma.user.update({
    where: { id: worker.id },
    data: { bankAccountNumber: "0123456789", bankCode: "058", bankName: "Guaranty Trust Bank" },
  });
  const { user: admin, token } = await createUserWithToken("SUPER_ADMIN");
  const w = await prisma.withdrawal.create({
    data: {
      workerId: worker.id,
      amount,
      bankMasked: "GTBank ••89",
      status: "REVIEW",
      reference: `afz_wd_${worker.id}_${Date.now()}`,
    },
  });
  return { prisma, worker, admin, token, w };
}

async function pay(id: string, token: string) {
  const res = await SELF.fetch(`http://local.test/api/admin/withdrawals/${id}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("payouts through AfriZoneMart", () => {
  it("sends nothing until an admin presses Pay, then sends a signed request", async () => {
    const calls = mockMart(() => ({ status: 201, body: { reference: "x", status: "PENDING", failureReason: null } }));
    const { prisma, admin, token, w } = await setup();
    expect(calls).toHaveLength(0);

    const r = await pay(w.id, token);
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("http://mart.test/api/integrations/parttime/payouts");
    expect(c.body).toMatchObject({
      reference: w.reference,
      amountNgn: 6000,
      bankCode: "058",
      accountNumber: "0123456789",
      expectedName: "Ada Obi",
      approvedBy: admin.email,
    });
    const expected = crypto.createHmac("sha256", SECRET).update(`${c.ts}.${JSON.stringify(c.body)}`).digest("hex");
    expect(c.sig).toBe(expected);

    const row = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    expect(row).toMatchObject({ status: "PROCESSING", provider: "afrizonemart", providerRef: w.reference });
  });

  it("marks it paid only when AfriZoneMart says Squad paid it", async () => {
    let status = "PENDING";
    mockMart((c) =>
      c.url.endsWith("/status")
        ? { status: 200, body: { reference: c.body.reference, status, failureReason: null } }
        : { status: 201, body: { status: "PENDING", failureReason: null } }
    );
    const { prisma, token, w } = await setup();
    await pay(w.id, token);

    await reconcileMartPayouts();
    expect((await prisma.withdrawal.findUnique({ where: { id: w.id } })).status).toBe("PROCESSING");

    status = "SUCCESS";
    await reconcileMartPayouts();
    expect((await prisma.withdrawal.findUnique({ where: { id: w.id } })).status).toBe("PAID");
  });

  it("returns the money when the account is in somebody else's name", async () => {
    mockMart(() => ({ status: 422, body: { code: "NAME_MISMATCH", error: 'Squad says this account belongs to "JOHN DOE".' } }));
    const { prisma, token, w } = await setup();
    const r = await pay(w.id, token);
    expect(r.status).toBe(422);
    const row = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    expect(row.status).toBe("FAILED");
    expect(row.failureReason).toContain("JOHN DOE");
  });

  it("goes back to the admin when AfriZoneMart does not answer, and resends the same reference", async () => {
    let up = false;
    const calls = mockMart(() => (up ? { status: 201, body: { status: "PENDING" } } : { status: 500, body: { error: "boom" } }));
    const { prisma, token, w } = await setup();

    expect((await pay(w.id, token)).status).toBe(502);
    expect((await prisma.withdrawal.findUnique({ where: { id: w.id } })).status).toBe("REVIEW");

    up = true;
    expect((await pay(w.id, token)).status).toBe(200);
    expect(calls.map((c) => c.body.reference)).toEqual([w.reference, w.reference]);
  });

  it("goes back to the admin while payouts are switched off on AfriZoneMart", async () => {
    mockMart(() => ({ status: 503, body: { code: "PAYOUTS_OFF", error: "Part Time payouts are switched off on AfriZoneMart." } }));
    const { prisma, token, w } = await setup();
    await pay(w.id, token);
    const row = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    expect(row.status).toBe("REVIEW");
    expect(row.failureReason).toContain("switched off");
  });
});

async function paidManually(id: string, token: string, body: unknown) {
  const res = await SELF.fetch(`http://local.test/api/admin/withdrawals/${id}/paid-manually`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("paid by bank transfer", () => {
  it("records a transfer we made ourselves, without sending anything", async () => {
    const calls = mockMart(() => ({ status: 500, body: {} }));
    const { prisma, token, w } = await setup();
    const { token: hr } = await createUserWithToken("HR_ADMIN");

    expect((await paidManually(w.id, hr, { reference: "100004261118" })).status).toBe(403);
    expect((await paidManually(w.id, token, {})).status).toBe(400);

    const r = await paidManually(w.id, token, { reference: "100004261118", note: "GTBank app" });
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(0);
    const row = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    expect(row).toMatchObject({ status: "PAID", provider: "manual", providerRef: "100004261118" });
    expect((await paidManually(w.id, token, { reference: "100004261118" })).status).toBe(409);
  });

  it("refuses when it may already have gone through Squad", async () => {
    let mart: { status: number; body: unknown } = { status: 500, body: { error: "down" } };
    mockMart(() => mart);
    const { prisma, token, w } = await setup();
    await pay(w.id, token); // no answer: back to REVIEW, but AfriZoneMart may have it

    mart = { status: 200, body: { status: "PENDING", failureReason: null } };
    const sent = await paidManually(w.id, token, { reference: "MANUAL-1" });
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe("MAYBE_SENT");

    mart = { status: 500, body: { error: "down" } };
    expect((await paidManually(w.id, token, { reference: "MANUAL-1" })).status).toBe(409);

    mart = { status: 404, body: { code: "NOT_FOUND", error: "No payout with that reference" } };
    expect((await paidManually(w.id, token, { reference: "MANUAL-1" })).status).toBe(200);
    expect((await prisma.withdrawal.findUnique({ where: { id: w.id } })).status).toBe("PAID");
  });
});

