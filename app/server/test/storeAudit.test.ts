// Store premises audits (Blueprint §8).
//
// The property worth protecting here is that an audit is real, gated work. An
// inspection task anybody could claim is worse than no inspection at all: it
// produces a document that looks like verification and is not one. So most of
// this file is about who can claim it, who can file a finding against it, and
// what happens when the credential that gates it is missing.
import { describe, it, expect, beforeAll } from "vitest";
import { apiGet, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

const prisma = () => testPrisma() as any;

// Proof-of-work photos have their own tests in evidence.test.ts. These are
// about scoring and outcomes, so the photo gate is switched off rather than every test here
// uploading a picture first.
beforeAll(async () => {
  await (testPrisma() as any).setting.upsert({
    where: { key: "evidence.enforce" },
    create: { key: "evidence.enforce", value: "off" },
    update: { value: "off" },
  });
});


let seq = 0;

async function auditorCredentialType() {
  const existing = await prisma().credentialType.findUnique({
    where: { slug: "auditor-accreditation" },
  });
  if (existing) return existing;
  return prisma().credentialType.create({
    data: {
      name: "Auditor accreditation",
      slug: "auditor-accreditation",
      reviewMode: "ADMIN_REVIEW",
      issuerMode: "AFRIZONE",
      requiresExpiry: false,
      requiresReference: false,
      requiresFile: false,
      active: true,
    },
  });
}

async function makeOrg(status = "PENDING", address: string | null = "12 Allen Ave, Ikeja") {
  seq += 1;
  return prisma().organization.create({
    data: {
      kind: "STORE",
      name: `Audit Shop ${seq}`,
      slug: `audit-shop-${seq}-${Date.now()}`,
      status,
      address,
      lat: address ? 6.6018 : null,
      lng: address ? 3.3515 : null,
    },
  });
}

describe("raising an audit", () => {
  it("creates an inspection task gated on the auditor credential", async () => {
    await auditorCredentialType();
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");

    const res = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);

    const task = await prisma().task.findUnique({ where: { id: res.body.taskId } });
    expect(task.kind).toBe("STORE_AUDIT");
    expect(task.organizationId).toBe(org.id);
    // It goes to the store, so it carries the store's location.
    expect(task.address).toBe(org.address);
    expect(task.requiresIdentityVerified).toBe(true);

    // Blueprint §3.1: "a store audit requires a verified auditor credential".
    const reqs = await prisma().taskCredentialRequirement.findMany({
      where: { taskId: task.id },
      include: { credentialType: true },
    });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].credentialType.slug).toBe("auditor-accreditation");
  });

  it("does not send two auditors to the same shop", async () => {
    await auditorCredentialType();
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");

    const first = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    const second = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);

    // Idempotent by intent, not by constraint: a duplicate here is two people
    // travelling, which is a real cost rather than a tidy-database concern.
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.taskId).toBe(first.body.taskId);

    const tasks = await prisma().task.findMany({
      where: { kind: "STORE_AUDIT", organizationId: org.id },
    });
    expect(tasks).toHaveLength(1);
  });

  it("refuses to audit a store that is already approved", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("ACTIVE");
    const res = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    // Re-checking a live store is a recurring compliance cycle, which is a
    // different thing and is not this.
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("already approved");
  });

  it("refuses to send somebody to a place with no address", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING", null);
    const res = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("address");
  });

  it("records loudly when there is no credential to gate it with", async () => {
    // Deliberately remove the gate, which is the dangerous configuration: an
    // ungated audit task can be claimed by anybody and produces a document that
    // looks like verification.
    await prisma().taskCredentialRequirement.deleteMany({});
    await prisma().credentialType.deleteMany({ where: { slug: "auditor-accreditation" } });

    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");
    const res = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    expect(res.status).toBe(201);

    const warning = await prisma().auditLog.findFirst({
      where: { action: "store.audit.ungated", entityId: res.body.taskId },
    });
    // It still creates the task - refusing would block store onboarding on a
    // catalogue entry - but it must not do so silently.
    expect(warning).not.toBeNull();
  });

  it("keeps audit-raising away from store members and workers", async () => {
    const org = await makeOrg("PENDING");
    const worker = await createUserWithToken("WORKER");
    const res = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, worker.token);
    expect(res.status).toBe(403);
  });
});

