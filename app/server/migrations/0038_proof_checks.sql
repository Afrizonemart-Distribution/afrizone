-- Checks on proof-of-work photos (services/proofCheck.ts). Both only FLAG a
-- photo for the reviewer; neither refuses one. Additive only.

-- SHA-256 of the bytes, so the same file sent again is noticed.
ALTER TABLE "Evidence" ADD COLUMN "sha256" TEXT;
-- The AI look at finished-work and audit photos: OK | DOUBT | FAILED | SKIPPED.
ALTER TABLE "Evidence" ADD COLUMN "aiVerdict" TEXT;
ALTER TABLE "Evidence" ADD COLUMN "aiCheckedAt" DATETIME;

CREATE INDEX "Evidence_sha256_idx" ON "Evidence"("sha256");
CREATE INDEX "Evidence_aiCheckedAt_createdAt_idx" ON "Evidence"("aiCheckedAt", "createdAt");
