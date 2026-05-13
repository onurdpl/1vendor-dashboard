export type ReconciliationFieldChange = {
  scope: string;
  field: string;
  localValue: string | null;
  canonicalValue: string | null;
};

export type ReconciliationAllocationResult = {
  allocationId: string;
  vendorId: string;
  staleFields: ReconciliationFieldChange[];
  repairedFields: ReconciliationFieldChange[];
  skippedFields: ReconciliationFieldChange[];
  warnings: string[];
};

export type CanonicalShopifyReconciliationSummary = {
  source: 'mock' | 'shopify_admin';
  shopifyOrderId: string;
  orderName: string | null;
  displayFulfillmentStatus: string | null;
  fulfillmentCount: number;
  fulfillmentOrderCount: number;
  fulfilledLineItemIds: string[];
  cancelledLineItemIds: string[];
};

export type LocalReconciliationSummary = {
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  allocationCount: number;
  refundRecordCount: number;
  returnRecordCount: number;
};

export type OrderReconciliationResult = {
  reconciliationStatus: 'in_sync' | 'repaired' | 'needs_attention';
  staleFields: ReconciliationFieldChange[];
  repairedFields: ReconciliationFieldChange[];
  skippedFields: ReconciliationFieldChange[];
  canonicalShopifySummary: CanonicalShopifyReconciliationSummary;
  localStateSummary: LocalReconciliationSummary;
  affectedAllocations: ReconciliationAllocationResult[];
  affectedVendorIds: string[];
  warnings: string[];
  requiresManualReview: boolean;
};
