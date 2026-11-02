-- Offline-tolerant clocking (Blueprint §16, services/clockTime.ts).
--
-- A Tasker with no signal can still clock in and out: the phone keeps the event
-- and sends it when it can. Three columns make that safe and visible.
--
-- clientId: the phone's own id for the event. A queued event can be sent twice
-- (the answer was lost on the way back), and the second send must find the
-- first rather than make a duplicate. Null for every event that exists today.
ALTER TABLE "ClockEvent" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "ClockEvent_workerId_clientId_key" ON "ClockEvent"("workerId", "clientId");

-- recordedOffline: the event reached us noticeably later than it happened, so
-- its time is the phone's. Shown to the manager on the timesheet.
ALTER TABLE "ClockEvent" ADD COLUMN "recordedOffline" BOOLEAN NOT NULL DEFAULT false;

-- receivedAt: when it actually arrived. createdAt stays "when it happened",
-- because that is what every reader of a clock event already means by it.
ALTER TABLE "ClockEvent" ADD COLUMN "receivedAt" DATETIME;
