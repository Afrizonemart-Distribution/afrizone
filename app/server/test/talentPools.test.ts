// Talent pools and the two new job-alert audiences: POOL (one pool HR keeps)
// and TOP (the career ladder's first invite, Silver and Gold standing only).
import { describe, it, expect } from "vitest";
import { apiDelete, apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken } from "./helpers";

let n = 0;

async function job(token: string) {
  n += 1;
  const r = await apiPost(
    "/api/jobs",
    {
      title: `Pool driver ${Date.now()}-${n}`,
      department: "Logistics",
      location: "Lagos",
      employmentType: "FULL_TIME",
      description: "Drive",
      needsCv: false,
    },
    token
  );
  expect(r.status).toBe(201);
  return r.body;
}

describe("talent pools", () => {
  it("HR builds a pool, only workers join, and a job alert reaches just that pool", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    const a = await createUserWithToken("WORKER");
    const b = await createUserWithToken("WORKER");
    const outsider = await createUserWithToken("WORKER");
    const staff = await createUserWithToken("TASK_MANAGER");

    // Workers can't see or make pools.
    expect((await apiGet("/api/talent-pools", a.token)).status).toBe(403);

    const name = `Lagos drivers ${Date.now()}`;
    const pool = await apiPost("/api/talent-pools", { name: `  ${name}  `, note: "Verified" }, hr.token);
    expect(pool.status).toBe(201);
    expect(pool.body.name).toBe(name);
    expect((await apiPost("/api/talent-pools", { name }, hr.token)).body.code).toBe("NAME_TAKEN");

    const add = await apiPost(
      `/api/talent-pools/${pool.body.id}/members`,
      { userIds: [a.user.id, b.user.id, staff.user.id, a.user.id] },
      hr.token
    );
    expect(add.body).toEqual({ added: 2, skipped: 1 });
    expect((await apiPost(`/api/talent-pools/${pool.body.id}/members`, { userIds: [a.user.id] }, hr.token)).body.added).toBe(0);

    const detail = await apiGet(`/api/talent-pools/${pool.body.id}`, hr.token);
    expect(detail.body.members.map((m: any) => m.userId).sort()).toEqual([a.user.id, b.user.id].sort());
    expect(detail.body.members[0].standing.level).toBe("NEW");

    const list = await apiGet("/api/talent-pools", hr.token);
    expect(list.body.find((p: any) => p.id === pool.body.id).memberCount).toBe(2);

    const j = await job(hr.token);
    expect((await apiGet(`/api/jobs/${j.id}/alerts?audience=POOL`, hr.token)).body.code).toBe("POOL_REQUIRED");
    const preview = await apiGet(`/api/jobs/${j.id}/alerts?audience=POOL&poolId=${pool.body.id}`, hr.token);
    expect(preview.body.preview.people).toBe(2);
    const sent = await apiPost(`/api/jobs/${j.id}/alerts`, { audience: "POOL", poolId: pool.body.id }, hr.token);
    expect(sent.status).toBe(202);
    expect(sent.body.people).toBe(2);

    // Removing a member, renaming, deleting.
    expect((await apiDelete(`/api/talent-pools/${pool.body.id}/members/${b.user.id}`, hr.token)).status).toBe(204);
    expect((await apiDelete(`/api/talent-pools/${pool.body.id}/members/${outsider.user.id}`, hr.token)).status).toBe(404);
    expect((await apiPatch(`/api/talent-pools/${pool.body.id}`, { name: `${name} 2` }, hr.token)).body.name).toBe(`${name} 2`);
    expect((await apiDelete(`/api/talent-pools/${pool.body.id}`, hr.token)).status).toBe(204);
    expect((await apiGet(`/api/talent-pools/${pool.body.id}`, hr.token)).status).toBe(404);
  });

  it("TOP leaves out workers below Silver", async () => {
    const hr = await createUserWithToken("HR_ADMIN");
    await createUserWithToken("WORKER");
    const j = await job(hr.token);
    const preview = await apiGet(`/api/jobs/${j.id}/alerts?audience=TOP`, hr.token);
    expect(preview.status).toBe(200);
    expect(preview.body.audience).toBe("TOP");
    expect(preview.body.preview.people).toBe(0);
  });
});