describe("filing a finding", () => {
  async function assignedAuditor(org: any) {
    const task = await prisma().task.findFirst({
      where: { kind: "STORE_AUDIT", organizationId: org.id },
    });
    const auditor = await createUserWithToken("WORKER");
    await prisma().application.create({
      data: { taskId: task.id, workerId: auditor.user.id, status: "APPROVED" },
    });
    return { task, auditor };
  }

  it("scores the premises and decides the outcome against the pass mark", async () => {
    await auditorCredentialType();
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");
    await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    const { task, auditor } = await assignedAuditor(org);

    const res = await apiPost(
      "/api/me/audits",
      { taskId: task.id, score: 82, notes: "Cold chain in order" },
      auditor.token
    );
    expect(res.status).toBe(201);
    expect(res.body.score).toBe(82);
    expect(res.body.outcome).toBe("PASS");
  });

  it("fails a store below the mark", async () => {
    await auditorCredentialType();
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");
    await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    const { task, auditor } = await assignedAuditor(org);

    const res = await apiPost("/api/me/audits", { taskId: task.id, score: 41 }, auditor.token);
    expect(res.body.outcome).toBe("FAIL");
  });

  it("stores the outcome rather than deriving it later", async () => {
    await auditorCredentialType();
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");
    await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    const { task, auditor } = await assignedAuditor(org);
    await apiPost("/api/me/audits", { taskId: task.id, score: 75 }, auditor.token);

    // Move the policy. An old audit must still say what it meant when it was
    // made - a threshold change should not silently rewrite history.
    await prisma().setting.upsert({
      where: { key: "audit.passMark" },
      update: { value: "90" },
      create: { key: "audit.passMark", value: "90" },
    });
    const row = await prisma().storeAudit.findFirst({ where: { organizationId: org.id } });
    expect(row.outcome).toBe("PASS");
    await prisma().setting.deleteMany({ where: { key: "audit.passMark" } });
  });

  it("refuses a finding from somebody who was never sent", async () => {
    await auditorCredentialType();
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");
    const raised = await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    const outsider = await createUserWithToken("WORKER");

    const res = await apiPost(
      "/api/me/audits",
      { taskId: raised.body.taskId, score: 95 },
      outsider.token
    );
    // An inspection report from somebody who was never dispatched is not
    // evidence of anything.
    expect([403, 404]).toContain(res.status);
  });

  it("refuses a finding filed against a task that is not an audit", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    seq += 1;
    const ordinary = await prisma().task.create({
      data: {
        title: `Not an audit ${seq}`,
        description: "x",
        category: "Logistics",
        tier: "DISPATCH",
        payModel: "FIXED",
        budget: 5000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 864e5),
        locationType: "PHYSICAL",
        slots: 1,
        status: "OPEN",
        deadline: new Date(Date.now() + 864e5),
        createdById: admin.user.id,
      },
    });
    const worker = await createUserWithToken("WORKER");
    await prisma().application.create({
      data: { taskId: ordinary.id, workerId: worker.user.id, status: "APPROVED" },
    });

    const res = await apiPost("/api/me/audits", { taskId: ordinary.id, score: 90 }, worker.token);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not a store audit");
  });

  it("rejects a score outside 0-100", async () => {
    await auditorCredentialType();
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");
    await apiPost(`/api/admin/organizations/${org.id}/audit`, {}, admin.token);
    const { task, auditor } = await assignedAuditor(org);

    for (const bad of [-1, 101, 55.5, "high"]) {
      const res = await apiPost("/api/me/audits", { taskId: task.id, score: bad }, auditor.token);
      expect(res.status).toBe(400);
    }
  });
});

describe("what the approver sees", () => {
  it("carries the latest finding on the store record", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");

    let detail = await apiGet(`/api/admin/organizations/${org.id}`, admin.token);
    expect(detail.body.latestAudit).toBeNull();

    await apiPost(
      `/api/admin/organizations/${org.id}/audit-result`,
      { score: 88, notes: "Good storage" },
      admin.token
    );

    detail = await apiGet(`/api/admin/organizations/${org.id}`, admin.token);
    // Approving a store is a decision made ON the record. Having to look the
    // finding up elsewhere is how it ends up not being looked at.
    expect(detail.body.latestAudit.score).toBe(88);
    expect(detail.body.latestAudit.outcome).toBe("PASS");
    expect(detail.body.latestAudit.notes).toBe("Good storage");
  });

  it("shows the most recent of several", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const org = await makeOrg("PENDING");
    await apiPost(`/api/admin/organizations/${org.id}/audit-result`, { score: 30 }, admin.token);
    await new Promise((r) => setTimeout(r, 15));
    await apiPost(`/api/admin/organizations/${org.id}/audit-result`, { score: 91 }, admin.token);

    const detail = await apiGet(`/api/admin/organizations/${org.id}`, admin.token);
    // A re-audit after remedial work is the normal case, and the old failure
    // must not be what an approver reads.
    expect(detail.body.latestAudit.score).toBe(91);
  });
});

