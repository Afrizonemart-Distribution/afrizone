/**
 * Tiers of work, from the Tier table (Settings > Tiers). The first five are
 * built in, seeded by migration 0041, and some rules key off them by name
 * (services/eligibility.ts, services/taskRules.ts). An admin can add more; a
 * tier is never deleted, only switched off, because tasks and Partimers keep
 * pointing at it.
 */
import { prisma } from "../prisma";
import { BUILT_IN_TIERS } from "../types";

export interface TierRow {
  key: string;
  label: string;
  description: string | null;
  docLabel: string | null;
  active: boolean;
  sortOrder: number;
}

export async function listTiers(opts: { activeOnly?: boolean } = {}): Promise<TierRow[]> {
  const rows = await prisma.tier.findMany({
    where: opts.activeOnly ? { active: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return rows;
}

/** Is `key` a tier that may be used right now? Built-ins always count. */
export async function isTierKey(key: unknown, opts: { activeOnly?: boolean } = { activeOnly: true }): Promise<boolean> {
  if (typeof key !== "string" || !key) return false;
  if ((BUILT_IN_TIERS as string[]).includes(key)) return true;
  const row = await prisma.tier.findUnique({ where: { key } });
  return !!row && (!opts.activeOnly || row.active);
}

/** "Field Sales" -> "FIELD_SALES". */
export function tierKeyFrom(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}
