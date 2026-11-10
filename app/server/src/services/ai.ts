/**
 * The AI helpers for hiring (Phase 7), through Claude.
 *
 *   readCv           a CV (PDF or photo) -> a DRAFT Hiring profile the worker
 *                    reviews before anything is saved.
 *   rankApplicants   a job + applicants -> a score and reasons per applicant,
 *                    for HR to read. It orders the list; it never rejects,
 *                    hides or hires anyone (same rule as applicantRanking.ts).
 *
 * FAIRNESS. Applicants are sent without name, email, phone, photo or exact
 * age, under an opaque reference, and the model is told to judge only what the
 * job needs. What comes back is checked: unknown references are dropped and
 * scores are clamped, so a malformed answer can't land on the wrong person.
 *
 * OFF UNTIL CONFIGURED. With no ANTHROPIC_API_KEY secret the routes answer
 * 503 AI_OFF, and everything else works as before. Read lazily, like sms.ts:
 * Workers only fill process.env once a request is running.
 *
 * This module takes plain data, never the prisma client, so the pure parts
 * (briefs, result checks) are tested directly.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/** The default model for these calls. AI_MODEL overrides it without a deploy of code. */
const DEFAULT_MODEL = "claude-opus-5-5";

export function aiEnabled(): boolean {
  return (process.env.ANTHROPIC_API_KEY || "").length > 0;
}

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
}

function model(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

/** A refusal or an unparseable answer, said plainly for the caller. */
export class AiUnavailable extends Error {
  code = "AI_FAILED";
}

/**
 * One structured call. Server-side fallbacks ("default") re-run a declined
 * request on Anthropic's recommended model instead of returning the refusal.
 */
async function structured<T extends z.ZodType>(
  schema: T,
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  effort: "low" | "medium" | "high"
): Promise<z.infer<T>> {
  const res = await client().beta.messages.parse({
    model: model(),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new AiUnavailable("The AI declined to read this. Fill it in by hand.");
  if (res.stop_reason === "max_tokens" || !res.parsed_output) {
    throw new AiUnavailable("The AI's answer was incomplete. Try again.");
  }
  return res.parsed_output as z.infer<T>;
}

/* ── CV reading ───────────────────────────────────────────────────────── */

const CvSchema = z.object({
  headline: z.string().describe("One line, e.g. 'Retail supervisor, 5 years in FMCG'. Empty if unclear."),
  bio: z.string().describe("Two to four plain sentences in the first person, from the CV only. Empty if nothing to say."),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string().describe("Empty if not stated."),
      startDate: z.string().describe("YYYY-MM, or YYYY-01 if only the year is given. Empty if unknown."),
      endDate: z.string().describe("YYYY-MM; empty if this is the current job."),
      description: z.string().describe("What they did, short. Empty if not stated."),
    })
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      qualification: z.string().describe("e.g. 'B.Sc', 'HND', 'WAEC/SSCE', 'OND'"),
      field: z.string().describe("Empty if not stated."),
      startYear: z.number().int().describe("0 if unknown."),
      endYear: z.number().int().describe("0 if unknown."),
    })
  ),
  skills: z.array(z.string()).describe("Short skill names stated or clearly shown in the CV, at most 15."),
});
export type CvDraft = z.infer<typeof CvSchema>;

const CV_SYSTEM = `You turn a job seeker's CV into the fields of their Hiring profile on AfriZone, a Nigerian work platform.
Copy facts from the CV; never invent employers, dates, qualifications or skills. When something isn't in the CV, leave the field empty (or 0 for years).
Keep the person's own wording where you can, tidy spelling and capitals, and write the bio in the first person.
If the document is not a CV, return empty fields and empty lists.`;

export const CV_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

export async function readCv(bytes: Uint8Array, mimeType: string): Promise<CleanCv> {
  const data = Buffer.from(bytes).toString("base64");
  const doc: Anthropic.Beta.BetaContentBlockParam =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : {
          type: "image",
          source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data },
        };
  const draft = await structured(CvSchema, CV_SYSTEM, [doc, { type: "text", text: "Fill in the Hiring profile from this CV." }], "low");
  return cleanCvDraft(draft);
}

const yearOk = (y: number) => (y >= 1950 && y <= new Date().getFullYear() + 6 ? y : null);
const monthOk = (s: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(s.trim()) ? s.trim() : "");

/** Trim, cap, and drop what the profile can't hold, before the worker sees it. */
export type CleanCv = ReturnType<typeof cleanCvDraft>;

