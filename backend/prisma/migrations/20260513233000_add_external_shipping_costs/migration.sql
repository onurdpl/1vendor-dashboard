-- CreateEnum
CREATE TYPE "ShippingCostSourceType" AS ENUM ('MANUAL', 'IMPORTED', 'EXTERNAL_PROVIDER');

-- CreateEnum
CREATE TYPE "ShippingCostStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISPUTED', 'IGNORED');

-- AlterTable
ALTER TABLE "FinanceLedgerEntry"
ADD COLUMN "shippingCostSnapshot" DECIMAL(10,2),
ADD COLUMN "shippingVatAmountSnapshot" DECIMAL(10,2),
ADD COLUMN "shippingCostSourceSnapshot" TEXT,
ADD COLUMN "shippingCostProviderSnapshot" TEXT,
ADD COLUMN "shippingCostIdSnapshot" TEXT;

-- CreateTable
CREATE TABLE "ShipmentShippingCost" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyFulfillmentId" TEXT,
    "providerName" TEXT NOT NULL,
    "providerReference" TEXT,
    "shippingCost" DECIMAL(10,2) NOT NULL,
    "shippingVatAmount" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "status" "ShippingCostStatus" NOT NULL DEFAULT 'PENDING',
    "sourceType" "ShippingCostSourceType" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentShippingCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentShippingCost_vendorId_status_idx" ON "ShipmentShippingCost"("vendorId", "status");

-- CreateIndex
CREATE INDEX "ShipmentShippingCost_allocationId_status_idx" ON "ShipmentShippingCost"("allocationId", "status");

-- CreateIndex
CREATE INDEX "ShipmentShippingCost_sourceShopifyOrderId_idx" ON "ShipmentShippingCost"("sourceShopifyOrderId");

-- AddForeignKey
ALTER TABLE "ShipmentShippingCost" ADD CONSTRAINT "ShipmentShippingCost_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentShippingCost" ADD CONSTRAINT "ShipmentShippingCost_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
