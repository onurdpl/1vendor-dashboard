-- Allocation split lineage foundation.
-- Schema/audit only; no allocation split writes, finance movement, or Shopify behavior is added.

CREATE TABLE "AllocationSplitEvent" (
    "id" TEXT NOT NULL,
    "sourceAllocationId" TEXT NOT NULL,
    "childAllocationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedVendorAllocationLineItemIdsJson" JSONB,
    "movedShopifyLineItemIdsJson" JSONB,
    "sourceFinanceLedgerEntryId" TEXT,
    "remainingFinanceLedgerEntryId" TEXT,
    "childFinanceLedgerEntryId" TEXT,
    "metadataJson" JSONB,

    CONSTRAINT "AllocationSplitEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AllocationSplitEvent_sourceAllocationId_idx" ON "AllocationSplitEvent"("sourceAllocationId");
CREATE INDEX "AllocationSplitEvent_childAllocationId_idx" ON "AllocationSplitEvent"("childAllocationId");
CREATE INDEX "AllocationSplitEvent_actorUserId_idx" ON "AllocationSplitEvent"("actorUserId");
CREATE INDEX "AllocationSplitEvent_createdAt_idx" ON "AllocationSplitEvent"("createdAt");

ALTER TABLE "AllocationSplitEvent"
ADD CONSTRAINT "AllocationSplitEvent_sourceAllocationId_fkey"
FOREIGN KEY ("sourceAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AllocationSplitEvent"
ADD CONSTRAINT "AllocationSplitEvent_childAllocationId_fkey"
FOREIGN KEY ("childAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AllocationSplitEvent"
ADD CONSTRAINT "AllocationSplitEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AllocationSplitEvent"
ADD CONSTRAINT "AllocationSplitEvent_sourceFinanceLedgerEntryId_fkey"
FOREIGN KEY ("sourceFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AllocationSplitEvent"
ADD CONSTRAINT "AllocationSplitEvent_remainingFinanceLedgerEntryId_fkey"
FOREIGN KEY ("remainingFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AllocationSplitEvent"
ADD CONSTRAINT "AllocationSplitEvent_childFinanceLedgerEntryId_fkey"
FOREIGN KEY ("childFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
