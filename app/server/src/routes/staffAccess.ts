// Staff access: a Part-Time admin adds the people who run Part-Time
// (2026-11-25). Mounted under /api/admin/staff, SUPER_ADMIN only.
//
//   GET   /api/admin/staff               -> { staff }
//   POST  /api/admin/staff               { name, email, role } -> { member }
//   PATCH /api/admin/staff/:id           { role }              -> { member }
//   POST  /api/admin/staff/:id/invite    -> { sent }   (a fresh set-password link)
//   POST  /api/admin/staff/:id/remove    -> { removed: true }
//
// Roles: SUPER_ADMIN (runs Part-Time, manages staff, releases money),
// TASK_MANAGER (posts tasks, approves applications and work), HR_ADMIN
// (KYC and credential review, candidates). Staff roles used to come from
// Afrizonemart; they are Part-Time's own now, so nothing here needs an
// Afrizonemart account.
//
// Rules: a staff account is never a Partimer account (an email already used
// by a Partimer is refused: staff use their work email). Nobody changes or
// removes themselves, and the last SUPER_ADMIN can't be demoted or removed.
// Removing someone sets their role to REMOVED and clears every way to sign
// in; requireRole reads the live role, so their console access ends at once.
// Every change is audited.

import { Router, type Response } from "express";
import crypto from "crypto";
import { prisma } from "../prisma";
import { ADMIN_ROLES, AuthedRequest, requireAuth, requireRole } from "../auth";
import { userActor, writeAudit } from "../util/audit";
import { email as mailer } from "../services/email";
import type { Role } from "../types";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN"));

/** Set-password links for new staff last three days; a reset link lasts 30 minutes. */
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const REMOVED_ROLE = "REMOVED";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isStaffRole = (r: unknown): r is Role => typeof r === "string" && (ADMIN_ROLES as string[]).includes(r);

const select = {
  id: true,
  name: true,
  email: true,
  role: true,
  totpEnabled: true,
  passwordHash: true,
  googleId: true,
  createdAt: true,
} as const;

type Row = { id: string; name: string; email: string; role: string; totpEnabled: boolean; passwordHash: string | null; googleId: string | null; createdAt: Date };

/** Never send the hash: only whether they can sign in yet. */
function shape(u: Row) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    twoFactor: u.totpEnabled,
    canSignIn: !!u.passwordHash || !!u.googleId,
    createdAt: u.createdAt,
  };
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Admin",
  TASK_MANAGER: "Task manager",
  HR_ADMIN: "KYC & people reviewer",
};

