/**
 * Organizations: the businesses a person may act for, and the ones Afrizone
 * administers. A store and a courier company are the same shape here - what
 * differs is the work they receive, not who they are.
 *
 * WHY THESE ROUTES DO NOT USE requireAccountType, WHICH WILL LOOK LIKE AN
 * OVERSIGHT:
 *
 *   Membership is the authority here, not account type. `User.accountType`
 *   records how someone primarily uses the platform and decides which dashboard
 *   they land on; it is not a claim about which businesses they may touch, and
 *   every STORE account gives the same answer to it. Gating on it as well would
 *   buy nothing and would break a real case - an individual worker who also
 *   helps at their family's shop is one person with one login, an INDIVIDUAL
 *   account type, and a legitimate OrganizationMember row.
 *
 *   So requireAccountType is for gating features that belong to a KIND of
 *   account (courier-only, individual-only). Anything scoped to a particular
 *   business asks util/organization.ts instead, which answers the question that
 *   actually matters: may this person touch THIS organization.
 *
 * Two routers, mounted separately: the default one is for a business's own
 * people, `adminRouter` is for Afrizone staff. Splitting them keeps the approval
 * and suspension endpoints away from any path a member can reach, rather than
 * relying on a role check buried in a shared handler.
 */
import { Router, Response } from "express";
import { claimForStore, onStoreApproved } from "../services/referrals";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { slugify } from "../types";
import { formatDistance, haversineMetres, isValidCoord } from "../util/geo";
import { latestAudit, recordAudit, requestStoreAudit } from "../services/storeAudit";
import { userActor, writeAudit } from "../util/audit";
import { decideCac, isCacConfigured, submitCac } from "../services/cacVerification";
import {
  kindLabel,
  listOrganizationsForUser,
  requireOrgAccess,
  ORG_KINDS,
  ORG_ROLES,
  ORG_STATUSES,
  type OrgKind,
  type OrgRole,
} from "../util/organization";

const router = Router();
export const adminRouter = Router();

/**
 * An organization as it goes over the wire.
 *
 * The full bank account number is returned only to an OWNER. STAFF do the work;
 * they have no reason to read the payout account, and staff turnover is exactly
 * the population you do not want holding it. `bankMasked` is enough to confirm
 * which account is on file, which is the only reason to display it.
 */
function publicOrg(org: any, viewerRole: OrgRole | "ADMIN") {
  const { bankAccountNumber, ...rest } = org;
  if (viewerRole === "OWNER" || viewerRole === "ADMIN") {
    return { ...rest, bankAccountNumber: bankAccountNumber ?? null };
  }
  return rest;
}

function memberShape(m: any) {
  return {
    id: m.id,
    userId: m.userId,
    role: m.role,
    createdAt: m.createdAt,
    name: m.user?.name ?? null,
    email: m.user?.email ?? null,
    phone: m.user?.phone ?? null,
  };
}

/** Last four digits, which is all a business needs to recognise its own account. */
function maskAccount(n: string): string {
  const digits = n.replace(/\D/g, "");
  return digits.length >= 4 ? `****${digits.slice(-4)}` : "****";
}

/** `?kind=STORE` as a validated value, or undefined for "any". */
function readKind(raw: unknown): OrgKind | undefined {
  return ORG_KINDS.includes(raw as OrgKind) ? (raw as OrgKind) : undefined;
}

// ── A business's own people ──────────────────────────────────────────────────

/**
 * GET /api/organizations?kind=STORE → every business this person may act for.
 *
 * Deliberately not "all organizations". A listing endpoint that returns the
 * platform's businesses and leaves filtering to the client is the same leak as
 * answering 403 instead of 404 on a single one, spread over one request instead
 * of many.
 */
router.get("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const orgs = await listOrganizationsForUser(req.user!.id, readKind(req.query.kind));
  res.json(orgs.map(({ org, role }) => ({ ...publicOrg(org, role), myRole: role })));
});

