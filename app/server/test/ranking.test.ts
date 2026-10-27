// Ranked offers: a delivery goes to the best-placed online courier first
// (Blueprint §11, services/ranking.ts).
//
// Five properties, and every test below is one of them:
//
//   THE BEST-PLACED COURIER IS ASKED FIRST. Nearer beats further, a clean
//   record beats a patchy one, and a courier with nothing on beats one already
//   carrying two jobs - and an unknown is neutral, never a penalty, or a new
//   rider would never be offered anything.
//
//   ONLY THE ONE WHOSE TURN IT IS MAY TAKE IT. Somebody else tapping Claim
//   during another courier's window is refused, and told when it comes to them.
//
//   TURNS PASS ON THE CLOCK, AND EACH COURIER IS TOLD ONCE. Whose turn it is is
//   arithmetic; the cron only sends the push, and running it twice must not
//   send it twice.
//
//   THE GATE STILL DECIDES WHO MAY WORK. Ranking orders couriers who pass
//   eligibility. Offline, stale, unqualified and too-far couriers are not on
//   the list at all.
//
//   NOBODY ONLINE MEANS THE OLD BOARD. Ranking adds a few minutes in front of
//   the open circle and never takes the circle away.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "crypto";
import { SELF } from "cloudflare:test";
import { apiGet, apiPost, apiPut } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import {
  DEFAULT_OFFER_RULE,
  minutesUntilInRange,
  offerStateAt,
  type OfferRule,
} from "../src/services/deliveryOffer";
import {
  PRESENCE_TTL_MINUTES,
  advanceRankedOffers,
  orderCandidates,
  scoreCandidate,
  type CandidateFacts,
} from "../src/services/ranking";

const prisma = () => testPrisma() as any;

const SECRET = "local-dev-mart-inbound-secret";
const MINUTE = 60_000;

// Allen Avenue, Ikeja.
const SHOP = { lat: 6.6018, lng: 3.3515 };
// About 1 km away.
const ONE_KM = { lat: 6.5928, lng: 3.3515 };
// About 5 km away.
const FIVE_KM = { lat: 6.5568, lng: 3.3515 };
// About 21 km away - beyond the widest circle the order will ever reach.
const BEYOND_CAP = { lat: 6.4478, lng: 3.4723 };

beforeAll(async () => {
  // The credential gate has its own tests; these are about ordering. Couriers
  // are given the DISPATCH tier, which is checked regardless.
  await prisma().setting.upsert({
    where: { key: "eligibility.enforce" },
    create: { key: "eligibility.enforce", value: "off" },
    update: { value: "off" },
  });
});

// Presence is shared across every test in the file; each starts with nobody online.
beforeEach(async () => {
  await prisma().courierPresence.deleteMany({});
});

