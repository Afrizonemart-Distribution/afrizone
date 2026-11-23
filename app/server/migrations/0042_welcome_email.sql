-- When a Partimer was sent the welcome email, so it goes once (services/partimerEmail.ts).
ALTER TABLE "User" ADD COLUMN "welcomeEmailedAt" DATETIME;
