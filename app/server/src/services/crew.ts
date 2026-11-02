/**
 * Crew contracts: a lead Tasker brings a small crew to a larger fixed-price job,
 * and the pay is split between them (Blueprint §14).
 *
 * THE SHAPE, AS DECIDED:
 *
 *   The lead proposes. They name each member by phone number and a share for
 *   each, their own included, and the shares add up to the task budget exactly.
 *
 *   Each member accepts their own share. Nobody is signed up for an amount they
 *   never saw. Until every member has accepted, the manager cannot approve; one
 *   decline withdraws the whole application, and the lead is told who and can
 *   apply again with somebody else.
 *
 *   The manager approves the crew as one. It takes ONE slot - the crew is doing
 *   the job, not several jobs - and every member gets a contract of their own
 *   with their share ring-fenced against it, so the money owed to each is a
 *   record the day they start rather than a promise the lead makes.
 *
 *   The lead hands in once, for everybody. The members' contracts move with the
 *   lead's, and approving the hand-in pays each member their share as their own
 *   Payment with their own withholding tax. A crew member is a Tasker being
 *   paid by Afrizone, never a subcontractor being paid by the lead.
 *
 * THE GATE STILL APPLIES TO EVERYONE. Every member must meet the task's
 * requirements on their own, checked when they are named and again at
 * approval. There is no override for a crew member: an admin override is a
 * person taking responsibility for one named Tasker, and the place to do that
 * is a solo approval.
 *
 * FIXED-PRICE ONLY, AND ONLY WHERE A MANAGER SAID SO. `Task.crewMax` is the
 * number of people, lead included; 0 means solo. Hourly work is paid per
 * person's own hours and has no budget to split.
 */
import { prisma } from "../prisma";
import { notifyWorker } from "./push";
import { writeAudit, type AuditActor } from "../util/audit";
import { computeWht } from "../util/tax";
import { transitionContract, type ContractState } from "./contractState";
import { commitForContract, releaseForContract } from "./commitments";
import {
  blockingBlockers,
  decide,
  isEnforcing,
  loadTaskRequirements,
  loadWorkerProfile,
  type Blocker,
} from "./eligibility";

export interface CrewProposal {
  leadShare: number;
  members: { phone: string; share: number }[];
}

type Fail = { ok: false; status: 400 | 404 | 409; error: string; blockers?: Blocker[] };

// ── The proposal ─────────────────────────────────────────────────────────────

/**
 * Pure. Whether a proposal is well-formed for this task, before anybody is
 * looked up. Returns the first problem in words a lead can act on, or null.
 */
export function checkProposal(
  task: { payModel: string; budget: number | null; crewMax: number },
  p: CrewProposal
): string | null {
  if (task.payModel !== "FIXED" || task.crewMax < 2) return "This job does not take a crew";
  if (!Array.isArray(p.members) || p.members.length === 0) return "Name at least one person for your crew";
  if (p.members.length + 1 > task.crewMax) {
    return `This job takes a crew of at most ${task.crewMax}, including you`;
  }
  const shares = [p.leadShare, ...p.members.map((m) => m.share)];
  if (!shares.every((s) => Number.isInteger(s) && s > 0)) {
    return "Every share must be a whole amount of naira above zero";
  }
  const total = shares.reduce((a, b) => a + b, 0);
  if (total !== (task.budget ?? 0)) {
    return `The shares add up to ₦${total.toLocaleString("en-NG")}; they must add up to the job's ₦${(task.budget ?? 0).toLocaleString("en-NG")}`;
  }
  return null;
}

/**
 * The forms one Nigerian number is commonly typed and stored in. Sign-in keeps
 * what the person typed, so a lead typing 0803... must still find somebody who
 * signed in as +234803..., and the other way round.
 */
export function phoneVariants(raw: string): string[] {
  const s = String(raw ?? "").trim().replace(/[\s()-]/g, "");
  if (!s) return [];
  const digits = s.replace(/^\+/, "");
  let local: string | null = null;
  if (/^234\d{10}$/.test(digits)) local = digits.slice(3);
  else if (/^0\d{10}$/.test(digits)) local = digits.slice(1);
  else if (/^\d{10}$/.test(digits)) local = digits;
  const out = new Set([s]);
  if (local) {
    out.add(`+234${local}`);
    out.add(`234${local}`);
    out.add(`0${local}`);
  }
  return [...out];
}

/**
 * Resolve the named members and check each against the task's requirements.
 * Nothing is written. On success, who they are and what each was offered.
 */
