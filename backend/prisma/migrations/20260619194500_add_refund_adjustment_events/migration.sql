-- Phase 3.5E: append-only audit events for refund adjustment lifecycle visibility.
CREATE TYPE "SettlementRefundAdjustmentEventType" AS ENUM (
  'CREATED',
  'PARTIALLY_APPLIED',
  'APPLIED',
  'APPLICATION_CANCELLED',
  'ADJUSTMENT_CANCELLED'
);

CREATE TABLE "SettlementRefundAdjustmentEvent" (
  "id" TEXT NOT NULL,
  "settlementRefundAdjustmentId" TEXT NOT NULL,
  "eventType" "SettlementRefundAdjustmentEventType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadataJson" JSONB,

  CONSTRAINT "SettlementRefundAdjustmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SettlementRefundAdjustmentEvent_adjustment_createdAt_idx"
  ON "SettlementRefundAdjustmentEvent"("settlementRefundAdjustmentId", "createdAt");
CREATE INDEX "SettlementRefundAdjustmentEvent_eventType_createdAt_idx"
  ON "SettlementRefundAdjustmentEvent"("eventType", "createdAt");

ALTER TABLE "SettlementRefundAdjustmentEvent"
  ADD CONSTRAINT "SettlementRefundAdjustmentEvent_adjustment_fkey"
  FOREIGN KEY ("settlementRefundAdjustmentId") REFERENCES "SettlementRefundAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
