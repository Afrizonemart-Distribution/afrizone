-- Signatures at every handover (Blueprint §14, services/evidence.ts).
--
-- The photo shows what was there; the signature shows somebody on the other
-- side agreed it happened: the shop at pickup, the customer at the door, the
-- store manager on an audit, the site contact on field work. Drawn on the
-- Tasker's phone and stored as SVG path data - a few kilobytes, so it lives in
-- the row rather than in R2 - with the signer's typed name and the same where
-- and when as a photo.
--
-- One per Tasker per step of a job: signing again replaces it.
--
-- A drop-off signature carries a customer's name. It is customer data under
-- MART_INTEGRATION.md §5 and is deleted by the delivery purge with the door
-- photo.
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" REAL NOT NULL,
    "height" REAL NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "accuracyMetres" REAL,
    "capturedAt" DATETIME,
    "distanceMetres" REAL,
    "flags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Signature_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Signature_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Signature_taskId_workerId_stage_key" ON "Signature"("taskId", "workerId", "stage");
