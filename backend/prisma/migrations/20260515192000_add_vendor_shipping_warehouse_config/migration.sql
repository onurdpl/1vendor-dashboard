-- AlterEnum
ALTER TYPE "ShippingProvider" ADD VALUE IF NOT EXISTS 'KARGO_ENTEGRATOR';

-- AlterTable
ALTER TABLE "VendorShippingConfig"
ADD COLUMN "cargoIntegrationId" TEXT,
ADD COLUMN "defaultWarehouseId" TEXT,
ADD COLUMN "shippingVatPercent" DECIMAL(5,2) NOT NULL DEFAULT 18.00;

-- AlterTable
ALTER TABLE "ShipmentExecution"
ADD COLUMN "cargoIntegrationId" TEXT,
ADD COLUMN "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "VendorShippingWarehouse" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorShippingWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorShippingWarehouse_vendorId_provider_warehouseId_key" ON "VendorShippingWarehouse"("vendorId", "provider", "warehouseId");

-- CreateIndex
CREATE INDEX "VendorShippingWarehouse_configId_isDefault_idx" ON "VendorShippingWarehouse"("configId", "isDefault");

-- CreateIndex
CREATE INDEX "VendorShippingWarehouse_vendorId_provider_isDefault_idx" ON "VendorShippingWarehouse"("vendorId", "provider", "isDefault");

-- AddForeignKey
ALTER TABLE "VendorShippingWarehouse" ADD CONSTRAINT "VendorShippingWarehouse_configId_fkey" FOREIGN KEY ("configId") REFERENCES "VendorShippingConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorShippingWarehouse" ADD CONSTRAINT "VendorShippingWarehouse_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
