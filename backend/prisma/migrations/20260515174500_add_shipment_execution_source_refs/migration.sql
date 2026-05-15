-- AlterTable
ALTER TABLE "ShipmentExecution"
ADD COLUMN "sourceShopifyOrderId" TEXT,
ADD COLUMN "sourceShopifyOrderNumber" TEXT,
ADD COLUMN "sourceShopifyFulfillmentId" TEXT;

-- CreateIndex
CREATE INDEX "ShipmentExecution_sourceShopifyOrderId_idx" ON "ShipmentExecution"("sourceShopifyOrderId");
