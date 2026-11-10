/**
 * Two more checks on proof-of-work photos (Phase 7), on top of the location
 * and time checks in services/evidence.ts. Same rule as those: DOUBTFUL
 * EVIDENCE FLAGS, IT NEVER REFUSES. A flag is a sentence for the reviewer; no
 * hand-in is stopped, no payment held and no worker marked down by either.
 *
 *   REPEATED PHOTOS, on upload, free. The SHA-256 of the bytes is kept, and a
 *   photo whose exact file was sent before - by another worker, for another
 *   job, or for this one - is flagged as such. Catches the same picture
 *   reused across jobs or passed between workers.
 *
 *   AN AI LOOK, a minute or so after upload, from the cron. Finished-work and
 *   store-audit photos only (WORK, AUDIT): those are the ones whose content
 *   says whether work was done. Door, pickup and clock photos are not sent -
 *   a door photo is customer data (MART_INTEGRATION.md §5) and a clock photo
 *   shows a person, not work. Off without ANTHROPIC_API_KEY, and switchable
 *   off with the setting `ai.proofCheck` = "off".
 *
 * Every photo is looked at once at most: the row is claimed (aiCheckedAt set)
 * before the call, so a slow or failed call is never paid for twice.
 */
import type { PrismaClient } from "@prisma/client";
import { aiEnabled, lookAtProofPhoto, proofFlags, PROOF_IMAGE_TYPES, type ProofAnswer, type ProofTaskFacts } from "./ai";
import { getEvidenceBytes } from "./storage";
import { parseFlags, STAGE_LABEL, type EvidenceStage } from "./evidence";
import { readCriteria } from "./proof";

/* ── Repeated photos ──────────────────────────────────────────────────── */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Pure. The flag for a photo whose exact file was sent before, or null. The
 * most telling earlier copy wins: another worker's, then another job's.
 */
export function repeatFlag(
  earlier: { taskId: string; workerId: string }[],
  now: { taskId: string; workerId: string }
): string | null {
  if (earlier.some((e) => e.workerId !== now.workerId)) return "Same photo as one another worker sent";
  if (earlier.some((e) => e.taskId !== now.taskId)) return "Same photo as one already sent for another job";
  if (earlier.length) return "Same photo as one already sent for this job";
  return null;
}

export async function findRepeat(
  db: PrismaClient,
  sha256: string,
  now: { taskId: string; workerId: string }
): Promise<string | null> {
  const earlier = await db.evidence.findMany({
    where: { sha256 },
    select: { taskId: true, workerId: true },
    take: 20,
  });
  return repeatFlag(earlier, now);
}

/* ── The AI look ──────────────────────────────────────────────────────── */

export const AI_PROOF_STAGES: EvidenceStage[] = ["WORK", "AUDIT"];
export const PROOF_CHECK_KEY = "ai.proofCheck";
/** Photos looked at per cron run (once a minute). */
export const PROOF_PER_RUN = 5;
/** Older photos are left alone: the reviewer has probably decided already. */
const WINDOW_MS = 48 * 60 * 60 * 1000;
/** The API's limit on one image. Larger photos are skipped, not shrunk. */
const MAX_AI_BYTES = 5 * 1024 * 1024;

type Look = (task: ProofTaskFacts, bytes: Uint8Array, mime: (typeof PROOF_IMAGE_TYPES)[number]) => Promise<ProofAnswer>;
type Read = (key: string) => Promise<{ bytes: Uint8Array; contentType: string | undefined } | null>;

export interface ProofCheckTally {
  ok: number;
  doubt: number;
  failed: number;
  skipped: number;
}

/**
 * One cron run: look at up to PROOF_PER_RUN photos not yet looked at. `deps`
 * lets tests stand in for the model and storage; production uses the real ones.
 */
export async function checkDueProofPhotos(
  db: PrismaClient,
  deps: { look?: Look; read?: Read; enabled?: boolean; now?: Date } = {}
): Promise<ProofCheckTally> {
  const tally: ProofCheckTally = { ok: 0, doubt: 0, failed: 0, skipped: 0 };
  if (!(deps.enabled ?? aiEnabled())) return tally;
  const setting = await db.setting.findUnique({ where: { key: PROOF_CHECK_KEY } });
  if (setting && String(setting.value).toLowerCase() === "off") return tally;

  const look = deps.look ?? lookAtProofPhoto;
  const read = deps.read ?? getEvidenceBytes;
  const now = deps.now ?? new Date();

  const due = await db.evidence.findMany({
    where: {
      stage: { in: AI_PROOF_STAGES },
      aiCheckedAt: null,
      createdAt: { gte: new Date(now.getTime() - WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: PROOF_PER_RUN,
    include: { task: { select: { title: true, description: true, acceptanceCriteria: true } } },
  });

  for (const row of due) {
    // Claim it first: two overlapping runs must not both pay for one photo.
    const claimed = await db.evidence.updateMany({
      where: { id: row.id, aiCheckedAt: null },
      data: { aiCheckedAt: now, aiVerdict: "CHECKING" },
    });
    if (claimed.count === 0) continue;

    const mime = PROOF_IMAGE_TYPES.find((t) => t === row.contentType);
    if (!mime || row.sizeBytes > MAX_AI_BYTES) {
      await db.evidence.update({ where: { id: row.id }, data: { aiVerdict: "SKIPPED" } });
      tally.skipped++;
      continue;
    }

    try {
      const file = await read(row.objectKey);
      if (!file) {
        await db.evidence.update({ where: { id: row.id }, data: { aiVerdict: "SKIPPED" } });
        tally.skipped++;
        continue;
      }
      const answer = await look(
        {
          title: row.task.title,
          description: row.task.description,
          criteria: readCriteria(row.task.acceptanceCriteria),
          stageLabel: STAGE_LABEL[row.stage as EvidenceStage] ?? row.stage,
        },
        file.bytes,
        mime
      );
      const { verdict, flags } = proofFlags(answer);
      await db.evidence.update({
        where: { id: row.id },
        data: { aiVerdict: verdict, flags: JSON.stringify([...parseFlags(row.flags), ...flags]) },
      });
      if (verdict === "OK") tally.ok++;
      else tally.doubt++;
    } catch (e) {
      // No retry: a photo the AI could not read is one the reviewer looks at
      // as they always have. Logged so a pattern of failures is visible.
      console.error(`[proof-check] ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      await db.evidence.update({ where: { id: row.id }, data: { aiVerdict: "FAILED" } });
      tally.failed++;
    }
  }
  return tally;
}
