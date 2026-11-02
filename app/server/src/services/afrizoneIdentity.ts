// Continue with AfriZone: verify an AfriZone identity token (app/AFRIZONE_ACCOUNT.md §3).
//
// The AfriZone API signs a 5-minute ES256 JWT for one audience ("parttime").
// We verify it with AfriZone's PUBLIC key only; no secret is shared.
//
// Key source, in order:
//   AFRIZONE_IDENTITY_PUBLIC_KEY  PEM in an env var (pinned; rotating needs a deploy)
//   AFRIZONE_JWKS_URL             JWKS (default https://api.afrizonemart.com/.well-known/jwks.json),
//                                 cached by kid, so AfriZone can rotate without a deploy
//
// Off unless AFRIZONE_LOGIN_ENABLED is exactly "true" (fail closed, see src/env.ts).
// Every env var is read lazily: Workers only populate process.env per request.

import { createPublicKey, type KeyObject } from "crypto";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const AFRIZONE_ISSUER = "afrizonemart";
export const AFRIZONE_AUDIENCE = "parttime";
const DEFAULT_JWKS_URL = "https://api.afrizonemart.com/.well-known/jwks.json";
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;

export interface AfrizoneClaims {
  sub: string;
  jti: string;
  exp: number;
  email: string | null;
  email_verified: boolean;
  name: string | null;
  phone_number: string | null;
  phone_number_verified: boolean;
  country: string | null;
  mfa_enabled: boolean;
}

export class AfrizoneTokenError extends Error {}

export function afrizoneLoginEnabled(): boolean {
  return process.env.AFRIZONE_LOGIN_ENABLED === "true";
}

let pemCache: { pem: string; key: KeyObject } | null = null;
let jwksCache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;

function pinnedKey(): KeyObject | null {
  const pem = process.env.AFRIZONE_IDENTITY_PUBLIC_KEY?.replace(/\\n/g, "\n").trim();
  if (!pem) return null;
  if (pemCache?.pem !== pem) pemCache = { pem, key: createPublicKey(pem) };
  return pemCache.key;
}

async function jwksKey(kid: string | undefined): Promise<KeyObject> {
  if (!kid) throw new AfrizoneTokenError("token has no kid");
  const now = Date.now();
  const fresh = jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS;
  const canRefetch = !jwksCache || now - jwksCache.fetchedAt > JWKS_MIN_REFETCH_MS;
  // Refetch when stale, or when the kid is unknown (AfriZone rotated its key),
  // but never more than once a minute so bad kids can't make us hammer the JWKS.
  if (!fresh || (!jwksCache!.keys.has(kid) && canRefetch)) {
    const url = process.env.AFRIZONE_JWKS_URL || DEFAULT_JWKS_URL;
    const res = await fetch(url);
    if (!res.ok) throw new AfrizoneTokenError(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (typeof jwk.kid !== "string" || jwk.kty !== "EC" || jwk.crv !== "P-256") continue;
      keys.set(jwk.kid, createPublicKey({ key: jwk as any, format: "jwk" }));
    }
    jwksCache = { keys, fetchedAt: now };
  }
  const key = jwksCache!.keys.get(kid);
  if (!key) throw new AfrizoneTokenError("unknown kid");
  return key;
}

/** Verify signature, issuer, audience and expiry. Does NOT consume the jti. */
export async function verifyAfrizoneToken(identityToken: string): Promise<AfrizoneClaims> {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded === "string") throw new AfrizoneTokenError("malformed token");
  const key = pinnedKey() ?? (await jwksKey(decoded.header.kid));

  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(identityToken, key, {
      algorithms: ["ES256"], // never HS256 or "none"
      issuer: AFRIZONE_ISSUER,
      audience: AFRIZONE_AUDIENCE,
    }) as jwt.JwtPayload;
  } catch (e) {
    throw new AfrizoneTokenError((e as Error).message);
  }
  if (typeof claims.sub !== "string" || !claims.sub) throw new AfrizoneTokenError("no sub");
  if (typeof claims.jti !== "string" || !claims.jti) throw new AfrizoneTokenError("no jti");
  if (typeof claims.exp !== "number") throw new AfrizoneTokenError("no exp");

  const email = typeof claims.email === "string" && claims.email ? claims.email.trim().toLowerCase() : null;
  return {
    sub: claims.sub,
    jti: claims.jti,
    exp: claims.exp,
    email,
    email_verified: email !== null && claims.email_verified === true,
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
    phone_number: typeof claims.phone_number === "string" ? claims.phone_number : null,
    // AfriZone always sends false for now; only trust an explicit true.
    phone_number_verified: claims.phone_number_verified === true,
    country: typeof claims.country === "string" ? claims.country : null,
    mfa_enabled: claims.mfa_enabled === true,
  };
}

/**
 * Mark a token used. Throws AfrizoneTokenError if it already was (a replay).
 * The insert IS the check: jti is the primary key, so two racing requests
 * with the same token can't both succeed.
 */
export async function consumeAfrizoneToken(claims: AfrizoneClaims): Promise<void> {
  await prisma.afrizoneTokenUse.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  try {
    await prisma.afrizoneTokenUse.create({
      data: { jti: claims.jti, expiresAt: new Date(claims.exp * 1000) },
    });
  } catch (e) {
    const unique =
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") ||
      /UNIQUE constraint failed/i.test(String((e as Error)?.message));
    if (unique) {
      throw new AfrizoneTokenError("token already used");
    }
    throw e;
  }
}

/** Test hook: forget cached keys between tests. */
export function _resetAfrizoneKeyCache(): void {
  pemCache = null;
  jwksCache = null;
}
