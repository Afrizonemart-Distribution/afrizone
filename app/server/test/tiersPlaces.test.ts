// Tiers an admin adds, the countries Part Time works in (Nigeria live, the
// rest of Africa coming soon), and the dashboard that counts them.
import { describe, expect, it } from "vitest";
import { apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

function task(over: Record<string, unknown> = {}) {
  return {
    title: "Shelf check",
    description: "Count the shelves",
    category: "Audits",
    tier: "PROMO",
    payModel: "HOURLY",
    rate: 1500,
    ...over,
  };
}

describe("tiers", () => {
  it("lists the built-ins and lets a Super Admin add one that tasks can use", async () => {
    const { token: sa } = await createUserWithToken("SUPER_ADMIN");
    const { token: worker } = await createUserWithToken("WORKER");

    const list = await apiGet("/api/reference/tiers", worker);
    expect(list.status).toBe(200);
    expect(list.body.map((t: any) => t.key)).toEqual(expect.arrayContaining(["STUDENT", "DISPATCH", "REMOTE", "PROMO", "TRADE"]));

    expect((await apiPost("/api/reference/tiers", { label: "Field Sales" }, worker)).status).toBe(403);
    const made = await apiPost("/api/reference/tiers", { label: `Field Sales ${Date.now()}` }, sa);
    expect(made.status).toBe(201);
    expect(made.body.key).toMatch(/^FIELD_SALES_\d+$/);

    expect((await apiPost("/api/tasks", task({ tier: made.body.key }), sa)).status).toBe(201);
    expect((await apiPost("/api/tasks", task({ tier: "NOT_A_TIER" }), sa)).status).toBe(400);

    // Switched off: no new work in it, and it drops off the public list.
    expect((await apiPatch(`/api/reference/tiers/${made.body.key}`, { active: false }, sa)).status).toBe(200);
    expect((await apiPost("/api/tasks", task({ tier: made.body.key }), sa)).status).toBe(400);
    const after = await apiGet("/api/reference/tiers", worker);
    expect(after.body.some((t: any) => t.key === made.body.key)).toBe(false);
  });
});

describe("places", () => {
  it("is open in Nigeria and coming soon elsewhere", async () => {
    const places = await apiGet("/api/reference/places");
    expect(places.status).toBe(200);
    const ng = places.body.countries.find((c: any) => c.code === "NG");
    const gh = places.body.countries.find((c: any) => c.code === "GH");
    expect(ng.live).toBe(true);
    expect(gh.live).toBe(false);
    expect(places.body.countries).toHaveLength(54);
    expect(places.body.states.NG).toContain("Lagos");
    expect(places.body.states.NG).toContain("FCT (Abuja)");
    expect(places.body.states.NG).toHaveLength(37);
  });

  it("only takes tasks in a live country and a real state", async () => {
    const { token: sa } = await createUserWithToken("SUPER_ADMIN");
    const ok = await apiPost("/api/tasks", task({ country: "NG", state: "Kano" }), sa);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ country: "NG", state: "Kano" });

    const soon = await apiPost("/api/tasks", task({ country: "KE", state: "Nairobi" }), sa);
    expect(soon.status).toBe(400);
    expect(soon.body.error).toContain("coming soon");
    expect((await apiPost("/api/tasks", task({ state: "Atlantis" }), sa)).status).toBe(400);
  });

  it("lets a Super Admin switch a country on", async () => {
    const { token: sa } = await createUserWithToken("SUPER_ADMIN");
    const { token: hr } = await createUserWithToken("HR_ADMIN");
    expect((await apiPatch("/api/reference/countries/SN", { live: true }, hr)).status).toBe(403);
    const r = await apiPatch("/api/reference/countries/SN", { live: true }, sa);
    expect(r.body.live).toBe(true);
    await testPrisma().country.update({ where: { code: "SN" }, data: { live: false } });
  });

  it("saves where a Partimer lives", async () => {
    const { user, token } = await createUserWithToken("WORKER");
    expect((await apiPatch("/api/me", { state: "Oyo" }, token)).status).toBe(200);
    expect((await testPrisma().user.findUnique({ where: { id: user.id } }))!.state).toBe("Oyo");
    expect((await apiPatch("/api/me", { country: "GH", state: "Accra" }, token)).status).toBe(400);
  });
});

describe("dashboard", () => {
  it("counts Partimers, tasks and money, and says where it is live", async () => {
    const { token: sa } = await createUserWithToken("SUPER_ADMIN");
    const { user } = await createUserWithToken("WORKER");
    await testPrisma().user.update({ where: { id: user.id }, data: { state: "Lagos" } });

    const r = await apiGet("/api/dashboard/stats", sa);
    expect(r.status).toBe(200);
    expect(r.body.liveIn).toContain("Nigeria");
    expect(r.body.partimers.total).toBeGreaterThan(0);
    expect(r.body.partimersByState.some((s: any) => s.state === "Lagos")).toBe(true);
    expect(r.body.money).toEqual(
      expect.objectContaining({ earnedThisMonth: expect.any(Number), owedToPartimers: expect.any(Number) })
    );
    expect(Array.isArray(r.body.attention)).toBe(true);

    const { token: worker } = await createUserWithToken("WORKER");
    expect((await apiGet("/api/dashboard/stats", worker)).status).toBe(403);
  });
});
