CREATE TYPE "VendorProfileSnapshotImpact" AS ENUM (
  'FUTURE_LEDGER_ROWS_ONLY',
  'FUTURE_SETTLEMENT_APPROVALS_ONLY',
  'FUTURE_COMMISSION_INVOICES_ONLY',
  'FUTURE_SHIPMENTS_ONLY',
  'FUTURE_RETURNS_ONLY',
  'FUTURE_SHIPMENTS_AND_RETURNS_ONLY',
  'EXISTING_SETTLEMENTS_UNCHANGED',
  'PROVIDER_REBIND_REQUIRED',
  'FUTURE_PAYOUT_RELEVANT',
  'DIAGNOSTIC_ONLY',
  'UNKNOWN'
);

CREATE TABLE "VendorProfileAuditLog" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "changedByUserId" TEXT,
  "changedByEmail" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT,
  "snapshotImpact" "VendorProfileSnapshotImpact" NOT NULL,
  "source" TEXT NOT NULL,

  CONSTRAINT "VendorProfileAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VendorProfileAuditLog_vendorId_changedAt_idx" ON "VendorProfileAuditLog"("vendorId", "changedAt");
CREATE INDEX "VendorProfileAuditLog_vendorId_section_idx" ON "VendorProfileAuditLog"("vendorId", "section");
CREATE INDEX "VendorProfileAuditLog_fieldName_idx" ON "VendorProfileAuditLog"("fieldName");

ALTER TABLE "VendorProfileAuditLog"
ADD CONSTRAINT "VendorProfileAuditLog_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