export async function resolveCrew(
  task: { id: string; payModel: string; budget: number | null; crewMax: number } & Record<string, any>,
  leadId: string,
  p: CrewProposal
): Promise<{ ok: true; members: { workerId: string; name: string; share: number }[] } | Fail> {
  const problem = checkProposal(task, p);
  if (problem) return { ok: false, status: 400, error: problem };

  const [requirements, enforcing] = await Promise.all([
    loadTaskRequirements(prisma, [task as any]),
    isEnforcing(prisma),
  ]);
  const reqs = requirements.get(task.id)!;

  const members: { workerId: string; name: string; share: number }[] = [];
  const seen = new Set<string>([leadId]);
  for (const m of p.members) {
    const user = await prisma.user.findFirst({
      where: { phone: { in: phoneVariants(m.phone) }, role: "WORKER" },
      select: { id: true, name: true },
    });
    if (!user) {
      return { ok: false, status: 404, error: `Nobody on PartTime has the number ${m.phone}` };
    }
    if (user.id === leadId) return { ok: false, status: 400, error: "You are already on your crew as the lead" };
    if (seen.has(user.id)) return { ok: false, status: 400, error: `${user.name} is named twice` };
    seen.add(user.id);

    const profile = await loadWorkerProfile(prisma, user.id);
    const blocking = profile ? blockingBlockers(decide(profile, reqs).blockers, enforcing) : [];
    if (!profile || blocking.length > 0) {
      return {
        ok: false,
        status: 400,
        // Not the member's own checklist wording ("Upload your licence"): the
        // lead is reading this, about somebody else.
        error: `${user.name} cannot join this job yet: they do not meet its requirements`,
        blockers: blocking,
      };
    }
    members.push({ workerId: user.id, name: user.name, share: m.share });
  }
  return { ok: true, members };
}

/** Write the invites for a new crew application and tell each member. */
export async function inviteCrew(
  applicationId: string,
  task: { id: string; title: string },
  lead: { id: string; name: string },
  members: { workerId: string; share: number }[]
): Promise<void> {
  for (const m of members) {
    await prisma.crewInvite.create({ data: { applicationId, workerId: m.workerId, share: m.share } });
    await notifyWorker(
      prisma,
      m.workerId,
      "You have been asked to join a crew",
      `${lead.name} wants you on their crew for "${task.title}", for ₦${m.share.toLocaleString("en-NG")}. Accept or decline in the app.`,
      { screen: "crew" },
      "notifTasks"
    );
  }
  await writeAudit({ type: "USER", userId: lead.id }, "crew.proposed", "Application", applicationId, {
    taskId: task.id,
    members: members.map((m) => ({ workerId: m.workerId, share: m.share })),
  });
}

// ── Answering an invite ──────────────────────────────────────────────────────

export type CrewState = "SOLO" | "WAITING" | "READY";

/** Where a crew application stands. SOLO for an application without a crew. */
export async function crewStateOf(applicationId: string): Promise<CrewState> {
  const invites = await prisma.crewInvite.findMany({ where: { applicationId }, select: { status: true } });
  if (invites.length === 0) return "SOLO";
  return invites.every((i) => i.status === "ACCEPTED") ? "READY" : "WAITING";
}

/**
 * A member says yes or no to their own share.
 *
 * A decline withdraws the whole application rather than leaving a hole: the
 * shares were agreed as a set, and a crew with one person missing is a
 * different proposal the lead has to make again.
 */
export async function answerInvite(
  inviteId: string,
  workerId: string,
  accept: boolean
): Promise<{ ok: true; status: string } | Fail> {
  const invite = await prisma.crewInvite.findUnique({
    where: { id: inviteId },
    include: { application: { include: { task: true } }, worker: { select: { name: true } } },
  });
  if (!invite || invite.workerId !== workerId) return { ok: false, status: 404, error: "Invite not found" };
  if (invite.status !== "INVITED") return { ok: false, status: 409, error: "You have already answered this" };
  if (invite.application.status !== "APPLIED") {
    return { ok: false, status: 409, error: "This crew application has already been decided" };
  }

  const status = accept ? "ACCEPTED" : "DECLINED";
  const moved = await prisma.crewInvite.updateMany({
    where: { id: invite.id, status: "INVITED" },
    data: { status, respondedAt: new Date() },
  });
  if (moved.count !== 1) return { ok: false, status: 409, error: "You have already answered this" };

  const app = invite.application;
  const actor: AuditActor = { type: "USER", userId: workerId };
  await writeAudit(actor, accept ? "crew.accepted" : "crew.declined", "Application", app.id, {
    inviteId: invite.id,
    share: invite.share,
  });

  if (!accept) {
    await prisma.application.update({
      where: { id: app.id },
      data: { status: "REJECTED", reason: `${invite.worker.name} declined to join the crew` },
    });
    await notifyWorker(
      prisma,
      app.workerId,
      "Your crew application was withdrawn",
      `${invite.worker.name} declined to join your crew for "${app.task.title}". You can apply again with someone else.`,
      { screen: "tasks" },
      "notifTasks"
    );
  } else if ((await crewStateOf(app.id)) === "READY") {
    await notifyWorker(
      prisma,
      app.workerId,
      "Your crew is complete",
      `Everyone has accepted. Your crew application for "${app.task.title}" is now with the team.`,
      { screen: "tasks" },
      "notifTasks"
    );
  }
  return { ok: true, status };
}

// ── Approval ─────────────────────────────────────────────────────────────────

/**
 * Before the lead is assigned: every member has accepted and still qualifies.
 * Returns null when the crew may be approved.
 */
