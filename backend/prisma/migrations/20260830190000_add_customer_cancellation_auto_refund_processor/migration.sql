-- Additive ownership and lease metadata for the default-disabled customer cancellation refund processor.
ALTER TABLE "OutboundShopifyRefundAttempt"
  ADD COLUMN "customerCancellationRequestItemId" TEXT;

ALTER TABLE "OperationalJob"
  ADD COLUMN "customerCancellationRequestItemId" TEXT,
  ADD COLUMN "processingGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processingLeaseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "OutboundShopifyRefundAttempt_customerCancellationRequestItemId_key"
  ON "OutboundShopifyRefundAttempt"("customerCancellationRequestItemId");

CREATE UNIQUE INDEX "OperationalJob_customerCancellationRequestItemId_key"
  ON "OperationalJob"("customerCancellationRequestItemId");

CREATE INDEX "OperationalJob_status_processingLeaseExpiresAt_idx"
  ON "OperationalJob"("status", "processingLeaseExpiresAt");

ALTER TABLE "OutboundShopifyRefundAttempt"
  ADD CONSTRAINT "OutboundShopifyRefundAttempt_customerCancellationRequestItemId_fkey"
  FOREIGN KEY ("customerCancellationRequestItemId") REFERENCES "CustomerCancellationRequestItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OperationalJob"
  ADD CONSTRAINT "OperationalJob_customerCancellationRequestItemId_fkey"
  FOREIGN KEY ("customerCancellationRequestItemId") REFERENCES "CustomerCancellationRequestItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
