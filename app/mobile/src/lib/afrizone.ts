/**
 * Continue with AfriZone, mobile (app/AFRIZONE_ACCOUNT.md §2).
 *
 * The web flow borrows the .afrizonemart.com cookie. An app has no such cookie,
 * so this signs in to AfriZone directly:
 *
 *   1. POST {AFRIZONE}/api/auth/login. When the account has 2FA on, AfriZone
 *      answers { mfaRequired, mfaToken } and the code goes to /api/auth/mfa/sign-in.
 *   2. Swap the access token for a 5-minute identity token (audience "parttime").
 *   3. Sign that AfriZone session out again, because Part-Time keeps only its own session.
 *
 * The caller then hands the identity token to OUR server (api.afrizoneSignIn).
 * The AfriZone password and access token never leave this module or touch storage.
 *
 * Only email+password AfriZone accounts can use this for now. Phone-only and
 * Google-only AfriZone accounts need their own flows; not built yet.
 */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { afrizoneApiUrl?: string };

export const AFRIZONE_API: string = (
  process.env.EXPO_PUBLIC_AFRIZONE_API_URL ||
  extra.afrizoneApiUrl ||
  'https://api.afrizonemart.com'
).replace(/\/+$/, '');

export class AfrizoneAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AfrizoneAuthError';
    this.status = status;
  }
}

export type AfrizoneLoginResult =
  | { kind: 'ok'; accessToken: string }
  | { kind: 'mfa'; mfaToken: string };

async function post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let res: Response;
  try {
    res = await fetch(`${AFRIZONE_API}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new AfrizoneAuthError('Could not reach AfriZone. Check your connection and try again.', 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    // AfriZone errors are { error: { code, message } }.
    const err = (data as { error?: { message?: unknown } } | null)?.error;
    const msg = typeof err?.message === 'string' ? err.message : null;
    throw new AfrizoneAuthError(friendly(res.status, msg), res.status);
  }
  return data as T;
}

function friendly(status: number, serverMsg: string | null): string {
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (status === 401) return serverMsg || 'That email and password do not match an AfriZone account.';
  if (status === 400) return 'Check your email and password and try again.';
  return serverMsg || 'AfriZone could not sign you in. Please try again.';
}

/** Step 1: email + password. May ask for a 2FA code. */
export async function afrizoneLogin(email: string, password: string): Promise<AfrizoneLoginResult> {
  const res = await post<{ accessToken?: string; mfaRequired?: boolean; mfaToken?: string }>(
    '/api/auth/login',
    { email: email.trim(), password },
  );
  if (res.mfaRequired && res.mfaToken) return { kind: 'mfa', mfaToken: res.mfaToken };
  if (!res.accessToken) throw new AfrizoneAuthError('AfriZone could not sign you in. Please try again.', 500);
  return { kind: 'ok', accessToken: res.accessToken };
}

/** Step 1b: the 6-digit code (or a recovery code) when AfriZone asked for one. */
export async function afrizoneMfa(mfaToken: string, code: string): Promise<string> {
  const res = await post<{ accessToken?: string }>('/api/auth/mfa/sign-in', {
    mfaToken,
    code: code.trim(),
  });
  if (!res.accessToken) throw new AfrizoneAuthError('That code is wrong or expired.', 401);
  return res.accessToken;
}

/**
 * Steps 2 + 3: get the identity token, then end the AfriZone session we
 * opened. The logout is best-effort; failing it must not fail the sign-in.
 */
export async function afrizoneIdentityToken(accessToken: string): Promise<string> {
  try {
    const res = await post<{ identityToken?: string }>(
      '/api/auth/identity-token',
      { audience: 'parttime' },
      accessToken,
    );
    if (!res.identityToken) throw new AfrizoneAuthError('AfriZone could not confirm your sign-in.', 500);
    return res.identityToken;
  } finally {
    post('/api/auth/logout', {}, accessToken).catch(() => undefined);
  }
}
