ALTER TABLE "VendorAllocation"
ADD COLUMN "vendorIntegrationStatus" TEXT,
ADD COLUMN "vendorIntegrationStatusMessage" TEXT,
ADD COLUMN "vendorIntegrationStatusUpdatedAt" TIMESTAMP(3),
ADD COLUMN "vendorIntegrationProvider" TEXT,
ADD COLUMN "lastVendorIntegrationRequestId" TEXT;

CREATE TABLE "VendorIntegrationStatusEvent" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "vendorAllocationId" TEXT NOT NULL,
  "vendorIdentifier" TEXT NOT NULL,
  "providerName" TEXT,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VendorIntegrationStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorIntegrationStatusEvent_clientId_vendorAllocationId_idempotencyKey_key"
ON "VendorIntegrationStatusEvent"("clientId", "vendorAllocationId", "idempotencyKey");

CREATE INDEX "VendorIntegrationStatusEvent_vendorAllocationId_createdAt_idx"
ON "VendorIntegrationStatusEvent"("vendorAllocationId", "createdAt");

CREATE INDEX "VendorIntegrationStatusEvent_vendorIdentifier_createdAt_idx"
ON "VendorIntegrationStatusEvent"("vendorIdentifier", "createdAt");

CREATE INDEX "VendorAllocation_vendorIntegrationStatus_idx"
ON "VendorAllocation"("vendorIntegrationStatus");

ALTER TABLE "VendorIntegrationStatusEvent"
ADD CONSTRAINT "VendorIntegrationStatusEvent_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorIntegrationStatusEvent"
ADD CONSTRAINT "VendorIntegrationStatusEvent_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
