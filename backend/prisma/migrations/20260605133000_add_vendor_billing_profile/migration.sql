CREATE TABLE "VendorBillingProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "legalCompanyName" TEXT,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "billingAddress" TEXT,
    "iban" TEXT,
    "authorizedPerson" TEXT,
    "billingEmail" TEXT,
    "billingPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBillingProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorBillingProfile_vendorId_key" ON "VendorBillingProfile"("vendorId");
CREATE INDEX "VendorBillingProfile_vendorId_idx" ON "VendorBillingProfile"("vendorId");

ALTER TABLE "VendorBillingProfile"
ADD CONSTRAINT "VendorBillingProfile_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
