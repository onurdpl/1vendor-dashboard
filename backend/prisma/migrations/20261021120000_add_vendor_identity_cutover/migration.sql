CREATE TABLE "VendorIdentityCutover" (
    "id" TEXT NOT NULL,
    "externalSellerSlug" TEXT NOT NULL,
    "previousVendorId" TEXT NOT NULL,
    "replacementVendorId" TEXT NOT NULL,
    "approvedCutoverAt" TIMESTAMPTZ(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "VendorIdentityCutover_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VendorIdentityCutover_vendor_distinct_check"
      CHECK ("previousVendorId" <> "replacementVendorId"),
    CONSTRAINT "VendorIdentityCutover_previous_slug_check"
      CHECK ("previousVendorId" = "externalSellerSlug"),
    CONSTRAINT "VendorIdentityCutover_slug_check"
      CHECK ("externalSellerSlug" ~ '^[a-z0-9][a-z0-9_-]*$'),
    CONSTRAINT "VendorIdentityCutover_activation_check"
      CHECK ("active" = ("activatedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "VendorIdentityCutover_externalSellerSlug_key"
  ON "VendorIdentityCutover"("externalSellerSlug");
CREATE INDEX "VendorIdentityCutover_previousVendorId_idx"
  ON "VendorIdentityCutover"("previousVendorId");
CREATE INDEX "VendorIdentityCutover_replacementVendorId_idx"
  ON "VendorIdentityCutover"("replacementVendorId");

ALTER TABLE "VendorIdentityCutover" ADD CONSTRAINT "VendorIdentityCutover_previousVendorId_fkey"
  FOREIGN KEY ("previousVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorIdentityCutover" ADD CONSTRAINT "VendorIdentityCutover_replacementVendorId_fkey"
  FOREIGN KEY ("replacementVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorIdentityCutover" ADD CONSTRAINT "VendorIdentityCutover_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorIdentityCutover" ADD CONSTRAINT "VendorIdentityCutover_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION vendor_identity_cutover_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Vendor identity cutover cannot be deleted';
  END IF;

  IF (NEW."id", NEW."externalSellerSlug", NEW."previousVendorId", NEW."replacementVendorId",
      NEW."approvedCutoverAt", NEW."createdByUserId", NEW."approvedByUserId",
      NEW."createdAt", NEW."approvedAt")
     IS DISTINCT FROM
     (OLD."id", OLD."externalSellerSlug", OLD."previousVendorId", OLD."replacementVendorId",
      OLD."approvedCutoverAt", OLD."createdByUserId", OLD."approvedByUserId",
      OLD."createdAt", OLD."approvedAt") THEN
    RAISE EXCEPTION 'Vendor identity cutover authority is immutable';
  END IF;

  IF OLD."active" AND (NOT NEW."active" OR NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt") THEN
    RAISE EXCEPTION 'Activated vendor identity cutover cannot be changed';
  END IF;
  IF NOT OLD."active" AND NEW."active" AND NEW."activatedAt" IS NULL THEN
    RAISE EXCEPTION 'Vendor identity cutover activation requires activatedAt';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_identity_cutover_immutable_trigger
  BEFORE UPDATE OR DELETE ON "VendorIdentityCutover"
  FOR EACH ROW EXECUTE FUNCTION vendor_identity_cutover_immutable();
