/**
 * Where Part Time works. Countries come from the Country table: Nigeria is
 * live, the rest of Africa is listed as coming soon until an admin switches a
 * country on (Settings > Countries). States are kept here, per country, for
 * the live ones; a country with no list here takes a typed state.
 */
import { prisma } from "../prisma";

export const STATES: Record<string, string[]> = {
  NG: [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River",
    "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT (Abuja)", "Gombe", "Imo", "Jigawa", "Kaduna",
    "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
    "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
  ],
};

export interface CountryRow {
  code: string;
  name: string;
  live: boolean;
  sortOrder: number;
}

export async function listCountries(): Promise<CountryRow[]> {
  return prisma.country.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * Check a country + state pair. Returns an error message, or null when fine.
 * `state` may be empty (remote work, or a Partimer who has not said).
 */
export async function placeProblem(country: unknown, state: unknown): Promise<string | null> {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!code) return "Choose a country";
  const row = await prisma.country.findUnique({ where: { code } });
  if (!row) return "Unknown country";
  if (!row.live) return `${row.name} is coming soon. Part Time is only open in live countries for now.`;
  if (state === undefined || state === null || state === "") return null;
  if (typeof state !== "string" || state.length > 60) return "Choose a state";
  const list = STATES[code];
  if (list && !list.includes(state)) return `${state} is not a state in ${row.name}`;
  return null;
}
