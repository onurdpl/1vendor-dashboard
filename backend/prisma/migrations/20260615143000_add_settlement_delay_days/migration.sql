ALTER TABLE "VendorFinancialProfile" ADD COLUMN "settlementDelayDays" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "FinanceLedgerEntry" ADD COLUMN "settlementDelayDaysSnapshot" INTEGER NOT NULL DEFAULT 21;
