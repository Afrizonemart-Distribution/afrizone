// Paystack integration: outbound Transfers (payouts to worker bank accounts)
// and inbound hosted-checkout (Afrizone Mart funding the platform balance).
//
// Env-driven: set PAYSTACK_SECRET in .env to go live. With no key, `enabled` is
// false and both flows run in SIMULATED mode (no real money moves).
//
// Outbound: create a transfer recipient (NUBAN + bank code) → initiate transfer
// (amount in kobo) → Paystack settles async → webhook flips status to PAID/FAILED.
// Docs: https://paystack.com/docs/transfers
//
// Inbound: initialize a transaction → redirect admin to the returned
// authorization_url → Paystack settles async → webhook (charge.success) flips
// the matching Funding row to SUCCESS.
// Docs: https://paystack.com/docs/payments/accept-payments

import crypto from "crypto";

// Read lazily, not at module load: Workers only populate process.env from
// bindings once request handling begins, not at pure module-evaluation time -
// reading these eagerly always saw them as unset, permanently forcing
// simulated mode regardless of what's actually configured. See src/auth.ts's
// jwtSecret() for the same pattern (there it also crashes the deploy, since
// JWT_SECRET is checked at import time; here it just fails silently, which is
// worse).
function secret(): string {
  return process.env.PAYSTACK_SECRET || "";
}
function base(): string {
  return process.env.PAYSTACK_BASE || "https://api.paystack.co";
}

export const paystack = {
  /** True when a secret key is configured: gates all real network calls. */
  get enabled(): boolean {
    return secret().length > 0;
  },

  /** Low-level authenticated call to the Paystack API. */
  async call(path: string, method: "GET" | "POST", body?: unknown): Promise<any> {
    const SECRET = secret();
    if (!SECRET) throw new Error("PAYSTACK_SECRET is not set");
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json.status === false) {
      throw new Error(json.message || `Paystack ${path} failed (${res.status})`);
    }
    return json.data;
  },

  /** Create (or reuse) a transfer recipient for a NUBAN account. Returns recipient_code. */
  async createRecipient(input: { name: string; accountNumber: string; bankCode: string }): Promise<string> {
    const data = await this.call("/transferrecipient", "POST", {
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    });
    return data.recipient_code as string;
  },

  /** Initiate a transfer. `amountNaira` is whole Naira; Paystack expects kobo. */
  async initiateTransfer(input: {
    amountNaira: number;
    recipientCode: string;
    reference: string;
    reason?: string;
  }): Promise<{ status: string; transferCode: string }> {
    const data = await this.call("/transfer", "POST", {
      source: "balance",
      amount: input.amountNaira * 100,
      recipient: input.recipientCode,
      reference: input.reference,
      reason: input.reason || "AfriZone PartTime payout",
    });
    return { status: data.status as string, transferCode: data.transfer_code as string };
  },

  /** Start a hosted-checkout inbound payment. `amountNaira` is whole Naira. */
  async initializeTransaction(input: {
    amountNaira: number;
    email: string;
    reference: string;
    callbackUrl?: string;
  }): Promise<{ authorizationUrl: string; accessCode: string }> {
    const data = await this.call("/transaction/initialize", "POST", {
      amount: input.amountNaira * 100,
      email: input.email,
      reference: input.reference,
      callback_url: input.callbackUrl,
    });
    return { authorizationUrl: data.authorization_url as string, accessCode: data.access_code as string };
  },

  /** Verify the X-Paystack-Signature header (HMAC-SHA512 of the raw body). */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    const SECRET = secret();
    if (!SECRET || !signature) return false;
    const hash = crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex");
    // timing-safe compare
    const a = Buffer.from(hash);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
};
