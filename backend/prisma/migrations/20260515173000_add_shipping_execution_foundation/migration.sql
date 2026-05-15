-- CreateEnum
CREATE TYPE "ShippingProvider" AS ENUM ('HEPSIJET', 'MNG', 'YURTICI', 'ARAS');

-- CreateEnum
CREATE TYPE "ShipmentExecutionStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "VendorShippingConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "preferredProvider" "ShippingProvider" NOT NULL DEFAULT 'HEPSIJET',
    "shippingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultDesi" DECIMAL(10,2) NOT NULL DEFAULT 3.00,
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorShippingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentExecution" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "providerShipmentId" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "labelUrl" TEXT,
    "shipmentStatus" "ShipmentExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "desi" DECIMAL(10,2) NOT NULL DEFAULT 3.00,
    "shippingCost" DECIMAL(10,2),
    "shippingVat" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "requestSnapshot" JSONB NOT NULL,
    "responseSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorShippingConfig_vendorId_key" ON "VendorShippingConfig"("vendorId");

-- CreateIndex
CREATE INDEX "VendorShippingConfig_vendorId_shippingEnabled_idx" ON "VendorShippingConfig"("vendorId", "shippingEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentExecution_allocationId_provider_key" ON "ShipmentExecution"("allocationId", "provider");

-- CreateIndex
CREATE INDEX "ShipmentExecution_vendorId_shipmentStatus_idx" ON "ShipmentExecution"("vendorId", "shipmentStatus");

-- CreateIndex
CREATE INDEX "ShipmentExecution_provider_shipmentStatus_idx" ON "ShipmentExecution"("provider", "shipmentStatus");

-- CreateIndex
CREATE INDEX "ShipmentExecution_createdAt_idx" ON "ShipmentExecution"("createdAt");

-- AddForeignKey
ALTER TABLE "VendorShippingConfig" ADD CONSTRAINT "VendorShippingConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentExecution" ADD CONSTRAINT "ShipmentExecution_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentExecution" ADD CONSTRAINT "ShipmentExecution_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
