-- Talent Profile: the worker's shareable hiring profile (CV, work history,
-- education, portfolio). Additive only; nothing existing changes meaning.

ALTER TABLE "User" ADD COLUMN "headline" TEXT;
ALTER TABLE "User" ADD COLUMN "bio" TEXT;
-- Comma-separated OpenTo[]: TASKS,HOURLY,CONTRACT,FULL_TIME. Empty = not said.
ALTER TABLE "User" ADD COLUMN "openTo" TEXT NOT NULL DEFAULT '';
-- The worker's current CV: a KycDocument of docType CV that they own.
ALTER TABLE "User" ADD COLUMN "cvDocumentId" TEXT;
-- PRIVATE: only the worker and Afrizone staff. LINK: anyone with the link.
ALTER TABLE "User" ADD COLUMN "profileVisibility" TEXT NOT NULL DEFAULT 'PRIVATE';
-- Set the first time a profile is shared; never reused for another person.
ALTER TABLE "User" ADD COLUMN "profileSlug" TEXT;
CREATE UNIQUE INDEX "User_profileSlug_key" ON "User"("profileSlug");

CREATE TABLE "WorkExperience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkExperience_userId_idx" ON "WorkExperience"("userId");

CREATE TABLE "Education" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "field" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Education_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Education_userId_idx" ON "Education"("userId");

CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "documentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortfolioItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KycDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PortfolioItem_userId_idx" ON "PortfolioItem"("userId");