export function cleanCvDraft(d: CvDraft) {
  const t = (s: string, n: number) => (s ?? "").trim().slice(0, n);
  return {
    headline: t(d.headline, 120),
    bio: t(d.bio, 2000),
    experience: d.experience
      .map((e) => ({
        title: t(e.title, 120),
        company: t(e.company, 120),
        location: t(e.location, 120),
        startDate: monthOk(e.startDate),
        endDate: monthOk(e.endDate),
        description: t(e.description, 2000),
      }))
      .filter((e) => e.title && e.company)
      .slice(0, 30),
    education: d.education
      .map((e) => ({
        institution: t(e.institution, 160),
        qualification: t(e.qualification, 120),
        field: t(e.field, 120),
        startYear: yearOk(e.startYear),
        endYear: yearOk(e.endYear),
      }))
      .filter((e) => e.institution && e.qualification)
      .slice(0, 30),
    skills: [...new Set(d.skills.map((s) => t(s, 60)).filter(Boolean))].slice(0, 15),
  };
}

/* ── applicant ranking ────────────────────────────────────────────────── */

export interface ApplicantFacts {
  /** Our application id. Never sent: the model sees `ref` instead. */
  id: string;
  headline: string | null;
  bio: string | null;
  experience: { title: string; company: string; startDate: Date | string; endDate: Date | string | null; description: string | null }[];
  education: { qualification: string; field: string | null; institution: string; endYear: number | null }[];
  skills: string[];
  verifiedCredentials: string[];
  workRecord: { paidTasks: number; rating: number | null };
  coverNote: string | null;
}

export interface JobFacts {
  title: string;
  department: string;
  employmentType: string;
  location: string;
  description: string;
}

const ymd = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 7) : "now");

/**
 * The text the model reads about one applicant: work facts only. No name,
 * email, phone, photo, date of birth or home town, so it can't weigh them.
 */
export function applicantBrief(ref: string, a: ApplicantFacts): string {
  const lines = [`<applicant ref="${ref}">`];
  if (a.headline) lines.push(`Headline: ${a.headline}`);
  if (a.bio) lines.push(`About: ${a.bio.slice(0, 800)}`);
  if (a.experience.length) {
    lines.push("Work history:");
    for (const e of a.experience.slice(0, 10)) {
      lines.push(`- ${e.title} at ${e.company} (${ymd(e.startDate)} to ${ymd(e.endDate)})${e.description ? `: ${e.description.slice(0, 300)}` : ""}`);
    }
  }
  if (a.education.length) {
    lines.push("Education:");
    for (const e of a.education.slice(0, 6)) {
      lines.push(`- ${e.qualification}${e.field ? ` in ${e.field}` : ""}, ${e.institution}${e.endYear ? ` (${e.endYear})` : ""}`);
    }
  }
  if (a.skills.length) lines.push(`Skills: ${a.skills.slice(0, 30).join(", ")}`);
  if (a.verifiedCredentials.length) lines.push(`Checked certificates: ${a.verifiedCredentials.join(", ")}`);
  lines.push(
    `AfriZone work record: ${a.workRecord.paidTasks} paid task(s)${a.workRecord.rating ? `, rated ${a.workRecord.rating.toFixed(1)}/5` : ""}`
  );
  if (a.coverNote) lines.push(`Cover letter: ${a.coverNote.slice(0, 1500)}`);
  lines.push("</applicant>");
  return lines.join("\n");
}

const RankSchema = z.object({
  applicants: z.array(
    z.object({
      ref: z.string(),
      score: z.number().int().describe("0-100: how well the evidence fits what this job needs."),
      summary: z.string().describe("One sentence a recruiter can read at a glance."),
      strengths: z.array(z.string()).describe("Up to 3, each tied to evidence in the profile."),
      gaps: z.array(z.string()).describe("Up to 3 things the job needs that the profile doesn't show."),
    })
  ),
});

