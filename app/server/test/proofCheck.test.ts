// Checks on proof photos (services/proofCheck.ts): the same file sent again,
// and the AI look. Both only flag a photo for the reviewer. The model isn't
// called here: the sweep is driven with a stand-in, so what is tested is which
// photos are looked at, that each is looked at once, and what lands on it.
import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { createUserWithToken, testPrisma } from "./helpers";
import { repeatFlag, checkDueProofPhotos, PROOF_CHECK_KEY } from "../src/services/proofCheck";
import { proofBrief, proofFlags } from "../src/services/ai";

const prisma = () => testPrisma() as any;
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

beforeAll(async () => {
  await prisma().setting.upsert({
    where: { key: "eligibility.enforce" },
    create: { key: "eligibility.enforce", value: "off" },
    update: { value: "off" },
  });
});

async function auditTask() {
  const admin = await createUserWithToken("SUPER_ADMIN");
  const worker = await createUserWithToken("WORKER");
  const task = await prisma().task.create({
    data: {
      title: uid("Shelf audit"),
      description: "Photograph the drinks shelf",
      acceptanceCriteria: JSON.stringify(["Whole shelf in view"]),
      category: "Field",
      tier: "STUDENT",
      payModel: "FIXED",
      budget: 10000,
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 864e5),
      locationType: "REMOTE",
      slots: 1,
      status: "FILLED",
      kind: "STORE_AUDIT",
      deadline: new Date(Date.now() + 7 * 864e5),
      createdById: admin.user.id,
    },
  });
  await prisma().application.create({ data: { taskId: task.id, workerId: worker.user.id, status: "APPROVED" } });
  await prisma().contract.create({ data: { taskId: task.id, workerId: worker.user.id, status: "CLAIMED" } });
  return { worker, task };
}

