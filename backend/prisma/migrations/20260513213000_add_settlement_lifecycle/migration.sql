-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'ACCRUING', 'PAYABLE', 'PARTIALLY_REFUNDED', 'HELD', 'SETTLED', 'DISPUTED');

-- AlterTable
ALTER TABLE "FinanceLedgerEntry"
ADD COLUMN "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "settlementEligibleAt" TIMESTAMP(3),
ADD COLUMN "accruedAt" TIMESTAMP(3),
ADD COLUMN "payableAt" TIMESTAMP(3),
ADD COLUMN "settledAt" TIMESTAMP(3),
ADD COLUMN "settlementHoldReason" TEXT;

-- Backfill deterministic initial settlement lifecycle from existing allocation state.
UPDATE "FinanceLedgerEntry" AS ledger
SET
  "settlementStatus" = CASE
    WHEN ledger."payoutStatus" = 'HOLD' THEN 'HELD'::"SettlementStatus"
    WHEN ledger."payoutStatus" = 'PAID' THEN 'SETTLED'::"SettlementStatus"
    WHEN lower(ledger."entryType") = 'refund' THEN 'PARTIALLY_REFUNDED'::"SettlementStatus"
    WHEN fulfillment."fulfilledAt" IS NOT NULL
      OR lower(allocation."fulfillmentStatus") LIKE '%fulfilled%'
      OR lower(allocation."shippingStatus") LIKE '%shipped%'
      OR lower(allocation."shippingStatus") LIKE '%in transit%'
      OR lower(allocation."shippingStatus") LIKE '%delivered%'
      THEN 'PAYABLE'::"SettlementStatus"
    WHEN lower(ledger."entryType") = 'sale' THEN 'ACCRUING'::"SettlementStatus"
    ELSE 'PENDING'::"SettlementStatus"
  END,
  "accruedAt" = CASE
    WHEN lower(ledger."entryType") = 'sale' THEN ledger."createdAt"
    ELSE ledger."accruedAt"
  END,
  "payableAt" = CASE
    WHEN fulfillment."fulfilledAt" IS NOT NULL
      OR lower(allocation."fulfillmentStatus") LIKE '%fulfilled%'
      OR lower(allocation."shippingStatus") LIKE '%shipped%'
      OR lower(allocation."shippingStatus") LIKE '%in transit%'
      OR lower(allocation."shippingStatus") LIKE '%delivered%'
      THEN COALESCE(fulfillment."fulfilledAt", ledger."createdAt")
    ELSE ledger."payableAt"
  END,
  "settlementEligibleAt" = CASE
    WHEN fulfillment."fulfilledAt" IS NOT NULL
      OR lower(allocation."fulfillmentStatus") LIKE '%fulfilled%'
      OR lower(allocation."shippingStatus") LIKE '%shipped%'
      OR lower(allocation."shippingStatus") LIKE '%in transit%'
      OR lower(allocation."shippingStatus") LIKE '%delivered%'
      THEN COALESCE(fulfillment."fulfilledAt", ledger."createdAt")
    ELSE ledger."settlementEligibleAt"
  END
FROM "VendorAllocation" AS allocation
LEFT JOIN "Fulfillment" AS fulfillment
  ON fulfillment."vendorAllocationId" = allocation."id"
WHERE ledger."vendorAllocationId" = allocation."id";

-- CreateIndex
CREATE INDEX "FinanceLedgerEntry_vendorId_settlementStatus_idx" ON "FinanceLedgerEntry"("vendorId", "settlementStatus");
