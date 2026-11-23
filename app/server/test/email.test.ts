import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { email } from "../src/services/email";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

describe("email.sendBatch", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("sets reply_to from EMAIL_REPLY_TO on every message in the batch", async () => {
    process.env.EMAIL_REPLY_TO = "support@afrizonemart.com";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await email.sendBatch([{ to: "worker@example.com", subject: "Welcome", text: "Hi" }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body[0].reply_to).toBe("support@afrizonemart.com");
  });

  it("falls back to support@afrizonemart.com when EMAIL_REPLY_TO isn't set", async () => {
    delete process.env.EMAIL_REPLY_TO;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await email.sendBatch([{ to: "worker@example.com", subject: "Welcome", text: "Hi" }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body[0].reply_to).toBe("support@afrizonemart.com");
  });
});
