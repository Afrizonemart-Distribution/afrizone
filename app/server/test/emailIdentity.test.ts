// Who Part Time's email comes from, and where replies go: set in the
// storefront admin (Integrations: EMAIL_FROM_PARTTIME / EMAIL_REPLY_TO_PARTTIME),
// read from AfriZoneMart's public config feed, falling back to the Worker's
// own settings. A missing or broken feed never stops an email.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { email, resetEmailIdentityCache } from "../src/services/email";

const KEYS = ["RESEND_API_KEY", "MART_BASE_URL", "MART_CONFIG_URL", "EMAIL_FROM", "EMAIL_REPLY_TO"] as const;
const saved: Record<string, string | undefined> = {};

function stub(feed: Record<string, string> | "down") {
  const sent: any[] = [];
  let feedCalls = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://mart.test/api/config/public") {
      feedCalls++;
      if (feed === "down") throw new Error("unreachable");
      return new Response(JSON.stringify(feed), { status: 200 });
    }
    if (url.startsWith("https://api.resend.com/")) {
      sent.push(...JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { sent, feedCalls: () => feedCalls };
}

const msg = { to: "ada@example.com", subject: "Hi", text: "Hello" };

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.RESEND_API_KEY = "re_test";
  process.env.MART_BASE_URL = "https://mart.test/api/integrations";
  resetEmailIdentityCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEmailIdentityCache();
});

describe("email sender identity", () => {
  it("uses the From and Reply-To set in the storefront admin", async () => {
    const s = stub({ EMAIL_FROM_PARTTIME: "AfriZone Jobs <jobs@parttime.afrizonemart.com>", EMAIL_REPLY_TO_PARTTIME: "jobs@afrizonemart.com" });
    await email.sendBatch([msg]);
    await email.sendBatch([msg]);
    expect(s.sent[0]).toMatchObject({ from: "AfriZone Jobs <jobs@parttime.afrizonemart.com>", reply_to: "jobs@afrizonemart.com" });
    expect(s.feedCalls()).toBe(1); // cached, not fetched per email
  });

  it("falls back to the Worker settings when the admin has not set them", async () => {
    process.env.EMAIL_FROM = "Part Time <pt@afrizonemart.com>";
    process.env.EMAIL_REPLY_TO = "help@afrizonemart.com";
    const s = stub({ SOME_OTHER_KEY: "x" });
    await email.sendBatch([msg]);
    expect(s.sent[0]).toMatchObject({ from: "Part Time <pt@afrizonemart.com>", reply_to: "help@afrizonemart.com" });
  });

  it("still sends, with the defaults, when the feed is down", async () => {
    const s = stub("down");
    expect(await email.sendBatch([msg])).toBe(true);
    expect(s.sent[0]).toMatchObject({ from: "AfriZone Jobs <jobs@afrizonemart.com>", reply_to: "support@afrizonemart.com" });
  });
});
