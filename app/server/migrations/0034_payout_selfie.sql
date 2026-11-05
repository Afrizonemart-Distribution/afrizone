-- A fresh selfie before a large withdrawal, checked by a person before the
-- money leaves (routes/adminWithdrawals.ts). Additive only.

-- The PAYOUT_SELFIE document taken for this withdrawal. Each one is used once.
ALTER TABLE "Withdrawal" ADD COLUMN "selfieDocumentId" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN "reviewedAt" DATETIME;
CREATE UNIQUE INDEX "Withdrawal_selfieDocumentId_key" ON "Withdrawal"("selfieDocumentId");
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");