// DECLARED BEFORE /:id ON PURPOSE. Express matches in declaration order, so with
// these the other way round a request for /map is read as an organization whose
// id is "map" - and answers 404, because nobody is a member of it. The symptom
// is "the map endpoint does not exist" and the cause is invisible.
/**
 * GET /api/organizations/map?kind=STORE&lat=&lng=&radius=
 *
 * The live network of approved nodes (Blueprint §8). This is what lets a Courier
 * find the nearest shop holding an order, and what a Sourcing Agent uses to see
 * where they can drop stock.
 *
 * OPEN TO ANY SIGNED-IN USER, WHICH IS DELIBERATE AND IS ALSO WHY THE PAYLOAD IS
 * NARROW. Every Tasker and Courier needs this, and gating it on membership would
 * mean only a store's own staff could see it - the opposite of a network map. So
 * it returns exactly what somebody needs to travel to a place: name, address,
 * coordinates, and how far away it is. No payout details, no members, no contact
 * for a shop you have no business phoning.
 *
 * ONLY ACTIVE ORGANIZATIONS APPEAR. A store that is still awaiting approval, or
 * has been suspended, is not part of the network, and putting it on the map
 * would send a courier to a shop that cannot hand anything over.
 */
router.get("/map", requireAuth, async (req: AuthedRequest, res: Response) => {
  const kind = readKind(req.query.kind) ?? "STORE";

  const orgs = await prisma.organization.findMany({
    where: { kind, status: "ACTIVE" },
    select: { id: true, name: true, slug: true, address: true, lat: true, lng: true, kind: true },
    orderBy: { name: "asc" },
  });

  // A node with no coordinates cannot be navigated to, so it is not on a map.
  // It is still a real approved store - it just needs its location set, which is
  // a gap an admin can see on the Organizations screen rather than a courier
  // discovering it at a junction.
  const placed = orgs.filter((o) => isValidCoord(o.lat, o.lng));

  const from = isValidCoord(req.query.lat, req.query.lng)
    ? { lat: Number(req.query.lat), lng: Number(req.query.lng) }
    : null;

  let out = placed.map((o) => {
    const metres = from ? haversineMetres(from.lat, from.lng, o.lat!, o.lng!) : null;
    return {
      id: o.id,
      kind: o.kind,
      name: o.name,
      slug: o.slug,
      address: o.address,
      lat: o.lat,
      lng: o.lng,
      distanceMetres: metres === null ? null : Math.round(metres),
      distance: metres === null ? null : formatDistance(metres),
    };
  });

  if (from) {
    const radius = Number(req.query.radius);
    if (Number.isFinite(radius) && radius > 0) {
      out = out.filter((o) => (o.distanceMetres ?? Infinity) <= radius);
    }
    // Nearest first. Without a reference point the list stays alphabetical,
    // because "nearest to nowhere" is not an order.
    out.sort((a, b) => (a.distanceMetres ?? 0) - (b.distanceMetres ?? 0));
  }

  res.json({
    count: out.length,
    // Named so the difference is visible rather than inferred: an admin looking
    // at a short map should be able to tell "not approved yet" from "nobody set
    // the address".
    unplaced: orgs.length - placed.length,
    nodes: out,
  });
});

// GET /api/organizations/:id → one business, if the caller belongs to it.
router.get("/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  res.json({
    ...publicOrg(access.org, access.membership.role as OrgRole),
    myRole: access.membership.role,
  });
});

/**
 * PATCH /api/organizations/:id → update its own details. OWNER only.
 *
 * Neither `status` nor `kind` is writable here at any role. A business
 * approving itself is the hole the PENDING default exists to close, and one
 * reclassifying itself from a store into a courier company would silently
 * change which work it can receive.
 */
