-- Surge pay on deliveries (services/surge.ts).
--
-- How much an order pays right now is arithmetic on offeredAt and needs no
-- column. This is the surge LOCKED INTO the task budget when a courier claimed
-- it, kept apart so a re-open can take it back off and the next courier's
-- surge starts from the base. 0 for every existing row is correct - no order
-- has ever surged.
ALTER TABLE "Delivery" ADD COLUMN "surgeAmount" INTEGER NOT NULL DEFAULT 0;
