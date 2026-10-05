ALTER TABLE "AllocationDeliveredObservation"
  ADD COLUMN "sopyoOrderPushId" TEXT;

CREATE INDEX "AllocationDeliveredObservation_sopyoOrderPushId_idx"
  ON "AllocationDeliveredObservation"("sopyoOrderPushId");

ALTER TABLE "AllocationDeliveredObservation"
  ADD CONSTRAINT "AllocationDeliveredObservation_sopyoOrderPushId_fkey"
  FOREIGN KEY ("sopyoOrderPushId") REFERENCES "SopyoOrderPush"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AllocationDeliveredObservation"
  DROP CONSTRAINT "AllocationDeliveredObservation_source_check";

ALTER TABLE "AllocationDeliveredObservation"
  ADD CONSTRAINT "AllocationDeliveredObservation_source_check" CHECK (
    (
      "outboundMethod" = 'KARGONOMI'
      AND "outboundIntegrationProvider" IS NULL
      AND "shipmentExecutionId" IS NOT NULL
      AND "vendorIntegrationClientId" IS NULL
      AND "sopyoOrderPushId" IS NULL
    ) OR (
      "outboundMethod" = 'VENDOR_INTEGRATION'
      AND "outboundIntegrationProvider" IS NOT NULL
      AND "shipmentExecutionId" IS NULL
      AND "vendorIntegrationClientId" IS NOT NULL
      AND "sopyoOrderPushId" IS NULL
    ) OR (
      "outboundMethod" = 'VENDOR_INTEGRATION'
      AND "outboundIntegrationProvider" = 'SOPYO'
      AND "shipmentExecutionId" IS NULL
      AND "vendorIntegrationClientId" IS NULL
      AND "sopyoOrderPushId" IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION "validate_allocation_delivered_observation_source"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allocation_row "VendorAllocation"%ROWTYPE;
  push_row "SopyoOrderPush"%ROWTYPE;
BEGIN
  SELECT * INTO allocation_row FROM "VendorAllocation" WHERE "id" = NEW."vendorAllocationId" FOR UPDATE;
  IF NOT FOUND OR allocation_row."outboundMethodSnapshot" IS DISTINCT FROM NEW."outboundMethod"
    OR allocation_row."outboundIntegrationProviderSnapshot" IS DISTINCT FROM NEW."outboundIntegrationProvider" THEN
    RAISE EXCEPTION 'Delivered observation source does not match allocation snapshot';
  END IF;

  IF NEW."outboundMethod" = 'KARGONOMI' AND NOT EXISTS (
    SELECT 1 FROM "ShipmentExecution" execution
    WHERE execution."id" = NEW."shipmentExecutionId"
      AND execution."allocationId" = NEW."vendorAllocationId"
      AND execution."vendorId" = allocation_row."assignedVendorId"
      AND execution."provider" = 'KARGONOMI'
      AND execution."shipmentStatus" = 'DELIVERED'
      AND execution."providerShipmentId" = NEW."sourceReference"
  ) THEN
    RAISE EXCEPTION 'Delivered observation lacks matching Kargonomi execution';
  END IF;

  IF NEW."outboundMethod" = 'VENDOR_INTEGRATION' AND NEW."vendorIntegrationClientId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "VendorIntegrationClient" client
      WHERE client."id" = NEW."vendorIntegrationClientId"
        AND client."vendorIdentifier" = allocation_row."assignedVendorId"
        AND client."providerCode" = NEW."outboundIntegrationProvider"
        AND client."enabled" = true
        AND client."revokedAt" IS NULL
        AND 'shipment:write' = ANY(client."scopes")
    ) THEN
      RAISE EXCEPTION 'Delivered observation lacks matching active integration client';
    END IF;

    IF NEW."outboundIntegrationProvider" = 'SOPYO' THEN
      SELECT * INTO push_row FROM "SopyoOrderPush"
      WHERE "vendorAllocationId" = NEW."vendorAllocationId" FOR UPDATE;
      IF FOUND AND (
        push_row."status" <> 'SUCCEEDED'
        OR push_row."assignedVendorId" <> allocation_row."assignedVendorId"
        OR push_row."orderCode" <> allocation_row."id"
        OR push_row."sopyoOrderId" IS NULL
        OR push_row."sopyoOrderId" <> NEW."sourceReference"
      ) THEN
        RAISE EXCEPTION 'Tracking observation conflicts with Sopyo push identity';
      END IF;
    END IF;
  END IF;

  IF NEW."sopyoOrderPushId" IS NOT NULL THEN
    SELECT * INTO push_row FROM "SopyoOrderPush" WHERE "id" = NEW."sopyoOrderPushId" FOR UPDATE;
    IF NOT FOUND OR NEW."outboundMethod" <> 'VENDOR_INTEGRATION'
      OR NEW."outboundIntegrationProvider" <> 'SOPYO'
      OR push_row."vendorAllocationId" <> NEW."vendorAllocationId"
      OR push_row."assignedVendorId" <> allocation_row."assignedVendorId"
      OR push_row."orderCode" <> allocation_row."id"
      OR push_row."status" <> 'SUCCEEDED'
      OR push_row."sopyoOrderId" IS NULL
      OR push_row."sopyoOrderId" !~ '^[1-9][0-9]*$'
      OR length(push_row."sopyoOrderId") > 16
      OR push_row."sopyoOrderId"::numeric > 9007199254740991
      OR NEW."sourceReference" <> push_row."sopyoOrderId" THEN
      RAISE EXCEPTION 'Delivered observation lacks matching successful Sopyo push';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
