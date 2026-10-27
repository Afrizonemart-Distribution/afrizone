-- A ranked courier can pass instead of letting their window run out
-- (services/ranking.ts passTurn).
--
-- Whose turn it is stays arithmetic on offeredAt. A pass is the unused rest of
-- a window, so it is stored as seconds and added to the clock the turns are
-- read from: one pass jumps straight to the start of the next window. 0 for
-- every existing row is correct - nobody has passed.
ALTER TABLE "Delivery" ADD COLUMN "rankedSkippedSeconds" INTEGER NOT NULL DEFAULT 0;
