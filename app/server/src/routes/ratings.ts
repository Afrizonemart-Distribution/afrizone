import { Router, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { closeIfBothSidesRated, recomputeWorkerRating } from "../services/ratings";
import { userActor } from "../util/audit";

const router = Router();

// POST /api/workers/:id/rate: admin rates a worker for a completed task.
// body: { taskId, score (1–5), note? }
// Upserts (one rating per worker per task); recalculates user.rating as average.
router.post(
  "/:id/rate",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const { taskId, score, note } = req.body || {};

    const scoreNum = Number(score);
    if (!Number.isInteger(scoreNum) || scoreNum < 1 || scoreNum > 5) {
      return res.status(400).json({ error: "score must be an integer between 1 and 5" });
    }
    if (!taskId || typeof taskId !== "string") {
      return res.status(400).json({ error: "taskId is required" });
    }

    const worker = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!worker || worker.role !== "WORKER") {
      return res.status(404).json({ error: "Worker not found" });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // direction is explicit rather than left to the column default: this route
    // is one of two that write here, and a rating whose direction was implied
    // is one nobody can audit later.
    await prisma.rating.upsert({
      where: {
        workerId_taskId_direction: {
          workerId: worker.id,
          taskId: task.id,
          direction: "OF_WORKER",
        },
      },
      update: { score: scoreNum, note: note ? String(note).trim() : null },
      create: {
        workerId: worker.id,
        taskId: task.id,
        direction: "OF_WORKER",
        score: scoreNum,
        note: note ? String(note).trim() : null,
        createdById: req.user!.id,
      },
    });

    // Counts only ratings OF this worker. The average used to be taken over
    // every row matching workerId, which now also matches the ratings they
    // WROTE - a Partimer who rated three jobs one star would have dragged their
    // own profile to one star.
    const updated = await recomputeWorkerRating(worker.id);

    // Blueprint §4.2: Closed means "ratings exchanged". So the second rating is
    // what closes the engagement, rather than an admin remembering to.
    await closeIfBothSidesRated(task.id, worker.id, userActor(req.user!.id));

    res.json({
      id: updated.id,
      name: updated.name,
      rating: updated.rating,
      completedCount: updated.completedCount,
    });
  }
);

export default router;
