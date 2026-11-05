-- One person, one account (services/identityGuard.ts). Additive only.

-- A fact about an account that should belong to one person only: a payout
-- bank account, a government ID number, a phone/device. Stored as a keyed
-- hash, never the value.
CREATE TABLE "IdentitySignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    -- BANK | ID_NUMBER | DEVICE
    "kind" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdentitySignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IdentitySignal_kind_valueHash_userId_key" ON "IdentitySignal"("kind", "valueHash", "userId");
CREATE INDEX "IdentitySignal_userId_idx" ON "IdentitySignal"("userId");

-- Two or more accounts sharing one signal: a case for a person to decide.
CREATE TABLE "IdentityFlag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    -- JSON array of user ids, sorted.
    "userIds" TEXT NOT NULL,
    -- HIGH pauses payouts for every account on it; LOW is shown, not enforced.
    "severity" TEXT NOT NULL,
    -- OPEN | CLEARED | CONFIRMED
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "IdentityFlag_kind_valueHash_key" ON "IdentityFlag"("kind", "valueHash");
CREATE INDEX "IdentityFlag_status_idx" ON "IdentityFlag"("status");
