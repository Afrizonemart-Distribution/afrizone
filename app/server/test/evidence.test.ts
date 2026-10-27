// Proof-of-work photos (Blueprint §14, services/evidence.ts).
//
// Five properties, and every test below is one of them:
//
//   A MISSING PHOTO REFUSES THE STEP; A DOUBTFUL ONE IS FLAGGED. Collecting,
//   completing, clocking, handing in and filing an audit each need their
//   photo. Where the photo was taken, how good the fix was and how old it is
//   are written down for a reviewer and never block anybody.
//
//   ONLY THE ASSIGNED WORKER MAY SEND ONE, AND ONLY FOR A STEP THE JOB HAS.
//
//   ONLY THE WORKER AND STAFF MAY SEE ONE. A door photo shows where a customer
//   lives.
//
//   A CLOCK PHOTO IS FRESH AND SINGLE-USE. The first day's clock-in photo
//   cannot clock somebody in for the rest of the month.
//
//   A DOOR PHOTO IS DELETED WITH THE REST OF THE CUSTOMER'S DATA (§5).
//
// And signatures, which sit beside the photos at every handover - the shop at
// pickup, the customer at the door, the store manager on an audit, the site
// contact on field work - and go through the same checks, the same switch and,
// at the door, the same purge.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "crypto";
import { SELF } from "cloudflare:test";
import { apiGet, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { checkEvidence, required, signatureRequired, type Site } from "../src/services/evidence";
import { purgeCustomerData, RETENTION_DAYS } from "../src/services/deliveryPurge";
import { SYSTEM_ACTORS } from "../src/util/audit";

const prisma = () => testPrisma() as any;
const SECRET = "local-dev-mart-inbound-secret";

// Allen Avenue, Ikeja - the shop.
const SHOP = { lat: 6.6018, lng: 3.3515 };
// Opebi Road - the customer's door in the order payload below.
const DOOR = { lat: 6.5921, lng: 3.3489 };
// About 2 km south of the shop.
const AWAY = { lat: 6.5838, lng: 3.3515 };

// A one-pixel PNG: the upload decides the type from these bytes.
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function setEnforce(on: boolean) {
  await prisma().setting.upsert({
    where: { key: "evidence.enforce" },
    create: { key: "evidence.enforce", value: on ? "on" : "off" },
    update: { value: on ? "on" : "off" },
  });
}

beforeAll(async () => {
  // Couriers get the DISPATCH tier; the credential gate has its own tests.
  await prisma().setting.upsert({
    where: { key: "eligibility.enforce" },
    create: { key: "eligibility.enforce", value: "off" },
    update: { value: "off" },
  });
});
beforeEach(async () => {
  await setEnforce(true);
});

async function sendPhoto(
  token: string,
  fields: { taskId: string; stage: string; at?: { lat: number; lng: number } | null; accuracy?: number; capturedAt?: Date | null },
  bytes: Uint8Array = PNG
) {
  const form = new FormData();
  form.set("taskId", fields.taskId);
  form.set("stage", fields.stage);
  if (fields.at) {
    form.set("lat", String(fields.at.lat));
    form.set("lng", String(fields.at.lng));
  }
  if (fields.accuracy != null) form.set("accuracy", String(fields.accuracy));
  const captured = fields.capturedAt === undefined ? new Date() : fields.capturedAt;
  if (captured) form.set("capturedAt", captured.toISOString());
  form.set("file", new File([bytes], "photo.png", { type: "image/png" }));
  const res = await SELF.fetch("http://local.test/api/me/evidence", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}

// A tick, drawn on a 300x150 pad.
const TICK = "M10 80 L60 130 L290 20";

async function sendSignature(
  token: string,
  fields: { taskId: string; stage: string; signerName?: string; path?: string; at?: { lat: number; lng: number } | null }
) {
  const at = fields.at === undefined ? SHOP : fields.at;
  return apiPost(
    "/api/me/evidence/signature",
    {
      taskId: fields.taskId,
      stage: fields.stage,
      signerName: fields.signerName ?? "Bola Ade",
      path: fields.path ?? TICK,
      width: 300,
      height: 150,
      ...(at ? { lat: at.lat, lng: at.lng, accuracy: 10 } : {}),
      capturedAt: new Date().toISOString(),
    },
    token
  );
}

let seq = 0;
function uid(p: string) {
  seq += 1;
  return `${p}-${seq}-${Date.now()}`;
}

/** A task with a worker assigned to it, the way approval leaves one. */
async function assignedTask(over: Record<string, unknown>) {
  const admin = await createUserWithToken("SUPER_ADMIN");
  const worker = await createUserWithToken("WORKER");
  const task = await prisma().task.create({
    data: {
      title: uid("Evidence task"),
      description: "x",
      category: "Field",
      tier: "STUDENT",
      payModel: "FIXED",
      budget: 10000,
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 864e5),
      locationType: "PHYSICAL",
      lat: SHOP.lat,
      lng: SHOP.lng,
      geofenceRadius: 100,
      slots: 1,
      status: "FILLED",
      deadline: new Date(Date.now() + 7 * 864e5),
      createdById: admin.user.id,
      ...over,
    },
  });
  await prisma().application.create({ data: { taskId: task.id, workerId: worker.user.id, status: "APPROVED" } });
  await prisma().contract.create({ data: { taskId: task.id, workerId: worker.user.id, status: "CLAIMED" } });
  return { admin, worker, task };
}

/** A delivery a courier has claimed, end to end through the real routes. */
async function claimedDelivery() {
  const store = await prisma().organization.create({
    data: { kind: "STORE", name: uid("Shop"), slug: uid("shop"), status: "ACTIVE", lat: SHOP.lat, lng: SHOP.lng },
  });
  const martOrderId = uid("AZM");
  const body = JSON.stringify({
    eventId: uid("evt"),
    type: "order.confirmed",
    occurredAt: new Date().toISOString(),
    data: {
      martOrderId,
      fulfilment: { storeSlug: store.slug, stockSource: "OWN_STOCK" },
      items: [{ ref: "SKU-1", name: "Rice 5kg", qty: 1 }],
      dropoff: { address: "14 Opebi Road, Ikeja", lat: DOOR.lat, lng: DOOR.lng },
      customer: { displayName: "Ada O.", phone: "+2348030000123" },
      money: { goodsTotal: 12000, deliveryFee: 1500 },
      expectedBy: new Date(Date.now() + 2 * 3600e3).toISOString(),
    },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  await SELF.fetch("http://local.test/api/integrations/mart/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Afz-Timestamp": ts, "X-Afz-Signature": sig },
    body,
  });
  const owner = await createUserWithToken("WORKER");
  await prisma().organizationMember.create({ data: { organizationId: store.id, userId: owner.user.id, role: "OWNER" } });
  const pending = await prisma().delivery.findUnique({ where: { martOrderId } });
  await apiPost(`/api/deliveries/${pending.id}/accept`, {}, owner.token);

  const courier = await createUserWithToken("WORKER");
  await prisma().user.update({
    where: { id: courier.user.id },
    data: { tiers: "DISPATCH", kycStatus: "VERIFIED", accountType: "COURIER" },
  });
  const claim = await apiPost(`/api/deliveries/${pending.id}/claim`, SHOP, courier.token);
  expect(claim.status).toBe(201);
  const delivery = await prisma().delivery.findUnique({ where: { martOrderId } });
  return { delivery, courier };
}

// ── What each kind of work needs ─────────────────────────────────────────────

describe("what each kind of work asks for", () => {
  const t = (kind: string, payModel = "FIXED", locationType = "PHYSICAL") => ({ kind, payModel, locationType });

  it("asks a delivery for the shop and the door, and nothing else", () => {
    expect(required(t("DELIVERY"), "PICKUP")).toBe(1);
    expect(required(t("DELIVERY"), "DROPOFF")).toBe(1);
    expect(required(t("DELIVERY", "HOURLY"), "CLOCK_IN")).toBe(0);
  });

  it("asks an audit for three photos of the premises", () => {
    expect(required(t("STORE_AUDIT"), "AUDIT")).toBe(3);
  });

  it("asks field and media work for the result", () => {
    expect(required(t("MEDIA", "FIXED", "REMOTE"), "WORK")).toBe(1);
    expect(required(t("SOURCING"), "WORK")).toBe(1);
    expect(required(t("SOURCING", "FIXED", "REMOTE"), "WORK")).toBe(0);
    expect(required(t("GENERAL"), "WORK")).toBe(0);
  });

  it("asks hourly on-site work for a photo each way, and remote work for none", () => {
    expect(required(t("GENERAL", "HOURLY"), "CLOCK_IN")).toBe(1);
    expect(required(t("GENERAL", "HOURLY"), "CLOCK_OUT")).toBe(1);
    expect(required(t("GENERAL", "HOURLY", "REMOTE"), "CLOCK_IN")).toBe(0);
    expect(required(t("GENERAL", "FIXED"), "CLOCK_IN")).toBe(0);
  });

  it("asks for a signature at every handover, and not to clock in or out", () => {
    expect(signatureRequired(t("DELIVERY"), "PICKUP")).toBe(true);
    expect(signatureRequired(t("DELIVERY"), "DROPOFF")).toBe(true);
    expect(signatureRequired(t("STORE_AUDIT"), "AUDIT")).toBe(true);
    expect(signatureRequired(t("MEDIA", "FIXED", "REMOTE"), "WORK")).toBe(true);
    expect(signatureRequired(t("GENERAL", "HOURLY"), "CLOCK_IN")).toBe(false);
    expect(signatureRequired(t("GENERAL"), "WORK")).toBe(false);
  });
});

describe("the checks a photo goes through", () => {
  const site: Site = { ...SHOP, toleranceMetres: 250, name: "the shop" };
  const now = new Date("2026-10-09T12:00:00Z");

  it("passes a photo taken at the site, just now, with a good fix", () => {
    const r = checkEvidence({ ...SHOP, accuracyMetres: 12, capturedAt: now }, site, now);
    expect(r.flags).toEqual([]);
    expect(r.distanceMetres).toBe(0);
  });

  it("says how far away a photo was taken, in words", () => {
    const r = checkEvidence({ ...AWAY, accuracyMetres: 12, capturedAt: now }, site, now);
    expect(r.flags).toEqual([expect.stringMatching(/^Taken 2\.\d km from the shop$/)]);
  });

  it("flags a missing position, a poor fix, an old photo and a wrong clock", () => {
    expect(checkEvidence({ lat: null, lng: null, accuracyMetres: null, capturedAt: now }, site, now).flags).toEqual([
      "No location with the photo",
    ]);
    expect(checkEvidence({ ...SHOP, accuracyMetres: 400, capturedAt: now }, site, now).flags[0]).toMatch(/accurate to about/);
    const old = new Date(now.getTime() - 40 * 60_000);
    expect(checkEvidence({ ...SHOP, accuracyMetres: 10, capturedAt: old }, site, now).flags).toEqual([
      "Taken 40 min before it was sent",
    ]);
    const ahead = new Date(now.getTime() + 20 * 60_000);
    expect(checkEvidence({ ...SHOP, accuracyMetres: 10, capturedAt: ahead }, site, now).flags[0]).toMatch(/clock is ahead/);
  });

  it("does not invent a distance when there is no site to measure from", () => {
    const r = checkEvidence({ ...AWAY, accuracyMetres: 10, capturedAt: now }, null, now);
    expect(r.flags).toEqual([]);
    expect(r.distanceMetres).toBeNull();
  });
});

// ── Sending one ──────────────────────────────────────────────────────────────

describe("sending a photo", () => {
  it("accepts it from the assigned worker and checks it on arrival", async () => {
    const { worker, task } = await assignedTask({ kind: "STORE_AUDIT" });
    const res = await sendPhoto(worker.token, { taskId: task.id, stage: "AUDIT", at: AWAY, accuracy: 10 });
    expect(res.status).toBe(201);
    expect(res.body.flagged).toBe(true);
    expect(res.body.flags[0]).toMatch(/from the store$/);
    expect(res.body.url).toBe(`/api/evidence/${res.body.id}/file`);
  });

  it("refuses somebody who is not on the job", async () => {
    const { task } = await assignedTask({ kind: "STORE_AUDIT" });
    const stranger = await createUserWithToken("WORKER");
    const res = await sendPhoto(stranger.token, { taskId: task.id, stage: "AUDIT", at: SHOP });
    expect(res.status).toBe(403);
  });

  it("refuses a photo for a step the job does not have", async () => {
    const { worker, task } = await assignedTask({ kind: "STORE_AUDIT" });
    const res = await sendPhoto(worker.token, { taskId: task.id, stage: "DROPOFF", at: SHOP });
    expect(res.status).toBe(400);
  });

  it("refuses something that is not a photo, whatever it calls itself", async () => {
    const { worker, task } = await assignedTask({ kind: "STORE_AUDIT" });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const res = await sendPhoto(worker.token, { taskId: task.id, stage: "AUDIT", at: SHOP }, svg);
    expect(res.status).toBe(400);
  });
});

describe("who may see a photo", () => {
  it("shows it to the worker who took it and to staff, and to nobody else", async () => {
    const { worker, task, admin } = await assignedTask({ kind: "STORE_AUDIT" });
    const sent = await sendPhoto(worker.token, { taskId: task.id, stage: "AUDIT", at: SHOP });
    const get = (token: string) =>
      SELF.fetch(`http://local.test${sent.body.url}`, { headers: { Authorization: `Bearer ${token}` } });

    const mine = await get(worker.token);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG);

    expect((await get(admin.token)).status).toBe(200);
    const other = await createUserWithToken("WORKER");
    expect((await get(other.token)).status).toBe(404);
  });

  it("lists a job's photos with what the job still asks for", async () => {
    const { worker, task, admin } = await assignedTask({ kind: "STORE_AUDIT" });
    await sendPhoto(worker.token, { taskId: task.id, stage: "AUDIT", at: SHOP });

    const mine = await apiGet(`/api/me/evidence?taskId=${task.id}`, worker.token);
    expect(mine.body.requirements).toEqual([expect.objectContaining({ stage: "AUDIT", count: 3, have: 1 })]);

    const staff = await apiGet(`/api/admin/evidence?taskId=${task.id}`, admin.token);
    expect(staff.body.evidence).toHaveLength(1);
    expect((await apiGet(`/api/admin/evidence?taskId=${task.id}`, worker.token)).status).toBe(403);
  });
});

