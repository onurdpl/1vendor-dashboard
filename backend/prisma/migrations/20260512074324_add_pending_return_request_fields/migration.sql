-- AlterTable
ALTER TABLE "ReturnRecord" ADD COLUMN     "requestCreatedAt" TIMESTAMP(3),
ADD COLUMN     "requestUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "returnLifecycleStatus" TEXT,
ADD COLUMN     "returnRequestSource" TEXT,
ADD COLUMN     "sourceShopifyLineItemId" TEXT,
ADD COLUMN     "sourceShopifyReturnGid" TEXT,
ADD COLUMN     "sourceShopifyReturnId" TEXT;

-- CreateIndex
CREATE INDEX "ReturnRecord_sourceShopifyReturnGid_idx" ON "ReturnRecord"("sourceShopifyReturnGid");

-- CreateIndex
CREATE INDEX "ReturnRecord_sourceShopifyReturnId_idx" ON "ReturnRecord"("sourceShopifyReturnId");