router.patch("/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id, { roles: ["OWNER"] });
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const b = req.body || {};
  const data: any = {};
  for (const f of ["name", "phone", "email", "address", "bankName", "bankCode", "tin"]) {
    if (b[f] !== undefined) data[f] = b[f] === null ? null : String(b[f]);
  }
  if (b.lat !== undefined) data.lat = b.lat != null ? Number(b.lat) : null;
  if (b.lng !== undefined) data.lng = b.lng != null ? Number(b.lng) : null;
  if (b.bankAccountNumber !== undefined) {
    const n = b.bankAccountNumber == null ? null : String(b.bankAccountNumber).trim();
    data.bankAccountNumber = n;
    // Derived here rather than trusted from the client: a mask that does not
    // match the account is worse than no mask, because it is the only thing
    // anyone visually checks before a payout goes out.
    data.bankMasked = n ? maskAccount(n) : null;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const org = await prisma.organization.update({ where: { id: access.org.id }, data });
  // Payout details changing is worth a trail on its own: it is the one edit
  // here that redirects money.
  if (data.bankAccountNumber !== undefined || data.bankCode !== undefined) {
    await writeAudit(userActor(req.user!.id), "organization.payout.updated", "Organization", org.id, {
      bankMasked: org.bankMasked,
      bankCode: org.bankCode,
    });
  }
  res.json({ ...publicOrg(org, "OWNER"), myRole: "OWNER" });
});

/**
 * POST /api/organizations/:id/cac → record the CAC registration number. OWNER.
 *
 * OWNER, not STAFF. This is the business asserting who it legally is, which is
 * the same class of act as changing the payout account, and staff turnover is
 * exactly the population that should not be able to make it.
 *
 * Always lands on PENDING, never VERIFIED - see services/cacVerification.ts for
 * why a registry hit is not a decision.
 */
router.post("/:id/cac", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id, { roles: ["OWNER"] });
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const raw = String(req.body?.cacNumber ?? "").trim();
  if (!raw) return res.status(400).json({ error: "Give the registration number" });

  const result = await submitCac(access.org.id, raw, userActor(req.user!.id));
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  const org = await prisma.organization.findUnique({ where: { id: access.org.id } });
  res.json({ ...publicOrg(org, "OWNER"), myRole: "OWNER", message: result.message });
});

// GET /api/organizations/:id/members → who can act for it. Any member may look.
router.get("/:id/members", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: access.org.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(members.map(memberShape));
});

/**
 * POST /api/organizations/:id/members → add someone by email or phone. OWNER only.
 *
 * The person must already have an Afrizone account. Creating one implicitly
 * would let an owner mint logins for addresses they do not control, and an
 * invitation flow is a different feature with different consent - not something
 * to smuggle in as a side effect of adding a colleague.
 *
 * Adding somebody does NOT change their accountType. Membership and account
 * type are separate facts, and overwriting the second here would silently move
 * an individual worker off their own dashboard.
 */
router.post("/:id/members", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id, { roles: ["OWNER"] });
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const b = req.body || {};
  const email = b.email ? String(b.email).trim().toLowerCase() : null;
  const phone = b.phone ? String(b.phone).trim() : null;
  if (!email && !phone) return res.status(400).json({ error: "An email or phone number is required" });

  const role: OrgRole = b.role === "OWNER" ? "OWNER" : "STAFF";
  const user = await prisma.user.findFirst({
    where: email ? { email } : { phone: phone! },
    select: { id: true },
  });
  if (!user) {
    return res.status(404).json({ error: "No Afrizone account with that email or phone number" });
  }

  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: access.org.id, userId: user.id } },
  });
  if (existing) return res.status(409).json({ error: `They are already on this ${kindLabel(access.org.kind)}` });

  const member = await prisma.organizationMember.create({
    data: { organizationId: access.org.id, userId: user.id, role },
    include: { user: true },
  });
  await writeAudit(userActor(req.user!.id), "organization.member.added", "Organization", access.org.id, {
    userId: user.id,
    role,
  });
  res.status(201).json(memberShape(member));
});

/**
 * How many OWNERs would remain if this membership were removed or demoted?
 *
 * A business with no owner cannot add members, edit itself, or fix its own
 * payout account - it is unmanageable without an admin stepping in. That is a
 * support ticket created by a single mis-click, so it is refused rather than
 * allowed and apologised for.
 */
async function ownersBesides(organizationId: string, memberId: string): Promise<number> {
  return prisma.organizationMember.count({
    where: { organizationId, role: "OWNER", id: { not: memberId } },
  });
}

