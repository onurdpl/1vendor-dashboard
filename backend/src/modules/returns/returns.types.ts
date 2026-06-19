export type ReturnSummaryDto = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  sourceShopifyRefundId: string;
  sourceShopifyReturnId: string | null;
  sourceShopifyReturnGid: string | null;
  returnLifecycleStatus: string | null;
  returnRequestSource: string | null;
  vendorId: string;
  assignedVendorId: string;
  status: string;
  reason: string | null;
  returnReasonNote: string | null;
  returnProvider: string | null;
  returnProviderShipmentId: string | null;
  returnLabel: string | null;
  returnReferenceId: string | null;
  navlungoReturnCreatedAt: string | null;
  returnProviderSnapshot?: Record<string, unknown> | null;
  returnCarrierName: string | null;
  returnTrackingNumber: string | null;
  returnTrackingUrl: string | null;
  vendorReceivedAt: string | null;
  vendorReviewedAt: string | null;
  vendorDecision: 'approved' | 'rejected' | null;
  vendorDecisionReason: string | null;
  refundAmount: string;
  refundedItemCount: number;
  refundedSkus: string[];
  itemTitle: string | null;
  displayTitle: string | null;
  variantTitle: string | null;
  refundedItems: RefundedItemDto[];
  createdAt: string;
  updatedAt: string;
};

export type DashboardReturnSummaryDto = {
  id: string;
  status: string;
  sourceShopifyRefundId: string | null;
  createdAt: string;
};

export type RefundedItemDto = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  itemTitle?: string | null;
  displayTitle?: string | null;
  orderLineItemTitle?: string | null;
  variantTitle?: string | null;
  imageUrl?: string | null;
  quantity: number;
  refundAmount: string;
};

export type ReturnSettlementAdjustmentDto = {
  id: string;
  status: 'pending' | 'applied' | 'blocked' | 'cancelled';
  amountMinor: number;
  currencyCode: string;
  reason: string;
  originalSettlementApprovalId: string | null;
  originalSettlementApprovalLineId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  appliedSettlementApprovalId: string | null;
  appliedSettlementApprovalLineId: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReturnDetailDto = ReturnSummaryDto & {
  sourceShopifyInternalOrderId: string;
  originalVendorId: string;
  requestCreatedAt: string | null;
  requestUpdatedAt: string | null;
  returnProviderSnapshot: Record<string, unknown> | null;
  refundedItems: RefundedItemDto[];
  settlementRefundAdjustments: ReturnSettlementAdjustmentDto[];
};

export type KargonomiReturnPreviewDto = {
  ok: true;
  provider: 'KARGONOMI';
  mode: 'return_preview';
  returnId: string;
  ready: boolean;
  missingFields: string[];
  direction: 'CUSTOMER_TO_VENDOR';
  senderSource: 'CUSTOMER_ORDER_ADDRESS';
  receiverSource: 'VENDOR_KARGONOMI_WAREHOUSE';
  previewPayload: Record<string, unknown>;
  notes: string[];
};
