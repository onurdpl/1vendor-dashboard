ALTER TABLE "VendorAllocation"
ADD COLUMN "odooSaleOrderId" TEXT,
ADD COLUMN "odooSaleOrderName" TEXT,
ADD COLUMN "odooSaleOrderSyncedAt" TIMESTAMP(3);

CREATE INDEX "VendorAllocation_odooSaleOrderId_idx" ON "VendorAllocation"("odooSaleOrderId");
