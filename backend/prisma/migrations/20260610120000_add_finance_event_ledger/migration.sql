-- CreateEnum
CREATE TYPE "FinanceEventType" AS ENUM (
    'SALE_RECORDED',
    'COMMISSION_RESERVED',
    'COMMISSION_VAT_RESERVED',
    'VENDOR_PAYABLE_RESERVED',
    'REFUND_RECORDED',
    'COMMISSION_REVERSED',
    'COMMISSION_VAT_REVERSED',
    'VENDOR_PAYABLE_REVERSED',
    'MANUAL_ADJUSTMENT'
);

-- CreateTable
CREATE TABLE "FinanceEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "financeLedgerEntryId" TEXT,
    "eventType" "FinanceEventType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "FinanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceEvent_idempotencyKey_key" ON "FinanceEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinanceEvent_vendorId_createdAt_idx" ON "FinanceEvent"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_shopifyOrderId_createdAt_idx" ON "FinanceEvent"("shopifyOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_financeLedgerEntryId_createdAt_idx" ON "FinanceEvent"("financeLedgerEntryId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_eventType_createdAt_idx" ON "FinanceEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceEvent_referenceType_referenceId_idx" ON "FinanceEvent"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "FinanceEvent" ADD CONSTRAINT "FinanceEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEvent" ADD CONSTRAINT "FinanceEvent_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEvent" ADD CONSTRAINT "FinanceEvent_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
