ALTER TABLE "SettlementCommissionInvoice"
  ADD COLUMN "unknownReason" TEXT,
  ADD COLUMN "unknownAt" TIMESTAMP(3),
  ADD COLUMN "reconciliationStatus" TEXT,
  ADD COLUMN "reconciliationEvidenceJson" JSONB,
  ADD COLUMN "reconciledAt" TIMESTAMP(3),
  ADD COLUMN "reconciledBy" TEXT;
