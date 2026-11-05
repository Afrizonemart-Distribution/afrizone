/**
 * Task categories. Task.category is still the label itself (reports, the app's
 * filter chips and search all read it as text), and the Category table is the
 * list the task form offers.
 *
 * The task form lets an admin type a category that does not exist yet; the
 * task is saved under it and the category is added to the list in the same
 * step, so nobody has to leave the form to set one up first. Matching is
 * case- and spacing-insensitive, so "Store audit" never becomes a second
 * "store  audit".
 */
import { prisma } from "../prisma";
import { TIERS } from "../types";

export const MAX_CATEGORY_NAME = 60;

export function cleanCategoryName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_CATEGORY_NAME) return null;
  return name;
}

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The existing category with this name, or a new one. Returns the canonical
 * spelling, which is what the task should store. A retired category typed
 * again is brought back rather than duplicated.
 */
export async function ensureCategory(
  rawName: string,
  defaults: { tier?: string; payModel?: string }
): Promise<{ name: string; created: boolean; id: string }> {
  const name = cleanCategoryName(rawName);
  if (!name) throw new Error("Category name is empty or too long");

  // The list is small (tens), and SQLite has no case-insensitive Prisma mode.
  const all = await prisma.category.findMany({ select: { id: true, name: true, active: true } });
  const found = all.find((c) => key(c.name) === key(name));
  if (found) {
    if (!found.active) await prisma.category.update({ where: { id: found.id }, data: { active: true } });
    return { name: found.name, created: false, id: found.id };
  }

  const tier = defaults.tier && (TIERS as string[]).includes(defaults.tier) ? defaults.tier : "REMOTE";
  const payModel = defaults.payModel === "FIXED" ? "FIXED" : "HOURLY";
  const created = await prisma.category.create({
    data: { name, tier, defaultPayModel: payModel, active: true },
  });
  return { name: created.name, created: true, id: created.id };
}
