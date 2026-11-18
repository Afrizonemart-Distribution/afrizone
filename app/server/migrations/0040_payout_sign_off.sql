-- Two people for a payout: one admin signs a withdrawal off, a different
-- Super Admin pays it (routes/adminWithdrawals.ts). Additive only.
ALTER TABLE "Withdrawal" ADD COLUMN "signedOffById" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN "signedOffAt" DATETIME;
