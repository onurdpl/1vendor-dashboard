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
  trackingUrl: string | null;
  fulfilledAt: string | null;
  shipmentCreatedAt: string | null;
  shipmentUpdatedAt: string | null;
  reassignmentRequired: boolean;
  cancellationReason: string | null;
  lineItems: OrderDetailLineItemDto[];
  assignmentHistory: OrderAssignmentHistoryDto[];
};

export type AdminOrderBreakdownLineItemDto = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  lineAmount: string;
};

export type AdminOrderBreakdownAllocationDto = {
  id: string;
  vendorId: string;
  vendorName: string;
  originalVendorId: string;
  assignedVendorId: string;
  allocationStatus: string;
  cancellationReason: string | null;
  reassignmentRequired: boolean;
  fulfillmentStatus: string;
  shippingStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  trackingUrl: string | null;
  fulfilledAt: string | null;
  shipmentCreatedAt: string | null;
  shipmentUpdatedAt: string | null;
  totalAmount: string;
  lineItems: AdminOrderBreakdownLineItemDto[];
  assignmentHistory: OrderAssignmentHistoryDto[];
  returnRecords: Array<{
    id: string;
    status: string;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  refundRecords: Array<{
    id: string;
    sourceShopifyRefundId: string;
    amount: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type AdminOrderBreakdownDto = {
  order: {
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    customerName: string | null;
    customerEmail: string | null;
    totalAmount: string;
    createdAt: string;
    updatedAt: string;
  };
  allocations: AdminOrderBreakdownAllocationDto[];
};
