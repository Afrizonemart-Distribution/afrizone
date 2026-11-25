/**
 * The staff workspace: AfriZone staff see their afrizonemart tasks and KPI here
 * (afrizonemart PLANNING/STAFF_TASKS_KPI_TRACKER.md P5).
 *
 * THE DATA STAYS IN AFRIZONEMART. Part Time keeps nothing about staff: no User
 * row, no role, nothing in the gig feeds. A staff member signs in with their
 * AfriZone account (the same identity token "Continue with AfriZone" uses;
 * AfriZone's own sign-in already enforces staff 2FA), gets a short staff
 * session, and every request is passed to afrizonemart-api's
 * /api/integrations/parttime/staff/* with our service token, naming them in
 * X-Afz-User. afrizonemart decides what they may see.
 *
 *   POST /api/staff/session   { identityToken } -> { token, me }
 *   ANY  /api/staff/<allowed path>               -> afrizonemart
 *
 * Off until MART_STAFF_TOKEN is set (a `parttime.staff` service token).
 */
import { Router, Request, Response, NextFunction } from "express";
import { signStaffSession, verifyStaffSession, type StaffSession } from "../auth";
import {
  AfrizoneTokenError,
  consumeAfrizoneToken,
  verifyAfrizoneToken,
} from "../services/afrizoneIdentity";

const router = Router();
const TIMEOUT_MS = 10_000;

function config() {
  return {
    base: (process.env.AFRIZONE_API_URL || "https://api.afrizonemart.com").replace(/\/+$/, ""),
    token: process.env.MART_STAFF_TOKEN || "",
  };
}

export function staffWorkspaceEnabled(): boolean {
  return !!config().token;
}

/** Only these paths go through, so this is never an open proxy. */
const ALLOWED: { method: "GET" | "POST" | "PUT" | "PATCH"; path: RegExp }[] = [
  // My HR (AZM HR Console): the person's own file, leave, documents, pay,
  // claims, reviews, queries, policies, training, surveys, and their team.
  { method: "GET", path: /^hr(\/(leave|documents|payslips|claims|reviews|queries|policies|training|surveys|celebrations|team))?$/ },
  { method: "GET", path: /^hr\/documents\/[\w-]{1,64}\/file$/ },
  { method: "PATCH", path: /^hr\/file$/ },
  { method: "POST", path: /^hr\/(leave|documents|claims)$/ },
  { method: "POST", path: /^hr\/(leave|claims)\/[\w-]{1,64}\/cancel$/ },
  { method: "POST", path: /^hr\/documents\/[\w-]{1,64}\/sign$/ },
  { method: "POST", path: /^hr\/queries\/[\w-]{1,64}\/respond$/ },
  { method: "POST", path: /^hr\/policies\/[\w-]{1,64}\/ack$/ },
  { method: "POST", path: /^hr\/training\/[\w-]{1,64}\/complete$/ },
  { method: "POST", path: /^hr\/surveys\/[\w-]{1,64}$/ },
  { method: "PUT", path: /^hr\/reviews\/[\w-]{1,64}$/ },
  { method: "POST", path: /^hr\/team\/(leave|claims)\/[\w-]{1,64}\/decide$/ },
  { method: "PUT", path: /^hr\/team\/reviews\/[\w-]{1,64}$/ },
  { method: "GET", path: /^me$/ },
  { method: "GET", path: /^tasks$/ },
  { method: "GET", path: /^tasks\/summary$/ },
  { method: "POST", path: /^tasks\/offsite$/ },
  { method: "GET", path: /^tasks\/[\w-]{1,64}$/ },
  { method: "POST", path: /^tasks\/[\w-]{1,64}\/(start|submit|approve|rework|comments)$/ },
  { method: "GET", path: /^kpi\/(me|team)$/ },
  { method: "GET", path: /^kpi\/users\/[\w-]{1,64}$/ },
];

export function isAllowed(method: string, path: string): boolean {
  return ALLOWED.some((a) => a.method === method && a.path.test(path));
}

/**
 * Who the call is for: an AfriZone user id (staff workspace sessions) or the
 * proven work email of a Part Time console account (routes/consoleMyHr.ts).
 */
export type MartStaffIdentity = string | { email: string };

export async function callMart(method: string, path: string, who: MartStaffIdentity, query: string, body?: unknown) {
  const { base, token } = config();
  return fetch(`${base}/api/integrations/parttime/staff/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(typeof who === "string" ? { "X-Afz-User": who } : { "X-Afz-Staff-Email": who.email }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

router.post("/session", async (req: Request, res: Response) => {
  if (!staffWorkspaceEnabled()) {
    return res.status(503).json({ error: "The staff workspace isn't switched on yet", code: "STAFF_OFF" });
  }
  const identityToken = typeof req.body?.identityToken === "string" ? req.body.identityToken : "";
  if (!identityToken) return res.status(400).json({ error: "identityToken is required" });
  try {
    const claims = await verifyAfrizoneToken(identityToken);
    await consumeAfrizoneToken(claims);
    const r = await callMart("GET", "me", claims.sub, "");
    if (r.status === 403) {
      return res.status(403).json({ error: "This AfriZone account isn't a staff account", code: "NOT_STAFF" });
    }
    if (!r.ok) return res.status(502).json({ error: "AfriZone couldn't be reached. Try again." });
    const me = (await r.json()) as { name?: string | null };
    return res.json({ token: signStaffSession(claims.sub, me.name ?? claims.name), me });
  } catch (e) {
    if (e instanceof AfrizoneTokenError) return res.status(401).json({ error: "AfriZone sign-in failed. Try again." });
    console.error("staff session failed:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "AfriZone couldn't be reached. Try again." });
  }
});

interface StaffRequest extends Request {
  staff?: StaffSession;
}

function requireStaff(req: StaffRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in again" });
  try {
    req.staff = verifyStaffSession(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "Sign in again" });
  }
}

router.use(requireStaff, async (req: StaffRequest, res: Response) => {
  const path = req.path.replace(/^\/+/, "");
  if (!isAllowed(req.method, path)) return res.status(404).json({ error: "Not found" });
  if (!staffWorkspaceEnabled()) return res.status(503).json({ error: "The staff workspace isn't switched on yet" });
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  try {
    const r = await callMart(req.method, path, req.staff!.sub, query, req.method === "GET" ? undefined : req.body ?? {});
    const type = r.headers.get("content-type") || "application/json";
    if (!type.includes("application/json")) {
      // A My HR document: pass the bytes through.
      res.status(r.status).setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(Buffer.from(await r.arrayBuffer()));
    }
    const text = await r.text();
    res.status(r.status).type("application/json").send(text || "{}");
  } catch (e) {
    console.error("staff proxy failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "AfriZone couldn't be reached. Try again." });
  }
});

export default router;
