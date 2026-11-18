// Stores and couriers are on hold (src/util/held.ts). The rest of the suite runs
// with PARTTIME_UNHOLD=all so the dormant code keeps its tests; this file clears
// it and checks the hold itself.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { heldRoute, isHeld, openAccountTypes } from "../src/util/held";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.PARTTIME_UNHOLD;
  delete process.env.PARTTIME_UNHOLD;
});
afterEach(() => {
  if (saved === undefined) delete process.env.PARTTIME_UNHOLD;
  else process.env.PARTTIME_UNHOLD = saved;
});

function run(feature: "stores" | "couriers") {
  let status = 0;
  let body: unknown;
  let passed = false;
  const res = {
    status(n: number) {
      status = n;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  };
  heldRoute(feature)({} as any, res as any, () => {
    passed = true;
  });
  return { status, body, passed };
}

describe("held features", () => {
  it("holds stores and couriers", () => {
    expect(isHeld("stores")).toBe(true);
    expect(isHeld("couriers")).toBe(true);
  });

  it("only opens Tasker sign-up", () => {
    expect(openAccountTypes()).toEqual(["INDIVIDUAL"]);
  });

  it("answers 404 and runs nothing behind a held route", () => {
    for (const f of ["stores", "couriers"] as const) {
      const r = run(f);
      expect(r.passed).toBe(false);
      expect(r.status).toBe(404);
    }
  });

  it("lets everything through when the test override is on", () => {
    process.env.PARTTIME_UNHOLD = "all";
    expect(openAccountTypes()).toEqual(["INDIVIDUAL", "STORE", "COURIER"]);
    expect(run("stores").passed).toBe(true);
  });
});
