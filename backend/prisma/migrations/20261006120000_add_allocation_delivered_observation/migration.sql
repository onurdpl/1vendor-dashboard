CREATE TABLE "AllocationDeliveredObservation" (
  "id" TEXT NOT NULL,
  "vendorAllocationId" TEXT NOT NULL,
  "firstObservedDeliveredAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  "outboundMethod" "VendorOutboundMethod" NOT NULL,
  "outboundIntegrationProvider" "VendorIntegrationProviderCode",
  "sourceReference" TEXT NOT NULL,
  "shipmentExecutionId" TEXT,
  "vendorIntegrationClientId" TEXT,
  CONSTRAINT "AllocationDeliveredObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AllocationDeliveredObservation_source_check" CHECK (
    (
      "outboundMethod" = 'KARGONOMI'
      AND "outboundIntegrationProvider" IS NULL
      AND "shipmentExecutionId" IS NOT NULL
      AND "vendorIntegrationClientId" IS NULL
    ) OR (
      "outboundMethod" = 'VENDOR_INTEGRATION'
      AND "outboundIntegrationProvider" IS NOT NULL
      AND "shipmentExecutionId" IS NULL
      AND "vendorIntegrationClientId" IS NOT NULL
    )
  ),
  CONSTRAINT "AllocationDeliveredObservation_reference_check" CHECK (length(btrim("sourceReference")) > 0)
);

CREATE UNIQUE INDEX "AllocationDeliveredObservation_vendorAllocationId_key"
  ON "AllocationDeliveredObservation"("vendorAllocationId");
CREATE INDEX "AllocationDeliveredObservation_shipmentExecutionId_idx"
  ON "AllocationDeliveredObservation"("shipmentExecutionId");
CREATE INDEX "AllocationDeliveredObservation_vendorIntegrationClientId_idx"
  ON "AllocationDeliveredObservation"("vendorIntegrationClientId");

ALTER TABLE "AllocationDeliveredObservation"
  ADD CONSTRAINT "AllocationDeliveredObservation_vendorAllocationId_fkey"
  FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AllocationDeliveredObservation"
  ADD CONSTRAINT "AllocationDeliveredObservation_shipmentExecutionId_fkey"
  FOREIGN KEY ("shipmentExecutionId") REFERENCES "ShipmentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AllocationDeliveredObservation"
  ADD CONSTRAINT "AllocationDeliveredObservation_vendorIntegrationClientId_fkey"
  FOREIGN KEY ("vendorIntegrationClientId") REFERENCES "VendorIntegrationClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_allocation_delivered_observation_source"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allocation_row "VendorAllocation"%ROWTYPE;
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

  IF NEW."outboundMethod" = 'VENDOR_INTEGRATION' AND NOT EXISTS (
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

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AllocationDeliveredObservation_source_guard"
BEFORE INSERT ON "AllocationDeliveredObservation"
FOR EACH ROW EXECUTE FUNCTION "validate_allocation_delivered_observation_source"();

CREATE FUNCTION "prevent_allocation_delivered_observation_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Allocation delivered observation is immutable';
END;
$$;

CREATE TRIGGER "AllocationDeliveredObservation_immutable"
BEFORE UPDATE OR DELETE ON "AllocationDeliveredObservation"
FOR EACH ROW EXECUTE FUNCTION "prevent_allocation_delivered_observation_change"();
