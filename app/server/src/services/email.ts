/**
 * Email through Resend (the provider AfriZoneMart already uses; the
 * afrizonemart.com domain is verified there).
 *
 * Off until RESEND_API_KEY is set as a Worker secret: with no key, messages are
 * logged and `send` reports false, so callers record them as skipped instead of
 * pretending they went out. Read lazily, like sms.ts: Workers only fill
 * process.env once a request (or cron) is running.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function config() {
  return {
    key: process.env.RESEND_API_KEY || "",
    from: process.env.EMAIL_FROM || "AfriZone Jobs <jobs@afrizonemart.com>",
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
    return config().key.length > 0;
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
    const { key, from } = config();
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        messages.slice(0, 100).map((m) => ({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }))
      ),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as any;
      throw new Error(json.message || `Resend send failed (${res.status})`);
    }
    return true;
  },
};
