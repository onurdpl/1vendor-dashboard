ALTER TABLE "VendorBillingProfile"
  ADD COLUMN "billingCity" TEXT,
  ADD COLUMN "billingDistrict" TEXT,
  ADD COLUMN "legalEntityType" TEXT,
  ADD COLUMN "logoIsbasiCustomerCode" TEXT,
  ADD COLUMN "logoIsbasiCustomerId" TEXT,
  ADD COLUMN "logoIsbasiEinvoiceEligible" BOOLEAN,
  ADD COLUMN "logoIsbasiLastCheckedAt" TIMESTAMP(3);
