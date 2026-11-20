/**
 * Email through Resend (the provider AfriZoneMart already uses; the
 * afrizonemart.com domain is verified there).
 *
 * Off until RESEND_API_KEY is set as a Worker secret: with no key, messages are
 * logged and `send` reports false, so callers record them as skipped instead of
 * pretending they went out. Read lazily, like sms.ts: Workers only fill
 * process.env once a request (or cron) is running.
 *
 * Who the mail comes from, and where a reply goes, is set in the storefront
 * admin under Integrations: EMAIL_FROM_PARTTIME and EMAIL_REPLY_TO_PARTTIME,
 * marked public, are read from AfriZoneMart's public config feed. Change them
 * there and Part Time picks them up within minutes, with no redeploy. When
 * they are not set, or the feed cannot be reached, the EMAIL_FROM and
 * EMAIL_REPLY_TO Worker settings apply, then the defaults below. Looking the
 * address up never stops an email going out.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const DEFAULT_FROM = "AfriZone Jobs <jobs@afrizonemart.com>";
const DEFAULT_REPLY_TO = "jobs@afrizonemart.com";
const IDENTITY_TTL_MS = 5 * 60 * 1000;

let identityCache: { at: number; from?: string; replyTo?: string } | null = null;

/** AfriZoneMart's public config feed, e.g. https://api.afrizonemart.com/api/config/public. */
function configFeedUrl(): string | null {
  if (process.env.MART_CONFIG_URL) return process.env.MART_CONFIG_URL;
  const base = process.env.MART_BASE_URL;
  if (!base) return null;
  try {
    return `${new URL(base).origin}/api/config/public`;
  } catch {
    return null;
  }
}

function clean(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** The sender set in the storefront admin, if any. Cached; never throws. */
async function martIdentity(): Promise<{ from?: string; replyTo?: string }> {
  if (identityCache && Date.now() - identityCache.at < IDENTITY_TTL_MS) return identityCache;
  const url = configFeedUrl();
  let found: { from?: string; replyTo?: string } = {};
  if (url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const keys = (await res.json()) as Record<string, unknown>;
        found = { from: clean(keys.EMAIL_FROM_PARTTIME), replyTo: clean(keys.EMAIL_REPLY_TO_PARTTIME) };
      }
    } catch {
      // Unreachable feed: fall through to the Worker's own settings.
    }
  }
  identityCache = { at: Date.now(), ...found };
  return found;
}

/** For tests: forget the cached sender. */
export function resetEmailIdentityCache(): void {
  identityCache = null;
}

async function config() {
  const mart = await martIdentity();
  return {
    key: process.env.RESEND_API_KEY || "",
    from: mart.from || process.env.EMAIL_FROM || DEFAULT_FROM,
    replyTo: mart.replyTo || process.env.EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
  };
}

/** Accounts made without a real email carry a placeholder we must never mail. */
export function isRealEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.toLowerCase();
  return /^\S+@\S+\.\S+$/.test(e) && !e.endsWith(".local");
}

export const email = {
  get enabled(): boolean {
    return (process.env.RESEND_API_KEY || "").length > 0;
  },

  /**
   * Send up to 100 messages in one call (Resend's batch endpoint), which keeps
   * a cron run inside the Worker's subrequest budget. Returns false when email
   * is not configured.
   */
  async sendBatch(messages: EmailMessage[]): Promise<boolean> {
    if (messages.length === 0) return true;
    if (!this.enabled) {
      for (const m of messages) console.log(`[email:sim] to ${m.to}: ${m.subject}`);
      return false;
    }
    const { key, from, replyTo } = await config();
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        messages
          .slice(0, 100)
          .map((m) => ({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html, reply_to: replyTo }))
      ),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as any;
      throw new Error(json.message || `Resend send failed (${res.status})`);
    }
    return true;
  },
};
