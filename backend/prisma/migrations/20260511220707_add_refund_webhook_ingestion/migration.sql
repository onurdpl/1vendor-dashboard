-- AlterTable
ALTER TABLE "ReturnRecord" ADD COLUMN     "sourceShopifyRefundId" TEXT;

-- CreateTable
CREATE TABLE "ShopifyRefund" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "sourceShopifyOrderNumber" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyRefundLineItem" (
    "id" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "refundRecordId" TEXT,
    "shopifyOrderLineItemId" TEXT NOT NULL,
    "sourceRefundLineItemId" TEXT NOT NULL,
    "sourceLineItemId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyRefundLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyRefund_sourceShopifyRefundId_key" ON "ShopifyRefund"("sourceShopifyRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyRefundLineItem_shopifyRefundId_sourceRefundLineItemI_key" ON "ShopifyRefundLineItem"("shopifyRefundId", "sourceRefundLineItemId");

-- AddForeignKey
ALTER TABLE "ShopifyRefund" ADD CONSTRAINT "ShopifyRefund_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyRefundLineItem" ADD CONSTRAINT "ShopifyRefundLineItem_shopifyRefundId_fkey" FOREIGN KEY ("shopifyRefundId") REFERENCES "ShopifyRefund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyRefundLineItem" ADD CONSTRAINT "ShopifyRefundLineItem_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyRefundLineItem" ADD CONSTRAINT "ShopifyRefundLineItem_shopifyOrderLineItemId_fkey" FOREIGN KEY ("shopifyOrderLineItemId") REFERENCES "ShopifyOrderLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
