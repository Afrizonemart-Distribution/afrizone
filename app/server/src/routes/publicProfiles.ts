/**
 * GET /api/public/profiles/:slug - a Talent Profile someone chose to share.
 *
 * No auth, by design: this is the link a worker sends to an employer. So it
 * answers ONLY for profiles set to LINK, and with the public cut of the data
 * (services/talentProfile.ts): no contact details, no files, and nothing
 * unverified dressed as verified.
 *
 * A private, unknown or staff profile all answer the same 404, so the route
 * cannot be used to learn whether someone has an account.
 */
import { Router } from "express";
import { prisma } from "../prisma";
import { buildProfile } from "../services/talentProfile";

const router = Router();
const SLUG = /^[a-z0-9-]{3,48}$/;

router.get("/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const notFound = () => res.status(404).json({ error: "Profile not found" });
  if (!SLUG.test(slug)) return notFound();

  const user = await prisma.user.findUnique({ where: { profileSlug: slug } });
  if (!user || user.profileVisibility !== "LINK" || user.role !== "WORKER") return notFound();

  res.set("Cache-Control", "public, max-age=60");
  res.json(await buildProfile(user.id, "public"));
});

export default router;