let seq = 0;
function uid(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}-${Date.now()}`;
}

async function makeStore() {
  return prisma().organization.create({
    data: {
      kind: "STORE",
      name: `Ranked Shop ${seq}`,
      slug: uid("ranked-shop"),
      status: "ACTIVE",
      address: "9 Allen Avenue, Ikeja, Lagos",
      lat: SHOP.lat,
      lng: SHOP.lng,
    },
  });
}

async function makeCourier(opts: { tiers?: string } = {}) {
  const c = await createUserWithToken("WORKER");
  await prisma().user.update({
    where: { id: c.user.id },
    data: { tiers: opts.tiers ?? "DISPATCH", kycStatus: "VERIFIED", accountType: "COURIER" },
  });
  return c;
}

async function goOnline(c: { token: string }, at: { lat: number; lng: number }) {
  const res = await apiPut("/api/me/presence", at, c.token);
  expect(res.status).toBe(200);
  return res;
}

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
    headers: { "Content-Type": "application/json", "X-Afz-Timestamp": ts, "X-Afz-Signature": sig },
    body,
  });
  return res.status;
}

/** An order the store has accepted, so it has just gone on the board and been ranked. */
async function offeredOrder() {
  const store = await makeStore();
  const martOrderId = uid("AZM");
  await confirmOrder({
    martOrderId,
    fulfilment: { storeSlug: store.slug, stockSource: "OWN_STOCK" },
    items: [{ ref: "SKU-1120", name: "Rice 5kg", qty: 1 }],
    dropoff: { address: "14 Opebi Road, Ikeja, Lagos", lat: 6.5921, lng: 3.3489 },
    customer: { displayName: "Ada O.", phone: "+2348030000123" },
    money: { goodsTotal: 12000, deliveryFee: 1500 },
    expectedBy: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  const owner = await createUserWithToken("WORKER");
  await prisma().organizationMember.create({
    data: { organizationId: store.id, userId: owner.user.id, role: "OWNER" },
  });
  const pending = await prisma().delivery.findUnique({ where: { martOrderId } });
  const accepted = await apiPost(`/api/deliveries/${pending.id}/accept`, {}, owner.token);
  expect(accepted.status).toBeLessThan(300);
  return prisma().delivery.findUnique({ where: { martOrderId } });
}

function rankedIds(delivery: { rankedCandidates: string | null }): string[] {
  return JSON.parse(delivery.rankedCandidates ?? "[]").map((c: any) => c.workerId);
}

/** Move an order's clock back, so turns can be tested without waiting. */
async function waited(deliveryId: string, minutes: number) {
  await prisma().delivery.update({
    where: { id: deliveryId },
    data: { offeredAt: new Date(Date.now() - minutes * MINUTE) },
  });
}

// ── The score, as arithmetic ─────────────────────────────────────────────────

describe("the score", () => {
  const rule = DEFAULT_OFFER_RULE;
  const base: CandidateFacts = {
    distanceMetres: 2_000,
    completed: 5,
    cancelled: 0,
    rating: 4.5,
    activeLoad: 0,
  };

  it("prefers the nearer courier when everything else is equal", () => {
    expect(scoreCandidate({ ...base, distanceMetres: 1_000 }, rule)).toBeGreaterThan(
      scoreCandidate({ ...base, distanceMetres: 8_000 }, rule)
    );
  });

  it("prefers a courier who finishes what they take", () => {
    expect(scoreCandidate({ ...base, completed: 10, cancelled: 0 }, rule)).toBeGreaterThan(
      scoreCandidate({ ...base, completed: 5, cancelled: 5 }, rule)
    );
  });

  it("prefers a courier with nothing on, but does not rule out a busy one", () => {
    const free = scoreCandidate({ ...base, activeLoad: 0 }, rule);
    const one = scoreCandidate({ ...base, activeLoad: 1 }, rule);
    const two = scoreCandidate({ ...base, activeLoad: 2 }, rule);
    expect(free).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(0);
  });

  it("treats a brand-new courier as middling, not as the worst", () => {
    // No rating and no history. Scoring that as zero would mean a new rider is
    // never offered anything and so never builds the record that would get
    // them offered something.
    const fresh = scoreCandidate(
      { distanceMetres: 2_000, completed: 0, cancelled: 0, rating: null, activeLoad: 0 },
      rule
    );
    const flaky = scoreCandidate(
      { distanceMetres: 2_000, completed: 1, cancelled: 6, rating: 1.5, activeLoad: 0 },
      rule
    );
    expect(fresh).toBeGreaterThan(flaky);
  });

  it("orders the same facts the same way every time", () => {
    const tied = [
      { workerId: "b", score: 0.7, distanceMetres: 2_000 },
      { workerId: "a", score: 0.7, distanceMetres: 2_000 },
      { workerId: "c", score: 0.7, distanceMetres: 1_000 },
      { workerId: "d", score: 0.9, distanceMetres: 9_000 },
    ];
    expect(orderCandidates(tied).map((c) => c.workerId)).toEqual(["d", "c", "a", "b"]);
    expect(orderCandidates([...tied].reverse()).map((c) => c.workerId)).toEqual(["d", "c", "a", "b"]);
  });
});

// ── Turns, as arithmetic ─────────────────────────────────────────────────────

describe("whose turn it is", () => {
  const rule: OfferRule = DEFAULT_OFFER_RULE; // 3 turns of 2 minutes
  const now = new Date("2026-10-08T12:00:00Z");
  const ago = (m: number) => new Date(now.getTime() - m * MINUTE);
  const three = [{ workerId: "w1" }, { workerId: "w2" }, { workerId: "w3" }];

  it("gives each candidate their window in order", () => {
    expect(offerStateAt(ago(0), now, rule, three)!.turn!.workerId).toBe("w1");
    expect(offerStateAt(ago(1.9), now, rule, three)!.turn!.workerId).toBe("w1");
    expect(offerStateAt(ago(2), now, rule, three)!.turn!.workerId).toBe("w2");
    expect(offerStateAt(ago(5), now, rule, three)!.turn!.workerId).toBe("w3");
    expect(offerStateAt(ago(0), now, rule, three)!.stage).toBe("RANKED");
  });

  it("counts down in seconds, not minutes", () => {
    expect(offerStateAt(ago(0.5), now, rule, three)!.turn!.secondsLeft).toBe(90);
  });

  it("opens to everyone after the last turn, at the base circle", () => {
    // The circle waits for the ranked phase. Six minutes of exclusive offers
    // must not open the board already doubled, to couriers twice as far away.
    const opened = offerStateAt(ago(6), now, rule, three)!;
    expect(opened.turn).toBeNull();
    expect(opened.stage).toBe("OFFERED");
    expect(opened.radiusMetres).toBe(3_000);
    expect(offerStateAt(ago(11), now, rule, three)!.radiusMetres).toBe(6_000);
  });

  it("only gives as many turns as there are candidates", () => {
    const one = [{ workerId: "w1" }];
    expect(offerStateAt(ago(1), now, rule, one)!.turn!.workerId).toBe("w1");
    expect(offerStateAt(ago(2), now, rule, one)!.turn).toBeNull();
  });

  it("keeps the old board exactly when nobody was ranked", () => {
    const plain = offerStateAt(ago(5), now, rule, []);
    expect(plain!.turn).toBeNull();
    expect(plain!.radiusMetres).toBe(6_000);
  });

  it("can be switched off with a count of zero", () => {
    const off = { ...rule, rankedCandidates: 0 };
    expect(offerStateAt(ago(0), now, off, three)!.turn).toBeNull();
  });

  it("still escalates on total time waited", () => {
    // A customer waiting is a customer waiting, whoever the order was with.
    const slow = { ...rule, rankedWindowMinutes: 10, escalateAfterMinutes: 20 };
    expect(offerStateAt(ago(25), now, slow, three)!.escalated).toBe(true);
  });

  it("tells a courier beyond the base circle when it reaches them, after the ranked phase", () => {
    // 5 km needs one doubling: 6 minutes of turns, then 5 more.
    expect(minutesUntilInRange(5_000, now, now, rule, 3)).toBe(11);
    expect(minutesUntilInRange(5_000, now, now, rule, 0)).toBe(5);
  });

  it("moves to the next candidate as soon as one passes", () => {
    // w1 passed 30 seconds in, so 90 seconds of their window were never used.
    const passed = offerStateAt(ago(0.5), now, rule, three, 90)!;
    expect(passed.turn!.workerId).toBe("w2");
    expect(passed.turn!.secondsLeft).toBe(120);
    expect(passed.turn!.opensToAllAt.getTime()).toBe(now.getTime() + 4 * MINUTE);
  });

  it("opens the circle early when the last candidate passes, but escalates on real time", () => {
    const one = [{ workerId: "w1" }];
    const opened = offerStateAt(ago(0.5), now, rule, one, 90)!;
    expect(opened.turn).toBeNull();
    expect(opened.radiusMetres).toBe(3_000);
    // The circle widens from when it really opened, not from when it would have.
    expect(offerStateAt(ago(5.5), now, rule, one, 90)!.radiusMetres).toBe(6_000);
    // The customer has waited what they have waited.
    expect(offerStateAt(ago(0.5), now, rule, one, 90)!.waitingMinutes).toBe(0);
  });

  it("brings the open circle forward for couriers waiting outside it", () => {
    // 1 courier who passed straight away: no ranked time at all, then 5 minutes.
    expect(minutesUntilInRange(5_000, now, now, rule, 1, 120)).toBe(5);
  });
});

// ── Against the real worker ──────────────────────────────────────────────────

describe("going online", () => {
  it("needs a position, because ranking is by distance", async () => {
    const c = await makeCourier();
    const res = await apiPut("/api/me/presence", {}, c.token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_LOCATION");
  });

  it("is only for courier accounts", async () => {
    const worker = await createUserWithToken("WORKER");
    const res = await apiPut("/api/me/presence", ONE_KM, worker.token);
    expect(res.status).toBe(403);
  });

  it("keeps one point per courier and deletes it on going offline", async () => {
    const c = await makeCourier();
    await goOnline(c, ONE_KM);
    await goOnline(c, FIVE_KM);
    const rows = await prisma().courierPresence.findMany({ where: { userId: c.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(FIVE_KM.lat, 4);

    const res = await SELF.fetch("http://local.test/api/me/presence", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${c.token}` },
    });
    expect(res.status).toBe(200);
    expect(await prisma().courierPresence.count({ where: { userId: c.user.id } })).toBe(0);
  });

  it("reads as offline once the app has gone quiet, without anyone going offline", async () => {
    const c = await makeCourier();
    await goOnline(c, ONE_KM);
    await prisma().courierPresence.update({
      where: { userId: c.user.id },
      data: { seenAt: new Date(Date.now() - (PRESENCE_TTL_MINUTES + 1) * MINUTE) },
    });
    const res = await apiGet("/api/me/presence", c.token);
    expect(res.body.online).toBe(false);

    const run = await advanceRankedOffers();
    expect(run.swept).toBeGreaterThanOrEqual(1);
    expect(await prisma().courierPresence.count({ where: { userId: c.user.id } })).toBe(0);
  });
});

