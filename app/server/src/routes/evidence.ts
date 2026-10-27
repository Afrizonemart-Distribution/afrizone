/**
 * Proof-of-work photos: taking one, seeing one, listing them
 * (services/evidence.ts).
 *
 * UPLOAD AND FILE READS ARE HANDLED BEFORE EXPRESS, exactly as KYC documents
 * are and for the same two reasons (routes/kycDocuments.ts has the long form):
 * Workers' own request.formData() is the supported multipart parser, and an R2
 * body is a WHATWG stream that Express's adapted response cannot be piped into.
 * Listing is ordinary JSON and stays on the routers below.
 *
 * WHO MAY SEE A PHOTO: the worker who took it, and Afrizone staff. Not other
 * workers, and not the store - a drop-off photo shows a customer's door, which
 * MART_INTEGRATION.md §5 lets us hold for one purpose. Refusals are 404s, so a
 * guessed id does not confirm that a photo exists.
 */
import { Router, Response as ExpressResponse } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest, verifyToken, isAdmin } from "../auth";
import { requireAssignedTask } from "../util/assignment";
import { putEvidence, getEvidenceStream } from "../services/storage";
import { sniffFileType, isAllowedMime, IDENTITY_MIMES } from "../util/fileType";
import {
  EVIDENCE_STAGES,
  checkEvidence,
  evidenceView,
  required,
  signatureRequired,
  signatureView,
  siteFor,
  stagesFor,
  validSignaturePath,
  type EvidenceStage,
} from "../services/evidence";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
// A busy courier on a long shift takes two photos an order; an auditor three a
// shop. Bounds abuse of storage the platform pays for, not normal work.
const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_UPLOADS_PER_WINDOW = 80;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function bearer(request: Request): ReturnType<typeof verifyToken> | null {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

function num(v: File | string | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * POST /api/me/evidence -> take a photo for a step of a job.
 * multipart/form-data: taskId, stage, file, and lat, lng, accuracy, capturedAt
 * (ISO) as the phone reports them.
 *
 * Accepted for any stage the task actually asks for, from the worker assigned
 * to it. The checks run here, on arrival, and their result is returned so the
 * app can say "taken 600 m from the shop" while the courier is still there to
 * take another.
 */
export async function handleEvidenceUpload(request: Request): Promise<Response> {
  const payload = bearer(request);
  if (!payload) return json(401, { error: "Invalid or expired token" });
  const workerId = payload.sub;

  // Before formData(), which is what buffers the body: a refused upload should
  // not cost ten megabytes of memory to refuse.
  const since = new Date(Date.now() - UPLOAD_WINDOW_MS);
  const recent = await prisma.evidence.count({ where: { workerId, createdAt: { gte: since } } });
  if (recent >= MAX_UPLOADS_PER_WINDOW) {
    return json(
      429,
      { error: "Too many photos today. Contact support if you need to send more." },
      { "Retry-After": String(Math.ceil(UPLOAD_WINDOW_MS / 1000)) }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "Invalid form data" });
  }

  const stage = form.get("stage");
  if (typeof stage !== "string" || !EVIDENCE_STAGES.includes(stage as EvidenceStage)) {
    return json(400, { error: `stage must be one of ${EVIDENCE_STAGES.join(", ")}` });
  }

  const assignment = await requireAssignedTask(workerId, form.get("taskId"));
  if (!assignment.ok) return json(assignment.status, { error: assignment.error });
  const { task } = assignment;

  // A photo for a step this task does not have is not evidence of anything,
  // and accepting it would let a quota's worth of unrelated pictures pile up
  // against a job.
  if (required(task, stage as EvidenceStage) === 0) {
    return json(400, { error: "This job does not ask for a photo at that step" });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "No photo attached" });
  if (file.size > MAX_FILE_SIZE) return json(400, { error: "Photo too large (max 10 MB)" });

  const bytes = new Uint8Array(await file.arrayBuffer());
  // From the bytes, never from file.type, which the client chooses.
  const sniffed = sniffFileType(bytes);
  if (!sniffed || !IDENTITY_MIMES.includes(sniffed.mime)) {
    return json(400, { error: "Send a photo (JPEG, PNG or WebP)" });
  }

  const receivedAt = new Date();
  const capturedRaw = form.get("capturedAt");
  const capturedAt =
    typeof capturedRaw === "string" && !Number.isNaN(Date.parse(capturedRaw)) ? new Date(capturedRaw) : null;
  const input = {
    lat: num(form.get("lat")),
    lng: num(form.get("lng")),
    accuracyMetres: num(form.get("accuracy")),
    capturedAt,
  };
  const site = await siteFor(task, stage as EvidenceStage);
  const { flags, distanceMetres } = checkEvidence(input, site, receivedAt);

  // Server-chosen key; nothing the client sent reaches the storage path.
  const objectKey = `${task.id}/${workerId}/${crypto.randomUUID()}${sniffed.ext}`;
  await putEvidence(objectKey, bytes.buffer as ArrayBuffer, sniffed.mime);

  const row = await prisma.evidence.create({
    data: {
      taskId: task.id,
      workerId,
      stage,
      objectKey,
      contentType: sniffed.mime,
      sizeBytes: bytes.byteLength,
      lat: input.lat,
      lng: input.lng,
      accuracyMetres: input.accuracyMetres,
      capturedAt,
      distanceMetres,
      flags: JSON.stringify(flags),
    },
  });

  return json(201, evidenceView(row));
}

/**
 * GET /api/evidence/:id/file -> the photo itself, to the worker who took it or
 * to staff.
 */
