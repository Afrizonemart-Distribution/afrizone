import { Router, Response } from "express";
import { onPaymentReleased } from "../services/referrals";
import { prisma } from "../prisma";
import { requireAuth, requireRole, AuthedRequest } from "../auth";
import { writeAudit, userActor, auditData, type AuditActor } from "../util/audit";
import { notifyWorker, notifyWorkers } from "../services/push";

import { transitionContract, type ContractState } from "../services/contractState";
import { markPaidForContract } from "../services/commitments";
import { releaseBlock, secondApprovalLine } from "../services/proof";

const router = Router();

/**
 * Advance the contract binding this worker to this task, if there is one.
 *
 * Best-effort and deliberately silent on failure. These calls sit alongside an
 * action that already succeeded - a timesheet is approved, a payment released -
 * and refusing that action because a lifecycle row would not move would trade a
 * real outcome for a bookkeeping one. An illegal transition here means the
 * contract was already further along, which is not something the person in
 * front of us can act on. The transition itself is still audited; only the
 * failure is swallowed.
 */
async function advanceContract(
  taskId: string,
  workerId: string,
  to: ContractState,
  actor: AuditActor,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const contract = await prisma.contract.findFirst({
    where: { taskId, workerId },
    select: { id: true },
  });
  if (!contract) return;
  await transitionContract(prisma, contract.id, to, actor, meta);
}


// GET /api/payments?status= → joined with worker {id,name} and task {id,title}
// Admin-only: the worker's own view is GET /api/me/transactions and
// GET /api/me/payments/:id, both already scoped to req.user.id.
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "TASK_MANAGER"), async (req: AuthedRequest, res: Response) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const payments = await prisma.payment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { worker: true, task: true },
  });
  res.json(
    payments.map((p) => ({
      id: p.id,
      workerId: p.workerId,
      taskId: p.taskId,
      gross: p.gross,
      whtRate: p.whtRate,
      whtAmount: p.whtAmount,
      net: p.net,
      status: p.status,
      approvedById: p.approvedById,
      createdAt: p.createdAt,
      worker: { id: p.worker.id, name: p.worker.name },
      task: { id: p.task.id, title: p.task.title },
    }))
  );
});

// POST /api/payments/:id/release → sets RELEASED, writes AuditLog
router.post("/:id/release", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthedRequest, res: Response) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (payment.status === "RELEASED") return res.status(400).json({ error: "Payment already released" });
  if (payment.status !== "APPROVED") return res.status(409).json({ error: "Only an approved payment can be released" });

  const block = releaseBlock(payment, req.user!.id, await secondApprovalLine());
  if (block) return res.status(409).json({ error: block, code: "SECOND_APPROVER_REQUIRED" });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "RELEASED" },
  });
  await advanceContract(payment.taskId, payment.workerId, "PAID", userActor(req.user!.id), {
    via: "payment-released",
    paymentId: payment.id,
  });
  const paidContract = await prisma.contract.findFirst({
    where: { taskId: payment.taskId, workerId: payment.workerId },
    select: { id: true },
  });
  if (paidContract) {
    await markPaidForContract(paidContract.id, userActor(req.user!.id));
  }
  await writeAudit(userActor(req.user!.id), "PAYMENT_RELEASED", "Payment", payment.id, {
    net: payment.net,
    gross: payment.gross,
    workerId: payment.workerId,
  });

  // A Tasker's first released payment is what makes them a real referral.
  await onPaymentReleased(payment.workerId);

  await notifyWorker(
    prisma,
    payment.workerId,
    "Payment released 💰",
    `₦${payment.net.toLocaleString()} has been added to your wallet.`,
    { screen: "wallet" },
    "notifPay"
  );

  res.json(updated);
});

// POST /api/payments/release-all → releases all APPROVED → {released, totalNet}
router.post("/release-all", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthedRequest, res: Response) => {
  // Large payments this admin approved themselves are left for somebody else,
  // exactly as the one-at-a-time release refuses them.
  const line = await secondApprovalLine();
  const pending = await prisma.payment.findMany({ where: { status: "APPROVED" } });
  const approved = pending.filter((p) => !releaseBlock(p, req.user!.id, line));
  const heldBack = pending.length - approved.length;
  const totalNet = approved.reduce((sum, p) => sum + p.net, 0);

  // ARRAY FORM, NOT THE CALLBACK FORM. D1 does not support interactive
  // transactions - the callback version throws - so this endpoint could never
  // have released a batch in production.
  //
  // Every audit row is built up front and sent in the SAME batch as the status
  // update, so a release cannot land without its trail. auditData() rather than
  // writeAudit() for that reason: writeAudit writes on its own and would fall
  // outside the batch.
  await prisma.$transaction([
    prisma.payment.updateMany({
      where: { id: { in: approved.map((p) => p.id) }, status: "APPROVED" },
      data: { status: "RELEASED" },
    }),
    ...approved.map((p) =>
      prisma.auditLog.create({
        data: auditData(userActor(req.user!.id), "PAYMENT_RELEASED", "Payment", p.id, {
          net: p.net,
          gross: p.gross,
          workerId: p.workerId,
          batch: true,
        }),
      })
    ),
  ]);

  // Notify each worker whose payment was released
  // The same follow-through as a single release: the contract reaches PAID and
  // its ring-fence is marked paid. The batch used to skip both, leaving every
  // batch-paid job looking approved-but-unpaid.
  for (const p of approved) {
    await advanceContract(p.taskId, p.workerId, "PAID", userActor(req.user!.id), {
      via: "payment-released",
      paymentId: p.id,
      batch: true,
    });
    const c = await prisma.contract.findFirst({
      where: { taskId: p.taskId, workerId: p.workerId },
      select: { id: true },
    });
    if (c) await markPaidForContract(c.id, userActor(req.user!.id));
  }

  const workerIds = [...new Set(approved.map((p) => p.workerId))];
  for (const id of workerIds) await onPaymentReleased(id);
  await notifyWorkers(
    prisma,
    workerIds,
    "Payments released 💰",
    "Your earnings have been released to your wallet.",
    { screen: "wallet" },
    "notifPay"
  );

  res.json({ released: approved.length, totalNet, heldBack });
});

export default router;