describe("the audit results screen", () => {
  /** A filed audit with its task, and whatever proof the auditor left on it. */
  async function filedAudit(opts: { score: number; outcome: "PASS" | "FAIL"; photos?: number; flagged?: boolean; signed?: boolean }) {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const auditor = await createUserWithToken("WORKER");
    const org = await makeOrg("PENDING");
    const task = await prisma().task.create({
      data: {
        title: `Audit ${org.name}`,
        description: "x",
        category: "Field",
        tier: "STUDENT",
        kind: "STORE_AUDIT",
        payModel: "FIXED",
        budget: 5000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 864e5),
        locationType: "PHYSICAL",
        slots: 1,
        status: "FILLED",
        deadline: new Date(Date.now() + 864e5),
        createdById: admin.user.id,
        organizationId: org.id,
      },
    });
    for (let i = 0; i < (opts.photos ?? 0); i++) {
      await prisma().evidence.create({
        data: {
          taskId: task.id,
          workerId: auditor.user.id,
          stage: "AUDIT",
          objectKey: `${task.id}/${auditor.user.id}/${i}-${Date.now()}.png`,
          contentType: "image/png",
          sizeBytes: 10,
          flags: JSON.stringify(opts.flagged && i === 0 ? ["Taken 2.1 km from the store"] : []),
        },
      });
    }
    if (opts.signed) {
      await prisma().signature.create({
        data: { taskId: task.id, workerId: auditor.user.id, stage: "AUDIT", signerName: "Manager", path: "M0 0 L1 1", width: 300, height: 150 },
      });
    }
    const audit = await prisma().storeAudit.create({
      data: { organizationId: org.id, taskId: task.id, auditorId: auditor.user.id, score: opts.score, outcome: opts.outcome, notes: "Shelves dusty" },
    });
    return { admin, org, task, auditor, audit };
  }

  it("lists every finding newest first, with the store, the auditor and what they left behind", async () => {
    const first = await filedAudit({ score: 82, outcome: "PASS", photos: 3, signed: true });
    const second = await filedAudit({ score: 40, outcome: "FAIL", photos: 3, flagged: true });

    const res = await apiGet("/api/admin/audits", second.admin.token);
    expect(res.status).toBe(200);
    const ids = res.body.audits.map((a: any) => a.id);
    expect(ids.indexOf(second.audit.id)).toBeLessThan(ids.indexOf(first.audit.id));

    const row = res.body.audits.find((a: any) => a.id === second.audit.id);
    expect(row).toMatchObject({
      score: 40,
      outcome: "FAIL",
      notes: "Shelves dusty",
      organization: { id: second.org.id, name: second.org.name, status: "PENDING" },
      auditor: { id: second.auditor.user.id },
      taskId: second.task.id,
      proof: { photos: 3, signed: false, flagged: 1 },
    });
    const passed = res.body.audits.find((a: any) => a.id === first.audit.id);
    expect(passed.proof).toEqual({ photos: 3, signed: true, flagged: 0 });
  });

  it("filters to passes or failures", async () => {
    const { admin } = await filedAudit({ score: 30, outcome: "FAIL" });
    const res = await apiGet("/api/admin/audits?outcome=FAIL", admin.token);
    expect(res.body.audits.length).toBeGreaterThan(0);
    expect(res.body.audits.every((a: any) => a.outcome === "FAIL")).toBe(true);
    expect(res.body.counts.FAIL).toBeGreaterThan(0);
  });

  it("is for staff", async () => {
    const worker = await createUserWithToken("WORKER");
    expect((await apiGet("/api/admin/audits", worker.token)).status).toBe(403);
  });
});