// PATCH /api/organizations/:id/members/:memberId → change standing. OWNER only.
router.patch("/:id/members/:memberId", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id, { roles: ["OWNER"] });
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const role = req.body?.role;
  if (!ORG_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${ORG_ROLES.join(", ")}` });
  }

  const member = await prisma.organizationMember.findFirst({
    where: { id: req.params.memberId, organizationId: access.org.id },
  });
  if (!member) return res.status(404).json({ error: "Not a member here" });

  if (member.role === "OWNER" && role !== "OWNER" && (await ownersBesides(access.org.id, member.id)) === 0) {
    return res.status(400).json({ error: "There must be at least one owner" });
  }

  const updated = await prisma.organizationMember.update({
    where: { id: member.id },
    data: { role },
    include: { user: true },
  });
  await writeAudit(
    userActor(req.user!.id),
    "organization.member.role.changed",
    "Organization",
    access.org.id,
    { userId: member.userId, role }
  );
  res.json(memberShape(updated));
});

// DELETE /api/organizations/:id/members/:memberId → remove someone. OWNER only.
router.delete("/:id/members/:memberId", requireAuth, async (req: AuthedRequest, res: Response) => {
  const access = await requireOrgAccess(req.user!.id, req.params.id, { roles: ["OWNER"] });
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const member = await prisma.organizationMember.findFirst({
    where: { id: req.params.memberId, organizationId: access.org.id },
  });
  if (!member) return res.status(404).json({ error: "Not a member here" });

  if (member.role === "OWNER" && (await ownersBesides(access.org.id, member.id)) === 0) {
    return res.status(400).json({ error: "There must be at least one owner" });
  }

  await prisma.organizationMember.delete({ where: { id: member.id } });
  await writeAudit(
    userActor(req.user!.id),
    "organization.member.removed",
    "Organization",
    access.org.id,
    { userId: member.userId }
  );
  res.json({ ok: true });
});

/**
 * POST /api/admin/organizations/:id/audit -> generate the inspection task.
 *
 * Blueprint §8's middle step. Idempotent: an audit already open for this store
 * is returned rather than a second one raised, because two auditors dispatched
 * to the same shop is a real cost to two people.
 */
adminRouter.post(
  "/:id/audit",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) return res.status(404).json({ error: "Not found" });
    if (org.status === "ACTIVE") {
      return res.status(400).json({ error: "This one is already approved" });
    }
    if (!org.address && (org.lat == null || org.lng == null)) {
      return res.status(400).json({ error: "Add an address before requesting an audit" });
    }

    const result = await requestStoreAudit(org.id, userActor(req.user!.id));
    if (!result) return res.status(400).json({ error: "Could not raise an audit for this one" });
    res.status(result.created ? 201 : 200).json(result);
  }
);

/**
 * POST /api/admin/organizations/:id/audit-result -> record a finding directly.
 *
 * For an audit an admin carried out themselves, or one that came in off the
 * platform. The auditor-facing route is POST /api/me/audits.
 */
adminRouter.post(
  "/:id/audit-result",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) return res.status(404).json({ error: "Not found" });

    const score = Number(req.body?.score);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: "Score must be a whole number between 0 and 100" });
    }

    const row = await recordAudit({
      organizationId: org.id,
      score,
      notes: req.body?.notes ? String(req.body.notes) : null,
      actor: userActor(req.user!.id),
    });
    res.status(201).json(row);
  }
);

// ── Afrizone staff ───────────────────────────────────────────────────────────

// GET /api/admin/organizations?kind=&status= → all of them, with a member count.
adminRouter.get(
  "/",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const kind = readKind(req.query.kind);
    // The CAC review queue is a filter on this list rather than a screen of its
    // own: it is the same rows, asked a different question.
    const cacStatus = req.query.cacStatus ? String(req.query.cacStatus) : undefined;
    const orgs = await prisma.organization.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(cacStatus ? { cacStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { members: true } } },
    });
    res.json(
      orgs.map((o) => {
        const { _count, ...rest } = o as any;
        return { ...publicOrg(rest, "ADMIN"), memberCount: _count.members };
      })
    );
  }
);

// GET /api/admin/organizations/:id → one, with its members.
adminRouter.get(
  "/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: { members: { include: { user: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!org) return res.status(404).json({ error: "Not found" });
    const { members, ...rest } = org as any;
    // The latest finding travels with the record, because approving a store is
    // a decision made ON it - having to go and look it up elsewhere is how it
    // ends up not being looked at.
    const audit = await latestAudit(org.id);
    res.json({
      ...publicOrg(rest, "ADMIN"),
      members: members.map(memberShape),
      latestAudit: audit
        ? {
            id: audit.id,
            score: audit.score,
            outcome: audit.outcome,
            notes: audit.notes,
            createdAt: audit.createdAt,
            auditorName: audit.auditor?.name ?? null,
          }
        : null,
    });
  }
);

/**
 * POST /api/admin/organizations → register a store or a courier company.
 * SUPER_ADMIN.
 *
 * Lands PENDING unless an explicit status says otherwise, per the column
 * default. `ownerEmail` optionally seeds the first OWNER, because a business
 * with no owner is unmanageable and creating one then forgetting the owner is
 * the obvious way to produce that.
 */
adminRouter.post(
  "/",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const b = req.body || {};
    const name = String(b.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    // Defaults STORE rather than being required, matching the column default -
    // every organization that existed before couriers were modelled was a store.
    const kind: OrgKind = readKind(b.kind) ?? "STORE";

    const slug = String(b.slug ?? "").trim() || slugify(name);
    if (!slug) return res.status(400).json({ error: "Could not derive a slug from that name" });
    const clash = await prisma.organization.findUnique({ where: { slug } });
    if (clash) return res.status(409).json({ error: `Something with slug "${slug}" already exists` });

    if (b.status !== undefined && !ORG_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of ${ORG_STATUSES.join(", ")}` });
    }

    // Resolved BEFORE the organization is created, so a typo in the owner's
    // email cannot leave an ownerless business behind.
    let ownerId: string | null = null;
    if (b.ownerEmail) {
      const owner = await prisma.user.findUnique({
        where: { email: String(b.ownerEmail).trim().toLowerCase() },
        select: { id: true },
      });
      if (!owner) return res.status(404).json({ error: "No Afrizone account with that owner email" });
      ownerId = owner.id;
    }

    const account = b.bankAccountNumber ? String(b.bankAccountNumber).trim() : null;
    const org = await prisma.organization.create({
      data: {
        kind,
        name,
        slug,
        phone: b.phone ?? null,
        email: b.email ?? null,
        address: b.address ?? null,
        lat: b.lat != null ? Number(b.lat) : null,
        lng: b.lng != null ? Number(b.lng) : null,
        bankAccountNumber: account,
        bankMasked: account ? maskAccount(account) : null,
        bankCode: b.bankCode ?? null,
        bankName: b.bankName ?? null,
        tin: b.tin ?? null,
        status: b.status ?? "PENDING",
      },
    });
    if (ownerId) {
      await prisma.organizationMember.create({
        data: { organizationId: org.id, userId: ownerId, role: "OWNER" },
      });
    }
    // Who brought the store in, when the admin registering it was told. A bad
    // code does not undo the registration; it comes back as a warning.
    let referralWarning: string | null = null;
    if (b.referralCode) {
      const claimed = await claimForStore(org.id, b.referralCode, userActor(req.user!.id));
      if (!claimed.ok) referralWarning = claimed.error;
      // Registered as already approved: it is real from the start.
      else if (org.status === "ACTIVE") await onStoreApproved(org.id);
    }

    await writeAudit(userActor(req.user!.id), "organization.created", "Organization", org.id, {
      name: org.name,
      kind: org.kind,
      status: org.status,
      ownerId,
    });
    // memberCount is included so the created row matches the shape the list
    // endpoint returns. Without it a client that adds the new organization to
    // its list optimistically renders "0 people" for a business that was just
    // given an owner - which reads as the owner having failed to attach.
    res.status(201).json({ ...publicOrg(org, "ADMIN"), memberCount: ownerId ? 1 : 0, referralWarning });
  }
);

