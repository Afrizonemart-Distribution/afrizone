-- Talent pools: named groups of workers HR keeps (e.g. "Verified Lagos
-- drivers") and can send a job alert to in one press. Additive only.

CREATE TABLE "TalentPool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "TalentPool_name_key" ON "TalentPool"("name");

CREATE TABLE "TalentPoolMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TalentPoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "TalentPool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TalentPoolMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TalentPoolMember_poolId_userId_key" ON "TalentPoolMember"("poolId", "userId");
CREATE INDEX "TalentPoolMember_userId_idx" ON "TalentPoolMember"("userId");
