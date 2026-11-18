/**
 * Parts of Part Time that are ON HOLD (product decision, 2026-11-18).
 *
 *   stores    Partner AZM Stores are not being taken on. No store accounts,
 *             no organizations, no store audits, no store.applied intake.
 *   couriers  Delivery is being built into the AfriZoneMart storefront instead.
 *             No courier accounts, no deliveries, no order.confirmed intake.
 *
 * The code and tables stay; they are switched off here, in one place. Turning
 * one back on means flipping its line below and putting the client entry points
 * back. Production had no store or courier accounts, organizations or
 * deliveries when this went in, so nobody was stranded by it.
 */
import type { NextFunction, Request, Response } from "express";
import type { AccountType } from "../types";

const DECIDED = { stores: true, couriers: true } as const;
export type HeldFeature = keyof typeof DECIDED;

/**
 * Whether a feature is held right now. Read per call, not at load: Workers fill
 * process.env from bindings once requests start. PARTTIME_UNHOLD=all is set
 * only by the test config, so the dormant code keeps its tests and does not rot.
 */
export function isHeld(feature: HeldFeature): boolean {
  return DECIDED[feature] && process.env.PARTTIME_UNHOLD !== "all";
}

/** The account types somebody can sign up as right now. */
export function openAccountTypes(): AccountType[] {
  return [
    "INDIVIDUAL",
    ...(isHeld("stores") ? [] : (["STORE"] as AccountType[])),
    ...(isHeld("couriers") ? [] : (["COURIER"] as AccountType[])),
  ];
}

/**
 * Answers 404 for a held feature, so nothing behind it runs. 404 rather than
 * 403: there is nothing there to be refused, and an old app build that still
 * calls it shows "not found" rather than a permissions error.
 */
export function heldRoute(feature: HeldFeature) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!isHeld(feature)) return next();
    return res.status(404).json({ error: "This part of Afrizone Part Time is not open." });
  };
}
