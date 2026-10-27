// Worker passwordless auth: phone + OTP. Mounted under /api/auth.
//
//   POST /api/auth/otp/request  { phone }        -> { sent: true, devCode? }
//   POST /api/auth/otp/verify   { phone, code }  -> { token, user, isNewUser }
//
// OTP codes are hashed (sha256) at rest, single-use, 10-min expiry,
// rate-limited to <=5 requests/hour/phone, and locked after >=5 wrong attempts.
// Dev/sim: code is returned as devCode when SMS is not configured; master code
// 123456 works ONLY when NODE_ENV is explicitly "development" or "test".

import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../prisma";
import { signToken, publicUser, hashPassword } from "../auth";
import { AccountType, ACCOUNT_TYPES, Role } from "../types";
import { sms } from "../services/sms";
import { devAuthShortcutsEnabled } from "../env";

const router = Router();

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;
const MASTER_CODE = "123456";

// Fail closed: a bypass must be opted into, never left on because a variable
// was missing. See src/env.ts - NODE_ENV is unset on Workers, so the previous
// `!== "production"` test made the master code live in production.
const isDev = devAuthShortcutsEnabled;

// ── OTP secret material ──────────────────────────────────────────────────────
//
// A six-digit code has only 10^6 possible values, so an UNSALTED sha256 of one
// is reversible by anyone who can read the table: the entire digest space
// precomputes to a few megabytes, once, and is reusable forever. Read access to
// OtpCode therefore used to hand over every live login code on the platform -
// a database dump, a console query or a support export was an account takeover
// for every worker with a code outstanding.
//
// Two changes close that:
//   1. a per-row random salt, so one precomputed table cannot cover the table -
//      each row would need its own 10^6-hash search; and
//   2. a server-side pepper (the HMAC key) that lives only in the Worker's
//      environment and never in the database, so a database-only compromise
//      cannot compute anything at all, not even that per-row search.
//
// phone and purpose are bound into the message too, so a digest lifted from one
// row cannot be replayed against another.
const DEFAULT_DEV_PEPPER = "dev-otp-pepper-change-me";

// Resolved lazily, never at module scope: Workers only populate process.env
// from bindings once request handling begins (same constraint as auth.ts's
// jwtSecret()). Note this caches on first use, so a NODE_ENV change afterwards
// is not re-evaluated - fine in practice, since the environment is fixed for
// the lifetime of an isolate.
let _otpPepper: string | undefined;
function otpPepper(): string {
  if (_otpPepper === undefined) {
    // OTP_PEPPER is the dedicated secret; JWT_SECRET is accepted as a fallback
    // so this ships without requiring a new binding on day one. Fail closed
    // outside development rather than hashing with a value published in this
    // repository.
    const configured = process.env.OTP_PEPPER || process.env.JWT_SECRET || "";
    if (!devAuthShortcutsEnabled() && (!configured || configured === DEFAULT_DEV_PEPPER)) {
      throw new Error(
        "OTP_PEPPER (or JWT_SECRET) must be set to a strong, unique value outside development: OTP codes are keyed with it."
      );
    }
    _otpPepper = configured || DEFAULT_DEV_PEPPER;
  }
  return _otpPepper;
}

/** 16 random bytes, hex. Stored per row in OtpCode.codeSalt. */
function newSalt(): string {
  return (crypto.randomBytes(16) as any).toString("hex");
}

function hashCode(code: string, salt: string, phone: string, purpose: string): string {
  return crypto
    .createHmac("sha256", otpPepper())
    .update(`${salt}:${phone}:${purpose}:${code}`)
    .digest("hex");
}

/** Constant-time digest compare, mirroring services/paystack.ts. */
function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * A six-digit code from a cryptographic source.
 *
 * Math.random() is a non-cryptographic PRNG whose internal state is
 * recoverable from a handful of outputs - and an attacker can harvest outputs
 * at will by requesting codes for a phone they control, then predict the next
 * code issued to someone else. Rejection sampling keeps the distribution
 * uniform (a bare modulo over a 32-bit draw is biased), and the full
 * 000000-999999 range is used rather than the old 100000-999999.
 */
function generateOtpCode(): string {
  const RANGE = 1_000_000;
  const LIMIT = 4_294_967_296 - (4_294_967_296 % RANGE);
  // The module-scope `import crypto from "crypto"` shadows the global, so reach
  // for Web Crypto explicitly. Workers always provide it.
  const webcrypto = (globalThis as any).crypto as Crypto;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    webcrypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= LIMIT);
  return String(n % RANGE).padStart(6, "0");
}

// Loose E.164 normalisation: strip spaces/dashes, keep leading +.
function normalisePhone(raw: string): string {
  return String(raw).trim().replace(/[\s-]/g, "");
}

