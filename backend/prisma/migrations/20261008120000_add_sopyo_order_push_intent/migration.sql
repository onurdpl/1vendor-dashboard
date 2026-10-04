CREATE TYPE "SopyoOrderPushStatus" AS ENUM ('PENDING');

CREATE TABLE "SopyoOrderPush" (
    "id" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "assignedVendorId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "status" "SopyoOrderPushStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopyoOrderPush_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SopyoOrderPush_vendorAllocationId_key" ON "SopyoOrderPush"("vendorAllocationId");
CREATE UNIQUE INDEX "SopyoOrderPush_orderCode_key" ON "SopyoOrderPush"("orderCode");
CREATE INDEX "SopyoOrderPush_status_createdAt_idx" ON "SopyoOrderPush"("status", "createdAt");

ALTER TABLE "SopyoOrderPush" ADD CONSTRAINT "SopyoOrderPush_vendorAllocationId_fkey"
    FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
