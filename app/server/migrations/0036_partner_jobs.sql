-- Partner hiring and job alerts. AfriZone posts jobs on behalf of partner
-- companies (Job.partnerName); a worker's Hiring profile goes to that partner
-- only after they agree to it when applying (NDPR consent), and HR records
-- when it was shared. Job alerts are queued one row per person per channel and
-- sent by the per-minute cron. Additive only.

ALTER TABLE "Job" ADD COLUMN "partnerName" TEXT;
ALTER TABLE "Job" ADD COLUMN "partnerAbout" TEXT;
ALTER TABLE "Job" ADD COLUMN "alertedAt" DATETIME;

ALTER TABLE "JobApplication" ADD COLUMN "shareConsentAt" DATETIME;
ALTER TABLE "JobApplication" ADD COLUMN "sharedAt" DATETIME;
ALTER TABLE "JobApplication" ADD COLUMN "sharedById" TEXT;

ALTER TABLE "User" ADD COLUMN "jobAlertEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "jobAlertSms" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "jobAlertWhatsapp" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "JobAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "JobAlert_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JobAlert_jobId_userId_channel_key" ON "JobAlert"("jobId", "userId", "channel");
CREATE INDEX "JobAlert_status_createdAt_idx" ON "JobAlert"("status", "createdAt");