/**
 * POST /api/auth/register: email/password self-serve signup. Creates a WORKER
 * (kycStatus PENDING) and returns a normal token. 409 if the email is taken.
 *
 * `accountType` is the one place a person declares which of the three kinds of
 * account they are opening. It is validated against ACCOUNT_TYPES rather than
 * written through, because it is a client-supplied string that route guards
 * will later trust - an unrecognised value would sit in the column and quietly
 * fail every requireAccountType check with no way to tell why.
 *
 * `role` stays WORKER for all three. That is not an oversight: role is about
 * Afrizone staff, accountType is about what kind of outside party this is, and
 * self-serve signup can never mint anything but an outside party. Letting the
 * client influence `role` here is exactly the privilege-escalation shape this
 * codebase has already been bitten by elsewhere.
 *
 * Note the asymmetry with phone OTP, which is deliberate. Phone OTP is the
 * individual worker's path and its auto-created accounts stay INDIVIDUAL by
 * column default; stores and couriers sign up with an email and a password.
 * That mirrors the split the platform already had - workers passwordless,
 * everyone else credentialed - rather than inventing a second one.
 */
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  const accountType: AccountType = ACCOUNT_TYPES.includes(req.body?.accountType)
    ? req.body.accountType
    : "INDIVIDUAL";
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }
  if (String(name).trim().length < 2) {
    return res.status(400).json({ error: "Please enter your full name" });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  const normEmail = String(email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normEmail)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }

  const existing = await prisma.user.findUnique({ where: { email: normEmail } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await hashPassword(String(password));
  const user = await prisma.user.create({
    data: {
      name: String(name).trim(),
      email: normEmail,
      passwordHash,
      role: "WORKER",
      accountType,
      tiers: "",
      kycStatus: "PENDING",
    },
  });

  const token = signToken({ sub: user.id, role: user.role as Role, email: user.email });
  return res.json({ token, user: publicUser(user), isNewUser: true });
});

// POST /api/auth/otp/request
router.post("/otp/request", async (req, res) => {
  const phoneRaw = req.body?.phone;
  if (!phoneRaw) return res.status(400).json({ error: "phone is required" });
  const phone = normalisePhone(phoneRaw);
  if (!/^\+?\d{7,15}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  // Rate limit: <=5 requests/hour/phone.
  const since = new Date(Date.now() - REQUEST_WINDOW_MS);
  const recent = await prisma.otpCode.count({
    where: { phone, purpose: "login", createdAt: { gte: since } },
  });
  if (recent >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: "Too many OTP requests. Try again later." });
  }

  const code = generateOtpCode();
  const salt = newSalt();
  await prisma.otpCode.create({
    data: {
      phone,
      codeSalt: salt,
      codeHash: hashCode(code, salt, phone, "login"),
      purpose: "login",
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  try {
    await sms.sendOtp(phone, code);
  } catch (e) {
    console.error("[otp] sms send failed:", e);
  }

  const payload: { sent: true; devCode?: string } = { sent: true };
  // Expose devCode only when SMS isn't really sending (sim) and not in prod.
  if (isDev() && !sms.enabled) payload.devCode = code;
  return res.json(payload);
});

// POST /api/auth/otp/verify
router.post("/otp/verify", async (req, res) => {
  const phoneRaw = req.body?.phone;
  const codeRaw = req.body?.code;
  if (!phoneRaw || !codeRaw) {
    return res.status(400).json({ error: "phone and code are required" });
  }
  const phone = normalisePhone(phoneRaw);
  const code = String(codeRaw).trim();

  // Master code shortcut in dev: bypasses the stored-code checks entirely.
  const masterOk = isDev() && code === MASTER_CODE;

  if (!masterOk) {
    const otp = await prisma.otpCode.findFirst({
      where: { phone, purpose: "login", consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return res.status(400).json({ error: "Invalid or expired code" });

    if (otp.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many attempts. Request a new code." });
    }
    if (otp.expiresAt < new Date()) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }
    if (!digestsEqual(otp.codeHash, hashCode(code, otp.codeSalt ?? "", phone, otp.purpose))) {
      const attempts = otp.attempts + 1;
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts } });
      if (attempts >= MAX_ATTEMPTS) {
        return res.status(429).json({ error: "Too many attempts. Request a new code." });
      }
      return res.status(400).json({ error: "Invalid or expired code" });
    }
    // Correct: consume it.
    await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }

  // Find or create the worker.
  let user = await prisma.user.findUnique({ where: { phone } });
  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    user = await prisma.user.create({
      data: {
        name: "New Tasker",
        email: `${phone.replace(/\D/g, "")}@phone.afrizone.local`, // placeholder, set in KYC
        phone,
        passwordHash: null,
        role: "WORKER",
        tiers: "",
        kycStatus: "PENDING",
      },
    });
  }

  const token = signToken({ sub: user.id, role: user.role as Role, email: user.email });
  return res.json({ token, user: publicUser(user), isNewUser });
});

export default router;
