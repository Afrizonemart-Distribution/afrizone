-- Opportunities: job applications made from the worker's own account and
-- Hiring profile, instead of a typed name and email. Additive only; rows
-- staff entered by hand keep a null userId.

ALTER TABLE "JobApplication" ADD COLUMN "userId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL;
ALTER TABLE "JobApplication" ADD COLUMN "coverNote" TEXT;
-- One application per person per job. NULLs (hand-entered rows) don't collide.
CREATE UNIQUE INDEX "JobApplication_jobId_userId_key" ON "JobApplication"("jobId", "userId");
CREATE INDEX "JobApplication_userId_idx" ON "JobApplication"("userId");
