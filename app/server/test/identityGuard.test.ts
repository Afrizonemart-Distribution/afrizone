// One person, one account (services/identityGuard.ts). Five flows at most:
// the D1 pool hangs past about that many in one file.
import { describe, it, expect } from "vitest";
import { apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken } from "./helpers";
import { hashValue, idNumberFrom, normalise } from "../src/services/identityGuard";

let n = 0;
/** A fresh 10-digit account number per test, so runs never collide. */
const acct = () => String(Date.now() * 10 + (++n % 10)).slice(-10);

const saveBank = (token: string, number: string) =>
  apiPatch("/api/me", { bankName: "GTBank", bankCode: "058", bankAccountNumber: number }, token);
const withdraw = (token: string) => apiPost("/api/wallet/withdraw", { amount: 5000 }, token);

async function caseFor(adminToken: string, userId: string, status = "ALL") {
  const list = await apiGet(`/api/admin/identity-flags?status=${status}`, adminToken);
  return list.body.find((f: any) => f.accounts.some((a: any) => a.id === userId));
}

describe("identity guard", () => {
  it("normalises, hashes and finds ID numbers wherever a provider puts them", () => {
    expect(normalise("ID_NUMBER", " a12-34 5 ")).toBe("A12345");
    expect(normalise("BANK", "058:123")).toBeNull();
    expect(hashValue("BANK", "058:0123456789")).toHaveLength(64);
    expect(hashValue("BANK", "058:0123456789")).not.toBe(hashValue("ID_NUMBER", "058:0123456789"));
    expect(idNumberFrom({ result: { Actions: {}, FullData: { IDNumber: "12345678901" } } })).toBe("12345678901");
    expect(idNumberFrom({ nothing: true })).toBeNull();
  });

  it("holds payouts for every account sharing a bank account, until cleared", async () => {
    const admin = await createUserWithToken("HR_ADMIN");
    const a = await createUserWithToken("WORKER");
    const b = await createUserWithToken("WORKER");
    const number = acct();

    expect((await saveBank(a.token, number)).status).toBe(200);
    // One account alone is nobody's business.
    expect((await withdraw(a.token)).body.code).not.toBe("IDENTITY_HOLD");

    expect((await saveBank(b.token, number)).status).toBe(200);
    const flag = await caseFor(admin.token, a.user.id, "OPEN");
    expect(flag.kind).toBe("BANK");
    expect(flag.holdsPayouts).toBe(true);
    expect(flag.accounts.map((x: any) => x.id).sort()).toEqual([a.user.id, b.user.id].sort());

    for (const t of [a.token, b.token]) {
      const w = await withdraw(t);
      expect(w.status).toBe(403);
      expect(w.body.code).toBe("IDENTITY_HOLD");
    }

    expect((await apiPost(`/api/admin/identity-flags/${flag.id}/decide`, { decision: "CLEARED" }, admin.token)).status).toBe(400);
    const cleared = await apiPost(
      `/api/admin/identity-flags/${flag.id}/decide`,
      { decision: "CLEARED", note: "Spouses, one shared account, confirmed by phone" },
      admin.token
    );
    expect(cleared.status).toBe(200);
    // Released: what stops them now is only their (empty) balance.
    expect((await withdraw(a.token)).body.code).not.toBe("IDENTITY_HOLD");

    // A third account on the same number reopens the case.
    const c = await createUserWithToken("WORKER");
    await saveBank(c.token, number);
    const reopened = await caseFor(admin.token, c.user.id);
    expect(reopened.id).toBe(flag.id);
    expect(reopened.status).toBe("OPEN");
    expect(reopened.accounts).toHaveLength(3);
  });

  it("shows a shared phone to staff without holding anyone's pay", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const a = await createUserWithToken("WORKER");
    const b = await createUserWithToken("WORKER");
    const device = `dev_${Date.now()}_${++n}_abcdefgh`;
    expect((await apiPost("/api/me/device", { deviceId: "short" }, a.token)).status).toBe(400);
    expect((await apiPost("/api/me/device", { deviceId: device }, a.token)).status).toBe(204);
    expect((await apiPost("/api/me/device", { deviceId: device }, b.token)).status).toBe(204);

    const flag = await caseFor(admin.token, a.user.id);
    expect(flag.kind).toBe("DEVICE");
    expect(flag.severity).toBe("LOW");
    expect(flag.holdsPayouts).toBe(false);
  });

  it("catches a second account on an ID number a reviewer typed", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const a = await createUserWithToken("WORKER");
    const b = await createUserWithToken("WORKER");
    const nin = `9${Date.now()}`.slice(0, 11);

    await apiPost(`/api/workers/${a.user.id}/kyc`, { decision: "TIER_APPROVED", idNumber: nin }, admin.token);
    // Same number, typed with spaces: still the same document.
    const spaced = `${nin.slice(0, 4)} ${nin.slice(4)}`;
    await apiPost(`/api/workers/${b.user.id}/kyc`, { decision: "TIER_APPROVED", idNumber: spaced }, admin.token);

    const flag = await caseFor(admin.token, b.user.id);
    expect(flag.kind).toBe("ID_NUMBER");
    expect(flag.holdsPayouts).toBe(true);

    const confirmed = await apiPost(
      `/api/admin/identity-flags/${flag.id}/decide`,
      { decision: "CONFIRMED", note: "Same face on both selfies" },
      admin.token
    );
    expect(confirmed.status).toBe(200);
    // Confirmed keeps the hold.
    expect((await withdraw(b.token)).status).not.toBe(200);
  });

  it("is staff-only, and the backfill scan is Super Admin only", async () => {
    const worker = await createUserWithToken("WORKER");
    const hr = await createUserWithToken("HR_ADMIN");
    const sa = await createUserWithToken("SUPER_ADMIN");
    expect((await apiGet("/api/admin/identity-flags", worker.token)).status).toBe(403);
    expect((await apiPost("/api/admin/identity-flags/scan", {}, hr.token)).status).toBe(403);
    const scan = await apiPost("/api/admin/identity-flags/scan", {}, sa.token);
    expect(scan.status).toBe(200);
    expect(typeof scan.body.scanned).toBe("number");
  });
});
