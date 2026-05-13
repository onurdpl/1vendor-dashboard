-- AlterTable
ALTER TABLE "FinanceLedgerEntry"
ADD COLUMN "commissionPercentSnapshot" DECIMAL(5,2),
ADD COLUMN "commissionVatPercentSnapshot" DECIMAL(5,2),
ADD COLUMN "deductShippingEnabledSnapshot" BOOLEAN,
ADD COLUMN "shippingModeSnapshot" "ShippingDeductionMode",
ADD COLUMN "fixedShippingFeeSnapshot" DECIMAL(10,2),
ADD COLUMN "financialProfileIdSnapshot" TEXT;

-- Backfill existing sale rows with the currently configured active vendor profile when present.
-- If no configured profile exists, preserve the original platform default that prior calculations used.
UPDATE "FinanceLedgerEntry" AS ledger
SET
  "commissionPercentSnapshot" = COALESCE(profile."commissionPercent", 10.00),
  "commissionVatPercentSnapshot" = COALESCE(profile."commissionVatPercent", 0.00),
  "deductShippingEnabledSnapshot" = COALESCE(profile."deductShippingEnabled", false),
  "shippingModeSnapshot" = COALESCE(profile."shippingMode", 'DISABLED'::"ShippingDeductionMode"),
  "fixedShippingFeeSnapshot" = profile."fixedShippingFee",
  "financialProfileIdSnapshot" = profile."id"
FROM "Vendor" AS vendor
LEFT JOIN "VendorFinancialProfile" AS profile
  ON profile."vendorId" = vendor."id"
  AND profile."active" = true
WHERE
  ledger."vendorId" = vendor."id"
  AND lower(ledger."entryType") = 'sale'
  AND ledger."commissionPercentSnapshot" IS NULL;

-- CreateIndex
CREATE INDEX "FinanceLedgerEntry_vendorId_entryType_idx" ON "FinanceLedgerEntry"("vendorId", "entryType");
