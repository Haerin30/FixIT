-- Additive only. Existing repairs and schedule/payment history are preserved.
ALTER TABLE "RepairRequest"
ADD COLUMN "customerCanProposeSchedule" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priceVersion" INTEGER NOT NULL DEFAULT 0;
