/**
 * The inbound edge of the AfriZoneMart integration (Blueprint §5, §13).
 *
 * ONE ENDPOINT, NOT FOUR. Mart emits an event bus, so PartTime subscribes to a
 * bus: one signature scheme, one idempotency mechanism, one retry story. Four
 * endpoints would mean four of each and three chances to get one wrong.
 *
 * This route is NOT behind requireAuth. It is authenticated by an HMAC over the
 * raw body, the way the Paystack and Smile webhooks already are - Mart is a
 * system, not a user, and giving it a session token would mean a credential that
 * can do everything a person can.
 */
import { Router, Request, Response } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { intakeMartEvent, verifyMartSignature } from "../services/martEvents";
import { allRules } from "../services/taskRules";
import { offerRule } from "../services/deliveryOffer";
import { formatSurgeSteps, surgeRule } from "../services/surge";

const router = Router();
export const adminRouter = Router();

/**
 * POST /api/integrations/mart/events
 *
 * The raw body is required for signature verification, so index.ts mounts
 * express.raw() on this path BEFORE the global JSON parser - the same
 * arrangement the Paystack webhook needs.
 */
router.post("/events", async (req: Request, res: Response) => {
  const raw: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body ?? {}));

  const verified = verifyMartSignature(
    raw,
    req.header("x-afz-timestamp"),
    req.header("x-afz-signature"),
    process.env.MART_INBOUND_SECRET
  );
  if (!verified.ok) return res.status(401).json({ error: verified.error });

  let body: unknown;
  try {
    body = JSON.parse((raw as any).toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Bad payload" });
  }

  // Express 4 does not catch a rejection from an async handler: it never reaches
  // the error middleware, the response is never written, and the Workers runtime
  // eventually cancels the request as hung. The symptom is a 500 with no stack
  // and no log line, which is close to undiagnosable from the outside - so this
  // catches its own.
  try {
    const result = await intakeMartEvent(body as any);
    return res.status(result.status).json(result.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not process the event";
    console.error("mart event intake failed:", message);
    // 500 because it is our fault, and MART_INTEGRATION.md §2 tells Mart to
    // retry a 5xx with backoff - which is safe, because intake is idempotent.
    return res.status(500).json({ error: message });
  }
});

// ── Afrizone staff ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/mart/events?status=&type=
 *
 * What Mart has sent and what we did about it. This is the screen somebody opens
 * when a task they expected does not exist - it is the only place that
 * distinguishes "Mart never sent it" from "we de-duplicated it" from "nothing is
 * built to handle it yet".
 */
adminRouter.get(
  "/events",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const rows = await prisma.martEvent.findMany({
      where: { ...(status ? { status } : {}), ...(type ? { type } : {}) },
      orderBy: { receivedAt: "desc" },
      take: 200,
    });

    // Counted across everything rather than the page, because the number that
    // matters - how much is sitting deferred - is not visible in the latest 200.
    const counts = await prisma.martEvent.groupBy({
      by: ["status"],
      _count: { _all: true },
    }).catch(async () => {
      // groupBy is not supported everywhere D1 runs; a tally is cheap at this
      // scale and correctness beats elegance for an operations screen.
      const all = await prisma.martEvent.findMany({ select: { status: true } });
      const m = new Map<string, number>();
      for (const r of all) m.set(r.status, (m.get(r.status) ?? 0) + 1);
      return [...m.entries()].map(([status, n]) => ({ status, _count: { _all: n } }));
    });

    res.json({
      counts: Object.fromEntries(counts.map((c: any) => [c.status, c._count._all])),
      events: rows.map((e) => ({
        id: e.id,
        eventId: e.eventId,
        type: e.type,
        status: e.status,
        taskId: e.resultTaskId,
        note: e.note,
        occurredAt: e.occurredAt,
        receivedAt: e.receivedAt,
      })),
    });
  }
);

/**
 * GET /api/admin/mart/rules → what the generators will do with the next event.
 *
 * Blueprint §5 asks that these stay Admin-editable. They are Settings, written
 * through the existing PUT /api/settings/templates/:key, so this is the read
 * side that makes them discoverable rather than folklore.
 *
 * TWO SHAPES, NOT ONE FLAT OBJECT. `kinds` is per task kind and every kind has
 * an answer for every field. `offer` is delivery only - a claim radius means
 * nothing for a remote media task - and folding it in would put dead fields on
 * four cards. It is the same split as services/deliveryOffer.ts keeping its
 * parameters out of TaskRule while sharing the rules.DELIVERY.* prefix.
 */
adminRouter.get(
  "/rules",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (_req: AuthedRequest, res: Response) => {
    const surge = await surgeRule(prisma);
    res.json({
      kinds: await allRules(),
      offer: await offerRule(prisma),
      // Steps as the setting stores them, so the admin edits what is saved.
      surge: { ...surge, stepsText: formatSurgeSteps(surge.steps) },
    });
  }
);

export default router;
