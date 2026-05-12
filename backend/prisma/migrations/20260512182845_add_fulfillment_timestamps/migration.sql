-- AlterTable
ALTER TABLE "Fulfillment" ADD COLUMN     "fulfilledAt" TIMESTAMP(3),
ADD COLUMN     "shipmentCreatedAt" TIMESTAMP(3),
ADD COLUMN     "shipmentUpdatedAt" TIMESTAMP(3);
