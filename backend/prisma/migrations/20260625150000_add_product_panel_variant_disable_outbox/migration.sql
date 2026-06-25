-- CreateEnum
CREATE TYPE "ProductPanelVariantDisableOutboxStatus" AS ENUM ('CREATED', 'RESOLVED_DRY_RUN', 'FAILED');

-- CreateTable
CREATE TABLE "ProductPanelVariantDisableOutboxEvent" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "vendorAllocationLineItemId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "shopifyLineItemId" TEXT NOT NULL,
    "variantSku" TEXT,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "quantity" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environment" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductPanelVariantDisableOutboxStatus" NOT NULL DEFAULT 'CREATED',
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestPayloadJson" JSONB,
    "responseJson" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPanelVariantDisableOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPanelVariantDisableOutboxEvent_idempotencyKey_key" ON "ProductPanelVariantDisableOutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_allocationId_idx" ON "ProductPanelVariantDisableOutboxEvent"("allocationId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_vendorAllocationLineItemId_idx" ON "ProductPanelVariantDisableOutboxEvent"("vendorAllocationLineItemId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_vendorId_idx" ON "ProductPanelVariantDisableOutboxEvent"("vendorId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_shopifyOrderId_idx" ON "ProductPanelVariantDisableOutboxEvent"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "ProductPanelVariantDisableOutboxEvent_status_requestedAt_idx" ON "ProductPanelVariantDisableOutboxEvent"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "ProductPanelVariantDisableOutboxEvent" ADD CONSTRAINT "ProductPanelVariantDisableOutboxEvent_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPanelVariantDisableOutboxEvent" ADD CONSTRAINT "ProductPanelVariantDisableOutboxEvent_vendorAllocationLineItemId_fkey" FOREIGN KEY ("vendorAllocationLineItemId") REFERENCES "VendorAllocationLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