async function send(token: string, taskId: string, bytes: Uint8Array) {
  const form = new FormData();
  form.set("taskId", taskId);
  form.set("stage", "AUDIT");
  form.set("capturedAt", new Date().toISOString());
  form.set("file", new File([bytes], "p.png", { type: "image/png" }));
  const res = await SELF.fetch("http://local.test/api/me/evidence", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("checks on proof photos", () => {
  it("names the most telling earlier copy, and turns an AI answer into marked flags", () => {
    const me = { taskId: "t1", workerId: "w1" };
    expect(repeatFlag([], me)).toBeNull();
    expect(repeatFlag([{ taskId: "t1", workerId: "w1" }], me)).toBe("Same photo as one already sent for this job");
    expect(repeatFlag([{ taskId: "t2", workerId: "w1" }], me)).toBe("Same photo as one already sent for another job");
    expect(
      repeatFlag([{ taskId: "t2", workerId: "w1" }, { taskId: "t3", workerId: "w9" }], me)
    ).toBe("Same photo as one another worker sent");

    expect(proofFlags({ shows_the_work: "yes", concerns: [] })).toEqual({ verdict: "OK", flags: [] });
    expect(proofFlags({ shows_the_work: "no", concerns: [] }).flags).toEqual(["AI: The photo doesn't seem to show this work"]);
    const many = proofFlags({ shows_the_work: "yes", concerns: [" Photo of a screen ", "", "a", "b", "c"] });
    expect(many).toEqual({ verdict: "DOUBT", flags: ["AI: Photo of a screen", "AI: a", "AI: b"] });

    const brief = proofBrief({ title: "Shelf audit", description: "Drinks", criteria: ["Whole shelf"], stageLabel: "The store audit" });
    expect(brief).toContain("- Whole shelf");
  });

  it("flags the same file sent by another worker, and still accepts it", async () => {
    const a = await auditTask();
    const b = await auditTask();
    const bytes = Uint8Array.from([...PNG, ...new TextEncoder().encode(uid("#"))]);
    const first = await send(a.worker.token, a.task.id, bytes);
    expect(first.status).toBe(201);
    expect(first.body.flags).not.toContain("Same photo as one another worker sent");
    const again = await send(b.worker.token, b.task.id, bytes);
    expect(again.status).toBe(201);
    expect(again.body.flags).toContain("Same photo as one another worker sent");
  });
});

describe("the AI sweep", () => {
  it("looks at new work and audit photos once each, and adds what it finds to the flags", async () => {
    // Only the rows made here are due.
    await prisma().evidence.updateMany({ where: { aiCheckedAt: null }, data: { aiCheckedAt: new Date() } });
    const { worker, task } = await auditTask();
    const row = (stage: string, over: Record<string, unknown> = {}) =>
      prisma().evidence.create({
        data: {
          taskId: task.id,
          workerId: worker.user.id,
          stage,
          objectKey: uid("k"),
          contentType: "image/jpeg",
          sizeBytes: 1000,
          flags: JSON.stringify(["No location with the photo"]),
          ...over,
        },
      });
    const audit = await row("AUDIT");
    const door = await row("DROPOFF");
    const old = await row("WORK", { createdAt: new Date(Date.now() - 3 * 864e5) });

    const seen: string[] = [];
    const deps = {
      enabled: true,
      read: async () => ({ bytes: PNG, contentType: "image/jpeg" }),
      look: async (t: { title: string; criteria: string[] }) => {
        seen.push(t.title);
        expect(t.criteria).toEqual(["Whole shelf in view"]);
        return { shows_the_work: "unclear" as const, concerns: ["Photo of a screen, not the shelf"] };
      },
    };
    expect(await checkDueProofPhotos(prisma(), deps)).toEqual({ ok: 0, doubt: 1, failed: 0, skipped: 0 });
    expect(await checkDueProofPhotos(prisma(), deps)).toEqual({ ok: 0, doubt: 0, failed: 0, skipped: 0 });
    expect(seen).toEqual([task.title]);

    const after = await prisma().evidence.findUnique({ where: { id: audit.id } });
    expect(after.aiVerdict).toBe("DOUBT");
    expect(JSON.parse(after.flags)).toEqual(["No location with the photo", "AI: Photo of a screen, not the shelf"]);
    // A door photo is customer data and never sent; an old one is left alone.
    expect((await prisma().evidence.findUnique({ where: { id: door.id } })).aiCheckedAt).toBeNull();
    expect((await prisma().evidence.findUnique({ where: { id: old.id } })).aiCheckedAt).toBeNull();
  });

  it("does nothing with no key or when switched off, and a failed look is not retried", async () => {
    await prisma().evidence.updateMany({ where: { aiCheckedAt: null }, data: { aiCheckedAt: new Date() } });
    const { worker, task } = await auditTask();
    const ev = await prisma().evidence.create({
      data: { taskId: task.id, workerId: worker.user.id, stage: "WORK", objectKey: uid("k"), contentType: "image/png", sizeBytes: 10 },
    });
    let calls = 0;
    const failing = {
      read: async () => ({ bytes: PNG, contentType: "image/png" }),
      look: async (): Promise<never> => {
        calls++;
        throw new Error("down");
      },
    };
    expect(await checkDueProofPhotos(prisma(), { ...failing, enabled: false })).toEqual({ ok: 0, doubt: 0, failed: 0, skipped: 0 });

    await prisma().setting.upsert({ where: { key: PROOF_CHECK_KEY }, create: { key: PROOF_CHECK_KEY, value: "off" }, update: { value: "off" } });
    expect((await checkDueProofPhotos(prisma(), { ...failing, enabled: true })).failed).toBe(0);
    await prisma().setting.delete({ where: { key: PROOF_CHECK_KEY } });

    expect((await checkDueProofPhotos(prisma(), { ...failing, enabled: true })).failed).toBe(1);
    expect((await checkDueProofPhotos(prisma(), { ...failing, enabled: true })).failed).toBe(0);
    expect(calls).toBe(1);
    const after = await prisma().evidence.findUnique({ where: { id: ev.id } });
    expect(after.aiVerdict).toBe("FAILED");
    expect(after.flags).toBeNull();
  });
});
