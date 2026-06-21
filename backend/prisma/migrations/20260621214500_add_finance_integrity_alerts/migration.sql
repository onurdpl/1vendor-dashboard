-- Phase R1: Finance integrity alert foundation.
-- Diagnostic-only durable alert table for future economic transfer recovery.
-- Existing production rows are not backfilled or modified.

CREATE TABLE "FinanceIntegrityAlert" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "vendorAllocationId" TEXT,
    "allocationEconomicTransferId" TEXT,
    "affectedLedgerIds" JSONB,
    "affectedFinanceEventIds" JSONB,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resolutionNote" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceIntegrityAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceIntegrityAlert_dedupeKey_key" ON "FinanceIntegrityAlert"("dedupeKey");
CREATE INDEX "FinanceIntegrityAlert_status_idx" ON "FinanceIntegrityAlert"("status");
CREATE INDEX "FinanceIntegrityAlert_category_idx" ON "FinanceIntegrityAlert"("category");
CREATE INDEX "FinanceIntegrityAlert_severity_idx" ON "FinanceIntegrityAlert"("severity");
CREATE INDEX "FinanceIntegrityAlert_detectedAt_idx" ON "FinanceIntegrityAlert"("detectedAt");
CREATE INDEX "FinanceIntegrityAlert_vendorAllocationId_idx" ON "FinanceIntegrityAlert"("vendorAllocationId");
CREATE INDEX "FinanceIntegrityAlert_allocationEconomicTransferId_idx" ON "FinanceIntegrityAlert"("allocationEconomicTransferId");

ALTER TABLE "FinanceIntegrityAlert"
ADD CONSTRAINT "FinanceIntegrityAlert_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceIntegrityAlert"
ADD CONSTRAINT "FinanceIntegrityAlert_allocationEconomicTransferId_fkey"
FOREIGN KEY ("allocationEconomicTransferId") REFERENCES "AllocationEconomicTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceIntegrityAlert"
ADD CONSTRAINT "FinanceIntegrityAlert_resolvedByUserId_fkey"
FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
