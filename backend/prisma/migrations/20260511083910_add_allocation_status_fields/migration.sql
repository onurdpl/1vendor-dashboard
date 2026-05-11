-- AlterTable
ALTER TABLE "VendorAllocation" ADD COLUMN     "fulfillmentStatus" TEXT NOT NULL DEFAULT 'Pending',
ADD COLUMN     "shippingStatus" TEXT NOT NULL DEFAULT 'Awaiting Shipment';
