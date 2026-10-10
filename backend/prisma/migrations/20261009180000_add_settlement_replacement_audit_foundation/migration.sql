-- Add nullable replacement identity and audit evidence without changing existing approvals.
ALTER TABLE "SettlementApproval"
ADD COLUMN "cancelledFromStatus" "SettlementApprovalStatus",
ADD COLUMN "replacesSettlementApprovalId" TEXT,
ADD COLUMN "replacementRequestId" TEXT,
ADD COLUMN "replacementRequestedBy" TEXT,
ADD COLUMN "replacementReason" TEXT,
ADD COLUMN "replacementRequestedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "SettlementApproval_replacementRequestId_key"
ON "SettlementApproval"("replacementRequestId");
CREATE UNIQUE INDEX "SettlementApproval_id_vendorId_key"
ON "SettlementApproval"("id", "vendorId");
CREATE UNIQUE INDEX "SettlementApproval_replacesSettlementApprovalId_vendorId_key"
ON "SettlementApproval"("replacesSettlementApprovalId", "vendorId");

ALTER TABLE "SettlementApproval"
ADD CONSTRAINT "SettlementApproval_replacesSettlementApprovalId_fkey"
FOREIGN KEY ("replacesSettlementApprovalId", "vendorId") REFERENCES "SettlementApproval"("id", "vendorId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementApproval"
ADD CONSTRAINT "SettlementApproval_replacement_audit_check" CHECK (
  (
    "replacesSettlementApprovalId" IS NULL AND
    "replacementRequestId" IS NULL AND
    "replacementRequestedBy" IS NULL AND
    "replacementReason" IS NULL AND
    "replacementRequestedAt" IS NULL
  ) OR (
    "replacesSettlementApprovalId" IS NOT NULL AND
    "replacementRequestId" IS NOT NULL AND
    "replacementRequestedBy" IS NOT NULL AND
    BTRIM("replacementRequestedBy") <> '' AND
    "replacementReason" IS NOT NULL AND
    BTRIM("replacementReason") <> '' AND
    "replacementRequestedAt" IS NOT NULL
  )
);
