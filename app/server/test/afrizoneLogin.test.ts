import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { apiPost } from "./http";
import { testPrisma, createUserWithToken } from "./helpers";

/**
 * Continue with AfriZone (app/AFRIZONE_ACCOUNT.md §3-4). Tokens are signed
 * here with the throwaway key from vitest.config.mts, exactly as the AfriZone
 * API signs them (ES256, iss afrizonemart, aud parttime, 5 minutes, jti).
 *
 * Kept to a handful of D1 flows: the suite hangs past roughly five per file.
 */

function identityToken(claims: Record<string, unknown>, opts: { audience?: string } = {}) {
  return jwt.sign(
    {
      email: null,
      email_verified: false,
      name: null,
      phone_number: null,
      phone_number_verified: false,
      country: "NG",
      mfa_enabled: false,
      ...claims,
    },
    (env as any).TEST_AFRIZONE_PRIVATE_KEY,
    {
      algorithm: "ES256",
      issuer: "afrizonemart",
      audience: opts.audience ?? "parttime",
      expiresIn: 300,
      jwtid: randomUUID(),
    }
  );
}

let n = 0;
const uniq = () => `${Date.now()}${++n}`;

describe("POST /api/auth/afrizone", () => {
  it("creates a WORKER for a new AfriZone account, and never accepts the same token twice", async () => {
    const sub = `azsub${uniq()}`;
    const email = `new-${uniq()}@example.com`;
    const tok = identityToken({ sub, email, email_verified: true, name: "Ada Obi", phone_number: "+2348011112222" });

    const res = await apiPost("/api/auth/afrizone", { identityToken: tok });
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("WORKER");
    expect(res.body.user.kycStatus).toBe("PENDING");

    const row = await testPrisma().user.findUnique({ where: { afrizoneUserId: sub } });
    expect(row?.email).toBe(email);
    expect(row?.name).toBe("Ada Obi");
    // Phones are unverified on AfriZone's side: never stored as a login identity.
    expect(row?.phone).toBeNull();

    const audit = await testPrisma().auditLog.findFirst({ where: { entityId: row!.id, action: "AFRIZONE_ACCOUNT_CREATED" } });
    expect(audit).toBeTruthy();

    const replay = await apiPost("/api/auth/afrizone", { identityToken: tok });
    expect(replay.status).toBe(401);
  });

  it("refuses tokens for another audience, HS256 tokens, and garbage", async () => {
    const wrongAud = identityToken({ sub: `azsub${uniq()}` }, { audience: "ink" });
    expect((await apiPost("/api/auth/afrizone", { identityToken: wrongAud })).status).toBe(401);

    // A token "signed" with a shared secret must never pass, whatever its claims.
    const hs = jwt.sign({ sub: "x", jti: "y" }, "guess", { algorithm: "HS256", issuer: "afrizonemart", audience: "parttime", expiresIn: 300 });
    expect((await apiPost("/api/auth/afrizone", { identityToken: hs })).status).toBe(401);

    expect((await apiPost("/api/auth/afrizone", { identityToken: "nope" })).status).toBe(401);
    expect((await apiPost("/api/auth/afrizone", {})).status).toBe(400);
  });

  it("links an existing WORKER by verified email, then signs them in by sub alone", async () => {
    const { user: worker } = await createUserWithToken("WORKER");
    const sub = `azsub${uniq()}`;

    const first = await apiPost("/api/auth/afrizone", {
      identityToken: identityToken({ sub, email: worker.email, email_verified: true }),
    });
    expect(first.status).toBe(200);
    expect(first.body.isNewUser).toBe(false);
    expect(first.body.user.id).toBe(worker.id);

    // Next time the email differs (changed on AfriZone): sub is what links.
    const second = await apiPost("/api/auth/afrizone", {
      identityToken: identityToken({ sub, email: `changed-${uniq()}@example.com`, email_verified: true }),
    });
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(worker.id);
  });

  it("never auto-links staff, and never links or stores an unverified email", async () => {
    const { user: admin } = await createUserWithToken("SUPER_ADMIN");
    const staff = await apiPost("/api/auth/afrizone", {
      identityToken: identityToken({ sub: `azsub${uniq()}`, email: admin.email, email_verified: true }),
    });
    expect(staff.status).toBe(409);
    expect(staff.body.code).toBe("STAFF_LINK_FROM_SETTINGS");
    const adminRow = await testPrisma().user.findUnique({ where: { id: admin.id } });
    expect(adminRow?.afrizoneUserId).toBeNull();

    // Same staff email but UNVERIFIED: no link, a fresh worker with a placeholder email.
    const sub = `azsub${uniq()}`;
    const unverified = await apiPost("/api/auth/afrizone", {
      identityToken: identityToken({ sub, email: admin.email, email_verified: false }),
    });
    expect(unverified.status).toBe(200);
    expect(unverified.body.isNewUser).toBe(true);
    expect(unverified.body.user.id).not.toBe(admin.id);
    expect(unverified.body.user.email).toMatch(/@afrizone-account\.local$/);
  });
});

describe("POST /api/auth/afrizone/link", () => {
  it("lets a signed-in staff member link, and refuses an AfriZone account already in use", async () => {
    const { user: admin, token } = await createUserWithToken("HR_ADMIN");
    const sub = `azsub${uniq()}`;

    const linked = await apiPost("/api/auth/afrizone/link", { identityToken: identityToken({ sub }) }, token);
    expect(linked.status).toBe(200);
    expect(linked.body.user.afrizoneUserId).toBe(sub);

    // Linked staff still can't sign in WITH AfriZone: console only.
    const viaAfrizone = await apiPost("/api/auth/afrizone", { identityToken: identityToken({ sub }) });
    expect(viaAfrizone.status).toBe(403);
    expect(viaAfrizone.body.code).toBe("STAFF_USE_CONSOLE");
    expect(viaAfrizone.body.token).toBeUndefined();

    const { token: otherToken } = await createUserWithToken("WORKER");
    const clash = await apiPost("/api/auth/afrizone/link", { identityToken: identityToken({ sub }) }, otherToken);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("AFRIZONE_ACCOUNT_IN_USE");

    // Without a Part-Time session the link route is closed.
    expect((await apiPost("/api/auth/afrizone/link", { identityToken: identityToken({ sub: `azsub${uniq()}` }) })).status).toBe(401);
    void admin;
  });
});
