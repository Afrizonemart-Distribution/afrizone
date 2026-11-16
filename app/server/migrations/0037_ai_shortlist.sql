-- AI shortlisting (services/ai.ts rankApplicants): a suggested score and the
-- reasons for it, per application. A suggestion for HR to read; nothing is
-- decided by it. Additive only.

ALTER TABLE "JobApplication" ADD COLUMN "aiScore" INTEGER;
-- JSON: { summary, strengths[], gaps[] }
ALTER TABLE "JobApplication" ADD COLUMN "aiNotes" TEXT;
ALTER TABLE "JobApplication" ADD COLUMN "aiScoredAt" DATETIME;
