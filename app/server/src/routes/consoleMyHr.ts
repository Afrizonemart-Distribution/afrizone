// My HR for Part Time console staff (2026-11-25). Mounted at /api/admin/my-hr.
//
// Part Time staff have their own console accounts (routes/staffAccess.ts),
// not Afrizonemart ones, but their HR file lives in Afrizonemart like every
// other AZM staff member's. So the console relays My HR to afrizonemart-api's
// Part Time staff door with our service token, naming the person by their
// work email (X-Afz-Staff-Email).
//
// The email is one they have PROVED they own: a console account can only
// sign in after setting its password from a link mailed to that address, or
// with Google on it. We read it from the database, never from the request,
// and only for an account that can sign in. Only the My HR paths in the
// staff workspace allow-list go through, so this is never an open proxy.
//
//   ANY /api/admin/my-hr/<path>  ->  /api/integrations/parttime/staff/hr/<path>

import { Router, type Response } from "express";
import { prisma } from "../prisma";
import { ADMIN_ROLES, requireAuth, requireRole, type AuthedRequest } from "../auth";
import { callMart, isAllowed, staffWorkspaceEnabled } from "./staffWorkspace";

const router = Router();
router.use(requireAuth, requireRole(...ADMIN_ROLES));

/** Afrizonemart's error envelope ({ error: { code, message } }) in the console's shape ({ error, code }). */
function relayError(status: number, text: string) {
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } | string; message?: string };
    const e = body.error;
    if (typeof e === "object" && e) return { error: e.message ?? `Request failed (${status})`, code: e.code };
    if (typeof e === "string") return { error: e };
  } catch {
    /* not JSON */
  }
  return { error: `Request failed (${status})` };
}

router.use(async (req: AuthedRequest, res: Response) => {
  const sub = req.path.replace(/^\/+/, "").replace(/\/+$/, "");
  const path = sub ? `hr/${sub}` : "hr";
  if (!isAllowed(req.method, path)) return res.status(404).json({ error: "Not found" });
  if (!staffWorkspaceEnabled()) {
    return res.status(503).json({ error: "My HR isn't switched on for Part Time yet.", code: "MY_HR_OFF" });
  }
  const me = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { email: true, passwordHash: true, googleId: true },
  });
  if (!me || (!me.passwordHash && !me.googleId)) {
    return res.status(403).json({ error: "Set your password from your invite email first.", code: "EMAIL_NOT_PROVEN" });
  }
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  try {
    const r = await callMart(req.method, path, { email: me.email }, query, req.method === "GET" ? undefined : req.body ?? {});
    const type = r.headers.get("content-type") || "application/json";
    if (r.ok && !type.includes("application/json")) {
      // A document: pass the bytes through.
      res.status(r.status).setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(Buffer.from(await r.arrayBuffer()));
    }
    const text = await r.text();
    res.setHeader("Cache-Control", "private, no-store");
    if (!r.ok) return res.status(r.status).json(relayError(r.status, text));
    return res.status(r.status).type("application/json").send(text || "{}");
  } catch (e) {
    console.error("my-hr relay failed:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "AZM HR couldn't be reached. Try again." });
  }
});

export default router;
