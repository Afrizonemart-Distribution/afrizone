// Is 2FA asked anywhere right now? Decided by Afrizonemart (Admin → Feature
// flags → "2FA required (all products)"), owner rule 2026-11-18: when it's
// off, nobody is asked for a 2FA code in any admin or product, this console
// included. Part-Time's database isn't connected to Afrizonemart's, so we
// read GET {AFRIZONE_API_URL}/api/auth/two-factor-policy, cached 15 seconds.
//
// Fails safe: if Afrizonemart can't be reached, 2FA stays required. Tests
// never call out (required unless a test sets it).

const TTL_MS = 15_000;
let cached: { required: boolean; at: number } | null = null;
let testOverride: boolean | null = null;

export async function twoFactorRequired(): Promise<boolean> {
  if (testOverride !== null) return testOverride;
  if (process.env.VITEST || process.env.NODE_ENV === "test") return true;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.required;
  try {
    const base = (process.env.AFRIZONE_API_URL || "https://api.afrizonemart.com").replace(/\/+$/, "");
    const res = await fetch(`${base}/api/auth/two-factor-policy`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { required?: unknown };
    const required = body.required !== false; // only an explicit false switches it off
    cached = { required, at: Date.now() };
    return required;
  } catch {
    return cached?.required ?? true;
  }
}

/** Tests only. null = back to normal. */
export function __setTwoFactorRequired(v: boolean | null): void {
  testOverride = v;
  cached = null;
}
