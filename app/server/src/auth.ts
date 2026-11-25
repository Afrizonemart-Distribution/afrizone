import { Request, Response, NextFunction } from "express";
import { twoFactorRequired } from "./services/twoFactorPolicy";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { AccountType, Role, ROLES, tiersToArray } from "./types";
import { devAuthShortcutsEnabled } from "./env";

const DEFAULT_DEV_SECRET = "dev-secret-change-me";

// Resolved lazily on first use, not at module load: Workers only populate
// process.env from bindings once request handling begins, not at pure
// module-evaluation time (same constraint as env.DB in src/prisma.ts) -
// reading it eagerly here always saw it as undefined and wrongly refused to
// boot in production, even with a real secret configured.
let _jwtSecret: string | undefined;
function jwtSecret(): string {
  if (_jwtSecret === undefined) {
    // Refuse the default secret UNLESS we are explicitly in dev or test.
    //
    // This used to trigger only when NODE_ENV === "production" - which is never
    // set on Workers, so the guard was inert exactly where it mattered. Had
    // JWT_SECRET ever been unset in production the server would have quietly
    // signed every session with a secret published in this repository, letting
    // anyone mint a valid admin token. Inverted so the safe path is the default.
    if (
      !devAuthShortcutsEnabled() &&
      (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_DEV_SECRET)
    ) {
      throw new Error(
        "JWT_SECRET must be set to a strong, unique value outside development (refusing to start with the default dev secret)."
      );
    }
    _jwtSecret = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
  }
  return _jwtSecret;
}
const TOKEN_TTL = "7d";
const CHALLENGE_TTL = "5m"; // short-lived 2FA challenge token

export interface JwtPayload {
  sub: string; // user id
  role: Role;
  email: string;
}

// Short-lived token issued after password step when 2FA is required. Carries no
// role: it only authorises the /2fa/verify exchange, never a normal request.
export interface ChallengePayload {
  sub: string; // user id
  twofa: true;
}

export interface AuthedRequest extends Request {
  user?: { id: string; role: Role; email: string };
}

export function signToken(payload: JwtPayload): string {
  // typ marks this positively as a full session token. Challenge tokens never
  // carry it, so a future strict check can require it outright; today we reject
  // on the negative signals below so that already-issued tokens keep working.
  return jwt.sign({ ...payload, typ: "session" }, jwtSecret(), { expiresIn: TOKEN_TTL });
}

/**
 * Decode a FULL SESSION token. Rejects anything that is merely signed by us.
 *
 * A 2FA challenge is signed with the same key (signChallenge below), so a bare
 * jwt.verify() cast used to accept one as a session. That made 2FA decorative:
 * the challenge handed out after the password step could be sent as a bearer
 * token, used to re-key the victim's authenticator via /2fa/setup, and
 * exchanged for a genuine token. It was also role-less, so every
 * `if (role === "WORKER")` guard downstream failed open.
 *
 * Both holes close here: reject the challenge discriminator explicitly, and
 * require a role that is actually in ROLES - a payload without a valid role is
 * never a session, whatever else it contains.
 */
export function verifyToken(token: string): JwtPayload {
  const p = jwt.verify(token, jwtSecret()) as JwtPayload & { twofa?: unknown };
  if (!p || (p as any).twofa === true) {
    throw new Error("2FA challenge token is not a session token");
  }
  if (!p.role || !ROLES.includes(p.role)) {
    throw new Error("Token carries no valid role");
  }
  return p;
}

/**
 * Staff workspace sessions (routes/staffWorkspace.ts). An AfriZone staff
 * member viewing their afrizonemart tasks and KPI: no Part Time user row, no
 * role, so verifyToken never accepts one. Signed with a key derived from
 * JWT_SECRET so the two kinds can't be swapped even in principle.
 */
export interface StaffSession {
  sub: string; // AfriZone user id
  name: string | null;
  typ: "staff";
}
const STAFF_TTL = "8h";
function staffKey(): string {
  return `${jwtSecret()}:pt-staff`;
}
export function signStaffSession(sub: string, name: string | null): string {
  return jwt.sign({ sub, name, typ: "staff" } satisfies StaffSession, staffKey(), { expiresIn: STAFF_TTL });
}
export function verifyStaffSession(token: string): StaffSession {
  const p = jwt.verify(token, staffKey()) as StaffSession;
  if (!p || p.typ !== "staff" || typeof p.sub !== "string" || !p.sub) throw new Error("Not a staff session");
  return p;
}

export function signChallenge(userId: string): string {
  return jwt.sign({ sub: userId, twofa: true } as ChallengePayload, jwtSecret(), {
    expiresIn: CHALLENGE_TTL,
  });
}

