/**
 * Account emails to Partimers: welcome, approved for a task, payment released,
 * withdrawal paid or not sent. Sent through Resend (services/email.ts) next to
 * the push notification for the same moment, so a Partimer has a record even
 * without the app open.
 *
 * NOT gated on notifEmail: that switch is "Email summaries", a digest. These
 * are about the Partimer's own work and money. Phone-only accounts hold a
 * placeholder address and are skipped (isRealEmail).
 *
 * NEVER THROWS and never holds a request up for long: an email that fails must
 * not undo a payment or an approval that has already happened.
 */
import { prisma } from "../prisma";
import { email, isRealEmail } from "./email";

const PORTAL = "https://portal.parttime.afrizonemart.com";
const TIMEOUT_MS = 6000;

export interface PartimerEmail {
  subject: string;
  heading: string;
  paragraphs: string[];
  /** Optional button; defaults to opening the app. */
  cta?: { label: string; url: string };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderPartimerEmail(name: string, m: PartimerEmail): { text: string; html: string } {
  const first = (name || "there").split(" ")[0];
  const cta = m.cta ?? { label: "Open AfriZone Part Time", url: PORTAL };
  const text = [`Hi ${first},`, "", ...m.paragraphs.flatMap((p) => [p, ""]), `${cta.label}: ${cta.url}`, "", "AfriZone Part Time"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Raleway,Arial,sans-serif;color:#1d1d3a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#000066;padding:18px 24px;color:#FBAC34;font-weight:700;font-size:16px">AfriZone Part Time</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 14px;color:#000066">${esc(m.heading)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Hi ${esc(first)},</p>
${m.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join("\n")}
<p style="margin:20px 0 4px"><a href="${esc(cta.url)}" style="display:inline-block;background:#FBAC34;color:#000066;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">${esc(cta.label)}</a></p>
</td></tr>
<tr><td style="padding:14px 24px;font-size:12px;color:#6b6b80;border-top:1px solid #eee">You are getting this because you have an AfriZone Part Time account. Need help? Use Support in the app.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

async function withTimeout<T>(p: Promise<T>): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), TIMEOUT_MS))]);
}

/** Send one Partimer an account email. Returns whether it went. */
export async function emailPartimer(userId: string, m: PartimerEmail): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, role: true } });
    if (!user || user.role !== "WORKER" || !isRealEmail(user.email)) return false;
    const body = renderPartimerEmail(user.name, m);
    return (await withTimeout(email.sendBatch([{ to: user.email, subject: m.subject, ...body }]))) === true;
  } catch (e) {
    console.error(`[partimer-email] ${m.subject} failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * The welcome email, once per Partimer: the first time they have a real email
 * address. Claimed before sending, so two sign-in paths at once cannot both send.
 */
export async function sendWelcomeIfDue(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true, welcomeEmailedAt: true },
    });
    if (!user || user.role !== "WORKER" || user.welcomeEmailedAt || !isRealEmail(user.email)) return;
    const claimed = await prisma.user.updateMany({
      where: { id: userId, welcomeEmailedAt: null },
      data: { welcomeEmailedAt: new Date() },
    });
    if (claimed.count === 0) return;
    const went = await emailPartimer(userId, {
      subject: "Welcome to AfriZone Part Time",
      heading: "Welcome to AfriZone Part Time",
      paragraphs: [
        "Your account is set up. Here is how it works from here.",
        "1. Verify your identity in the app. A person checks it, usually within a working day.",
        "2. Find tasks that match your tier and skills, and apply.",
        "3. Do the work, submit your proof, and get paid into your wallet. Withdraw to your bank whenever you like.",
      ],
    });
    // Not sent (no email key yet, or Resend down): free the claim so the next
    // chance tries again, rather than marking a welcome that never arrived.
    if (!went) await prisma.user.update({ where: { id: userId }, data: { welcomeEmailedAt: null } });
  } catch (e) {
    console.error(`[partimer-email] welcome failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/** The four account moments, worded once. */
export const partimerEmails = {
  approved: (taskTitle: string): PartimerEmail => ({
    subject: `You've been picked for "${taskTitle}"`,
    heading: "You've been picked 🎉",
    paragraphs: [
      `Good news: you've been selected for "${taskTitle}".`,
      "Open the app to read and sign your contract. The pay is set aside for you as soon as the work starts.",
    ],
  }),
  paymentReleased: (net: number, taskTitle?: string): PartimerEmail => ({
    subject: `${naira(net)} added to your wallet`,
    heading: "Payment released 💰",
    paragraphs: [
      `${naira(net)} has been added to your AfriZone Part Time wallet${taskTitle ? ` for "${taskTitle}"` : ""}, after withholding tax.`,
      "You can withdraw it to your bank account from the Wallet tab.",
    ],
  }),
  withdrawalPaid: (amount: number, bank: string, reference?: string | null): PartimerEmail => ({
    subject: `${naira(amount)} sent to your bank`,
    heading: "Money sent ✅",
    paragraphs: [
      `Your ${naira(amount)} withdrawal has been paid to ${bank}.`,
      ...(reference ? [`Bank reference: ${reference}`] : []),
      "Banks usually show it within minutes. If you don't see it within 24 hours, contact Support in the app with the reference.",
    ],
  }),
  withdrawalNotSent: (amount: number, reason: string): PartimerEmail => ({
    subject: `Your ${naira(amount)} withdrawal was not sent`,
    heading: "Withdrawal not sent",
    paragraphs: [
      `Your ${naira(amount)} withdrawal was not sent: ${reason}`,
      "The money is back in your wallet. Check your bank details in the app, then try again.",
    ],
  }),
};
