CREATE TABLE "PayoutPreparationFailure" (
    "id" TEXT NOT NULL,
    "invocationId" UUID NOT NULL,
    "historicalVendorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" VARCHAR(64) NOT NULL,
    "correlationReference" VARCHAR(128),
    CONSTRAINT "PayoutPreparationFailure_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayoutPreparationFailure_classification_check" CHECK ("classification" = 'TRANSACTION_CONFLICT_RETRY_EXHAUSTED')
);
CREATE UNIQUE INDEX "PayoutPreparationFailure_invocationId_key" ON "PayoutPreparationFailure"("invocationId");
CREATE INDEX "PayoutPreparationFailure_occurredAt_id_idx" ON "PayoutPreparationFailure"("occurredAt" DESC, "id" DESC);
CREATE INDEX "PayoutPreparationFailure_historicalVendorId_occurredAt_id_idx" ON "PayoutPreparationFailure"("historicalVendorId", "occurredAt" DESC, "id" DESC);
