ALTER TABLE "VendorAllocation"
ADD COLUMN "vendorIntegrationTrackingUrl" TEXT,
ADD COLUMN "vendorIntegrationShippedAt" TIMESTAMP(3),
ADD COLUMN "lastVendorIntegrationShipmentRequestId" TEXT;

CREATE TABLE "VendorIntegrationShipmentEvent" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "vendorAllocationId" TEXT NOT NULL,
  "vendorIdentifier" TEXT NOT NULL,
  "providerName" TEXT,
  "carrier" TEXT NOT NULL,
  "trackingNumber" TEXT NOT NULL,
  "trackingUrl" TEXT,
  "shippedAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VendorIntegrationShipmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorIntegrationShipmentEvent_clientId_vendorAllocationId_idempotencyKey_key"
ON "VendorIntegrationShipmentEvent"("clientId", "vendorAllocationId", "idempotencyKey");

CREATE INDEX "VendorIntegrationShipmentEvent_vendorAllocationId_createdAt_idx"
ON "VendorIntegrationShipmentEvent"("vendorAllocationId", "createdAt");

CREATE INDEX "VendorIntegrationShipmentEvent_vendorIdentifier_createdAt_idx"
ON "VendorIntegrationShipmentEvent"("vendorIdentifier", "createdAt");

ALTER TABLE "VendorIntegrationShipmentEvent"
ADD CONSTRAINT "VendorIntegrationShipmentEvent_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorIntegrationShipmentEvent"
ADD CONSTRAINT "VendorIntegrationShipmentEvent_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
