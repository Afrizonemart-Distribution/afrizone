-- Flexible task builder: application questions, answers, and task templates.
-- Additive only.

-- JSON array of TaskQuestion (services/taskQuestions.ts). '[]' = no questions,
-- which is every task that existed before this column.
ALTER TABLE "Task" ADD COLUMN "questions" TEXT NOT NULL DEFAULT '[]';

-- JSON array of {id, label, type, answer}: the question's wording is copied in,
-- so editing a task's questions later never changes what an applicant answered.
ALTER TABLE "Application" ADD COLUMN "answers" TEXT;

CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    -- JSON: the task form's fields (routes/taskTemplates.ts TEMPLATE_KEYS).
    "payload" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TaskTemplate_archived_idx" ON "TaskTemplate"("archived");
