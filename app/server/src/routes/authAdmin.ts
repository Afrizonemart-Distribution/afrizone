// Admin auth extras: TOTP 2FA, Google SSO, password forgot/reset.
// Mounted under /api/auth.
//
//   POST /api/auth/2fa/verify    { challenge, code }     -> { token, user }
//   POST /api/auth/2fa/setup     (auth)                  -> { otpauthUrl, qrDataUrl, secret }
//   POST /api/auth/2fa/enable    (auth) { code }         -> { enabled: true }
//   POST /api/auth/2fa/disable   (auth) { code }         -> { enabled: false }
//   POST /api/auth/google        { idToken }             -> { token, user }
//   POST /api/auth/password/forgot { email }             -> { sent: true, devToken? }
//   POST /api/auth/password/reset  { token, password }   -> { ok: true }
//
// Reset tokens are hashed (sha256) at rest, single-use, 30-min expiry. 2FA
// secrets are TOTP (RFC 6238). Dev bypass 000000 lives in services/totp.ts.

import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../prisma";
import {
  AuthedRequest,
  requireAuth,
  signToken,
  verifyChallenge,
  publicUser,
  hashPassword,
  isAdmin,
} from "../auth";
import { Role } from "../types";
import { totp } from "../services/totp";
import { google } from "../services/google";
import { devAuthShortcutsEnabled } from "../env";

const router = Router();

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes
// Fail closed - see src/env.ts. This gate controls whether a password-reset
// token is returned in the API response; with NODE_ENV unset on Workers the old
// `!== "production"` test handed that token to any caller who knew an admin's
// email address, which is an account takeover in two requests.
const isDev = devAuthShortcutsEnabled;

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// POST /api/auth/2fa/verify: exchange a 2FA challenge + TOTP code for a token.
router.post("/2fa/verify", async (req, res) => {
  const { challenge, code } = req.body || {};
  if (!challenge || !code) {
    return res.status(400).json({ error: "challenge and code are required" });
  }
  let userId: string;
  try {
    userId = verifyChallenge(String(challenge)).sub;
  } catch {
    return res.status(401).json({ error: "Invalid or expired challenge" });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpEnabled) {
    return res.status(401).json({ error: "Invalid or expired challenge" });
  }
  if (!totp.verify(user.totpSecret || "", String(code))) {
    return res.status(400).json({ error: "Invalid code" });
  }
  const token = signToken({ sub: user.id, role: user.role as Role, email: user.email });
  return res.json({ token, user: publicUser(user) });
});

// POST /api/auth/2fa/setup (auth): generate + store a PENDING secret, return QR.
router.post("/2fa/setup", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Re-keying an ALREADY-ENABLED authenticator must prove control of the
  // current one. Without this, anyone who reaches this endpoint can silently
  // replace a live secret with one they generated and then pass 2FA with it,
  // which turns 2FA into a formality rather than a second factor.
  if (user.totpEnabled) {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: "Enter a code from your current authenticator to re-configure 2FA" });
    }
    if (!user.totpSecret || !totp.verify(user.totpSecret, String(code))) {
      return res.status(400).json({ error: "Invalid code" });
    }
  }

  const secret = totp.generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });

  const otpauthUrl = totp.otpauthUrl(secret, user.email);
  const qrDataUrl = await totp.qrDataUrl(otpauthUrl);
  return res.json({ otpauthUrl, qrDataUrl, secret });
});

// POST /api/auth/2fa/enable (auth): verify the pending secret, flip enabled on.
router.post("/2fa/enable", requireAuth, async (req: AuthedRequest, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "code is required" });
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.totpSecret) {
    return res.status(400).json({ error: "Start 2FA setup first" });
  }
  if (!totp.verify(user.totpSecret, String(code))) {
    return res.status(400).json({ error: "Invalid code" });
  }
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  return res.json({ enabled: true });
});

// POST /api/auth/2fa/disable (auth): requires a current code.
router.post("/2fa/disable", requireAuth, async (req: AuthedRequest, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "code is required" });
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.totpEnabled || !user.totpSecret) {
    return res.status(400).json({ error: "2FA is not enabled" });
  }
  if (!totp.verify(user.totpSecret, String(code))) {
    return res.status(400).json({ error: "Invalid code" });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  return res.json({ enabled: false });
});

// POST /api/auth/google: verify Google ID token.
//   context "admin" (default): invite-only, match an existing admin else 400.
//   context "worker": match by googleId/email, else auto-create a WORKER.
router.post("/google", async (req, res) => {
  if (!google.enabled) {
    return res.status(503).json({ error: "Google SSO not configured" });
  }
  const { idToken, context } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "idToken is required" });
  const ctx = context === "worker" ? "worker" : "admin";

  let verified: { email: string; sub: string; name?: string };
  try {
    verified = await google.verifyIdToken(String(idToken));
  } catch {
    return res.status(400).json({ error: "Invalid Google token" });
  }

  // Match by googleId first, then by verified email.
  let user =
    (await prisma.user.findUnique({ where: { googleId: verified.sub } })) ||
    (await prisma.user.findUnique({ where: { email: verified.email } }));
  let isNewUser = false;

  if (ctx === "admin") {
    // Invite-only: must already exist as an admin. Do NOT auto-create.
    // Allow-by-list. `user.role === "WORKER"` refused exactly one role and
    // admitted every other, so adding any new non-admin role (COURIER is on
    // the roadmap) would have let holders of it sign in to the admin console.
    if (!user || !isAdmin(user.role)) {
      return res.status(400).json({ error: "No admin account for this Google email" });
    }
  } else if (!user) {
    // Worker self-serve: auto-create a WORKER linked to this Google account.
    isNewUser = true;
    user = await prisma.user.create({
      data: {
        name: verified.name || "New Tasker", // placeholder when Google has no name
        email: verified.email,
        passwordHash: null,
        googleId: verified.sub,
        role: "WORKER",
        tiers: "",
        kycStatus: "PENDING",
      },
    });
  }

  // Link the googleId on first SSO sign-in (matched-by-email case).
  if (user.googleId !== verified.sub) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId: verified.sub },
    });
  }
  const token = signToken({ sub: user.id, role: user.role as Role, email: user.email });
  return res.json({ token, user: publicUser(user), isNewUser });
});

// POST /api/auth/password/forgot: no account enumeration.
router.post("/password/forgot", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  const payload: { sent: true; devToken?: string } = { sent: true };

  if (user) {
    // See webhooks.ts for why this cast: worker-configuration.d.ts's global
    // `Buffer: any` shadows @types/node's real Buffer type, hiding the
    // encoding-aware toString() overload at compile time only.
    const rawToken = (crypto.randomBytes(32) as any).toString("hex");
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    console.log(`[auth] password reset link for ${user.email}: token=${rawToken}`);
    if (isDev()) payload.devToken = rawToken;
  }
  // Always the same response shape: never reveal whether the email exists.
  return res.json(payload);
});

// POST /api/auth/password/reset: validate token, set new password, single-use.
router.post("/password/reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: "token and password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  const reset = await prisma.passwordReset.findFirst({
    where: { tokenHash: sha256(String(token)), usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!reset || reset.expiresAt < new Date()) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }
  const passwordHash = await hashPassword(String(password));
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
  return res.json({ ok: true });
});

export default router;