describe("ranking an order", () => {
  it("asks the nearest qualified online courier first, and tells them", async () => {
    const near = await makeCourier();
    const mid = await makeCourier();
    await goOnline(mid, FIVE_KM);
    await goOnline(near, ONE_KM);

    const d = await offeredOrder();
    expect(rankedIds(d)).toEqual([near.user.id, mid.user.id]);
    expect(d.rankedNotified).toBe(1);

    const told = await prisma().notification.findMany({ where: { userId: near.user.id } });
    expect(told.some((n: any) => JSON.parse(n.data ?? "{}").deliveryId === d.id)).toBe(true);
    const notYet = await prisma().notification.findMany({ where: { userId: mid.user.id } });
    expect(notYet.some((n: any) => JSON.parse(n.data ?? "{}").deliveryId === d.id)).toBe(false);
  });

  it("leaves out the offline, the unqualified and the too far", async () => {
    const good = await makeCourier();
    const offline = await makeCourier();
    const unqualified = await makeCourier({ tiers: "" });
    const far = await makeCourier();
    await goOnline(good, ONE_KM);
    await goOnline(unqualified, ONE_KM);
    await goOnline(far, BEYOND_CAP);
    void offline;

    const d = await offeredOrder();
    expect(rankedIds(d)).toEqual([good.user.id]);
  });

  it("goes straight to the open board when nobody is online", async () => {
    const d = await offeredOrder();
    expect(rankedIds(d)).toEqual([]);

    const c = await makeCourier();
    const claim = await apiPost(`/api/deliveries/${d.id}/claim`, ONE_KM, c.token);
    expect(claim.status).toBe(201);
  });
});

