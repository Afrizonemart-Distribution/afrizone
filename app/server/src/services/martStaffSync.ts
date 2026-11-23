// Staff roles follow Afrizonemart (2026-11-17).
//
// Staff access is granted in one place, Afrizonemart (managed from this
// console's Staff access screen), and Part-Time's D1 isn't connected to
// Afrizonemart's database. So every few minutes we pull the complete list of
// Part-Time staff roles from Afrizonemart and make every LINKED account match
// it: listed = that role, not listed = WORKER. Accounts not linked to
// AfriZone (afrizoneUserId null) are left alone and only counted.
//
//   GET {AFRIZONE_API_URL}/api/integrations/parttime/staff-roles
//   Authorization: Bearer {MART_STAFF_SYNC_TOKEN}   (read-only service token)
//
// Fail safe, never fail open: any fetch or shape problem changes nothing.
// Brakes: an empty list, a run that would demote more than MAX_DEMOTIONS
// admins, or one that would leave no SUPER_ADMIN, is refused and logged.

import type { PrismaClient } from "@prisma/client";
import { SYSTEM_ACTORS, auditData } from "../util/audit";

const STAFF_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "TASK_MANAGER", "AZM_HR"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];
const MAX_DEMOTIONS = 5;

export interface MartStaffEntry {
  afrizoneUserId: string;
  role: StaffRole;
}

export interface SyncResult {
  skipped?: string;
  promoted: number;
  demoted: number;
  changed: number;
  unmanagedStaff: number;
}

export function martStaffSyncConfigured(): boolean {
  return Boolean(process.env.MART_STAFF_SYNC_TOKEN);
}

/** Parse and validate the response; null if anything about it is off. */
export function parseStaffRoles(body: unknown): MartStaffEntry[] | null {
  const staff = (body as { staff?: unknown } | null)?.staff;
  if (!Array.isArray(staff)) return null;
  const out: MartStaffEntry[] = [];
  for (const s of staff) {
    const id = (s as any)?.afrizoneUserId;
    const role = (s as any)?.role;
    if (typeof id !== "string" || !id || !(STAFF_ROLES as readonly string[]).includes(role)) return null;
    out.push({ afrizoneUserId: id, role });
  }
  return out;
}

export async function fetchMartStaffRoles(fetchImpl: typeof fetch = fetch): Promise<MartStaffEntry[] | null> {
  const base = (process.env.AFRIZONE_API_URL || "https://api.afrizonemart.com").replace(/\/+$/, "");
  // include=azm_hr: we understand the AZM_HR role. An older Worker that
  // doesn't send it never receives that role, so its strict parser can't trip.
  const res = await fetchImpl(`${base}/api/integrations/parttime/staff-roles?include=azm_hr`, {
    headers: { Authorization: `Bearer ${process.env.MART_STAFF_SYNC_TOKEN}` },
  });
  if (!res.ok) throw new Error(`staff-roles fetch failed: ${res.status}`);
  return parseStaffRoles(await res.json());
}

/** Pure plan: which linked accounts change, given the Afrizonemart list. */
export function planRoleChanges(
  users: { id: string; afrizoneUserId: string | null; role: string }[],
  wanted: MartStaffEntry[],
): { changes: { id: string; from: string; to: string }[]; unmanagedStaff: number; refused?: string } {
  const byAfrizone = new Map(wanted.map((w) => [w.afrizoneUserId, w.role]));
  const changes: { id: string; from: string; to: string }[] = [];
  let unmanagedStaff = 0;
  for (const u of users) {
    if (!u.afrizoneUserId) {
      if (u.role !== "WORKER") unmanagedStaff++;
      continue;
    }
    const to = byAfrizone.get(u.afrizoneUserId) ?? "WORKER";
    if (to !== u.role) changes.push({ id: u.id, from: u.role, to });
  }
  const demotions = changes.filter((c) => c.to === "WORKER").length;
  if (wanted.length === 0) return { changes: [], unmanagedStaff, refused: "empty list from Afrizonemart" };
  if (demotions > MAX_DEMOTIONS) {
    return { changes: [], unmanagedStaff, refused: `would demote ${demotions} staff at once (max ${MAX_DEMOTIONS})` };
  }
  const after = new Map(users.map((u) => [u.id, u.role]));
  for (const c of changes) after.set(c.id, c.to);
  if (![...after.values()].includes("SUPER_ADMIN")) {
    return { changes: [], unmanagedStaff, refused: "would leave no SUPER_ADMIN" };
  }
  return { changes, unmanagedStaff };
}

export async function syncMartStaffRoles(
  prisma: PrismaClient,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const empty = { promoted: 0, demoted: 0, changed: 0, unmanagedStaff: 0 };
  if (!martStaffSyncConfigured()) return { ...empty, skipped: "MART_STAFF_SYNC_TOKEN not set" };
  const wanted = await fetchMartStaffRoles(fetchImpl);
  if (!wanted) return { ...empty, skipped: "malformed staff-roles response" };

  // Everyone who is staff now, plus every linked account (a linked WORKER may
  // be promoted).
  const users = await prisma.user.findMany({
    where: { OR: [{ role: { not: "WORKER" } }, { afrizoneUserId: { not: null } }] },
    select: { id: true, afrizoneUserId: true, role: true },
  });
  const plan = planRoleChanges(users, wanted);
  if (plan.refused) return { ...empty, unmanagedStaff: plan.unmanagedStaff, skipped: plan.refused };

  for (const c of plan.changes) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: c.id }, data: { role: c.to } }),
      prisma.auditLog.create({
        data: auditData(SYSTEM_ACTORS.martStaffSync, "STAFF_ROLE_FROM_AFRIZONEMART", "User", c.id, {
          from: c.from,
          to: c.to,
          via: "sync",
        }),
      }),
    ]);
  }
  return {
    promoted: plan.changes.filter((c) => c.to !== "WORKER").length,
    demoted: plan.changes.filter((c) => c.to === "WORKER").length,
    changed: plan.changes.length,
    unmanagedStaff: plan.unmanagedStaff,
  };
}
