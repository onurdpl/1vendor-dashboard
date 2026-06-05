CREATE TYPE "PaymentProvider" AS ENUM ('PARATIKA');

CREATE TABLE "VendorPaymentProviderSeller" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "externalSellerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPaymentProviderSeller_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorPaymentProviderSeller_provider_vendorId_key"
ON "VendorPaymentProviderSeller"("provider", "vendorId");

CREATE UNIQUE INDEX "VendorPaymentProviderSeller_provider_externalSellerId_key"
ON "VendorPaymentProviderSeller"("provider", "externalSellerId");

CREATE INDEX "VendorPaymentProviderSeller_vendorId_provider_enabled_idx"
ON "VendorPaymentProviderSeller"("vendorId", "provider", "enabled");

ALTER TABLE "VendorPaymentProviderSeller"
ADD CONSTRAINT "VendorPaymentProviderSeller_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
