import { describe, it, expect, vi } from "vitest";
import { apiGet, apiPost } from "./http";

describe("POST /api/auth/register", () => {
  it("creates a WORKER account and returns a token", async () => {
    const res = await apiPost("/api/auth/register", {
      name: "Jane Worker",
      email: `jane-${Date.now()}@afrizone.work`,
      password: "password123",
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user.role).toBe("WORKER");
    expect(res.body.user.kycStatus).toBe("PENDING");
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await apiPost("/api/auth/register", {
      name: "Short Pw",
      email: `short-${Date.now()}@afrizone.work`,
      password: "short1",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    const email = `dup-${Date.now()}@afrizone.work`;
    const payload = { name: "Dup User", email, password: "password123" };
    const first = await apiPost("/api/auth/register", payload);
    expect(first.status).toBe(200);
    const second = await apiPost("/api/auth/register", payload);
    expect(second.status).toBe(409);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and rejects a wrong password", async () => {
    const email = `login-${Date.now()}@afrizone.work`;
    await apiPost("/api/auth/register", { name: "Login User", email, password: "password123" });

    const ok = await apiPost("/api/auth/login", { email, password: "password123" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeDefined();

    const bad = await apiPost("/api/auth/login", { email, password: "wrongpass" });
    expect(bad.status).toBe(401);
  });

  it("rejects a login for an email that doesn't exist", async () => {
    const res = await apiPost("/api/auth/login", { email: "nobody@afrizone.work", password: "whatever1" });
    expect(res.status).toBe(401);
  });
});

describe("worker phone OTP", () => {
  it("requests then verifies an OTP for a brand new phone, auto-creating the worker", async () => {
    const phone = `+2347${Math.floor(10000000 + Math.random() * 89999999)}`;
    const reqRes = await apiPost("/api/auth/otp/request", { phone });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.devCode).toBeDefined(); // sim mode: SMS_PROVIDER unset

    const verifyRes = await apiPost("/api/auth/otp/verify", { phone, code: reqRes.body.devCode });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeDefined();
    expect(verifyRes.body.isNewUser).toBe(true);
  });

  it("rejects an incorrect OTP code", async () => {
    const phone = `+2347${Math.floor(10000000 + Math.random() * 89999999)}`;
    await apiPost("/api/auth/otp/request", { phone });
    const res = await apiPost("/api/auth/otp/verify", { phone, code: "000001" });
    expect(res.status).toBe(400);
  });
});

describe("password forgot/reset", () => {
  it("resets the password via a devToken and invalidates the old one", async () => {
    const email = `reset-${Date.now()}@afrizone.work`;
    await apiPost("/api/auth/register", { name: "Reset User", email, password: "password123" });

    const forgot = await apiPost("/api/auth/password/forgot", { email });
    expect(forgot.status).toBe(200);
    expect(forgot.body.devToken).toBeDefined();

    const reset = await apiPost("/api/auth/password/reset", {
      token: forgot.body.devToken,
      password: "newpassword456",
    });
    expect(reset.status).toBe(200);
    expect(reset.body.ok).toBe(true);

    const loginOld = await apiPost("/api/auth/login", { email, password: "password123" });
    expect(loginOld.status).toBe(401);

    const loginNew = await apiPost("/api/auth/login", { email, password: "newpassword456" });
    expect(loginNew.status).toBe(200);
  });

  it("never writes the reset token to the log", async () => {
    const email = `reset-log-${Date.now()}@afrizone.work`;
    await apiPost("/api/auth/register", { name: "Reset Log", email, password: "password123" });
    const lines: string[] = [];
    const spies = (["log", "error", "warn", "info"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      })
    );
    try {
      const forgot = await apiPost("/api/auth/password/forgot", { email });
      expect(forgot.body.devToken).toBeDefined();
      expect(lines.some((l) => l.includes(forgot.body.devToken))).toBe(false);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it("never reveals whether an email exists", async () => {
    const res = await apiPost("/api/auth/password/forgot", { email: "doesnotexist@afrizone.work" });
    expect(res.status).toBe(200);
    expect(res.body.devToken).toBeUndefined();
  });
});

describe("GET /api/auth/me", () => {
  it("requires a valid bearer token", async () => {
    const noAuth = await apiGet("/api/auth/me");
    expect(noAuth.status).toBe(401);

    const badAuth = await apiGet("/api/auth/me", "garbage");
    expect(badAuth.status).toBe(401);
  });

  it("returns the caller's own user with a valid token", async () => {
    const email = `me-${Date.now()}@afrizone.work`;
    const register = await apiPost("/api/auth/register", { name: "Me User", email, password: "password123" });

    const res = await apiGet("/api/auth/me", register.body.token);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });
});
