// The staff workspace: an AfriZone staff member signs in with their identity
// token and reads their afrizonemart tasks and KPI through a narrow proxy.
import { describe, it, expect, vi, afterEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { isAllowed } from "../src/routes/staffWorkspace";

function identityToken(sub: string) {
  return jwt.sign(
    { email: "ada@afrizonemart.com", email_verified: true, name: "Ada", mfa_enabled: true },
    (env as any).TEST_AFRIZONE_PRIVATE_KEY,
    { algorithm: "ES256", issuer: "afrizonemart", audience: "parttime", expiresIn: 300, jwtid: randomUUID(), subject: sub }
  );
}

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function mockMart(handler: (c: Call) => { status: number; body: unknown }) {
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
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

async function post(path: string, body: unknown, token?: string) {
  const res = await SELF.fetch(`http://local.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}
async function get(path: string, token?: string) {
  const res = await SELF.fetch(`http://local.test${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}

afterEach(() => vi.unstubAllGlobals());

describe("staff workspace", () => {
  it("only lets through the staff paths afrizonemart serves", () => {
    expect(isAllowed("GET", "tasks")).toBe(true);
    expect(isAllowed("POST", "tasks/abc123/submit")).toBe(true);
    expect(isAllowed("GET", "kpi/users/u_1")).toBe(true);
    expect(isAllowed("POST", "tasks")).toBe(false); // no creating tasks here
    expect(isAllowed("GET", "../admin/orders")).toBe(false);
    expect(isAllowed("DELETE", "tasks/abc")).toBe(false);
  });

  it("signs a staff member in and proxies as them", async () => {
    const calls = mockMart((c) =>
      c.url.endsWith("/staff/me")
        ? { status: 200, body: { id: "mart-u1", name: "Ada", monitor: false } }
        : { status: 200, body: { items: [{ id: "t1" }] } }
    );
    const s = await post("/api/staff/session", { identityToken: identityToken("mart-u1") });
    expect(s.status).toBe(200);
    expect(s.body.me.name).toBe("Ada");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer azm_sk_test-staff-token");
    expect(calls[0]!.headers["x-afz-user"]).toBe("mart-u1");

    const t = await get("/api/staff/tasks?scope=mine", s.body.token);
    expect(t.status).toBe(200);
    expect(t.body.items[0].id).toBe("t1");
    expect(calls[1]!.url).toBe("http://mart.test/api/integrations/parttime/staff/tasks?scope=mine");
    expect(calls[1]!.headers["x-afz-user"]).toBe("mart-u1");

    // Not an allowed path, and no session: never reaches afrizonemart.
    expect((await post("/api/staff/tasks", {}, s.body.token)).status).toBe(404);
    expect((await get("/api/staff/tasks")).status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it("refuses an account afrizonemart says isn't staff, and a replayed token", async () => {
    mockMart(() => ({ status: 403, body: { error: "Not a staff account" } }));
    const tok = identityToken("mart-customer");
    expect((await post("/api/staff/session", { identityToken: tok })).body.code).toBe("NOT_STAFF");
    expect((await post("/api/staff/session", { identityToken: tok })).status).toBe(401);
  });

  it("a staff session is not a Part Time session", async () => {
    mockMart(() => ({ status: 200, body: { id: "mart-u2", name: "Bo" } }));
    const s = await post("/api/staff/session", { identityToken: identityToken("mart-u2") });
    expect((await get("/api/me", s.body.token)).status).toBe(401);
  });
});
