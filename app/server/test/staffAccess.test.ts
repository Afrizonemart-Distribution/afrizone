import { describe, it, expect } from "vitest";
import { apiGet, apiPatch, apiPost } from "./http";
import { testPrisma, createUserWithToken } from "./helpers";

/**
 * Staff access (2026-11-25): a Part-Time admin adds, changes and removes
 * Part-Time staff. No Afrizonemart account involved.
 *
 * Kept to a few D1 flows per file: the suite hangs past roughly five.
 */

let n = 0;
const email = (p: string) => `${p}-${Date.now()}-${++n}@example.com`;

describe("Staff access", () => {
  it("only an admin manages staff; an added person shows on the list with a role", async () => {
    const { token: admin } = await createUserWithToken("SUPER_ADMIN");
    const { token: tm } = await createUserWithToken("TASK_MANAGER");
    expect((await apiGet("/api/admin/staff", tm)).status).toBe(403);

    const added = await apiPost("/api/admin/staff", { name: "Kemi", email: email("kemi"), role: "HR_ADMIN" }, admin);
    expect(added.status).toBe(201);
    expect(added.body.member).toMatchObject({ name: "Kemi", role: "HR_ADMIN", canSignIn: false });
    expect(added.body.member.passwordHash).toBeUndefined();

    const list = await apiGet("/api/admin/staff", admin);
    expect(list.body.staff.some((s: any) => s.id === added.body.member.id)).toBe(true);
    expect((await apiPost("/api/admin/staff", { name: "Bad", email: email("bad"), role: "WORKER" }, admin)).status).toBe(400);
  });

  it("a Partimer's email can't become a staff account", async () => {
    const { token: admin } = await createUserWithToken("SUPER_ADMIN");
    const { user: partimer } = await createUserWithToken("WORKER");
    const res = await apiPost("/api/admin/staff", { name: "P", email: partimer.email, role: "TASK_MANAGER" }, admin);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PARTIMER_EMAIL");
  });

  it("nobody changes themselves, and removal ends console access at once", async () => {
    const { user: me, token: admin } = await createUserWithToken("SUPER_ADMIN");
    const { user: other, token: otherToken } = await createUserWithToken("TASK_MANAGER");
    expect((await apiPatch(`/api/admin/staff/${me.id}`, { role: "HR_ADMIN" }, admin)).body.code).toBe("SELF");
    expect((await apiPost(`/api/admin/staff/${me.id}/remove`, {}, admin)).body.code).toBe("SELF");

    expect((await apiPatch(`/api/admin/staff/${other.id}`, { role: "HR_ADMIN" }, admin)).body.member.role).toBe("HR_ADMIN");
    expect((await apiGet("/api/dashboard/stats", otherToken)).status).toBe(200);

    expect((await apiPost(`/api/admin/staff/${other.id}/remove`, {}, admin)).status).toBe(200);
    const row = await testPrisma().user.findUnique({ where: { id: other.id } });
    expect(row).toMatchObject({ role: "REMOVED", passwordHash: null, googleId: null });
    // Their week-long session token still says HR_ADMIN; the live role wins.
    expect((await apiGet("/api/dashboard/stats", otherToken)).status).toBe(403);
  });

  it("a removed person can be added back, and starts with a fresh sign-in link", async () => {
    const { token: admin } = await createUserWithToken("SUPER_ADMIN");
    const addr = email("back");
    const first = await apiPost("/api/admin/staff", { name: "Tunde", email: addr, role: "TASK_MANAGER" }, admin);
    await apiPost(`/api/admin/staff/${first.body.member.id}/remove`, {}, admin);
    expect((await apiGet("/api/admin/staff", admin)).body.staff.some((s: any) => s.id === first.body.member.id)).toBe(false);
    const again = await apiPost("/api/admin/staff", { name: "Tunde", email: addr, role: "HR_ADMIN" }, admin);
    expect(again.status).toBe(201);
    expect(again.body.member).toMatchObject({ id: first.body.member.id, role: "HR_ADMIN" });
  });
});