/**
 * PATCH /api/admin/organizations/:id → including approval and suspension.
 * SUPER_ADMIN.
 *
 * This is the only place `status` can change. Approving a business is what lets
 * it receive work and be paid, so it is a decision by a named person and it is
 * audited as one.
 *
 * `kind` is not editable here either. A store that became a courier company
 * would change what work it can receive, silently, on rows that already exist -
 * that is a new registration, not an edit.
 */
adminRouter.patch(
  "/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthedRequest, res: Response) => {
    const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const b = req.body || {};
    const data: any = {};
    for (const f of ["name", "phone", "email", "address", "bankName", "bankCode", "tin"]) {
      if (b[f] !== undefined) data[f] = b[f] === null ? null : String(b[f]);
    }
    if (b.lat !== undefined) data.lat = b.lat != null ? Number(b.lat) : null;
    if (b.lng !== undefined) data.lng = b.lng != null ? Number(b.lng) : null;
    if (b.bankAccountNumber !== undefined) {
      const n = b.bankAccountNumber == null ? null : String(b.bankAccountNumber).trim();
      data.bankAccountNumber = n;
      data.bankMasked = n ? maskAccount(n) : null;
    }
    if (b.status !== undefined) {
      if (!ORG_STATUSES.includes(b.status)) {
        return res.status(400).json({ error: `status must be one of ${ORG_STATUSES.join(", ")}` });
      }
      data.status = b.status;
    }
    if (Object.keys(data).length === 0 && !b.referralCode) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    // A referrer can be recorded afterwards too, until the store is approved.
    if (b.referralCode) {
      if (existing.status === "ACTIVE") {
        return res.status(400).json({ error: "A referrer can only be added before the store is approved" });
      }
      const claimed = await claimForStore(existing.id, b.referralCode, userActor(req.user!.id));
      if (!claimed.ok) return res.status(claimed.status).json({ error: claimed.error });
      if (Object.keys(data).length === 0) {
        return res.json(publicOrg(existing, "ADMIN"));
      }
    }

    const org = await prisma.organization.update({ where: { id: existing.id }, data });
    // Approval is what makes a referred store real.
    if (org.status === "ACTIVE" && existing.status !== "ACTIVE") await onStoreApproved(org.id);
    if (data.status && data.status !== existing.status) {
      await writeAudit(
        userActor(req.user!.id),
        "organization.status.changed",
        "Organization",
        org.id,
        { from: existing.status, to: org.status, kind: org.kind }
      );
    }
    res.json(publicOrg(org, "ADMIN"));
  }
);

