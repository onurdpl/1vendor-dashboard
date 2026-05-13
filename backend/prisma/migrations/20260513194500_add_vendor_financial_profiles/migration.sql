-- CreateEnum
CREATE TYPE "ShippingDeductionMode" AS ENUM ('DISABLED', 'FIXED', 'EXTERNAL_PROVIDER');

-- CreateTable
CREATE TABLE "VendorFinancialProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "commissionVatPercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "deductShippingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shippingMode" "ShippingDeductionMode" NOT NULL DEFAULT 'DISABLED',
    "fixedShippingFee" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorFinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorFinancialProfile_vendorId_key" ON "VendorFinancialProfile"("vendorId");

-- CreateIndex
CREATE INDEX "VendorFinancialProfile_vendorId_active_idx" ON "VendorFinancialProfile"("vendorId", "active");

-- AddForeignKey
ALTER TABLE "VendorFinancialProfile" ADD CONSTRAINT "VendorFinancialProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
