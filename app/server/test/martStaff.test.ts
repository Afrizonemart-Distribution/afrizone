import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { apiGet, apiPost } from "./http";
import { testPrisma, createUserWithToken } from "./helpers";
import { parseStaffRoles, planRoleChanges } from "../src/services/martStaffSync";

/**
 * Staff roles follow Afrizonemart (2026-11-17): AfriZone sign-in applies a
 * role Afrizonemart vouches for only when that session passed 2FA, the sync
 * plan has brakes, and requireRole reads the live role.
 *
 * Kept to four D1 flows: the suite hangs past roughly five per file.
 */

function identityToken(claims: Record<string, unknown>) {
  return jwt.sign(
    { email: null, email_verified: false, name: null, phone_number: null, phone_number_verified: false, country: "NG", mfa_enabled: true, ...claims },
    (env as any).TEST_AFRIZONE_PRIVATE_KEY,
    { algorithm: "ES256", issuer: "afrizonemart", audience: "parttime", expiresIn: 300, jwtid: randomUUID() }
  );
}

let n = 0;
const uniq = () => `${Date.now()}${++n}`;

describe("planRoleChanges (pure)", () => {
  const boss = { id: "boss", afrizoneUserId: "az-boss", role: "SUPER_ADMIN" };
  it("promotes, demotes and leaves unlinked staff alone", () => {
    const users = [
      boss,
      { id: "w1", afrizoneUserId: "az-w1", role: "WORKER" },
      { id: "hr", afrizoneUserId: "az-hr", role: "HR_ADMIN" },
      { id: "local", afrizoneUserId: null, role: "TASK_MANAGER" },
    ];
    const plan = planRoleChanges(users, [
      { afrizoneUserId: "az-boss", role: "SUPER_ADMIN" },
      { afrizoneUserId: "az-w1", role: "TASK_MANAGER" },
    ]);
    expect(plan.refused).toBeUndefined();
    expect(plan.changes).toEqual([
      { id: "w1", from: "WORKER", to: "TASK_MANAGER" },
      { id: "hr", from: "HR_ADMIN", to: "WORKER" },
    ]);
    expect(plan.unmanagedStaff).toBe(1);
  });
  it("refuses an empty list", () => {
    expect(planRoleChanges([boss], []).refused).toMatch(/empty/);
  });
  it("refuses a mass demotion", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, afrizoneUserId: `az-s${i}`, role: "HR_ADMIN" }));
    expect(planRoleChanges([boss, ...many], [{ afrizoneUserId: "az-boss", role: "SUPER_ADMIN" }]).refused).toMatch(/demote 6/);
  });
  it("refuses to leave no SUPER_ADMIN", () => {
    expect(planRoleChanges([boss], [{ afrizoneUserId: "az-other", role: "HR_ADMIN" }]).refused).toMatch(/no SUPER_ADMIN/);
  });
  it("rejects a malformed response rather than reading it as 'no staff'", () => {
    expect(parseStaffRoles({ staff: [{ afrizoneUserId: "x", role: "GOD" }] })).toBeNull();
    expect(parseStaffRoles({})).toBeNull();
    expect(parseStaffRoles({ staff: [{ afrizoneUserId: "x", role: "HR_ADMIN" }] })).toEqual([{ afrizoneUserId: "x", role: "HR_ADMIN" }]);
  });
});

describe("AfriZone sign-in with an Afrizonemart staff role", () => {
  it("applies the role when the AfriZone session passed 2FA", async () => {
    const sub = `azsub${uniq()}`;
    const res = await apiPost("/api/auth/afrizone", {
      identityToken: identityToken({ sub, email: `t-${uniq()}@example.com`, email_verified: true, amr: ["mfa"], parttime_role: "TASK_MANAGER" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("TASK_MANAGER");
    const row = await testPrisma().user.findUnique({ where: { afrizoneUserId: sub } });
    const audit = await testPrisma().auditLog.findFirst({ where: { entityId: row!.id, action: "STAFF_ROLE_FROM_AFRIZONEMART" } });
    expect(audit?.actorRef).toBe("afrizonemart");
  });

  it("ignores the role without 2FA, and still keeps linked staff on the console", async () => {
    const sub = `azsub${uniq()}`;
    const fresh = await apiPost("/api/auth/afrizone", {
      identityToken: identityToken({ sub, email: `p-${uniq()}@example.com`, email_verified: true, amr: [], parttime_role: "SUPER_ADMIN" }),
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body.user.role).toBe("WORKER");

    const { user } = await createUserWithToken("HR_ADMIN");
    const staffSub = `azsub${uniq()}`;
    await testPrisma().user.update({ where: { id: user.id }, data: { afrizoneUserId: staffSub } });
    const refused = await apiPost("/api/auth/afrizone", { identityToken: identityToken({ sub: staffSub, amr: [], parttime_role: "HR_ADMIN" }) });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("STAFF_USE_CONSOLE");
  });
});

describe("requireRole reads the live role", () => {
  it("a SUPER_ADMIN token stops working once the account is demoted", async () => {
    const { user, token } = await createUserWithToken("SUPER_ADMIN");
    expect((await apiGet("/api/admin/funding/balance", token)).status).not.toBe(403);
    await testPrisma().user.update({ where: { id: user.id }, data: { role: "WORKER" } });
    expect((await apiGet("/api/admin/funding/balance", token)).status).toBe(403);
  });
});