describe("taking a signature", () => {
  it("accepts one from the assigned worker, with the signer's name, and checks it on arrival", async () => {
    const { worker, task } = await assignedTask({ kind: "STORE_AUDIT" });
    const res = await sendSignature(worker.token, { taskId: task.id, stage: "AUDIT", at: AWAY });
    expect(res.status).toBe(201);
    expect(res.body.signerName).toBe("Bola Ade");
    expect(res.body.path).toBe(TICK);
    expect(res.body.flags[0]).toMatch(/^Signed 2\.\d km from the store$/);
  });

  it("needs the signer's name and an actual drawing", async () => {
    const { worker, task } = await assignedTask({ kind: "STORE_AUDIT" });
    expect((await sendSignature(worker.token, { taskId: task.id, stage: "AUDIT", signerName: "  " })).status).toBe(400);
    expect((await sendSignature(worker.token, { taskId: task.id, stage: "AUDIT", path: "" })).status).toBe(400);
  });

  it("refuses anything but path data, so it is safe to draw for a reviewer", async () => {
    const { worker, task } = await assignedTask({ kind: "STORE_AUDIT" });
    const res = await sendSignature(worker.token, {
      taskId: task.id,
      stage: "AUDIT",
      path: 'M0 0"/><script>alert(1)</script>',
    });
    expect(res.status).toBe(400);
  });

  it("refuses a stranger and a step that takes no signature", async () => {
    const { worker, task } = await assignedTask({ kind: "GENERAL", payModel: "HOURLY", rate: 2000, budget: null });
    expect((await sendSignature(worker.token, { taskId: task.id, stage: "CLOCK_IN" })).status).toBe(400);
    const stranger = await createUserWithToken("WORKER");
    const audit = await assignedTask({ kind: "STORE_AUDIT" });
    expect((await sendSignature(stranger.token, { taskId: audit.task.id, stage: "AUDIT" })).status).toBe(403);
  });

  it("keeps one per step: signing again replaces it", async () => {
    const { worker, task, admin } = await assignedTask({ kind: "STORE_AUDIT" });
    await sendSignature(worker.token, { taskId: task.id, stage: "AUDIT", signerName: "First try" });
    await sendSignature(worker.token, { taskId: task.id, stage: "AUDIT", signerName: "Second try" });

    const mine = await apiGet(`/api/me/evidence?taskId=${task.id}`, worker.token);
    expect(mine.body.requirements).toEqual([expect.objectContaining({ stage: "AUDIT", signature: true, signed: true })]);
    expect(mine.body.signatures.map((s: any) => s.signerName)).toEqual(["Second try"]);

    const staff = await apiGet(`/api/admin/evidence?taskId=${task.id}`, admin.token);
    expect(staff.body.signatures).toHaveLength(1);
  });
});

