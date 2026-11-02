// Offline-tolerant clocking (Blueprint §16, services/clockTime.ts).
//
//   THE PHONE'S TIME COUNTS WHEN IT IS BELIEVABLE. A clock-out made in a
//   basement and sent an hour later is recorded at the time it was tapped,
//   and marked so the manager can see it.
//
//   NOT WHEN IT IS NOT. In the future, over a day old, or before the previous
//   event: the arrival time is used instead, still marked.
//
//   A RESEND IS NOT A SECOND EVENT. The same clientId twice records once.
import { describe, it, expect, beforeAll } from "vitest";
import { apiGet, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { clockTime, MAX_AGE_HOURS } from "../src/services/clockTime";

const prisma = () => testPrisma() as any;

beforeAll(async () => {
  await prisma().setting.upsert({
    where: { key: "evidence.enforce" },
    create: { key: "evidence.enforce", value: "off" },
    update: { value: "off" },
  });
});

async function assigned() {
  const admin = await createUserWithToken("SUPER_ADMIN");
  const task = await apiPost(
    "/api/tasks",
    { title: "Stock count", description: "Count the Yaba warehouse", category: "Logistics", tier: "STUDENT", payModel: "HOURLY", rate: 1200, slots: 1 },
    admin.token
  );
  const worker = await createUserWithToken("WORKER");
  await prisma().application.create({ data: { taskId: task.body.id, workerId: worker.user.id, status: "APPROVED" } });
  return { taskId: task.body.id as string, worker, admin };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe("clockTime", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const at = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  it("uses server time for an ordinary tap and for none at all", () => {
    expect(clockTime(at(0.5), now, null)).toEqual({ at: now, offline: false, adjusted: false });
    expect(clockTime(undefined, now, null)).toEqual({ at: now, offline: false, adjusted: false });
  });

  it("believes a late arrival within the day, after the last event", () => {
    const r = clockTime(at(90), now, new Date(at(200)));
    expect(r).toMatchObject({ offline: true, adjusted: false });
    expect(r.at.toISOString()).toBe(at(90));
  });

  it("disbelieves a time too old, before the last event, or in the future", () => {
    expect(clockTime(at(MAX_AGE_HOURS * 60 + 5), now, null)).toEqual({ at: now, offline: true, adjusted: true });
    expect(clockTime(at(90), now, new Date(at(30)))).toEqual({ at: now, offline: true, adjusted: true });
    expect(clockTime(at(-30), now, null)).toEqual({ at: now, offline: false, adjusted: true });
  });
});

describe("POST /api/clock from a phone that was offline", () => {
  it("records the tapped time, marks it, and shows it on the timesheet", async () => {
    const { taskId, worker, admin } = await assigned();
    const clockIn = await apiPost(
      "/api/clock",
      { taskId, type: "IN", occurredAt: ago(180), clientId: "in-0001-offline" },
      worker.token
    );
    expect(clockIn.status).toBe(201);
    expect(clockIn.body.event.recordedOffline).toBe(true);
    expect(clockIn.body.elapsedSeconds).toBeGreaterThan(179 * 60);

    const clockOut = await apiPost(
      "/api/clock",
      { taskId, type: "OUT", occurredAt: ago(60), clientId: "out-0001-offline" },
      worker.token
    );
    expect(clockOut.status).toBe(201);
    // Two hours worked, not three: the clock-out counts from when it was tapped.
    expect(Math.round(clockOut.body.elapsedSeconds / 60)).toBe(120);

    const sheet = await apiPost(
      "/api/timesheets",
      { taskId, periodStart: ago(181), periodEnd: ago(59), hours: 2 },
      worker.token
    );
    expect(sheet.status).toBe(201);
    const list = await apiGet("/api/timesheets?status=SUBMITTED", admin.token);
    const mine = list.body.find((t: any) => t.id === sheet.body.id);
    expect(mine.clock).toEqual({ events: 2, offline: 2, outsideFence: 0 });
  });

  it("records a resent event once", async () => {
    const { taskId, worker } = await assigned();
    const body = { taskId, type: "IN", occurredAt: ago(10), clientId: "in-0002-resend" };
    const first = await apiPost("/api/clock", body, worker.token);
    const again = await apiPost("/api/clock", body, worker.token);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.event.id).toBe(first.body.event.id);
    expect(await prisma().clockEvent.count({ where: { taskId } })).toBe(1);
  });

  it("uses arrival time for a phone time before the previous event", async () => {
    const { taskId, worker } = await assigned();
    await apiPost("/api/clock", { taskId, type: "IN", occurredAt: ago(30), clientId: "in-0003-order" }, worker.token);
    const out = await apiPost(
      "/api/clock",
      { taskId, type: "OUT", occurredAt: ago(120), clientId: "out-0003-order" },
      worker.token
    );
    expect(out.status).toBe(201);
    expect(out.body.event.recordedOffline).toBe(true);
    expect(Date.now() - new Date(out.body.event.createdAt).getTime()).toBeLessThan(60_000);
  });
});