export async function checkCrewForApproval(applicationId: string, task: any): Promise<Fail | null> {
  const invites = await prisma.crewInvite.findMany({
    where: { applicationId },
    include: { worker: { select: { name: true } } },
  });
  if (invites.length === 0) return null;

  const waiting = invites.filter((i) => i.status !== "ACCEPTED");
  if (waiting.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Waiting for ${waiting.map((i) => i.worker.name).join(", ")} to accept their share`,
    };
  }

  const [requirements, enforcing] = await Promise.all([loadTaskRequirements(prisma, [task]), isEnforcing(prisma)]);
  const reqs = requirements.get(task.id)!;
  for (const i of invites) {
    const profile = await loadWorkerProfile(prisma, i.workerId);
    const blocking = profile ? blockingBlockers(decide(profile, reqs).blockers, enforcing) : [];
    if (!profile || blocking.length > 0) {
      return {
        ok: false,
        status: 400,
        error: `${i.worker.name} no longer meets the requirements for this task. A crew member cannot be overridden; ask the lead to apply again without them.`,
        blockers: blocking,
      };
    }
  }
  return null;
}

/**
 * After the lead is assigned: a contract for each member, their share
 * ring-fenced against it, and each told.
 */
export async function assignCrew(
  applicationId: string,
  leadContractId: string,
  task: { id: string; title: string },
  actor: AuditActor
): Promise<void> {
  const invites = await prisma.crewInvite.findMany({ where: { applicationId, status: "ACCEPTED" } });
  for (const i of invites) {
    const existing = await prisma.contract.findFirst({ where: { taskId: task.id, workerId: i.workerId } });
    const contract =
      existing ??
      (await prisma.contract.create({
        data: {
          taskId: task.id,
          workerId: i.workerId,
          status: "CLAIMED",
          share: i.share,
          crewLeadContractId: leadContractId,
        },
      }));
    if (!existing) await commitForContract(contract.id, i.workerId, i.share, actor);
    await notifyWorker(
      prisma,
      i.workerId,
      "Your crew was approved 🎉",
      `You are on the crew for "${task.title}". Your share is ₦${i.share.toLocaleString("en-NG")}. A contract is ready to sign.`,
      { screen: "tasks" },
      "notifTasks"
    );
  }
}

// ── Hand-in and pay ──────────────────────────────────────────────────────────

/** The members' contracts on a lead's crew. Empty for a solo contract. */
export async function crewContractsOf(leadContractId: string) {
  return prisma.contract.findMany({ where: { crewLeadContractId: leadContractId } });
}

/** The route from where a member's contract is to where the lead's has got. */
const PATH: ContractState[] = ["CLAIMED", "IN_PROGRESS", "SUBMITTED", "VERIFIED"];

async function walkTo(contractId: string, to: ContractState, actor: AuditActor, meta: Record<string, unknown>) {
  const c = await prisma.contract.findUnique({ where: { id: contractId }, select: { status: true } });
  if (!c) return;
  let at = PATH.indexOf(c.status as ContractState);
  // REWORK goes back through IN_PROGRESS, as it does for a solo contract.
  if (c.status === "REWORK") at = PATH.indexOf("CLAIMED");
  const target = PATH.indexOf(to);
  if (at < 0 || target < 0) return;
  for (let i = at + 1; i <= target; i++) {
    const r = await transitionContract(prisma, contractId, PATH[i], actor, meta);
    if (!r.ok) {
      console.error(`[crew] contract ${contractId} could not move to ${PATH[i]}: ${r.error}`);
      return;
    }
  }
}

/** The lead handed in: every member's contract is handed in with it. */
export async function submitCrew(leadContractId: string, actor: AuditActor, meta: Record<string, unknown>) {
  for (const c of await crewContractsOf(leadContractId)) {
    await walkTo(c.id, "SUBMITTED", actor, { ...meta, via: "crew-lead-submitted" });
  }
}

/**
 * The lead's hand-in was approved: pay each member their share.
 *
 * A Payment per member, each with its own withholding tax, made in one batch
 * so the crew is paid together or not at all; then each member's ring-fence is
 * released and their contract verified, the same two steps a solo approval
 * takes. Returns the payments made.
 */
export async function payCrew(leadContractId: string, taskId: string, actor: AuditActor, meta: Record<string, unknown>) {
  const members = await crewContractsOf(leadContractId);
  if (members.length === 0) return [];

  const whtRate = 0.05;
  const rows = members.map((c) => {
    const gross = c.share ?? 0;
    const { whtAmount, net } = computeWht(gross, whtRate);
    return { contract: c, data: { workerId: c.workerId, taskId, gross, whtRate, whtAmount, net, status: "APPROVED" } };
  });
  const payments = await prisma.$transaction(rows.map((r) => prisma.payment.create({ data: r.data })));

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].contract;
    await releaseForContract(c.id, payments[i].net, actor);
    await walkTo(c.id, "VERIFIED", actor, { ...meta, via: "crew-lead-approved", paymentId: payments[i].id });
  }
  return payments;
}