// ── The gates ────────────────────────────────────────────────────────────────

describe("the steps that need a photo", () => {
  it("will not mark a delivery collected without a photo at the shop", async () => {
    const { delivery, courier } = await claimedDelivery();
    const bare = await apiPost(`/api/deliveries/${delivery.id}/picked-up`, {}, courier.token);
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe("EVIDENCE_REQUIRED");
    expect(bare.body.stage).toBe("PICKUP");

    const photo = await sendPhoto(courier.token, { taskId: delivery.taskId, stage: "PICKUP", at: SHOP });
    expect(photo.body.flags).toEqual([]);

    // The photo shows the goods; the signature shows the shop handed them over.
    const unsigned = await apiPost(`/api/deliveries/${delivery.id}/picked-up`, {}, courier.token);
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.code).toBe("SIGNATURE_REQUIRED");
    expect(unsigned.body.stage).toBe("PICKUP");

    await sendSignature(courier.token, { taskId: delivery.taskId, stage: "PICKUP" });
    const ok = await apiPost(`/api/deliveries/${delivery.id}/picked-up`, {}, courier.token);
    expect(ok.status).toBe(200);
  });

  it("asks for the door photo before the customer's code is spent", async () => {
    const { delivery, courier } = await claimedDelivery();
    await sendPhoto(courier.token, { taskId: delivery.taskId, stage: "PICKUP", at: SHOP });
    await sendSignature(courier.token, { taskId: delivery.taskId, stage: "PICKUP" });
    await apiPost(`/api/deliveries/${delivery.id}/picked-up`, {}, courier.token);

    const bare = await apiPost(`/api/deliveries/${delivery.id}/complete`, { code: "123456" }, courier.token);
    expect(bare.status).toBe(400);
    expect(bare.body.stage).toBe("DROPOFF");
    // Nothing was asked of Mart: the attempt count is untouched.
    const after = await prisma().delivery.findUnique({ where: { id: delivery.id } });
    expect(after.status).toBe("PICKED_UP");

    // The customer signs before the code is spent too.
    await sendPhoto(courier.token, { taskId: delivery.taskId, stage: "DROPOFF", at: DOOR });
    const unsigned = await apiPost(`/api/deliveries/${delivery.id}/complete`, { code: "123456" }, courier.token);
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.code).toBe("SIGNATURE_REQUIRED");
    expect(unsigned.body.stage).toBe("DROPOFF");
  });

  it("will not file an audit with fewer than three photos", async () => {
    const { worker, task } = await assignedTask({ kind: "STORE_AUDIT", organizationId: (await prisma().organization.create({ data: { kind: "STORE", name: uid("A"), slug: uid("a") } })).id });
    await sendPhoto(worker.token, { taskId: task.id, stage: "AUDIT", at: SHOP });
    const short = await apiPost("/api/me/audits", { taskId: task.id, score: 80 }, worker.token);
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/2 more photos/);

    await sendPhoto(worker.token, { taskId: task.id, stage: "AUDIT", at: SHOP });
    await sendPhoto(worker.token, { taskId: task.id, stage: "AUDIT", at: SHOP });
    const unsigned = await apiPost("/api/me/audits", { taskId: task.id, score: 80 }, worker.token);
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.code).toBe("SIGNATURE_REQUIRED");

    await sendSignature(worker.token, { taskId: task.id, stage: "AUDIT", signerName: "Store manager" });
    const filed = await apiPost("/api/me/audits", { taskId: task.id, score: 80 }, worker.token);
    expect(filed.status).toBe(201);
  });

  it("will not take field work in without a photo of the result", async () => {
    const { worker, task } = await assignedTask({ kind: "MEDIA" });
    const sheet = { taskId: task.id, periodStart: new Date().toISOString(), periodEnd: new Date().toISOString(), hours: 1 };
    expect((await apiPost("/api/timesheets", sheet, worker.token)).status).toBe(400);
    await sendPhoto(worker.token, { taskId: task.id, stage: "WORK", at: SHOP });
    expect((await apiPost("/api/timesheets", sheet, worker.token)).body.code).toBe("SIGNATURE_REQUIRED");
    await sendSignature(worker.token, { taskId: task.id, stage: "WORK" });
    expect((await apiPost("/api/timesheets", sheet, worker.token)).status).toBe(201);
  });

  it("clocks hourly on-site work with a fresh photo, once", async () => {
    const { worker, task } = await assignedTask({ kind: "GENERAL", payModel: "HOURLY", rate: 2000, budget: null });
    const bare = await apiPost("/api/clock", { taskId: task.id, type: "IN", ...SHOP }, worker.token);
    expect(bare.status).toBe(400);
    expect(bare.body.stage).toBe("CLOCK_IN");

    const photo = await sendPhoto(worker.token, { taskId: task.id, stage: "CLOCK_IN", at: SHOP });
    const inn = await apiPost("/api/clock", { taskId: task.id, type: "IN", ...SHOP, evidenceId: photo.body.id }, worker.token);
    expect(inn.status).toBe(201);

    // The same photo cannot be used again, in either direction.
    const again = await apiPost("/api/clock", { taskId: task.id, type: "IN", ...SHOP, evidenceId: photo.body.id }, worker.token);
    expect(again.status).toBe(400);
    const outWithIn = await apiPost("/api/clock", { taskId: task.id, type: "OUT", ...SHOP, evidenceId: photo.body.id }, worker.token);
    expect(outWithIn.status).toBe(400);
  });

  it("can be switched off in one row, for the day a camera bug stops everyone", async () => {
    const { delivery, courier } = await claimedDelivery();
    await setEnforce(false);
    const res = await apiPost(`/api/deliveries/${delivery.id}/picked-up`, {}, courier.token);
    expect(res.status).toBe(200);
  });
});

