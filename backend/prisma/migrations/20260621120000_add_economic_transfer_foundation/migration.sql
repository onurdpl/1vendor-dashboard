-- Phase 3A: Model B economic transfer data model foundation.
-- Prerequisite: this migration only adds nullable audit/voiding columns and a new transfer table.
-- Existing VendorAllocation and FinanceLedgerEntry rows are not backfilled or modified.

ALTER TABLE "FinanceLedgerEntry"
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidReason" TEXT,
ADD COLUMN "supersededByLedgerId" TEXT;

CREATE TABLE "AllocationEconomicTransfer" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "fromVendorId" TEXT NOT NULL,
    "toVendorId" TEXT NOT NULL,
    "fromFinanceLedgerEntryId" TEXT,
    "toFinanceLedgerEntryId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "adminActorUserId" TEXT,
    "pricingSnapshotJson" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "AllocationEconomicTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AllocationEconomicTransfer_idempotencyKey_key" ON "AllocationEconomicTransfer"("idempotencyKey");
CREATE INDEX "AllocationEconomicTransfer_vendorAllocationId_idx" ON "AllocationEconomicTransfer"("vendorAllocationId");
CREATE INDEX "AllocationEconomicTransfer_fromVendorId_idx" ON "AllocationEconomicTransfer"("fromVendorId");
CREATE INDEX "AllocationEconomicTransfer_toVendorId_idx" ON "AllocationEconomicTransfer"("toVendorId");
CREATE INDEX "AllocationEconomicTransfer_status_idx" ON "AllocationEconomicTransfer"("status");
CREATE INDEX "AllocationEconomicTransfer_createdAt_idx" ON "AllocationEconomicTransfer"("createdAt");
CREATE INDEX "FinanceLedgerEntry_supersededByLedgerId_idx" ON "FinanceLedgerEntry"("supersededByLedgerId");

ALTER TABLE "FinanceLedgerEntry"
ADD CONSTRAINT "FinanceLedgerEntry_supersededByLedgerId_fkey"
FOREIGN KEY ("supersededByLedgerId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AllocationEconomicTransfer"
ADD CONSTRAINT "AllocationEconomicTransfer_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AllocationEconomicTransfer"
ADD CONSTRAINT "AllocationEconomicTransfer_fromVendorId_fkey"
FOREIGN KEY ("fromVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AllocationEconomicTransfer"
ADD CONSTRAINT "AllocationEconomicTransfer_toVendorId_fkey"
FOREIGN KEY ("toVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AllocationEconomicTransfer"
ADD CONSTRAINT "AllocationEconomicTransfer_fromFinanceLedgerEntryId_fkey"
FOREIGN KEY ("fromFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AllocationEconomicTransfer"
ADD CONSTRAINT "AllocationEconomicTransfer_toFinanceLedgerEntryId_fkey"
FOREIGN KEY ("toFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AllocationEconomicTransfer"
ADD CONSTRAINT "AllocationEconomicTransfer_adminActorUserId_fkey"
FOREIGN KEY ("adminActorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
