-- Phase 3.5D: support partial refund adjustment application without creating vendor debt from overflow.
ALTER TYPE "SettlementRefundAdjustmentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_APPLIED';

CREATE TYPE "SettlementRefundAdjustmentApplicationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

ALTER TABLE "SettlementRefundAdjustment"
  ADD COLUMN "originalAmountMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "appliedAmountMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "remainingAmountMinor" INTEGER NOT NULL DEFAULT 0;

UPDATE "SettlementRefundAdjustment"
SET "originalAmountMinor" = "amountMinor",
    "appliedAmountMinor" = CASE WHEN "status" = 'APPLIED' THEN "amountMinor" ELSE 0 END,
    "remainingAmountMinor" = CASE WHEN "status" = 'APPLIED' THEN 0 ELSE "amountMinor" END
WHERE "originalAmountMinor" = 0
  AND "appliedAmountMinor" = 0
  AND "remainingAmountMinor" = 0;

ALTER TABLE "SettlementApprovalLine"
  ADD COLUMN "settlementRefundAdjustmentApplicationId" TEXT;

CREATE TABLE "SettlementRefundAdjustmentApplication" (
  "id" TEXT NOT NULL,
  "settlementRefundAdjustmentId" TEXT NOT NULL,
  "settlementApprovalId" TEXT NOT NULL,
  "settlementApprovalLineId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'TRY',
  "status" "SettlementRefundAdjustmentApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SettlementRefundAdjustmentApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementRefundAdjustmentApplication_settlementApprovalLineId_key"
  ON "SettlementRefundAdjustmentApplication"("settlementApprovalLineId");
CREATE INDEX "SettlementRefundAdjustmentApplication_adjustment_status_idx"
  ON "SettlementRefundAdjustmentApplication"("settlementRefundAdjustmentId", "status");
CREATE INDEX "SettlementRefundAdjustmentApplication_settlementApprovalId_idx"
  ON "SettlementRefundAdjustmentApplication"("settlementApprovalId");
CREATE INDEX "SettlementRefundAdjustmentApplication_createdAt_idx"
  ON "SettlementRefundAdjustmentApplication"("createdAt");
CREATE UNIQUE INDEX "SettlementApprovalLine_settlementRefundAdjustmentApplicationId_key"
  ON "SettlementApprovalLine"("settlementRefundAdjustmentApplicationId");

ALTER TABLE "SettlementRefundAdjustmentApplication"
  ADD CONSTRAINT "SettlementRefundAdjustmentApplication_adjustment_fkey"
  FOREIGN KEY ("settlementRefundAdjustmentId") REFERENCES "SettlementRefundAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustmentApplication"
  ADD CONSTRAINT "SettlementRefundAdjustmentApplication_approval_fkey"
  FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustmentApplication"
  ADD CONSTRAINT "SettlementRefundAdjustmentApplication_line_fkey"
  FOREIGN KEY ("settlementApprovalLineId") REFERENCES "SettlementApprovalLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementApprovalLine"
  ADD CONSTRAINT "SettlementApprovalLine_refundAdjustmentApplication_fkey"
  FOREIGN KEY ("settlementRefundAdjustmentApplicationId") REFERENCES "SettlementRefundAdjustmentApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