export async function handleEvidenceFileGet(request: Request, id: string): Promise<Response> {
  const notFound = () => json(404, { error: "Not found" });
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return notFound();

  const payload = bearer(request);
  if (!payload) return json(401, { error: "Invalid or expired token" });

  const row = await prisma.evidence.findUnique({ where: { id } });
  if (!row) return notFound();
  if (row.workerId !== payload.sub && !isAdmin(payload.role)) return notFound();

  const file = await getEvidenceStream(row.objectKey);
  if (!file) return notFound();

  // Same serving posture as KYC documents: an allow-listed type or an inert
  // one, no sniffing, no scripts, no framing, no shared caches.
  const type = isAllowedMime(file.contentType) ? file.contentType : "application/octet-stream";
  return new Response(file.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Frame-Options": "DENY",
      "Cache-Control": "private, no-store",
    },
  });
}

const router = Router();
export const adminRouter = Router();

/**
 * GET /api/me/evidence?taskId= -> what this worker has shown for a job, and
 * what the job still asks for. The checklist travels with the photos so the app
 * never hard-codes which steps need one.
 */
router.get("/", requireAuth, async (req: AuthedRequest, res: ExpressResponse) => {
  const assignment = await requireAssignedTask(req.user!.id, req.query.taskId);
  if (!assignment.ok) return res.status(assignment.status).json({ error: assignment.error });
  const { task } = assignment;

  const [rows, signed] = await Promise.all([
    prisma.evidence.findMany({
      where: { taskId: task.id, workerId: req.user!.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.signature.findMany({
      where: { taskId: task.id, workerId: req.user!.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const views = rows.map(evidenceView);
  const signatures = signed.map(signatureView);
  res.json({
    requirements: stagesFor(task).map((s) => ({
      ...s,
      have: views.filter((v) => v.stage === s.stage).length,
      signed: signatures.some((v) => v.stage === s.stage),
    })),
    evidence: views,
    signatures,
  });
});

/**
 * POST /api/me/evidence/signature -> the other side of a handover signs on the
 * Tasker's phone. JSON: taskId, stage, signerName, path (SVG path data), width,
 * height, and lat, lng, accuracy, capturedAt as the phone reports them.
 *
 * Ordinary JSON, so it stays on Express rather than beside the photo upload:
 * there is no file, only strokes.
 *
 * One per Tasker per step. Signing again replaces the last one - a smudged
 * signature redone is the same handover, not a second one.
 */
router.post("/signature", requireAuth, async (req: AuthedRequest, res: ExpressResponse) => {
  const workerId = req.user!.id;
  const body = req.body ?? {};

  const stage = body.stage;
  if (typeof stage !== "string" || !EVIDENCE_STAGES.includes(stage as EvidenceStage)) {
    return res.status(400).json({ error: `stage must be one of ${EVIDENCE_STAGES.join(", ")}` });
  }

  const assignment = await requireAssignedTask(workerId, body.taskId);
  if (!assignment.ok) return res.status(assignment.status).json({ error: assignment.error });
  const { task } = assignment;

  if (!signatureRequired(task, stage as EvidenceStage)) {
    return res.status(400).json({ error: "This job does not ask for a signature at that step" });
  }

  const signerName = typeof body.signerName === "string" ? body.signerName.trim().slice(0, 120) : "";
  if (!signerName) return res.status(400).json({ error: "Write the name of the person signing" });
  if (!validSignaturePath(body.path)) return res.status(400).json({ error: "Ask them to sign in the box" });

  const width = Number(body.width);
  const height = Number(body.height);
  if (!(width > 0 && width <= 4000 && height > 0 && height <= 4000)) {
    return res.status(400).json({ error: "width and height must describe the signing box" });
  }

  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const capturedAt =
    typeof body.capturedAt === "string" && !Number.isNaN(Date.parse(body.capturedAt)) ? new Date(body.capturedAt) : null;
  const input = { lat: n(body.lat), lng: n(body.lng), accuracyMetres: n(body.accuracy), capturedAt };
  const site = await siteFor(task, stage as EvidenceStage);
  const { flags, distanceMetres } = checkEvidence(input, site, new Date(), "signature");

  const data = {
    signerName,
    path: body.path as string,
    width,
    height,
    lat: input.lat,
    lng: input.lng,
    accuracyMetres: input.accuracyMetres,
    capturedAt,
    distanceMetres,
    flags: JSON.stringify(flags),
    createdAt: new Date(),
  };
  const row = await prisma.signature.upsert({
    where: { taskId_workerId_stage: { taskId: task.id, workerId, stage } },
    create: { taskId: task.id, workerId, stage, ...data },
    update: data,
  });

  res.status(201).json(signatureView(row));
});

/**
 * GET /api/admin/evidence?taskId=&workerId= -> the photos behind a job, for
 * whoever is approving it. Flagged first is the client's job; the order here is
 * the order things happened.
 */
adminRouter.get(
  "/",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER", "HR_ADMIN"),
  async (req: AuthedRequest, res: ExpressResponse) => {
    const taskId = typeof req.query.taskId === "string" ? req.query.taskId : null;
    if (!taskId) return res.status(400).json({ error: "taskId is required" });
    const workerId = typeof req.query.workerId === "string" ? req.query.workerId : undefined;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: "Task not found" });

    const where = { taskId, ...(workerId ? { workerId } : {}) };
    const [rows, signed] = await Promise.all([
      prisma.evidence.findMany({ where, orderBy: { createdAt: "asc" } }),
      prisma.signature.findMany({ where, orderBy: { createdAt: "asc" } }),
    ]);
    const views = rows.map(evidenceView);
    const signatures = signed.map(signatureView);
    res.json({
      requirements: stagesFor(task),
      evidence: views,
      signatures,
      flaggedCount: views.filter((v) => v.flagged).length + signatures.filter((v) => v.flagged).length,
    });
  }
);

export default router;
