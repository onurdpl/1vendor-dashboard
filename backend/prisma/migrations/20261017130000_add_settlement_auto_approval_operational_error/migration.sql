CREATE TABLE "SettlementAutoApprovalOperationalError" (
    "id" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "vendorId" TEXT,
    "settlementApprovalId" TEXT,
    "attemptId" TEXT,
    "safeContextJson" JSONB,
    "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SettlementAutoApprovalOperationalError_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementAutoApprovalOperationalError_deduplicationKey_key"
    ON "SettlementAutoApprovalOperationalError"("deduplicationKey");
CREATE INDEX "SettlementAutoApprovalOperationalError_firstOccurredAt_id_idx"
    ON "SettlementAutoApprovalOperationalError"("firstOccurredAt", "id");
CREATE INDEX "SettlementAutoApprovalOperationalError_vendorId_firstOccurredAt_id_idx"
    ON "SettlementAutoApprovalOperationalError"("vendorId", "firstOccurredAt", "id");
