-- Customer cancellation request persistence foundation.
-- This migration does not cancel Shopify orders, change allocations, or create monetary/shipment effects.

CREATE TYPE "CustomerCancellationStatus" AS ENUM (
    'PENDING',
    'PARTIALLY_RESOLVED',
    'APPROVED',
    'DECLINED',
    'TOO_LATE',
    'CONFLICTED'
);

CREATE TABLE "CustomerCancellationRequest" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "status" "CustomerCancellationStatus" NOT NULL DEFAULT 'PENDING',
    "reasonCode" TEXT NOT NULL,
    "customerNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCancellationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerCancellationRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "shopifyOrderLineItemId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "resolvedQuantity" INTEGER,
    "status" "CustomerCancellationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCancellationRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerCancellationRequest_shopDomain_shopifyCustomerId_id_key"
ON "CustomerCancellationRequest"("shopDomain", "shopifyCustomerId", "idempotencyKey");

CREATE INDEX "CustomerCancellationRequest_shopifyOrderId_status_idx"
ON "CustomerCancellationRequest"("shopifyOrderId", "status");

CREATE INDEX "CustomerCancellationRequest_shopifyCustomerId_status_idx"
ON "CustomerCancellationRequest"("shopifyCustomerId", "status");

CREATE UNIQUE INDEX "CustomerCancellationRequestItem_requestId_shopifyOrderLineI_key"
ON "CustomerCancellationRequestItem"("requestId", "shopifyOrderLineItemId", "vendorAllocationId");

CREATE INDEX "CustomerCancellationRequestItem_vendorAllocationId_status_idx"
ON "CustomerCancellationRequestItem"("vendorAllocationId", "status");

CREATE INDEX "CustomerCancellationRequestItem_shopifyOrderLineItemId_idx"
ON "CustomerCancellationRequestItem"("shopifyOrderLineItemId");

ALTER TABLE "CustomerCancellationRequest"
ADD CONSTRAINT "CustomerCancellationRequest_shopifyOrderId_fkey"
FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerCancellationRequest"
ADD CONSTRAINT "CustomerCancellationRequest_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerCancellationRequestItem"
ADD CONSTRAINT "CustomerCancellationRequestItem_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "CustomerCancellationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerCancellationRequestItem"
ADD CONSTRAINT "CustomerCancellationRequestItem_shopifyOrderLineItemId_fkey"
FOREIGN KEY ("shopifyOrderLineItemId") REFERENCES "ShopifyOrderLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerCancellationRequestItem"
ADD CONSTRAINT "CustomerCancellationRequestItem_vendorAllocationId_fkey"
FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerCancellationRequestItem"
ADD CONSTRAINT "CustomerCancellationRequestItem_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
