/**
 * The Talent Profile: one person's hiring profile, assembled for three readers.
 *
 *   self   - the worker editing it. Everything, including private files.
 *   staff  - Afrizone HR / task managers. Everything, plus contact details.
 *   public - anyone holding the share link. No email, phone, files or
 *            anything unverified that could pass for verified.
 *
 * WHAT IS PROVEN AND WHAT IS CLAIMED is the point of the whole feature. A CV
 * anyone can type is worth what anyone can type. So every section says which
 * it is:
 *   - work history, education, portfolio, skills: self-declared
 *   - credentials: VERIFIED only after a person checked the document
 *   - the work record: computed from RELEASED payments, so it cannot be typed
 *     at all. This is the line that makes a Part-Time profile worth more than
 *     a PDF CV.
 */
import { prisma } from "../prisma";
import { isCredentialValid } from "../types";
import { resolveUrl } from "./storage";

export const OPEN_TO = ["TASKS", "HOURLY", "CONTRACT", "FULL_TIME"] as const;
export type OpenTo = (typeof OPEN_TO)[number];
export const VISIBILITIES = ["PRIVATE", "LINK"] as const;

export type Audience = "self" | "staff" | "public";

export function openToArray(raw: string | null | undefined): OpenTo[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OpenTo => (OPEN_TO as readonly string[]).includes(s));
}

/** A share slug: readable, unguessable enough, never derived from email. */
export function mintSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "profile";
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(rand, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 6);
  return `${base}-${suffix}`;
}

/** Verified work done on Part-Time: released payments, grouped by category. */
export async function workRecord(userId: string) {
  const paid = await prisma.payment.findMany({
    where: { workerId: userId, status: "RELEASED" },
    select: { task: { select: { category: true } } },
  });
  const byCategory = new Map<string, number>();
  for (const p of paid) {
    const c = p.task?.category || "Other";
    byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
  }
  const ratings = await prisma.rating.findMany({
    where: { workerId: userId, direction: "OF_WORKER" },
    select: { score: true },
  });
  const avg = ratings.length ? ratings.reduce((s, r) => s + r.score, 0) / ratings.length : null;
  return {
    paidTasks: paid.length,
    byCategory: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    rating: avg === null ? null : Math.round(avg * 10) / 10,
    ratingsCount: ratings.length,
  };
}

export async function buildProfile(userId: string, audience: Audience) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      workExperience: { orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }] },
      education: { orderBy: [{ endYear: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] },
      portfolioItems: { include: { document: true }, orderBy: { createdAt: "desc" } },
      credentials: { include: { credentialType: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!user) return null;

  const skills = await prisma.workerSkill.findMany({
    where: { workerId: userId },
    include: { skill: true },
  });
  const pub = audience === "public";

  const cv =
    !pub && user.cvDocumentId
      ? await prisma.kycDocument.findFirst({ where: { id: user.cvDocumentId, userId } })
      : null;

  const credentials = user.credentials
    // The public sees only what a person checked and is still in date. A
    // pending or rejected certificate on a shared CV would read as a claim
    // Afrizone had vouched for.
    .filter((c) => !pub || isCredentialValid(c))
    .map((c) => ({
      id: c.id,
      title: c.title,
      type: c.credentialType.name,
      issuer: c.issuer,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      verified: isCredentialValid(c),
      ...(pub ? {} : { status: c.status }),
    }));

  return {
    id: pub ? undefined : user.id,
    name: user.name,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    openTo: openToArray(user.openTo),
    memberSince: user.createdAt,
    identityVerified: user.kycStatus === "VERIFIED",
    ...(pub
      ? {}
      : {
          visibility: user.profileVisibility,
          slug: user.profileSlug,
          cv: cv ? { id: cv.id, name: cv.originalName ?? "CV", url: resolveUrl(cv.filename) } : null,
        }),
    ...(audience === "staff" ? { email: user.email, phone: user.phone } : {}),
    workRecord: await workRecord(userId),
    experience: user.workExperience.map((e) => ({
      id: e.id,
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      description: e.description,
    })),
    education: user.education.map((e) => ({
      id: e.id,
      institution: e.institution,
      qualification: e.qualification,
      field: e.field,
      startYear: e.startYear,
      endYear: e.endYear,
    })),
    portfolio: user.portfolioItems.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      url: p.url,
      // Files sit behind an authenticated route; the public gets the title and
      // link only.
      file: !pub && p.document ? { id: p.document.id, name: p.document.originalName ?? "File", url: resolveUrl(p.document.filename) } : null,
    })),
    skills: skills
      .filter((s) => s.skill.active)
      .map((s) => ({ name: s.skill.name, group: s.skill.group, years: s.years })),
    credentials,
  };
}