export function verifyChallenge(token: string): ChallengePayload {
  const p = jwt.verify(token, jwtSecret()) as ChallengePayload;
  if (!p || (p as any).twofa !== true) throw new Error("Not a 2FA challenge token");
  return p;
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false; // passwordless accounts (workers) cannot password-login
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// Shape a User row for API responses (tiers as array, no secrets).
//
// totpSecret MUST be stripped: this shape is returned by GET /api/auth/me and
// by the admin worker routes, and leaking the secret lets anyone holding the
// response generate valid 2FA codes for that account - defeating 2FA without
// needing the authenticator at all. Same for the raw password hash.
export function publicUser(u: any) {
  if (!u) return u;
  const { passwordHash, totpSecret, tiers, ...rest } = u;
  return { ...rest, tiers: tiersToArray(tiers) };
}

/** Roles that may act administratively. WORKER is deliberately absent. */
export const ADMIN_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER"];

/**
 * Allow-by-list admin test. Prefer this over `role === "WORKER"` checks: those
 * are deny-by-exception and fail OPEN for any role the author didn't foresee
 * (an absent role, or any role added later).
 */
export function isAdmin(role?: string | null): boolean {
  return !!role && ADMIN_ROLES.includes(role as Role);
}

/** May sign in to the admin console at all: Part-Time admins, plus AZM HR (HR side only). */
export function isConsoleRole(role?: string | null): boolean {
  return isAdmin(role) || role === "AZM_HR";
}

/**
 * AZM_HR holds a console session but must never reach Part-Time data. Every
 * /api path except these is refused for that role, whatever the route's own
 * checks say (several Part-Time routes treat "not an admin" as "a worker").
 */
const AZM_HR_PATHS = [/^\/api\/admin\/hr(\/|$)/, /^\/api\/admin\/presence$/, /^\/api\/auth(\/|$)/, /^\/api\/health(\/|$)/];
export function hrRoleFence(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return next();
  let role: string | undefined;
  try {
    role = verifyToken(header.slice(7)).role;
  } catch {
    return next(); // not a session token: the route's own auth decides
  }
  if (role !== "AZM_HR") return next();
  const path = req.originalUrl.split("?")[0];
  if (AZM_HR_PATHS.some((p) => p.test(path))) return next();
  return res.status(403).json({ error: "AZM HR accounts only open the AZM Staff side", code: "AZM_HR_ONLY" });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  try {
    // verifyToken now rejects 2FA challenge tokens and any payload without a
    // valid role, so req.user.role is always a real Role past this point. That
    // matters beyond this function: downstream handlers branch on the role, and
    // a role-less req.user made every one of those branches fail open.
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * READS THE CURRENT ROLE FROM THE DATABASE, not the token (2026-11-17), for
 * the same reason as requireAccountType below: sessions last seven days, and
 * a Part-Time admin can change or remove a staff role at any time (Staff
 * access, routes/staffAccess.ts). Trusting the token would let someone whose
 * access was removed keep it for up to a week. One primary-key lookup per
 * staff request. req.user.role is refreshed for the handlers that follow.
 */
export function requireRole(...roles: Role[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    let row: { role: string } | null
    try {
      row = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
    } catch (e) {
      return next(e);
    }
    if (!row) return res.status(401).json({ error: "Not authenticated" });
    req.user.role = row.role as Role;
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    return next();
  };
}

/**
 * Gate a route on what kind of outside party the caller is: INDIVIDUAL, STORE
 * or COURIER. Orthogonal to requireRole, which is about Afrizone staff.
 *
 * READS THE DATABASE RATHER THAN THE TOKEN, on purpose. Putting accountType in
 * the JWT would make this free, but tokens live for seven days (TOKEN_TTL), so
 * a type changed today would keep being enforced as the old one for a week -
 * and adding a required claim would invalidate every session already issued.
 * One indexed primary-key lookup per guarded request buys correctness that is
 * always current; if it ever shows up in a profile, cache it, do not trust a
 * week-old claim.
 *
 * This is only ever half of the protection. It answers "is the caller a store
 * account?", which every store account answers the same way. "May the caller
 * touch THIS store's rows?" is ownership and lives in util/store.ts - a route
 * that uses this guard alone is one store away from reading another's orders.
 */
export function requireAccountType(...types: AccountType[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const row = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { accountType: true },
    });
    // A token whose user has since been deleted is not authenticated, whatever
    // the signature says.
    if (!row) return res.status(401).json({ error: "Not authenticated" });
    if (!types.includes(row.accountType as AccountType)) {
      return res.status(403).json({ error: "Not available for this kind of account" });
    }
    return next();
  };
}

/** Said to a removed staff member (role REMOVED, routes/staffAccess.ts) who tries to sign in. */
export const ACCOUNT_CLOSED = "This account no longer has access to Part Time.";

// POST /api/auth/login
export async function login(req: Request, res: Response) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await verifyPassword(String(password), user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  if (!ROLES.includes(user.role as Role)) return res.status(403).json({ error: ACCOUNT_CLOSED, code: "ACCOUNT_CLOSED" });

  // 2FA gate: issue a short-lived challenge instead of a full token. Skipped
  // while Afrizonemart has 2FA switched off everywhere (twoFactorPolicy.ts).
  if (user.totpEnabled && (await twoFactorRequired())) {
    return res.json({ requires2fa: true, challenge: signChallenge(user.id) });
  }

  const token = signToken({ sub: user.id, role: user.role as Role, email: user.email });
  return res.json({ token, user: publicUser(user) });
}

// GET /api/auth/me
export async function me(req: AuthedRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(user) });
}
