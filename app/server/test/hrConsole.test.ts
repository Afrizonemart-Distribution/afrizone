// AZM HR Console: the AZM Staff side passes everything to afrizonemart as the
// signed-in person, and an AZM_HR account never reaches Part-Time data.
import { describe, it, expect, vi, afterEach } from "vitest";
import { SELF } from "cloudflare:test";
import { createUserWithToken, testPrisma } from "./helpers";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function mockMart(handler: (c: Call) => { status: number; body: unknown; type?: string }) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("http://mart.test/")) return real(input as any, init);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call = { url, method: init?.method ?? "GET", headers, body: init?.body as string | undefined };
    calls.push(call);
    const r = handler(call);
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status, headers: { "Content-Type": r.type ?? "application/json" } });
  });
  return calls;
}

const call = (path: string, token: string, init: RequestInit = {}) =>
  SELF.fetch(`http://local.test${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

async function linked(role: "SUPER_ADMIN" | "AZM_HR" | "WORKER", afz: string) {
  const u = await createUserWithToken(role);
  await testPrisma().user.update({ where: { id: u.user.id }, data: { afrizoneUserId: afz } });
  return u;
}

afterEach(() => vi.unstubAllGlobals());

describe("AZM HR Console", () => {
  it("passes HR calls to afrizonemart as the linked AfriZone account", async () => {
    const { token } = await linked("AZM_HR", "afz_hr_1");
    const calls = mockMart(() => ({ status: 200, body: { id: "afz_hr_1", caps: ["hr.view"] } }));
    const res = await call("/api/admin/hr/me", token);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://mart.test/api/integrations/parttime/hr/me");
    expect(calls[0].headers["authorization"]).toBe("Bearer azm_sk_test-hr-token");
    expect(calls[0].headers["x-afz-user"]).toBe("afz_hr_1");
  });

  it("forwards writes with their body and method", async () => {
    const { token } = await linked("SUPER_ADMIN", "afz_sa_1");
    const calls = mockMart(() => ({ status: 200, body: { ok: true } }));
    const res = await call("/api/admin/hr/people/u1/file?x=1", token, { method: "PUT", body: JSON.stringify({ grade: "L3" }) });
    expect(res.status).toBe(200);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe("http://mart.test/api/integrations/parttime/hr/people/u1/file?x=1");
    expect(JSON.parse(calls[0].body!)).toEqual({ grade: "L3" });
  });

  it("passes files through as bytes", async () => {
    const { token } = await linked("AZM_HR", "afz_hr_2");
    mockMart(() => ({ status: 200, body: "a,b\r\n1,2", type: "text/csv; charset=utf-8" }));
    const res = await call("/api/admin/hr/directory.csv", token);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(await res.text()).toBe("a,b\r\n1,2");
  });

  it("refuses an account not linked to AfriZone", async () => {
    const { token } = await createUserWithToken("SUPER_ADMIN");
    const calls = mockMart(() => ({ status: 200, body: {} }));
    const res = await call("/api/admin/hr/me", token);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("never proxies for a Partimer", async () => {
    const { token } = await linked("WORKER", "afz_w_1");
    const calls = mockMart(() => ({ status: 200, body: {} }));
    const res = await call("/api/admin/hr/me", token);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses path tricks", async () => {
    const { token } = await linked("AZM_HR", "afz_hr_3");
    const calls = mockMart(() => ({ status: 200, body: {} }));
    const res = await call("/api/admin/hr/..%2F..%2Fadmin%2Forders", token);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("fences AZM_HR out of every Part-Time route", async () => {
    const { token } = await linked("AZM_HR", "afz_hr_4");
    for (const path of ["/api/workers", "/api/tasks", "/api/payments", "/api/admin/withdrawals", "/api/dashboard"]) {
      const res = await call(path, token);
      expect(res.status, path).toBe(403);
      expect(((await res.json()) as any).code).toBe("AZM_HR_ONLY");
    }
    // Their own session still works.
    expect((await call("/api/auth/me", token)).status).toBe(200);
  });

  it("does not fence Part-Time admins", async () => {
    const { token } = await createUserWithToken("SUPER_ADMIN");
    expect((await call("/api/workers", token)).status).toBe(200);
  });

  it("sends the console's online signal for linked staff", async () => {
    const { token } = await linked("SUPER_ADMIN", "afz_sa_2");
    const calls = mockMart(() => ({ status: 200, body: { sessionId: "s1", activeSeconds: 0 } }));
    const res = await call("/api/admin/presence", token, { method: "POST", body: JSON.stringify({ idle: false, path: "/tasks" }) });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("http://mart.test/api/integrations/parttime/staff/presence");
    expect(calls[0].headers["authorization"]).toBe("Bearer azm_sk_test-staff-token");
    expect(JSON.parse(calls[0].body!)).toMatchObject({ idle: false, path: "/tasks" });
  });
});
