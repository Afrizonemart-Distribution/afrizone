/**
 * AZM HR Console: the "AZM Staff" side of this admin.
 *
 * THE DATA STAYS IN AFRIZONEMART. Part Time stores nothing about AZM staff
 * (NDPA): every request is passed to afrizonemart-api's
 * /api/integrations/parttime/hr/* with our `parttime.hr` service token,
 * naming the signed-in person in X-Afz-User (their linked AfriZone account).
 * Afrizonemart decides what they may see from their hr.* capabilities, so a
 * Part-Time role alone never opens HR, and HR never touches Partimer data.
 *
 *   ANY  /api/admin/hr/<path>   -> afrizonemart /api/integrations/parttime/hr/<path>
 *   POST /api/admin/presence    -> afrizonemart workforce heartbeat (product PARTTIME)
 *
 * Off until MART_HR_TOKEN is set.
 */
import { Router, type Response } from "express";
import { requireAuth, isConsoleRole, type AuthedRequest } from "../auth";
import { prisma } from "../prisma";

const router = Router();
const TIMEOUT_MS = 20_000;

const base = () => (process.env.AFRIZONE_API_URL || "https://api.afrizonemart.com").replace(/\/+$/, "");

/** Path shape only: letters, digits, dashes, dots, slashes. Never an open proxy. */
const SAFE_PATH = /^[A-Za-z0-9._\-/]{1,200}$/;

async function afrizoneIdOf(req: AuthedRequest): Promise<string | null> {
  if (!req.user || !isConsoleRole(req.user.role)) return null;
  const row = await prisma.user.findUnique({ where: { id: req.user.id }, select: { afrizoneUserId: true, role: true } });
  if (!row || !isConsoleRole(row.role)) return null;
  return row.afrizoneUserId ?? null;
}

function clientIp(req: AuthedRequest): string {
  return (req.header("cf-connecting-ip") || req.ip || "").slice(0, 64);
}

router.post("/presence", requireAuth, async (req: AuthedRequest, res: Response) => {
  const token = process.env.MART_STAFF_TOKEN;
  if (!token) return res.json({ off: true });
  const afz = await afrizoneIdOf(req);
  // Not linked to AfriZone: nothing to report against, and that's fine.
  if (!afz) return res.json({ off: true });
  try {
    const r = await fetch(`${base()}/api/integrations/parttime/staff/presence`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Afz-User": afz,
        "X-Afz-Client-Ip": clientIp(req),
        "X-Afz-Client-Ua": (req.header("user-agent") || "").slice(0, 300),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined,
        idle: !!req.body?.idle,
        path: typeof req.body?.path === "string" ? req.body.path.slice(0, 300) : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    res.status(r.status).type("application/json").send((await r.text()) || "{}");
  } catch {
    res.status(502).json({ error: "AfriZone couldn't be reached" });
  }
});

router.use("/hr", requireAuth, async (req: AuthedRequest, res: Response) => {
  const token = process.env.MART_HR_TOKEN;
  if (!token) return res.status(503).json({ error: "The AZM HR Console isn't switched on yet", code: "HR_OFF" });
  const path = req.path.replace(/^\/+/, "");
  if (!SAFE_PATH.test(path) || path.includes("..")) return res.status(404).json({ error: "Not found" });
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return res.status(405).end();
  const afz = await afrizoneIdOf(req);
  if (!afz) {
    return res.status(403).json({
      error: "Link your AfriZone account in Settings to open the AZM Staff side.",
      code: "HR_NEEDS_AFRIZONE",
    });
  }
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const hasBody = !["GET", "DELETE"].includes(req.method);
  try {
    const r = await fetch(`${base()}/api/integrations/parttime/hr/${path}${query}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Afz-User": afz,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(req.body ?? {}) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Files and CSVs pass through as bytes with their headers; JSON as JSON.
    const type = r.headers.get("content-type") || "application/json";
    res.status(r.status);
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, no-store");
    const disp = r.headers.get("content-disposition");
    if (disp) res.setHeader("Content-Disposition", disp);
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error("hr proxy failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "AfriZone couldn't be reached. Try again." });
  }
});

export default router;
