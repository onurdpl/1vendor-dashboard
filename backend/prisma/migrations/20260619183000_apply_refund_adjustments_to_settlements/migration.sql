-- Phase 3.5C: allow PENDING refund adjustments to be applied as explicit settlement approval lines.
ALTER TYPE "SettlementApprovalLineType" ADD VALUE IF NOT EXISTS 'REFUND_ADJUSTMENT';

ALTER TABLE "SettlementApprovalLine"
  ADD COLUMN "settlementRefundAdjustmentId" TEXT;

CREATE UNIQUE INDEX "SettlementApprovalLine_settlementRefundAdjustmentId_key"
  ON "SettlementApprovalLine"("settlementRefundAdjustmentId");
