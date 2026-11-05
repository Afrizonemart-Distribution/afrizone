/**
 * One person, one account.
 *
 * Some facts belong to exactly one person: the bank account their pay goes
 * to, the number on their government ID, the phone they work from. When two
 * accounts share one, that is either a household sharing a phone or someone
 * farming accounts, and only a person can tell which. So nothing here bans
 * anybody. It records the fact (as a hash), opens a case when it is shared,
 * and, for the strong signals, pauses money leaving the platform until staff
 * decide.
 *
 *   BANK       HIGH  Pay for two accounts landing in one bank account is the
 *                    clearest sign of one person behind both.
 *   ID_NUMBER  HIGH  Two accounts verified with the same ID number.
 *   DEVICE     LOW   Shown to staff, never enforced: families share phones.
 *
 * HIGH cases that are OPEN or CONFIRMED hold withdrawals for every account on
 * them. CLEARED lifts it, until a new account joins the same value, which
 * reopens the case.
 *
 * Values are stored as a SHA-256 of a namespaced, normalised form. The salt is
 * fixed rather than secret on purpose: a rotated secret would silently stop
 * every old value matching every new one, and the point of the hash is only
 * that this table never holds an ID number in the clear.
 */
import crypto from "node:crypto";
import { prisma } from "../prisma";

export type SignalKind = "BANK" | "ID_NUMBER" | "DEVICE";
export const SIGNAL_KINDS: SignalKind[] = ["BANK", "ID_NUMBER", "DEVICE"];
const SEVERITY: Record<SignalKind, "HIGH" | "LOW"> = { BANK: "HIGH", ID_NUMBER: "HIGH", DEVICE: "LOW" };

export const KIND_LABEL: Record<SignalKind, string> = {
  BANK: "Same payout bank account",
  ID_NUMBER: "Same ID number",
  DEVICE: "Same phone",
};

const SALT = "afrizone-parttime/identity/v1";

/** The comparable form of a value, or null when there is nothing to compare. */
export function normalise(kind: SignalKind, raw: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  switch (kind) {
    case "BANK":
      // "bankCode:accountNumber" - digits only on both sides.
      return /^\d{2,6}:\d{10}$/.test(v) ? v : null;
    case "ID_NUMBER":
      // NIN, passport, licence and voter numbers: letters and digits, case-blind.
      return v.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null;
    case "DEVICE":
      return /^[A-Za-z0-9_-]{16,128}$/.test(v) ? v : null;
  }
}

export function hashValue(kind: SignalKind, normalised: string): string {
  return crypto.createHash("sha256").update(`${SALT}:${kind}:${normalised}`).digest("hex");
}

/**
 * Record that this account has this value, and open or refresh the case when
 * another account has it too. Never throws into the caller's request: a
 * failure here must not stop someone saving their bank details.
 */
export async function recordSignal(userId: string, kind: SignalKind, raw: string): Promise<void> {
  try {
    const value = normalise(kind, raw);
    if (!value) return;
    const valueHash = hashValue(kind, value);
    const now = new Date();

    await prisma.identitySignal.upsert({
      where: { kind_valueHash_userId: { kind, valueHash, userId } },
      create: { userId, kind, valueHash },
      update: { lastSeenAt: now },
    });

    const holders = await prisma.identitySignal.findMany({
      where: { kind, valueHash },
      select: { userId: true },
    });
    const userIds = [...new Set(holders.map((h) => h.userId))].sort();
    if (userIds.length < 2) return;

    const existing = await prisma.identityFlag.findUnique({ where: { kind_valueHash: { kind, valueHash } } });
    if (!existing) {
      await prisma.identityFlag.create({
        data: { kind, valueHash, userIds: JSON.stringify(userIds), severity: SEVERITY[kind] },
      });
      return;
    }
    const known: string[] = safeIds(existing.userIds);
    const joined = userIds.some((id) => !known.includes(id));
    if (!joined) return;
    // Somebody new shares it: whatever was decided was about other people.
    await prisma.identityFlag.update({
      where: { id: existing.id },
      data: {
        userIds: JSON.stringify(userIds),
        ...(existing.status === "CLEARED" ? { status: "OPEN", decidedById: null, decidedAt: null } : {}),
      },
    });
  } catch (e) {
    console.error(`[identityGuard] ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function safeIds(stored: string): string[] {
  try {
    const v = JSON.parse(stored);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Why this account's money is held, or null. Matched in JS over the open HIGH
 * cases: there are few, and SQLite cannot index into the JSON id list.
 */
export async function payoutHold(userId: string): Promise<string | null> {
  const flags = await prisma.identityFlag.findMany({
    where: { severity: "HIGH", status: { in: ["OPEN", "CONFIRMED"] } },
    select: { kind: true, userIds: true, status: true },
  });
  const mine = flags.find((f) => safeIds(f.userIds).includes(userId));
  if (!mine) return null;
  return mine.status === "CONFIRMED"
    ? "Payouts are stopped on this account. Contact AfriZone support."
    : "Payouts are paused while we confirm this account belongs to one person. We'll be in touch; contact support if it's urgent.";
}

/**
 * Pull a document number out of an identity provider's result, wherever that
 * provider put it. Returns null rather than guessing.
 */
export function idNumberFrom(raw: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | null => {
    if (!v || typeof v !== "object" || depth > 4 || seen.has(v)) return null;
    seen.add(v);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/^(id_?number|idnumber|document_?number)$/i.test(k) && typeof val === "string" && val.trim()) {
        return val.trim();
      }
    }
    for (const val of Object.values(v as Record<string, unknown>)) {
      const hit = walk(val, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(raw, 0);
}
