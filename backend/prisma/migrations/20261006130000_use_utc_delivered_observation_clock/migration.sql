-- Prisma maps DateTime to timestamp without time zone. Store an explicit UTC
-- wall clock so the first observation does not depend on the DB session zone.
ALTER TABLE "AllocationDeliveredObservation"
  ALTER COLUMN "firstObservedDeliveredAt" SET DEFAULT timezone('UTC', clock_timestamp());
