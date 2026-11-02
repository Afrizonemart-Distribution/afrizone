// Continue with AfriZone (app/AFRIZONE_ACCOUNT.md). Mounted under /api/auth.
//
//   POST /api/auth/afrizone       { identityToken }         -> { token, user, isNewUser }
//                                                              | { requires2fa, challenge }
//   POST /api/auth/afrizone/link  (auth) { identityToken }  -> { user }
//
// Linking rules (§4, security-critical):
//   1. A user already linked to this AfriZone `sub` signs in.
//   2. Else a verified email matching a WORKER links that worker and signs in.
//      Never link on phone: AfriZone can't vouch for phones yet.
//   3. Never auto-link staff. A staff member links from Settings while signed
//      in to Part-Time (the /link route), which proves they own both accounts.
//   4. Nothing matches: create a WORKER (kycStatus PENDING) -> KYC stepper.
//   5. Every link and every account created this way is audited.
//
// The identity token is single-use: its jti is consumed before any decision,
// so even a refused attempt burns it.

import { Router } from "express";
import type { User } from "@prisma/client";
import { prisma } from "../prisma";
import { AuthedRequest, requireAuth, signToken, signChallenge, publicUser } from "../auth";
import { Role } from "../types";
import { userActor, writeAudit } from "../util/audit";
import {
  afrizoneLoginEnabled,
  verifyAfrizoneToken,
  consumeAfrizoneToken,
  AfrizoneTokenError,
  type AfrizoneClaims,
} from "../services/afrizoneIdentity";

const router = Router();

/** Verify + consume, or send the error response and return null. */
async function acceptToken(body: unknown, res: any): Promise<AfrizoneClaims | null> {
  if (!afrizoneLoginEnabled()) {
    res.status(503).json({ error: "Continue with AfriZone is not enabled" });
    return null;
  }
  const identityToken = (body as { identityToken?: unknown } | undefined)?.identityToken;
  if (typeof identityToken !== "string" || !identityToken) {
    res.status(400).json({ error: "identityToken is required" });
    return null;
  }
  try {
    const claims = await verifyAfrizoneToken(identityToken);
    await consumeAfrizoneToken(claims);
    return claims;
  } catch (e) {
    if (e instanceof AfrizoneTokenError) {
      console.warn(`[auth] AfriZone identity token refused: ${e.message}`);
      res.status(401).json({ error: "Invalid or expired AfriZone sign-in. Please try again." });
      return null;
    }
    throw e;
  }
}

/** Same ending as password login: a 2FA challenge if TOTP is on, else a session. */
function signIn(res: any, user: User, isNewUser: boolean) {
  if (user.totpEnabled) {
    return res.json({ requires2fa: true, challenge: signChallenge(user.id) });
  }
  const token = signToken({ sub: user.id, role: user.role as Role, email: user.email });
  return res.json({ token, user: publicUser(user), isNewUser });
}

/** Placeholder for accounts with no verified email (email is NOT NULL + unique). */
function placeholderEmail(sub: string): string {
  return `${sub.toLowerCase().replace(/[^a-z0-9]/g, "")}@afrizone-account.local`;
}

router.post("/afrizone", async (req, res) => {
  const claims = await acceptToken(req.body, res);
  if (!claims) return;

  // 1. Already linked.
  const linked = await prisma.user.findUnique({ where: { afrizoneUserId: claims.sub } });
  if (linked) return signIn(res, linked, false);

  // 2-3. Verified email match.
  if (claims.email_verified && claims.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });
    if (byEmail) {
      if (byEmail.role !== "WORKER") {
        return res.status(409).json({
          error:
            "This email belongs to a staff account. Sign in to Part-Time the usual way, then link AfriZone from Settings.",
          code: "STAFF_LINK_FROM_SETTINGS",
        });
      }
      if (byEmail.afrizoneUserId) {
        // Linked to a different AfriZone account already. Don't move it.
        return res.status(409).json({
          error: "This Part-Time account is already linked to another AfriZone account.",
          code: "ALREADY_LINKED",
        });
      }
      const user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { afrizoneUserId: claims.sub },
      });
      await writeAudit(userActor(user.id), "AFRIZONE_LINKED", "User", user.id, {
        via: "verified_email",
        afrizoneUserId: claims.sub,
      });
      return signIn(res, user, false);
    }
  }

  // 4. Create a WORKER. Store only what AfriZone vouches for: an unverified
  // email or any phone could belong to someone else, and both are login
  // identities here (phone = OTP login, email = Google/password match).
  const user = await prisma.user.create({
    data: {
      name: claims.name || "New Tasker",
      email: claims.email_verified && claims.email ? claims.email : placeholderEmail(claims.sub),
      passwordHash: null,
      afrizoneUserId: claims.sub,
      role: "WORKER",
      tiers: "",
      kycStatus: "PENDING",
    },
  });
  await writeAudit(userActor(user.id), "AFRIZONE_ACCOUNT_CREATED", "User", user.id, {
    afrizoneUserId: claims.sub,
    emailVerified: claims.email_verified,
    country: claims.country,
  });
  return signIn(res, user, true);
});

// Link from Settings: the caller is signed in to Part-Time AND just signed in
// to AfriZone, which proves they own both. The only way staff get linked.
router.post("/afrizone/link", requireAuth, async (req: AuthedRequest, res) => {
  const claims = await acceptToken(req.body, res);
  if (!claims) return;

  const me = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!me) return res.status(404).json({ error: "User not found" });
  if (me.afrizoneUserId === claims.sub) return res.json({ user: publicUser(me) });
  if (me.afrizoneUserId) {
    return res.status(409).json({
      error: "Your account is already linked to a different AfriZone account.",
      code: "ALREADY_LINKED",
    });
  }
  const taken = await prisma.user.findUnique({ where: { afrizoneUserId: claims.sub } });
  if (taken) {
    return res.status(409).json({
      error: "That AfriZone account is already linked to another Part-Time account.",
      code: "AFRIZONE_ACCOUNT_IN_USE",
    });
  }
  const user = await prisma.user.update({
    where: { id: me.id },
    data: { afrizoneUserId: claims.sub },
  });
  await writeAudit(userActor(user.id), "AFRIZONE_LINKED", "User", user.id, {
    via: "settings",
    afrizoneUserId: claims.sub,
  });
  return res.json({ user: publicUser(user) });
});

export default router;
