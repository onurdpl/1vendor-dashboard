ALTER TABLE "SopyoShopifyExecutionPlanLine" ADD CONSTRAINT "SopyoShopifyExecutionPlanLine_vendorAllocationLineItemId_fkey"
  FOREIGN KEY ("vendorAllocationLineItemId") REFERENCES "VendorAllocationLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
