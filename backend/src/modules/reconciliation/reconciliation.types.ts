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

export type CanonicalRefundReconciliationItemResult = {
  refundId: string;
  status: 'created' | 'already_present' | 'repaired' | 'skipped' | 'failed';
  reason: string | null;
  affectedAllocationIds: string[];
  affectedVendorIds: string[];
  affectedRefundRecordIds: string[];
};

export type CanonicalRefundReconciliationReport = {
  shopifyOrderId: string;
  refundsFetched: number;
  refundsAlreadyPresent: number;
  refundsCreated: number;
  ledgersRepaired: number;
  eventsRepaired: number;
  skippedCount: number;
  failedCount: number;
  signalsCreatedOrUpdated: number;
  results: CanonicalRefundReconciliationItemResult[];
};

export type CanonicalReturnReconciliationItemResult = {
  returnId: string;
  status: 'created' | 'already_present' | 'repaired' | 'skipped' | 'failed';
  reason: string | null;
  affectedAllocationIds: string[];
  affectedVendorIds: string[];
  affectedReturnRecordIds: string[];
};

export type CanonicalReturnReconciliationReport = {
  shopifyOrderId: string;
  returnsFetched: number;
  returnsAlreadyPresent: number;
  returnsCreated: number;
  returnRecordsRepaired: number;
  skippedCount: number;
  failedCount: number;
  signalsCreatedOrUpdated: number;
  results: CanonicalReturnReconciliationItemResult[];
};

export type CanonicalOrderCancellationState =
  | 'none'
  | 'full_order_cancelled'
  | 'partial_line_cancelled'
  | 'unknown_requires_manual_review';

export type CanonicalOrderCancellationReconciliationItemResult = {
  status: 'reconciled' | 'already_current' | 'skipped' | 'failed';
  reason: string | null;
  vendorId: string | null;
  allocationId: string | null;
  financeLedgerEntryId: string | null;
};

export type CanonicalOrderCancellationReconciliationReport = {
  shopifyOrderId: string;
  cancellationState: CanonicalOrderCancellationState;
  affectedAllocations: string[];
  affectedLineItems: string[];
  ledgersHeldOrVoided: string[];
  skippedCount: number;
  failedCount: number;
  signalsCreatedOrUpdated: number;
  results: CanonicalOrderCancellationReconciliationItemResult[];
};
