-- Proof-to-pay: what a task must show before it is paid, pay per unit, and
-- a recorded review. Additive only.

-- JSON array of strings: what the reviewer confirms before approving. '[]' = none.
ALTER TABLE "Task" ADD COLUMN "acceptanceCriteria" TEXT NOT NULL DEFAULT '[]';
-- Photos of the finished work required at hand-in, on top of what the task's
-- kind already asks for. 0 = only the kind's own rule.
ALTER TABLE "Task" ADD COLUMN "proofPhotos" INTEGER NOT NULL DEFAULT 0;
-- PER_UNIT tasks: what one unit is ("photo", "survey") and the most one person may hand in.
ALTER TABLE "Task" ADD COLUMN "unitLabel" TEXT;
ALTER TABLE "Task" ADD COLUMN "maxUnits" INTEGER;

-- What was handed in, and what the reviewer decided.
ALTER TABLE "Timesheet" ADD COLUMN "units" INTEGER;
ALTER TABLE "Timesheet" ADD COLUMN "note" TEXT;
ALTER TABLE "Timesheet" ADD COLUMN "acceptedUnits" INTEGER;
ALTER TABLE "Timesheet" ADD COLUMN "reviewNote" TEXT;
-- JSON array of the acceptance criteria, as worded, that the reviewer confirmed.
ALTER TABLE "Timesheet" ADD COLUMN "checks" TEXT;
ALTER TABLE "Timesheet" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Timesheet" ADD COLUMN "reviewedAt" DATETIME;

-- Who approved the work this payment is for. A large payment must be
-- released by somebody else.
ALTER TABLE "Payment" ADD COLUMN "approvedById" TEXT;
CREATE INDEX "Payment_taskId_workerId_idx" ON "Payment"("taskId", "workerId");
