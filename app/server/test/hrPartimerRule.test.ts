import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { apiPost } from "./http";

/**
 * AZM staff policy (2026-11-24): an HR head's AfriZone account opens the HR
 * console only. In the Partimer app it gets a clear "use a different email"
 * answer instead of a session every route would refuse. Other AZM staff
 * (no Part-Time role) sign up as ordinary Partimers with their AfriZone email.
 */

function identityToken(claims: Record<string, unknown>) {
  return jwt.sign(
    { email: null, email_verified: false, name: null, phone_number: null, phone_number_verified: false, country: "NG", mfa_enabled: true, amr: ["pwd", "mfa"], ...claims },
    (env as any).TEST_AFRIZONE_PRIVATE_KEY,
    { algorithm: "ES256", issuer: "afrizonemart", audience: "parttime", expiresIn: 300, jwtid: randomUUID() }
  );
}

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

describe("AZM staff on Part-Time", () => {
  it("an HR head is sent to the console from the app, and signs in on the console", async () => {
    const sub = `azhr${uniq()}`;
    const email = `hr-${uniq()}@example.com`;
    const app = await apiPost("/api/auth/afrizone", { identityToken: identityToken({ sub, email, email_verified: true, parttime_role: "AZM_HR" }) });
    expect(app.status).toBe(409);
    expect(app.body.code).toBe("HR_ACCOUNT_CONSOLE_ONLY");
    expect(app.body.error).toMatch(/different email/);

    const consoleIn = await apiPost("/api/auth/afrizone", { identityToken: identityToken({ sub, email, email_verified: true, parttime_role: "AZM_HR" }), surface: "console" });
    expect(consoleIn.status).toBe(200);
    expect(consoleIn.body.user.role).toBe("AZM_HR");
  });

  it("other AZM staff (no Part-Time role) become ordinary Partimers with their AfriZone email", async () => {
    const res = await apiPost("/api/auth/afrizone", { identityToken: identityToken({ sub: `azst${uniq()}`, email: `staff-${uniq()}@example.com`, email_verified: true, parttime_role: null }) });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("WORKER");
    expect(res.body.isNewUser).toBe(true);
  });
});
