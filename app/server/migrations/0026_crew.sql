-- Crew contracts (Blueprint §14, services/crew.ts): a lead Tasker brings a
-- small crew to a larger fixed-price job and the pay is split between them.
--
-- Task.crewMax: how many people, lead included, may do this job together.
-- 0 for every existing task is correct - none has ever allowed a crew.
ALTER TABLE "Task" ADD COLUMN "crewMax" INTEGER NOT NULL DEFAULT 0;

-- Contract.share: what THIS contract pays, when it is one part of a crew job.
-- Null means the task budget, which is every contract that exists today.
ALTER TABLE "Contract" ADD COLUMN "share" INTEGER;
-- Contract.crewLeadContractId: on a member's contract, the lead's. The lead
-- hands in for everybody, so approving the lead's hand-in finds the rest here.
ALTER TABLE "Contract" ADD COLUMN "crewLeadContractId" TEXT;
CREATE INDEX "Contract_crewLeadContractId_idx" ON "Contract"("crewLeadContractId");

-- One row per person the lead named, with the share they were offered and
-- whether they agreed to it. The lead is not a row: their share is on the
-- application, and they agreed by applying.
CREATE TABLE "CrewInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "share" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "respondedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrewInvite_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrewInvite_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrewInvite_applicationId_workerId_key" ON "CrewInvite"("applicationId", "workerId");
CREATE INDEX "CrewInvite_workerId_status_idx" ON "CrewInvite"("workerId", "status");

-- The lead's own share, on their application. Null on a solo application.
ALTER TABLE "Application" ADD COLUMN "crewLeadShare" INTEGER;
