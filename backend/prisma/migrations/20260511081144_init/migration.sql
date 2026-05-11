-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VENDOR', 'SUPPORT', 'FINANCE');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('ACTIVE', 'VENDOR_BLOCKED', 'PENDING_REASSIGNMENT', 'REASSIGNED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('OUT_OF_STOCK', 'VENDOR_CANCELLED', 'DAMAGED_INVENTORY', 'FULFILLMENT_ISSUE');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'HOLD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVendorAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserVendorAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrder" (
    "id" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "customerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrderLineItem" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "sourceLineItemId" TEXT NOT NULL,
    "sourceVariantId" TEXT,
    "sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2),
    "originalVendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAllocation" (
    "id" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "originalVendorId" TEXT NOT NULL,
    "assignedVendorId" TEXT NOT NULL,
    "allocationStatus" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancellationReason" "CancellationReason",
    "reassignmentRequired" BOOLEAN NOT NULL DEFAULT false,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAllocationLineItem" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lineAmount" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAllocationLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationAssignmentHistory" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromVendorId" TEXT,
    "toVendorId" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "fulfillmentStatus" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRecord" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "amount" DECIMAL(10,2),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT,
    "vendorId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "sourceShopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "payloadHash" TEXT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "shopifyOrderId" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserVendorAccess_userId_vendorId_key" ON "UserVendorAccess"("userId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrder_sourceShopifyOrderId_key" ON "ShopifyOrder"("sourceShopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrderLineItem_shopifyOrderId_sourceLineItemId_key" ON "ShopifyOrderLineItem"("shopifyOrderId", "sourceLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAllocationLineItem_vendorAllocationId_shopifyLineItem_key" ON "VendorAllocationLineItem"("vendorAllocationId", "shopifyLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Fulfillment_vendorAllocationId_key" ON "Fulfillment"("vendorAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_sourceShopDomain_topic_webhookId_key" ON "WebhookEvent"("sourceShopDomain", "topic", "webhookId");

-- AddForeignKey
ALTER TABLE "UserVendorAccess" ADD CONSTRAINT "UserVendorAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVendorAccess" ADD CONSTRAINT "UserVendorAccess_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrderLineItem" ADD CONSTRAINT "ShopifyOrderLineItem_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_sourceShopifyOrderId_fkey" FOREIGN KEY ("sourceShopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_originalVendorId_fkey" FOREIGN KEY ("originalVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_assignedVendorId_fkey" FOREIGN KEY ("assignedVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocationLineItem" ADD CONSTRAINT "VendorAllocationLineItem_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocationLineItem" ADD CONSTRAINT "VendorAllocationLineItem_shopifyLineItemId_fkey" FOREIGN KEY ("shopifyLineItemId") REFERENCES "ShopifyOrderLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_fromVendorId_fkey" FOREIGN KEY ("fromVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_toVendorId_fkey" FOREIGN KEY ("toVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationAssignmentHistory" ADD CONSTRAINT "AllocationAssignmentHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceLedgerEntry" ADD CONSTRAINT "FinanceLedgerEntry_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceLedgerEntry" ADD CONSTRAINT "FinanceLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
