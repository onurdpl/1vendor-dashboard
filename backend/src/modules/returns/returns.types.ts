export type ReturnSummaryDto = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  sourceShopifyRefundId: string;
  vendorId: string;
  assignedVendorId: string;
  status: string;
  refundAmount: string;
  refundedItemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RefundedItemDto = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  refundAmount: string;
};

export type ReturnDetailDto = ReturnSummaryDto & {
  sourceShopifyInternalOrderId: string;
  originalVendorId: string;
  refundedItems: RefundedItemDto[];
};
