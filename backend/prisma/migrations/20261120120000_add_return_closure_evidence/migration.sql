-- Current canonical closure evidence only; no historical timestamp backfill.
CREATE SEQUENCE "ReturnClosureObservationVersion" AS BIGINT;
ALTER TABLE "ReturnRecord"
  ADD COLUMN "shopifyClosedAt" TIMESTAMP(3),
  ADD COLUMN "shopifyClosureStatus" TEXT,
  ADD COLUMN "shopifyClosureVersion" BIGINT,
  ADD COLUMN "shopifyClosureApiVersion" TEXT;
