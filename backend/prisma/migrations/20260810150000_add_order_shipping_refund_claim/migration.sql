-- Durable order-level ownership for future customer checkout shipping refunds.
-- This migration does not enable or execute shipping refunds.

CREATE TABLE "OrderShippingRefundClaim" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "ownerAttemptId" TEXT NOT NULL,
    "activeOrderKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderShippingRefundClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderShippingRefundClaim_ownerAttemptId_key"
ON "OrderShippingRefundClaim"("ownerAttemptId");

CREATE UNIQUE INDEX "OrderShippingRefundClaim_activeOrderKey_key"
ON "OrderShippingRefundClaim"("activeOrderKey");

CREATE INDEX "OrderShippingRefundClaim_shopifyOrderId_idx"
ON "OrderShippingRefundClaim"("shopifyOrderId");

CREATE INDEX "OrderShippingRefundClaim_status_idx"
ON "OrderShippingRefundClaim"("status");

ALTER TABLE "OrderShippingRefundClaim"
ADD CONSTRAINT "OrderShippingRefundClaim_ownerAttemptId_fkey"
FOREIGN KEY ("ownerAttemptId") REFERENCES "OutboundShopifyRefundAttempt"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