/**
 * POST /api/admin/organizations/:id/cac-decision → confirm or refuse it.
 *
 * TASK_MANAGER as well as SUPER_ADMIN, matching who reviews a worker's KYC and
 * credentials. This is a verification, not an approval: it records whether a
 * registration number checks out, and it deliberately does not change whether
 * the business can trade. Approving one stays SUPER_ADMIN, on PATCH.
 */
adminRouter.post(
  "/:id/cac-decision",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (req: AuthedRequest, res: Response) => {
    const decision = String(req.body?.decision ?? "");
    if (decision !== "VERIFIED" && decision !== "REJECTED") {
      return res.status(400).json({ error: "decision must be VERIFIED or REJECTED" });
    }
    const note = req.body?.note != null ? String(req.body.note) : null;

    const result = await decideCac(req.params.id, decision, note, userActor(req.user!.id));
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    res.json(publicOrg(org, "ADMIN"));
  }
);

/**
 * GET /api/admin/organizations/cac/config → is a registry provider wired up?
 *
 * So the review screen can say "checked against the registry" or "no registry
 * configured - this is a manual check" rather than leaving a reviewer to guess
 * how much the absence of a registered name means.
 */
adminRouter.get(
  "/cac/config",
  requireAuth,
  requireRole("SUPER_ADMIN", "TASK_MANAGER"),
  async (_req: AuthedRequest, res: Response) => {
    res.json({ configured: isCacConfigured() });
  }
);

export default router;
