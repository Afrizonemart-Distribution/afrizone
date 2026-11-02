-- Continue with AfriZone (app/AFRIZONE_ACCOUNT.md): a Part-Time user can be
-- linked to one AfriZone Account, by the identity token's `sub`.
ALTER TABLE "User" ADD COLUMN "afrizoneUserId" TEXT;
CREATE UNIQUE INDEX "User_afrizoneUserId_key" ON "User"("afrizoneUserId");

-- Accepted identity tokens by jti, kept until they expire, so none is replayed.
CREATE TABLE "AfrizoneTokenUse" (
    "jti" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AfrizoneTokenUse_expiresAt_idx" ON "AfrizoneTokenUse"("expiresAt");
