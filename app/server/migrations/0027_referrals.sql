-- The referral loop (Blueprint §14, services/referrals.ts): a Tasker or store
-- member earns for bringing in a new Tasker or store that turns out real.
--
-- User.referralCode: the short code a person hands out. Made the first time
-- they open their referral screen, so most rows stay null.
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- One row per person or store referred, and at most one: whoever claimed them
-- first. PENDING until they prove real (first payment released / store
-- approved), then EARNED with the reward and its withholding tax recorded, so
-- the wallet reads a fixed figure rather than today's setting. VOID if an
-- admin cancels it.
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT,
    "referredOrganizationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gross" INTEGER NOT NULL DEFAULT 0,
    "whtAmount" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL DEFAULT 0,
    "earnedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Referral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Referral_referredOrganizationId_fkey" FOREIGN KEY ("referredOrganizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Referral_referredUserId_key" ON "Referral"("referredUserId");
CREATE UNIQUE INDEX "Referral_referredOrganizationId_key" ON "Referral"("referredOrganizationId");
CREATE INDEX "Referral_referrerId_status_idx" ON "Referral"("referrerId", "status");
