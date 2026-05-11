export type OrderSummaryDto = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  vendorId: string;
  assignedVendorId: string;
  originalVendorId: string;
  allocationStatus: string;
  fulfillmentStatus: string;
  shippingStatus: string;
  totalAmount: string;
  lineItemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type OrderDetailLineItemDto = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  lineAmount: string;
};

export type OrderAssignmentHistoryDto = {
  id: string;
  action: string;
  fromVendorId: string | null;
  toVendorId: string;
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
};

export type OrderDetailDto = OrderSummaryDto & {
  carrier: string | null;
  trackingNumber: string | null;
  reassignmentRequired: boolean;
  cancellationReason: string | null;
  lineItems: OrderDetailLineItemDto[];
  assignmentHistory: OrderAssignmentHistoryDto[];
};

