ALTER TABLE "SettlementCommissionInvoice"
  ADD COLUMN "invoiceDate" TIMESTAMP(3),
  ADD COLUMN "invoiceTotalMinor" INTEGER,
  ADD COLUMN "invoiceCurrency" TEXT,
  ADD COLUMN "gibStatus" TEXT,
  ADD COLUMN "gibStatusCode" TEXT,
  ADD COLUMN "documentStatusCode" TEXT,
  ADD COLUMN "documentType" TEXT,
  ADD COLUMN "lastProviderSyncedAt" TIMESTAMP(3);
