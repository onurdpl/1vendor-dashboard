-- Outbound Shopify refund attempt audit foundation.
-- Preview/audit only; no refund, finance, or Shopify mutation behavior is added.

CREATE TABLE "OutboundShopifyRefundAttempt" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "restockType" TEXT NOT NULL,
    "refundShipping" BOOLEAN NOT NULL DEFAULT false,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundLineItemsJson" JSONB,
    "suggestedTransactionsJson" JSONB,
    "fulfillmentOrderCancellationJson" JSONB,
    "blockersJson" JSONB,
    "warningsJson" JSONB,
    "previewHash" TEXT,
    "previewedAt" TIMESTAMP(3),
    "shopifyRefundId" TEXT,
    "shopifyUserErrorsJson" JSONB,
    "mutationResponseJson" JSONB,
    "submittedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundShopifyRefundAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboundShopifyRefundAttempt_vendorAllocationId_idx" ON "OutboundShopifyRefundAttempt"("vendorAllocationId");
CREATE INDEX "OutboundShopifyRefundAttempt_shopifyOrderId_idx" ON "OutboundShopifyRefundAttempt"("shopifyOrderId");
CREATE INDEX "OutboundShopifyRefundAttempt_status_idx" ON "OutboundShopifyRefundAttempt"("status");
CREATE INDEX "OutboundShopifyRefundAttempt_shopifyRefundId_idx" ON "OutboundShopifyRefundAttempt"("shopifyRefundId");
CREATE INDEX "OutboundShopifyRefundAttempt_previewHash_idx" ON "OutboundShopifyRefundAttempt"("previewHash");

ALTER TABLE "OutboundShopifyRefundAttempt"
ADD CONSTRAINT "OutboundShopifyRefundAttempt_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutboundShopifyRefundAttempt"
ADD CONSTRAINT "OutboundShopifyRefundAttempt_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
