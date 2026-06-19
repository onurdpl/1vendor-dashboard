-- Phase 4A cleanup: monthly settlement scheduling was removed by business decision.
-- Existing MONTHLY values are normalized to WEEKLY before replacing the enum.
UPDATE "VendorFinancialProfile"
SET "settlementFrequencyType" = 'WEEKLY'
WHERE "settlementFrequencyType" = 'MONTHLY';

ALTER TABLE "VendorFinancialProfile"
  DROP COLUMN IF EXISTS "monthlySettlementDay";

ALTER TYPE "SettlementFrequencyType" RENAME TO "SettlementFrequencyType_old";

CREATE TYPE "SettlementFrequencyType" AS ENUM ('WEEKLY', 'BIWEEKLY');

ALTER TABLE "VendorFinancialProfile"
  ALTER COLUMN "settlementFrequencyType" DROP DEFAULT,
  ALTER COLUMN "settlementFrequencyType" TYPE "SettlementFrequencyType"
    USING "settlementFrequencyType"::text::"SettlementFrequencyType",
  ALTER COLUMN "settlementFrequencyType" SET DEFAULT 'WEEKLY';

DROP TYPE "SettlementFrequencyType_old";