// ── Retention ────────────────────────────────────────────────────────────────

describe("door photos and the customer-data promise", () => {
  it("deletes the door photo with the address, and keeps the shop photo", async () => {
    const { delivery, courier } = await claimedDelivery();
    await sendPhoto(courier.token, { taskId: delivery.taskId, stage: "PICKUP", at: SHOP });
    await sendPhoto(courier.token, { taskId: delivery.taskId, stage: "DROPOFF", at: DOOR });
    await sendSignature(courier.token, { taskId: delivery.taskId, stage: "PICKUP" });
    await sendSignature(courier.token, { taskId: delivery.taskId, stage: "DROPOFF", signerName: "Ada O.", at: DOOR });

    const when = new Date(Date.now() - (RETENTION_DAYS + 1) * 864e5);
    await prisma().$executeRawUnsafe(
      `UPDATE "Delivery" SET "status" = ?, "updatedAt" = ? WHERE "id" = ?`,
      "DELIVERED",
      when.toISOString(),
      delivery.id
    );
    await purgeCustomerData(SYSTEM_ACTORS.deliveryPurge);

    const left = await prisma().evidence.findMany({ where: { taskId: delivery.taskId } });
    expect(left.map((e: any) => e.stage)).toEqual(["PICKUP"]);
    // The customer's signature carries their name and goes with the rest.
    const signed = await prisma().signature.findMany({ where: { taskId: delivery.taskId } });
    expect(signed.map((s: any) => s.stage)).toEqual(["PICKUP"]);
  });
});
