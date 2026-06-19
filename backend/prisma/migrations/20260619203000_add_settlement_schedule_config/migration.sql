CREATE TYPE "SettlementFrequencyType" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

CREATE TYPE "SettlementWeekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY');

ALTER TABLE "VendorFinancialProfile"
  ADD COLUMN "settlementFrequencyType" "SettlementFrequencyType" NOT NULL DEFAULT 'WEEKLY',
  ADD COLUMN "weeklySettlementDay" "SettlementWeekday" NOT NULL DEFAULT 'WEDNESDAY',
  ADD COLUMN "monthlySettlementDay" INTEGER,
  ADD COLUMN "autoSettlementDraftEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoSettlementApproveEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoSettlementInvoiceEnabled" BOOLEAN NOT NULL DEFAULT false;
