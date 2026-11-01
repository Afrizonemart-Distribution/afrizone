// Surge pay: an unclaimed delivery pays more the longer it waits
// (Blueprint §10, services/surge.ts).
//
// Four properties, and every test below is one of them:
//
//   OFF UNTIL SWITCHED ON. No steps, no surge - the board pays what it always did.
//
//   IT ONLY EVER RISES, TO A CEILING. A longer wait is never cheaper to take,
//   and the naira cap holds whatever the percentage says.
//
//   LOCKED AT THE CLAIM. The budget, the ring-fenced commitment and so the
//   eventual payment all carry the figure the courier took it at.
//
//   A RE-OPEN STARTS AGAIN FROM THE BASE. The vanished courier's surge comes
//   off, so the next one is not paid surge on top of surge.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "crypto";
import { SELF } from "cloudflare:test";
import { apiGet, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { parseSurgeSteps, surgeAt, type SurgeRule } from "../src/services/surge";

const prisma = () => testPrisma() as any;

const SECRET = "local-dev-mart-inbound-secret";
const MINUTE = 60_000;

// The shop the fixtures deliver from: Allen Avenue, Ikeja.
const SHOP = { lat: 6.6018, lng: 3.3515 };
// Due south of the shop, about 8 km: outside the 3 km opening circle, inside
// the 15 km cap. This is the courier the widening is FOR - close enough that
// waiting brings them in.
const EIGHT_KM = { lat: 6.5299, lng: 3.3515 };
// Lekki Phase 1, about 21 km away - beyond even the widest circle this order
// will ever reach. Being told no is the right answer for them.
const BEYOND_CAP = { lat: 6.4478, lng: 3.4723 };

let admin: Awaited<ReturnType<typeof createUserWithToken>>;
beforeAll(async () => {
  admin = await createUserWithToken("SUPER_ADMIN");
  // The credential gate has its own 24 tests in eligibility.test.ts. These are
  // about assignment, and self-claim has no override to lean on the way the
  // admin fixture in delivery.test.ts does - so the gate is switched off and
  // couriers are given the DISPATCH tier, which enforces regardless.
  await prisma().setting.upsert({
    where: { key: "eligibility.enforce" },
    create: { key: "eligibility.enforce", value: "off" },
    update: { value: "off" },
  });
});

let seq = 0;
function uid(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}-${Date.now()}`;
}

async function makeStore(overrides: Record<string, unknown> = {}) {
  return prisma().organization.create({
    data: {
      kind: "STORE",
      name: `Claim Shop ${seq}`,
      slug: uid("claim-shop"),
      status: "ACTIVE",
      address: "9 Allen Avenue, Ikeja, Lagos",
      lat: SHOP.lat,
      lng: SHOP.lng,
      ...overrides,
    },
  });
}

async function memberOf(orgId: string) {
  const person = await createUserWithToken("WORKER");
  await prisma().organizationMember.create({
    data: { organizationId: orgId, userId: person.user.id, role: "OWNER" },
  });
  return person;
}

/** A courier the tier check will accept. */
async function makeCourier() {
  const c = await createUserWithToken("WORKER");
  await prisma().user.update({
    where: { id: c.user.id },
    data: { tiers: "DISPATCH", kycStatus: "VERIFIED", accountType: "COURIER" },
  });
  return c;
}

/** The payload as §3.1 documents it. */
function orderPayload(storeSlug: string, overrides: Record<string, any> = {}) {
  return {
    martOrderId: uid("AZM"),
    fulfilment: { storeSlug, stockSource: "OWN_STOCK" },
    items: [{ ref: "SKU-1120", name: "Rice 5kg", qty: 1 }],
    dropoff: {
      address: "14 Opebi Road, Ikeja, Lagos",
      lat: 6.5921,
      lng: 3.3489,
      instructions: "Blue gate",
    },
    customer: { displayName: "Ada O.", phone: "+2348030000123" },
    money: { goodsTotal: 12000, deliveryFee: 1500 },
    expectedBy: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/** Post a signed event through the real worker handler. */
async function confirmOrder(data: Record<string, unknown>) {
  const body = JSON.stringify({
    eventId: uid("evt"),
    type: "order.confirmed",
    occurredAt: new Date().toISOString(),
    data,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  const res = await SELF.fetch("http://local.test/api/integrations/mart/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Afz-Timestamp": ts,
      "X-Afz-Signature": sig,
    },
    body,
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}

/**
 * An order a store has accepted, so the courier posting is up and `offeredAt`
 * is stamped. This is the state every test below starts from.
 */
async function offeredOrder() {
  const store = await makeStore();
  const payload = orderPayload(store.slug);
  await confirmOrder(payload);

  const owner = await memberOf(store.id);
  const delivery = await prisma().delivery.findUnique({
    where: { martOrderId: payload.martOrderId },
  });
  await apiPost(`/api/deliveries/${delivery.id}/accept`, {}, owner.token);

  return {
    store,
    owner,
    delivery: await prisma().delivery.findUnique({
      where: { martOrderId: payload.martOrderId },
    }),
  };
}

/** Move a posting's clock back, so a widened circle can be tested without waiting. */
async function waitedMinutes(deliveryId: string, minutes: number) {
  await prisma().delivery.update({
    where: { id: deliveryId },
    data: { offeredAt: new Date(Date.now() - minutes * MINUTE) },
  });
}

async function setOfferRule(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    await prisma().setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

// ── The policy, as arithmetic ────────────────────────────────────────────────


const SURGE_STEPS = "rules.DELIVERY.surgeSteps";
const SURGE_MAX = "rules.DELIVERY.surgeMaxNaira";

beforeEach(async () => {
  await prisma().setting.deleteMany({ where: { key: { in: [SURGE_STEPS, SURGE_MAX] } } });
});

const T0 = new Date(Date.UTC(2026, 9, 28, 9, 0));
const at = (min: number) => new Date(T0.getTime() + min * MINUTE);
const rule = (steps: string, maxNaira = 0): SurgeRule => ({ steps: parseSurgeSteps(steps), maxNaira });

describe("the surge arithmetic", () => {
  it("is nothing with no steps", () => {
    expect(surgeAt(1500, T0, at(60), rule(""))).toEqual({ percent: 0, amount: 0, next: null });
  });

  it("steps up on time waited, in whole ₦50s rounded down, and says what is next", () => {
    const r = rule("10:10, 20:25");
    expect(surgeAt(1500, T0, at(5), r)).toEqual({
      percent: 0,
      amount: 0,
      next: { afterMinutes: 10, percent: 10, inMinutes: 5 },
    });
    expect(surgeAt(1500, T0, at(12), r)).toMatchObject({ percent: 10, amount: 150 });
    // 25% of 1500 is 375; paid as 350.
    expect(surgeAt(1500, T0, at(30), r)).toEqual({ percent: 25, amount: 350, next: null });
  });

  it("holds the naira ceiling and stops promising more once there", () => {
    const r = rule("5:20,15:50", 400);
    expect(surgeAt(2000, T0, at(6), r)).toMatchObject({ amount: 400, next: null });
  });

  it("drops steps that would pay less after a longer wait, and caps at 100%", () => {
    expect(parseSurgeSteps("20:10,10:30,30:250,x:5,-1:5")).toEqual([
      { afterMinutes: 10, percent: 30 },
      { afterMinutes: 30, percent: 100 },
    ]);
  });
});

async function settle(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    await prisma().setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

describe("a surged delivery", () => {
  it("shows the surged fee on the board and locks it into the pay at the claim", async () => {
    await settle({ [SURGE_STEPS]: "10:10,20:25" });
    const { delivery } = await offeredOrder();
    const task = await prisma().task.findUnique({ where: { id: delivery.taskId } });
    const base = task.budget;
    await waitedMinutes(delivery.id, 25);

    const courier = await makeCourier();
    const board = await apiGet(`/api/me/delivery-offers?lat=${SHOP.lat}&lng=${SHOP.lng}`, courier.token);
    const offer = board.body.offers.find((o: any) => o.id === delivery.id);
    const surge = Math.floor((base * 0.25) / 50) * 50;
    expect(offer.fee).toBe(base + surge);
    expect(offer.surge).toMatchObject({ percent: 25, amount: surge });

    const res = await apiPost(`/api/deliveries/${delivery.id}/claim`, SHOP, courier.token);
    expect(res.status).toBe(201);

    expect((await prisma().task.findUnique({ where: { id: task.id } })).budget).toBe(base + surge);
    expect((await prisma().delivery.findUnique({ where: { id: delivery.id } })).surgeAmount).toBe(surge);
    const commitment = await prisma().commitment.findFirst({ where: { contractId: res.body.contractId } });
    expect(commitment.amount).toBe(base + surge);
  });

  it("pays the base when surge is off", async () => {
    const { delivery } = await offeredOrder();
    const task = await prisma().task.findUnique({ where: { id: delivery.taskId } });
    await waitedMinutes(delivery.id, 60);
    const courier = await makeCourier();
    const res = await apiPost(`/api/deliveries/${delivery.id}/claim`, SHOP, courier.token);
    expect(res.status).toBe(201);
    expect((await prisma().task.findUnique({ where: { id: task.id } })).budget).toBe(task.budget);
  });

  it("takes the surge back off when the order is re-opened", async () => {
    await settle({ [SURGE_STEPS]: "10:20" });
    const { delivery } = await offeredOrder();
    const base = (await prisma().task.findUnique({ where: { id: delivery.taskId } })).budget;
    await waitedMinutes(delivery.id, 15);
    const courier = await makeCourier();
    expect((await apiPost(`/api/deliveries/${delivery.id}/claim`, SHOP, courier.token)).status).toBe(201);

    const reopened = await apiPost(`/api/admin/deliveries/${delivery.id}/reopen`, {}, admin.token);
    expect(reopened.status).toBe(200);
    expect((await prisma().task.findUnique({ where: { id: delivery.taskId } })).budget).toBe(base);
    const fresh = await prisma().delivery.findUnique({ where: { id: delivery.id } });
    expect(fresh.surgeAmount).toBe(0);

    // The wait restarted, so a claim straight away pays the base.
    const next = await makeCourier();
    expect((await apiPost(`/api/deliveries/${delivery.id}/claim`, SHOP, next.token)).status).toBe(201);
    expect((await prisma().task.findUnique({ where: { id: delivery.taskId } })).budget).toBe(base);
  });
});
