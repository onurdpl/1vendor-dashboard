-- CreateEnum
CREATE TYPE "SettlementRefundAdjustmentStatus" AS ENUM ('PENDING', 'APPLIED', 'BLOCKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SettlementRefundAdjustment" (
    "id" TEXT NOT NULL,
    "refundRecordId" TEXT NOT NULL,
    "refundFinanceLedgerEntryId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "originalOrderId" TEXT NOT NULL,
    "originalSettlementApprovalId" TEXT,
    "originalSettlementApprovalLineId" TEXT,
    "originalSettlementCommissionInvoiceId" TEXT,
    "status" "SettlementRefundAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'TRY',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedSettlementApprovalId" TEXT,
    "appliedSettlementApprovalLineId" TEXT,
    "blockedReason" TEXT,
    "createdBy" TEXT,

    CONSTRAINT "SettlementRefundAdjustment_pkey" PRIMARY KEY ("id")
);

-- Duplicate protection: one refund ledger row can create at most one settlement refund adjustment.
CREATE UNIQUE INDEX "SettlementRefundAdjustment_refundFinanceLedgerEntryId_key" ON "SettlementRefundAdjustment"("refundFinanceLedgerEntryId");

CREATE INDEX "SettlementRefundAdjustment_vendorId_status_idx" ON "SettlementRefundAdjustment"("vendorId", "status");
CREATE INDEX "SettlementRefundAdjustment_refundRecordId_idx" ON "SettlementRefundAdjustment"("refundRecordId");
CREATE INDEX "SettlementRefundAdjustment_originalOrderId_idx" ON "SettlementRefundAdjustment"("originalOrderId");
CREATE INDEX "SettlementRefundAdjustment_originalSettlementApprovalId_idx" ON "SettlementRefundAdjustment"("originalSettlementApprovalId");
CREATE INDEX "SettlementRefundAdjustment_originalSettlementCommissionInvoiceId_idx" ON "SettlementRefundAdjustment"("originalSettlementCommissionInvoiceId");
CREATE INDEX "SettlementRefundAdjustment_appliedSettlementApprovalId_idx" ON "SettlementRefundAdjustment"("appliedSettlementApprovalId");
CREATE INDEX "SettlementRefundAdjustment_createdAt_idx" ON "SettlementRefundAdjustment"("createdAt");

ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_refundFinanceLedgerEntryId_fkey" FOREIGN KEY ("refundFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalOrderId_fkey" FOREIGN KEY ("originalOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementApprovalId_fkey" FOREIGN KEY ("originalSettlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementApprovalLineId_fkey" FOREIGN KEY ("originalSettlementApprovalLineId") REFERENCES "SettlementApprovalLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_originalSettlementCommissionInvoiceId_fkey" FOREIGN KEY ("originalSettlementCommissionInvoiceId") REFERENCES "SettlementCommissionInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_appliedSettlementApprovalId_fkey" FOREIGN KEY ("appliedSettlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SettlementRefundAdjustment" ADD CONSTRAINT "SettlementRefundAdjustment_appliedSettlementApprovalLineId_fkey" FOREIGN KEY ("appliedSettlementApprovalLineId") REFERENCES "SettlementApprovalLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
