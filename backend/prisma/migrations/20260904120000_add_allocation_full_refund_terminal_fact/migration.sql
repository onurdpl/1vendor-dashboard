CREATE TABLE "AllocationFullRefundTerminalFact" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "shopifyOrderGid" TEXT NOT NULL,
    "verificationSource" TEXT NOT NULL,
    "shopifyApiVersion" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceJson" JSONB NOT NULL,

    CONSTRAINT "AllocationFullRefundTerminalFact_pkey"
      PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX
  "AllocationFullRefundTerminalFact_vendorAllocationId_key"
  ON "AllocationFullRefundTerminalFact"("vendorAllocationId");

CREATE INDEX
  "AllocationFullRefundTerminalFact_shopifyOrderGid_idx"
  ON "AllocationFullRefundTerminalFact"("shopifyOrderGid");

ALTER TABLE "AllocationFullRefundTerminalFact"
ADD CONSTRAINT "AllocationFullRefundTerminalFact_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId")
REFERENCES "VendorAllocation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
