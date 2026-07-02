ALTER TABLE "Vendor"
  ADD COLUMN "restrictionReason" TEXT,
  ADD COLUMN "restrictedByUserId" TEXT,
  ADD COLUMN "restrictedAt" TIMESTAMP(3);

WITH latest_vendor_status_audit AS (
  SELECT DISTINCT ON ("vendorId")
    "vendorId",
    "reason",
    "changedByUserId",
    "changedAt"
  FROM "VendorProfileAuditLog"
  WHERE "section" = 'vendor_status'
    AND "fieldName" = 'status'
  ORDER BY "vendorId", "changedAt" DESC
)
UPDATE "Vendor" AS vendor
SET
  "restrictionReason" = CASE
    WHEN LOWER(COALESCE(vendor."status", 'active')) <> 'active' THEN latest."reason"
    ELSE NULL
  END,
  "restrictedByUserId" = CASE
    WHEN LOWER(COALESCE(vendor."status", 'active')) <> 'active' THEN latest."changedByUserId"
    ELSE NULL
  END,
  "restrictedAt" = CASE
    WHEN LOWER(COALESCE(vendor."status", 'active')) <> 'active' THEN latest."changedAt"
    ELSE NULL
  END
FROM latest_vendor_status_audit AS latest
WHERE vendor."id" = latest."vendorId";
