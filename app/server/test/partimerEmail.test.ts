// Account emails to Partimers (services/partimerEmail.ts): welcome once,
// never to a phone-only placeholder address, and a failed send never undoes
// what it was reporting.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiPatch, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";
import { emailPartimer, partimerEmails, renderPartimerEmail, sendWelcomeIfDue } from "../src/services/partimerEmail";

type Sent = { to: string[]; subject: string; html: string; text: string };

let saved: string | undefined;
function mockResend(ok = true) {
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.resend.com/")) return real(input as any, init);
    for (const m of JSON.parse(String(init?.body))) sent.push(m);
    return new Response(JSON.stringify(ok ? { data: [] } : { message: "down" }), { status: ok ? 200 : 500 });
  });
  return sent;
}

beforeEach(() => {
  saved = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (saved === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = saved;
});

describe("Partimer emails", () => {
  it("escapes what it puts in the page", () => {
    const { html, text } = renderPartimerEmail("Ada <b>Obi</b>", partimerEmails.approved('Count <script> shelves'));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(text).toContain("Hi Ada");
  });

  it("welcomes a Partimer once, and only to a real address", async () => {
    const sent = mockResend();
    const { user } = await createUserWithToken("WORKER", { name: "Ada Obi" });
    await sendWelcomeIfDue(user.id);
    await sendWelcomeIfDue(user.id);
    expect(sent.filter((m) => m.to[0] === user.email)).toHaveLength(1);
    expect(sent[0]!.subject).toContain("Welcome");

    const { user: phoneOnly } = await createUserWithToken("WORKER", { email: `2348000000${Date.now() % 1000}@phone.afrizone.local` });
    await sendWelcomeIfDue(phoneOnly.id);
    expect(sent.some((m) => m.to[0] === phoneOnly.email)).toBe(false);
  });

  it("tries the welcome again later if it could not be sent", async () => {
    mockResend(false);
    const { user } = await createUserWithToken("WORKER");
    await sendWelcomeIfDue(user.id);
    expect((await testPrisma().user.findUnique({ where: { id: user.id } }))!.welcomeEmailedAt).toBeNull();

    vi.unstubAllGlobals();
    const sent = mockResend();
    await sendWelcomeIfDue(user.id);
    expect(sent).toHaveLength(1);
  });

  it("sends the welcome when a phone sign-up adds their email", async () => {
    const sent = mockResend();
    const { user, token } = await createUserWithToken("WORKER", { email: `2348011111${Date.now() % 1000}@phone.afrizone.local` });
    const real = `real-${Date.now()}@example.com`;
    expect((await apiPatch("/api/me", { email: real }, token)).status).toBe(200);
    expect(sent.some((m) => m.to[0] === real && m.subject.includes("Welcome"))).toBe(true);
    expect((await testPrisma().user.findUnique({ where: { id: user.id } }))!.welcomeEmailedAt).not.toBeNull();
  });

  it("never emails staff, and never throws", async () => {
    mockResend(false);
    const { user: admin } = await createUserWithToken("SUPER_ADMIN");
    expect(await emailPartimer(admin.id, partimerEmails.paymentReleased(5000))).toBe(false);
    const { user } = await createUserWithToken("WORKER");
    await expect(emailPartimer(user.id, partimerEmails.withdrawalPaid(5000, "GTBank ••89", "REF1"))).resolves.toBe(false);
  });

  it("emails a Partimer when they are paid by bank transfer", async () => {
    const sent = mockResend();
    const prisma = testPrisma() as any;
    const { user: worker } = await createUserWithToken("WORKER", { bankMasked: "GTBank ••89" });
    const { token: signer } = await createUserWithToken("HR_ADMIN");
    const { token: payer } = await createUserWithToken("SUPER_ADMIN");
    const w = await prisma.withdrawal.create({
      data: { workerId: worker.id, amount: 7000, bankMasked: "GTBank ••89", status: "REVIEW", reference: `afz_wd_${worker.id}_mail` },
    });
    await apiPost(`/api/admin/withdrawals/${w.id}/sign-off`, {}, signer);
    expect((await apiPost(`/api/admin/withdrawals/${w.id}/paid-manually`, { reference: "SESSION-123" }, payer)).status).toBe(200);
    const mail = sent.find((m) => m.to[0] === worker.email);
    expect(mail?.subject).toContain("₦7,000");
    expect(mail?.text).toContain("SESSION-123");
  });
});
