// GET /api/integrations/mart/stores: Mart's admin lists the partner stores an
// order can go to. Signed over an empty body; ACTIVE stores only.
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { SELF } from "cloudflare:test";
import { testPrisma } from "./helpers";

const SECRET = "local-dev-mart-inbound-secret";

async function getStores(secret = SECRET) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.`).digest("hex");
  const res = await SELF.fetch("http://local.test/api/integrations/mart/stores", {
    headers: { "X-Afz-Timestamp": ts, "X-Afz-Signature": sig },
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}

describe("mart store list", () => {
  it("lists active stores only, and refuses a bad signature", async () => {
    const prisma = testPrisma() as any;
    const n = Date.now();
    await prisma.organization.create({ data: { name: "Ikeja Mart", slug: `ikeja-${n}`, kind: "STORE", status: "ACTIVE", address: "Ikeja" } });
    await prisma.organization.create({ data: { name: "Pending Mart", slug: `pending-${n}`, kind: "STORE", status: "PENDING" } });
    await prisma.organization.create({ data: { name: "Rider Co", slug: `rider-${n}`, kind: "COURIER", status: "ACTIVE" } });

    const ok = await getStores();
    expect(ok.status).toBe(200);
    const slugs = ok.body.stores.map((s: any) => s.slug);
    expect(slugs).toContain(`ikeja-${n}`);
    expect(slugs).not.toContain(`pending-${n}`);
    expect(slugs).not.toContain(`rider-${n}`);
    expect(ok.body.stores.find((s: any) => s.slug === `ikeja-${n}`)).toEqual({
      slug: `ikeja-${n}`, name: "Ikeja Mart", address: "Ikeja", lat: null, lng: null,
    });

    expect((await getStores("wrong")).status).toBe(401);
  });
});
