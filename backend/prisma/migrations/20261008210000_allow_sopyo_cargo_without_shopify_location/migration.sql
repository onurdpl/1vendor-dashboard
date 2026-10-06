ALTER TABLE "SopyoShipmentIntent"
  ALTER COLUMN "shopifyLocationGid" DROP NOT NULL;

ALTER TABLE "SopyoShipmentIntent"
  DROP CONSTRAINT "SopyoShipmentIntent_cargo_check";

ALTER TABLE "SopyoShipmentIntent"
  ADD CONSTRAINT "SopyoShipmentIntent_cargo_check" CHECK (
    length(btrim("carrier")) >= 1
    AND length(btrim("carrier")) <= 200
    AND length(btrim("trackingNumber")) >= 1
    AND length(btrim("trackingNumber")) <= 200
    AND "carrier" = btrim("carrier")
    AND "trackingNumber" = btrim("trackingNumber")
    AND ("shopifyLocationGid" IS NULL OR length(btrim("shopifyLocationGid")) > 0)
  );
