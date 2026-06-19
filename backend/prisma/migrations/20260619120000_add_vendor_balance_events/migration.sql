-- Add append-only vendor balance events for refund-after-payment debt and future payout offsets.
CREATE TYPE "VendorBalanceEventType" AS ENUM (
  'PAYABLE_EARNED',
  'VENDOR_DEBT_CREATED',
  'VENDOR_DEBT_OFFSET',
  'MANUAL_ADJUSTMENT',
  'DEBT_WAIVED'
);

CREATE TABLE "VendorBalanceEvent" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "type" "VendorBalanceEventType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "financeLedgerEntryId" TEXT,
  "refundRecordId" TEXT,
  "payoutBatchId" TEXT,
  "settlementApprovalId" TEXT,
  "metadataJson" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VendorBalanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorBalanceEvent_idempotencyKey_key" ON "VendorBalanceEvent"("idempotencyKey");
CREATE INDEX "VendorBalanceEvent_vendorId_createdAt_idx" ON "VendorBalanceEvent"("vendorId", "createdAt");
CREATE INDEX "VendorBalanceEvent_vendorId_currency_idx" ON "VendorBalanceEvent"("vendorId", "currency");
CREATE INDEX "VendorBalanceEvent_type_createdAt_idx" ON "VendorBalanceEvent"("type", "createdAt");
CREATE INDEX "VendorBalanceEvent_sourceType_sourceId_idx" ON "VendorBalanceEvent"("sourceType", "sourceId");
CREATE INDEX "VendorBalanceEvent_financeLedgerEntryId_idx" ON "VendorBalanceEvent"("financeLedgerEntryId");
CREATE INDEX "VendorBalanceEvent_refundRecordId_idx" ON "VendorBalanceEvent"("refundRecordId");
CREATE INDEX "VendorBalanceEvent_payoutBatchId_idx" ON "VendorBalanceEvent"("payoutBatchId");
CREATE INDEX "VendorBalanceEvent_settlementApprovalId_idx" ON "VendorBalanceEvent"("settlementApprovalId");

ALTER TABLE "VendorBalanceEvent"
  ADD CONSTRAINT "VendorBalanceEvent_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorBalanceEvent"
  ADD CONSTRAINT "VendorBalanceEvent_financeLedgerEntryId_fkey"
  FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorBalanceEvent"
  ADD CONSTRAINT "VendorBalanceEvent_refundRecordId_fkey"
  FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorBalanceEvent"
  ADD CONSTRAINT "VendorBalanceEvent_payoutBatchId_fkey"
  FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorBalanceEvent"
  ADD CONSTRAINT "VendorBalanceEvent_settlementApprovalId_fkey"
  FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;
