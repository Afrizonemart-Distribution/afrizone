/**
 * Task templates: a saved task form, so a kind of task that is posted again
 * and again (a weekly stock count, a product shoot) is one click, not a form.
 *
 * A template is only a starting point. Nothing about it is trusted when a task
 * is created from it: the admin form fills itself from the payload and the
 * task is then created through POST /api/tasks with every check that applies
 * there. So the payload is cleaned to the known form fields here, not
 * validated as a task.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { parseQuestions } from "../services/taskQuestions";
import { userActor, writeAudit } from "../util/audit";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"));

/** The task-form fields a template may carry. Anything else is dropped. */
export const TEMPLATE_KEYS = [
  "title",
  "description",
  "category",
  "tier",
  "payModel",
  "rate",
  "budget",
  "locationType",
  "address",
  "lat",
  "lng",
  "geofenceRadius",
  "slots",
  "crewMax",
  "requiresIdentityVerified",
  "skillIds",
  "credentialTypeIds",
  "questions",
] as const;

const MAX_NAME = 80;
const MAX_PAYLOAD = 20_000;

class BadInput extends Error {}

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_NAME) throw new BadInput(`Template name must be 1 to ${MAX_NAME} characters`);
  return name;
}

function cleanPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadInput("payload must be an object");
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of TEMPLATE_KEYS) if (src[k] !== undefined) out[k] = src[k];
  if (out.questions !== undefined) {
    const q = parseQuestions(out.questions);
    if (!q.ok) throw new BadInput(q.error);
    out.questions = q.value;
  }
  if (JSON.stringify(out).length > MAX_PAYLOAD) throw new BadInput("Template is too large");
  return out;
}

function present(t: { id: string; name: string; payload: string; createdAt: Date; updatedAt: Date; createdBy?: { name: string } | null }) {
  let payload: unknown = {};
  try {
    payload = JSON.parse(t.payload);
  } catch {
    /* a corrupt row reads as an empty form */
  }
  return {
    id: t.id,
    name: t.name,
    payload,
    createdBy: t.createdBy?.name ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const wrap =
  (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch((e) => (e instanceof BadInput ? res.status(400).json({ error: e.message }) : next(e)));

// GET /api/task-templates -> the live ones, most recently changed first.
router.get(
  "/",
  wrap(async (_req, res) => {
    const rows = await prisma.taskTemplate.findMany({
      where: { archived: false },
      orderBy: { updatedAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });
    res.json(rows.map(present));
  })
);

// POST /api/task-templates {name, payload}
router.post(
  "/",
  wrap(async (req, res) => {
    const b = req.body || {};
    const row = await prisma.taskTemplate.create({
      data: { name: cleanName(b.name), payload: JSON.stringify(cleanPayload(b.payload)), createdById: req.user!.id },
      include: { createdBy: { select: { name: true } } },
    });
    await writeAudit(userActor(req.user!.id), "task_template.created", "TaskTemplate", row.id, { name: row.name });
    res.status(201).json(present(row));
  })
);

// PATCH /api/task-templates/:id {name?, payload?}
router.patch(
  "/:id",
  wrap(async (req, res) => {
    const b = req.body || {};
    const data: { name?: string; payload?: string } = {};
    if (b.name !== undefined) data.name = cleanName(b.name);
    if (b.payload !== undefined) data.payload = JSON.stringify(cleanPayload(b.payload));
    const hit = await prisma.taskTemplate.updateMany({ where: { id: req.params.id, archived: false }, data });
    if (hit.count === 0) return res.status(404).json({ error: "Template not found" });
    const row = await prisma.taskTemplate.findUnique({
      where: { id: req.params.id },
      include: { createdBy: { select: { name: true } } },
    });
    res.json(present(row!));
  })
);

// DELETE /api/task-templates/:id -> archived, not erased (the audit trail names it).
router.delete(
  "/:id",
  wrap(async (req, res) => {
    const hit = await prisma.taskTemplate.updateMany({
      where: { id: req.params.id, archived: false },
      data: { archived: true },
    });
    if (hit.count === 0) return res.status(404).json({ error: "Template not found" });
    await writeAudit(userActor(req.user!.id), "task_template.archived", "TaskTemplate", req.params.id, {});
    res.status(204).end();
  })
);

export default router;