export interface ApplicantScore {
  id: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

const RANK_SYSTEM = `You help a recruiter at AfriZone, a Nigerian employer, read applications. You suggest an order; a person decides.
Score each applicant from 0 to 100 on how well the evidence in their profile fits what this job needs: relevant work, skills, qualifications the job actually asks for, checked certificates, their AfriZone work record, and their cover letter.
Judge only job-relevant evidence. Ignore anything that hints at gender, age, religion, ethnicity, state of origin, marital status, disability or school prestige beyond what the job requires.
A thin profile is not a bad candidate: say what is missing under gaps instead of guessing.
Return every applicant you were given, once, by their ref.`;

/** Applicants per call: enough to compare against each other, small enough to answer fully. */
export const RANK_BATCH = 15;

export async function rankApplicants(job: JobFacts, applicants: ApplicantFacts[]): Promise<ApplicantScore[]> {
  const refs = new Map(applicants.map((a, i) => [`A${i + 1}`, a.id]));
  const jobText = [
    `<job>`,
    `Title: ${job.title}`,
    `Department: ${job.department}`,
    `Type: ${job.employmentType}`,
    `Location: ${job.location}`,
    `Description: ${job.description.slice(0, 4000)}`,
    `</job>`,
  ].join("\n");
  const briefs = applicants.map((a, i) => applicantBrief(`A${i + 1}`, a)).join("\n\n");
  const out = await structured(
    RankSchema,
    RANK_SYSTEM,
    [{ type: "text", text: `${jobText}\n\n${briefs}\n\nScore every applicant above.` }],
    "medium"
  );
  return checkScores(out.applicants, refs);
}

/** Map refs back to applications; drop unknown or repeated refs; clamp and cap. */
export function checkScores(
  rows: { ref: string; score: number; summary: string; strengths: string[]; gaps: string[] }[],
  refs: Map<string, string>
): ApplicantScore[] {
  const seen = new Set<string>();
  const out: ApplicantScore[] = [];
  for (const r of rows) {
    const id = refs.get(String(r.ref).trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
      summary: String(r.summary ?? "").trim().slice(0, 300),
      strengths: (r.strengths ?? []).map((s) => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 3),
      gaps: (r.gaps ?? []).map((s) => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 3),
    });
  }
  return out;
}

/* ── Proof-of-work photos ─────────────────────────────────────────────── */

/**
 * A look at one photo of finished work (or a store audit) against what the
 * task asked for. Like the location and time checks in services/evidence.ts,
 * the answer only ever FLAGS a photo for the reviewer: it never refuses a
 * hand-in, holds a payment or marks a worker down.
 */
const ProofSchema = z.object({
  shows_the_work: z
    .enum(["yes", "unclear", "no"])
    .describe("Does this photo plausibly show the work the task describes, done?"),
  concerns: z
    .array(z.string())
    .describe("Up to 3 short sentences a reviewer should check. Empty when there is nothing to point out."),
});
export type ProofAnswer = z.infer<typeof ProofSchema>;

const PROOF_SYSTEM = `You help a reviewer at AfriZone, a Nigerian work platform, check photos workers send as proof that a task was done.
You see one photo and the task it was sent for. Say whether it plausibly shows that work, and list anything the reviewer should look at closely, for example:
- it is a photo of a screen, a printout or another photo, or looks like a downloaded or stock image;
- it is too dark, blurred or cropped to show the work;
- it shows something unrelated to the task, or only part of what was asked;
- visible edits, watermarks or dates that don't fit.
Describe only the photo and the work. Never comment on a person's appearance, and don't guess who anyone is.
Be fair: ordinary phone photos of real work in Nigerian shops, markets, streets and offices are normal. Only raise a concern you can point to in the photo.
Write each concern as one plain sentence a reviewer can check, without hedging words like "possibly".`;

export interface ProofTaskFacts {
  title: string;
  description: string;
  criteria: string[];
  stageLabel: string;
}

/** The task as the model reads it; no names, places or people. */
export function proofBrief(t: ProofTaskFacts): string {
  const lines = [
    `Task: ${t.title.slice(0, 200)}`,
    `What it involves: ${t.description.slice(0, 1500)}`,
    `This photo is for: ${t.stageLabel}`,
  ];
  if (t.criteria.length) lines.push(`Done means:\n${t.criteria.map((c) => `- ${c}`).join("\n")}`);
  return lines.join("\n");
}

export const PROOF_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export async function lookAtProofPhoto(
  task: ProofTaskFacts,
  bytes: Uint8Array,
  mimeType: (typeof PROOF_IMAGE_TYPES)[number]
): Promise<ProofAnswer> {
  const data = Buffer.from(bytes).toString("base64");
  return structured(
    ProofSchema,
    PROOF_SYSTEM,
    [
      { type: "image", source: { type: "base64", media_type: mimeType, data } },
      { type: "text", text: `${proofBrief(task)}\n\nCheck this photo.` },
    ],
    "low"
  );
}

/**
 * The flag sentences for a reviewer, and the verdict stored with the photo.
 * Each starts "AI:" so nobody mistakes a suggestion for a measured check.
 */
export function proofFlags(a: ProofAnswer): { verdict: "OK" | "DOUBT"; flags: string[] } {
  const concerns = (a.concerns ?? [])
    .map((s) => String(s).trim().replace(/\s+/g, " ").slice(0, 200))
    .filter(Boolean)
    .slice(0, 3);
  if (a.shows_the_work === "no" && concerns.length === 0) {
    concerns.push("The photo doesn't seem to show this work");
  } else if (a.shows_the_work === "unclear" && concerns.length === 0) {
    concerns.push("Hard to tell from the photo whether the work was done");
  }
  const flags = concerns.map((c) => `AI: ${c}`);
  return { verdict: flags.length ? "DOUBT" : "OK", flags };
}
