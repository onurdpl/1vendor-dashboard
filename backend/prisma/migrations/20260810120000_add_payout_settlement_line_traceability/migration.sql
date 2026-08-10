-- Add exact approved-settlement traceability without inferring links for existing payout lines.
ALTER TABLE "PayoutBatchLine"
ADD COLUMN "settlementApprovalLineId" TEXT;

-- A payout batch can contain more than one approved slice backed by the same ledger row.
DROP INDEX "PayoutBatchLine_payoutBatchId_financeLedgerEntryId_key";

CREATE UNIQUE INDEX "PayoutBatchLine_payoutBatchId_settlementApprovalLineId_key"
ON "PayoutBatchLine"("payoutBatchId", "settlementApprovalLineId");

CREATE INDEX "PayoutBatchLine_settlementApprovalLineId_idx"
ON "PayoutBatchLine"("settlementApprovalLineId");

ALTER TABLE "PayoutBatchLine"
ADD CONSTRAINT "PayoutBatchLine_settlementApprovalLineId_fkey"
FOREIGN KEY ("settlementApprovalLineId")
REFERENCES "SettlementApprovalLine"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