/** A set-password link by email. Returns false if email isn't configured. */
async function sendInvite(user: { id: string; name: string; email: string; role: string }, inviter: string): Promise<boolean> {
  const rawToken = (crypto.randomBytes(32) as any).toString("hex");
  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  const admin = (process.env.WEB_ADMIN_URL || "").replace(/\/+$/, "");
  const link = `${admin}/reset-password?token=${rawToken}`;
  const role = ROLE_LABEL[user.role] ?? user.role;
  const text = `Hi ${user.name},

${inviter} has added you to the AZM Part Time staff console as ${role}.

Set your password here: ${link}

The link works once and expires in 3 days. After that, sign in at ${admin || "the staff console"} with this email address.`;
  const html = `<p>Hi ${escapeHtml(user.name)},</p><p>${escapeHtml(inviter)} has added you to the AZM Part Time staff console as <b>${escapeHtml(role)}</b>.</p><p><a href="${link}">Set your password</a></p><p>The link works once and expires in 3 days. After that, sign in with this email address.</p>`;
  try {
    return await mailer.sendBatch([{ to: user.email, subject: "You've been added to AZM Part Time", text, html }]);
  } catch (e) {
    console.error(`[staff] invite email failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function inviterName(req: AuthedRequest): Promise<string> {
  const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
  return me?.name || "A Part Time admin";
}

/** The one SUPER_ADMIN left can't lose the role: someone has to run Part-Time. */
async function isLastSuperAdmin(userId: string): Promise<boolean> {
  const others = await prisma.user.count({ where: { role: "SUPER_ADMIN", id: { not: userId } } });
  return others === 0;
}

async function staffById(id: string): Promise<Row | null> {
  const u = await prisma.user.findUnique({ where: { id }, select });
  return u && isStaffRole(u.role) ? u : null;
}

router.get("/", async (_req: AuthedRequest, res: Response) => {
  const rows = await prisma.user.findMany({
    where: { role: { in: ADMIN_ROLES as string[] } },
    select,
    orderBy: { createdAt: "asc" },
  });
  return res.json({ staff: rows.map(shape) });
});

router.post("/", async (req: AuthedRequest, res: Response) => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const role = req.body?.role;
  if (!name || name.length > 120) return res.status(400).json({ error: "Enter the person's name." });
  if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: "Enter a valid email address." });
  if (!isStaffRole(role)) return res.status(400).json({ error: "Choose a role." });

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existing) {
    if (isStaffRole(existing.role)) {
      return res.status(409).json({ error: "This person is already on the staff list.", code: "ALREADY_STAFF" });
    }
    if (existing.role === REMOVED_ROLE) {
      // Coming back: reuse the account, start clean.
      const back = await prisma.user.update({ where: { id: existing.id }, data: { name, role }, select });
      await writeAudit(userActor(req.user!.id), "STAFF_ADDED", "User", back.id, { role, rehired: true });
      const sent = await sendInvite(back, await inviterName(req));
      return res.status(201).json({ member: shape(back), inviteSent: sent });
    }
    return res.status(409).json({
      error: "This email already belongs to a Partimer account. Staff accounts use the person's work email, so use a different one.",
      code: "PARTIMER_EMAIL",
    });
  }

  const created = await prisma.user.create({
    data: { name, email, role, passwordHash: null, tiers: "" },
    select,
  });
  await writeAudit(userActor(req.user!.id), "STAFF_ADDED", "User", created.id, { role });
  const sent = await sendInvite(created, await inviterName(req));
  return res.status(201).json({ member: shape(created), inviteSent: sent });
});

router.patch("/:id", async (req: AuthedRequest, res: Response) => {
  const role = req.body?.role;
  if (!isStaffRole(role)) return res.status(400).json({ error: "Choose a role." });
  if (req.params.id === req.user!.id) return res.status(400).json({ error: "You can't change your own role. Ask another admin.", code: "SELF" });
  const member = await staffById(req.params.id);
  if (!member) return res.status(404).json({ error: "Staff member not found" });
  if (member.role === role) return res.json({ member: shape(member) });
  if (member.role === "SUPER_ADMIN" && (await isLastSuperAdmin(member.id))) {
    return res.status(409).json({ error: "Part Time needs at least one admin. Make someone else an admin first.", code: "LAST_ADMIN" });
  }
  const updated = await prisma.user.update({ where: { id: member.id }, data: { role }, select });
  await writeAudit(userActor(req.user!.id), "STAFF_ROLE_CHANGED", "User", member.id, { from: member.role, to: role });
  return res.json({ member: shape(updated) });
});

router.post("/:id/invite", async (req: AuthedRequest, res: Response) => {
  const member = await staffById(req.params.id);
  if (!member) return res.status(404).json({ error: "Staff member not found" });
  const sent = await sendInvite(member, await inviterName(req));
  await writeAudit(userActor(req.user!.id), "STAFF_INVITE_SENT", "User", member.id, { sent });
  if (!sent) return res.status(502).json({ error: "The email could not be sent. Check the email settings and try again." });
  return res.json({ sent: true });
});

router.post("/:id/remove", async (req: AuthedRequest, res: Response) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: "You can't remove yourself. Ask another admin.", code: "SELF" });
  const member = await staffById(req.params.id);
  if (!member) return res.status(404).json({ error: "Staff member not found" });
  if (member.role === "SUPER_ADMIN" && (await isLastSuperAdmin(member.id))) {
    return res.status(409).json({ error: "Part Time needs at least one admin.", code: "LAST_ADMIN" });
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: member.id },
      data: { role: REMOVED_ROLE, passwordHash: null, googleId: null, totpEnabled: false, totpSecret: null },
    }),
    // Unused set-password links die with the access.
    prisma.passwordReset.updateMany({ where: { userId: member.id, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
  await writeAudit(userActor(req.user!.id), "STAFF_REMOVED", "User", member.id, { role: member.role });
  return res.json({ removed: true });
});

export default router;
