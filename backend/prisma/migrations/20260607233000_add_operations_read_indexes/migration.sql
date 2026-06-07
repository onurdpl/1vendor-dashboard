-- Add indexes used by operations queue read paths.
CREATE INDEX "VendorAllocation_createdAt_idx" ON "VendorAllocation"("createdAt");

CREATE INDEX "ReturnRecord_vendorAllocationId_createdAt_idx" ON "ReturnRecord"("vendorAllocationId", "createdAt");

CREATE INDEX "RefundRecord_vendorAllocationId_createdAt_idx" ON "RefundRecord"("vendorAllocationId", "createdAt");