describe("taking a ranked order", () => {
  it("lets only the courier whose turn it is take it", async () => {
    const first = await makeCourier();
    const second = await makeCourier();
    await goOnline(first, ONE_KM);
    await goOnline(second, FIVE_KM);
    const d = await offeredOrder();

    const early = await apiPost(`/api/deliveries/${d.id}/claim`, ONE_KM, second.token);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("RANKED_TURN");
    expect(early.body.opensToYouInMinutes).toBe(2);

    // Your turn is yours wherever you are standing: you were chosen for where
    // you went online, and the circle is for everyone else.
    const taken = await apiPost(`/api/deliveries/${d.id}/claim`, FIVE_KM, first.token);
    expect(taken.status).toBe(201);
  });

  it("shows the holder a countdown and everyone else a reason", async () => {
    const first = await makeCourier();
    const other = await makeCourier();
    await goOnline(first, ONE_KM);
    const d = await offeredOrder();

    const mine = await apiGet(`/api/me/delivery-offers?lat=${ONE_KM.lat}&lng=${ONE_KM.lng}`, first.token);
    const offer = mine.body.offers.find((o: any) => o.id === d.id);
    expect(offer.claimable).toBe(true);
    expect(offer.yourTurnSecondsLeft).toBeGreaterThan(100);
    expect(offer.offer.stage).toBe("RANKED");

    const theirs = await apiGet(`/api/me/delivery-offers?lat=${ONE_KM.lat}&lng=${ONE_KM.lng}`, other.token);
    const seen = theirs.body.offers.find((o: any) => o.id === d.id);
    expect(seen.claimable).toBe(false);
    expect(seen.yourTurnSecondsLeft).toBeNull();
    expect(seen.reason).toMatch(/best-placed couriers first/);
  });

  it("passes to the next courier when the window runs out, and tells them once", async () => {
    const first = await makeCourier();
    const second = await makeCourier();
    await goOnline(first, ONE_KM);
    await goOnline(second, FIVE_KM);
    const d = await offeredOrder();

    await waited(d.id, 2.5);
    const run = await advanceRankedOffers();
    expect(run.notified).toBeGreaterThanOrEqual(1);
    const again = await advanceRankedOffers();
    expect(again.notified).toBe(0);

    const after = await prisma().delivery.findUnique({ where: { id: d.id } });
    expect(after.rankedNotified).toBe(2);
    const told = await prisma().notification.findMany({ where: { userId: second.user.id } });
    expect(told.filter((n: any) => JSON.parse(n.data ?? "{}").deliveryId === d.id)).toHaveLength(1);

    const late = await apiPost(`/api/deliveries/${d.id}/claim`, ONE_KM, first.token);
    expect(late.status).toBe(409);
    const taken = await apiPost(`/api/deliveries/${d.id}/claim`, FIVE_KM, second.token);
    expect(taken.status).toBe(201);
  });

  it("opens to everyone in range once every turn has passed", async () => {
    const ranked = await makeCourier();
    const latecomer = await makeCourier();
    await goOnline(ranked, ONE_KM);
    const d = await offeredOrder();

    await waited(d.id, 2.5);
    const claim = await apiPost(`/api/deliveries/${d.id}/claim`, ONE_KM, latecomer.token);
    expect(claim.status).toBe(201);
  });

  it("hands it to the next courier the moment the holder passes, and tells them", async () => {
    const first = await makeCourier();
    const second = await makeCourier();
    await goOnline(first, ONE_KM);
    await goOnline(second, FIVE_KM);
    const d = await offeredOrder();

    const passed = await apiPost(`/api/deliveries/${d.id}/pass`, {}, first.token);
    expect(passed.status).toBe(200);

    const after = await prisma().delivery.findUnique({ where: { id: d.id } });
    expect(after.rankedNotified).toBe(2);
    const told = await prisma().notification.findMany({ where: { userId: second.user.id } });
    expect(told.filter((n: any) => JSON.parse(n.data ?? "{}").deliveryId === d.id)).toHaveLength(1);

    // Passing is final for the ranked phase: it is the next courier's now.
    const changed = await apiPost(`/api/deliveries/${d.id}/claim`, ONE_KM, first.token);
    expect(changed.status).toBe(409);
    const offers = await apiGet(`/api/me/delivery-offers?lat=${FIVE_KM.lat}&lng=${FIVE_KM.lng}`, second.token);
    expect(offers.body.offers.find((o: any) => o.id === d.id).yourTurnSecondsLeft).toBeGreaterThan(100);
    const taken = await apiPost(`/api/deliveries/${d.id}/claim`, FIVE_KM, second.token);
    expect(taken.status).toBe(201);
  });

  it("only lets the courier whose turn it is pass", async () => {
    const first = await makeCourier();
    const second = await makeCourier();
    await goOnline(first, ONE_KM);
    await goOnline(second, FIVE_KM);
    const d = await offeredOrder();

    const res = await apiPost(`/api/deliveries/${d.id}/pass`, {}, second.token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_YOUR_TURN");
    const after = await prisma().delivery.findUnique({ where: { id: d.id } });
    expect(after.rankedSkippedSeconds).toBe(0);
  });

  it("opens the board to everyone in range when the last candidate passes", async () => {
    const ranked = await makeCourier();
    const latecomer = await makeCourier();
    await goOnline(ranked, ONE_KM);
    const d = await offeredOrder();

    const passed = await apiPost(`/api/deliveries/${d.id}/pass`, {}, ranked.token);
    expect(passed.status).toBe(200);
    const claim = await apiPost(`/api/deliveries/${d.id}/claim`, ONE_KM, latecomer.token);
    expect(claim.status).toBe(201);
  });

  it("is ranked afresh when re-opened, without the courier who dropped it", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const dropper = await makeCourier();
    const next = await makeCourier();
    await goOnline(dropper, ONE_KM);
    await goOnline(next, FIVE_KM);
    const d = await offeredOrder();

    const taken = await apiPost(`/api/deliveries/${d.id}/claim`, ONE_KM, dropper.token);
    expect(taken.status).toBe(201);

    const reopened = await apiPost(`/api/admin/deliveries/${d.id}/reopen`, {}, admin.token);
    expect(reopened.status).toBe(200);

    const after = await prisma().delivery.findUnique({ where: { id: d.id } });
    expect(rankedIds(after)).toEqual([next.user.id]);
    expect(after.rankedNotified).toBe(1);

    const claim = await apiPost(`/api/deliveries/${d.id}/claim`, FIVE_KM, next.token);
    expect(claim.status).toBe(201);
  });
});
