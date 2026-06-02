ALTER TABLE "VendorAllocation"
ADD COLUMN "vendorInvoiceNumber" TEXT,
ADD COLUMN "vendorInvoiceDate" TIMESTAMP(3),
ADD COLUMN "vendorInvoiceUrl" TEXT,
ADD COLUMN "vendorInvoiceAmount" DECIMAL(10,2),
ADD COLUMN "vendorInvoiceReceivedAt" TIMESTAMP(3),
ADD COLUMN "lastVendorIntegrationInvoiceRequestId" TEXT;

CREATE TABLE "VendorIntegrationInvoiceEvent" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "vendorAllocationId" TEXT NOT NULL,
  "vendorIdentifier" TEXT NOT NULL,
  "providerName" TEXT,
  "invoiceNumber" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "invoiceUrl" TEXT,
  "invoiceAmount" DECIMAL(10,2) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VendorIntegrationInvoiceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorIntegrationInvoiceEvent_clientId_vendorAllocationId_idempotencyKey_key"
ON "VendorIntegrationInvoiceEvent"("clientId", "vendorAllocationId", "idempotencyKey");

CREATE INDEX "VendorIntegrationInvoiceEvent_vendorAllocationId_createdAt_idx"
ON "VendorIntegrationInvoiceEvent"("vendorAllocationId", "createdAt");

CREATE INDEX "VendorIntegrationInvoiceEvent_vendorIdentifier_createdAt_idx"
ON "VendorIntegrationInvoiceEvent"("vendorIdentifier", "createdAt");

ALTER TABLE "VendorIntegrationInvoiceEvent"
ADD CONSTRAINT "VendorIntegrationInvoiceEvent_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorIntegrationInvoiceEvent"
ADD CONSTRAINT "VendorIntegrationInvoiceEvent_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
