CREATE TYPE "SopyoShipmentIntentStatus" AS ENUM (
  'CARGO_VERIFIED', 'SELECTION_PENDING', 'SUBMISSION_PENDING',
  'OUTCOME_UNKNOWN', 'RECONCILIATION_PENDING', 'CONFIRMED', 'CONFLICT'
);

CREATE TABLE "SopyoShipmentIntent" (
  "id" TEXT NOT NULL,
  "vendorAllocationId" TEXT NOT NULL,
  "sopyoOrderPushId" TEXT NOT NULL,
  "assignedVendorId" TEXT NOT NULL,
  "sopyoOrderId" TEXT NOT NULL,
  "orderCode" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "trackingNumber" TEXT NOT NULL,
  "firstObservedCargoAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC', clock_timestamp()),
  "shopifyLocationGid" TEXT NOT NULL,
  "status" "SopyoShipmentIntentStatus" NOT NULL DEFAULT 'CARGO_VERIFIED',
  "conflictReasonCode" TEXT,
  "conflictObservedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SopyoShipmentIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SopyoShipmentIntent_cargo_check" CHECK (
    length(btrim("carrier")) >= 1
    AND length(btrim("carrier")) <= 200
    AND length(btrim("trackingNumber")) >= 1
    AND length(btrim("trackingNumber")) <= 200
    AND "carrier" = btrim("carrier")
    AND "trackingNumber" = btrim("trackingNumber")
    AND length(btrim("shopifyLocationGid")) > 0
  ),
  CONSTRAINT "SopyoShipmentIntent_conflict_check" CHECK (
    ("status" = 'CONFLICT' AND "conflictReasonCode" = 'CARGO_MISMATCH' AND "conflictObservedAt" IS NOT NULL)
    OR ("status" <> 'CONFLICT' AND "conflictReasonCode" IS NULL AND "conflictObservedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "SopyoShipmentIntent_vendorAllocationId_key" ON "SopyoShipmentIntent"("vendorAllocationId");
CREATE UNIQUE INDEX "SopyoShipmentIntent_sopyoOrderPushId_key" ON "SopyoShipmentIntent"("sopyoOrderPushId");
CREATE INDEX "SopyoShipmentIntent_status_createdAt_idx" ON "SopyoShipmentIntent"("status", "createdAt");

ALTER TABLE "SopyoShipmentIntent" ADD CONSTRAINT "SopyoShipmentIntent_vendorAllocationId_fkey"
  FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopyoShipmentIntent" ADD CONSTRAINT "SopyoShipmentIntent_sopyoOrderPushId_fkey"
  FOREIGN KEY ("sopyoOrderPushId") REFERENCES "SopyoOrderPush"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SopyoShipmentIntent" ADD CONSTRAINT "SopyoShipmentIntent_assignedVendorId_fkey"
  FOREIGN KEY ("assignedVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_sopyo_shipment_intent"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allocation_row "VendorAllocation"%ROWTYPE;
  push_row "SopyoOrderPush"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."vendorAllocationId", NEW."sopyoOrderPushId", NEW."assignedVendorId",
        NEW."sopyoOrderId", NEW."orderCode", NEW."carrier", NEW."trackingNumber",
        NEW."firstObservedCargoAt", NEW."shopifyLocationGid") IS DISTINCT FROM
       (OLD."vendorAllocationId", OLD."sopyoOrderPushId", OLD."assignedVendorId",
        OLD."sopyoOrderId", OLD."orderCode", OLD."carrier", OLD."trackingNumber",
        OLD."firstObservedCargoAt", OLD."shopifyLocationGid") THEN
      RAISE EXCEPTION 'Sopyo shipment intent first cargo and identity are immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO allocation_row FROM "VendorAllocation" WHERE "id" = NEW."vendorAllocationId" FOR UPDATE;
  SELECT * INTO push_row FROM "SopyoOrderPush" WHERE "id" = NEW."sopyoOrderPushId" FOR UPDATE;
  IF NOT FOUND OR allocation_row."id" IS NULL
    OR allocation_row."outboundMethodSnapshot" IS DISTINCT FROM 'VENDOR_INTEGRATION'
    OR allocation_row."outboundIntegrationProviderSnapshot" IS DISTINCT FROM 'SOPYO'
    OR allocation_row."assignedVendorId" IS DISTINCT FROM NEW."assignedVendorId"
    OR allocation_row."shopifyLocationGidSnapshot" IS DISTINCT FROM NEW."shopifyLocationGid"
    OR push_row."vendorAllocationId" IS DISTINCT FROM allocation_row."id"
    OR push_row."assignedVendorId" IS DISTINCT FROM NEW."assignedVendorId"
    OR push_row."orderCode" IS DISTINCT FROM allocation_row."id"
    OR NEW."orderCode" IS DISTINCT FROM push_row."orderCode"
    OR push_row."status" IS DISTINCT FROM 'SUCCEEDED'
    OR push_row."sopyoOrderId" IS DISTINCT FROM NEW."sopyoOrderId"
    OR NEW."sopyoOrderId" !~ '^[1-9][0-9]*$'
    OR length(NEW."sopyoOrderId") > 16
    OR NEW."sopyoOrderId"::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Sopyo shipment intent lacks matching frozen allocation and successful push';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SopyoShipmentIntent_validate"
  BEFORE INSERT OR UPDATE ON "SopyoShipmentIntent"
  FOR EACH ROW EXECUTE FUNCTION "validate_sopyo_shipment_intent"();
