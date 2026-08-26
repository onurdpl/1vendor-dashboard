export type AdminWebhookDiagnosticsSummary = {
  total: number;
  received: number;
  processed: number;
  failed: number;
  duplicates: number;
  needsAttention: number;
};

export type OperationalJobDiagnostic = {
  id: string;
  jobType: string;
  status: string;
  payloadRef: string | null;
  webhookEventId: string | null;
  sourceShopifyOrderId: string | null;
  vendorAllocationId: string | null;
  refundRecordId: string | null;
  returnRecordId: string | null;
  priority: number;
  retryCount: number;
  maxRetries: number;
  scheduledAt: string;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  retryBackoffMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorSummary: string | null;
  failureCategory: string | null;
  escalationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminWebhookDiagnosticsEvent = {
  id: string;
  topic: string;
  shopDomain: string;
  shopifyWebhookId: string | null;
  eventId: string | null;
  idempotencyKey: string | null;
  payloadHash: string | null;
  status: string;
  processingStatus: string;
  receivedAt: string;
  processedAt: string | null;
  errorMessage: string | null;
  lastErrorSummary: string | null;
  duplicate: boolean;
  payloadAvailable: boolean;
  replayEligible: boolean;
  replayBlockedReason: string | null;
  recoverEligible: boolean;
  recoverBlockedReason: string | null;
  recommendedAction: string;
  affectedEntities: WebhookAffectedEntities;
  relatedJobs: OperationalJobDiagnostic[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminWebhookDiagnosticsResponse = {
  summary: AdminWebhookDiagnosticsSummary;
  events: AdminWebhookDiagnosticsEvent[];
};

export type AdminWebhookDiagnosticDetail = {
  id: string;
  topic: string;
  shopDomain: string;
  shopifyWebhookId: string | null;
  eventId: string | null;
  idempotencyKey: string | null;
  payloadHash: string | null;
  payloadPreview: string | null;
  payloadPreviewTruncated: boolean;
  payloadAvailable: boolean;
  status: string;
  processingStatus: string;
  errorMessage: string | null;
  lastErrorSummary: string | null;
  replayEligible: boolean;
  replayBlockedReason: string | null;
  recoverEligible: boolean;
  recoverBlockedReason: string | null;
  recommendedAction: string;
  affectedEntities: WebhookAffectedEntities;
  relatedJobs: OperationalJobDiagnostic[];
  receivedAt: string;
  processedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  relatedShopifyOrderId: string | null;
};

export type WebhookAffectedEntities = {
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  shopifyReturnId: string | null;
  shopifyRefundId: string | null;
  shopifyFulfillmentId: string | null;
  vendorId: string | null;
};

export type SyncDiagnosticSeverity = 'critical' | 'high' | 'warning' | 'attention' | 'normal';

export type SyncDiagnosticItem = {
  id: string;
  type: string;
  severity: SyncDiagnosticSeverity;
  title: string;
  description: string;
  relatedWebhookEventId: string | null;
  relatedShopifyOrderId: string | null;
  relatedAllocationId: string | null;
  status: string;
  createdAt: string;
};

export type SyncDiagnosticsResponse = {
  items: SyncDiagnosticItem[];
};

export type WebhookReplayResponse = {
  ok: boolean;
  topic: string;
  webhookEventId?: string;
  action: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  replayStatus?: 'replayed' | 'failed' | 'not_replayable';
  recoveryStatus?: 'recovered' | 'failed' | 'not_recoverable';
  processingStatus: string;
  affectedRecordCount?: number;
  shopifyOrderId?: string;
  allocationCount?: number;
  refundAllocationCount?: number;
  refundClassification?: string;
  reasonCode?: string;
  affectedAllocationCount?: number;
  skippedReason?: string;
  errorSummary?: string | null;
  message?: string;
};

export type WebhookRecoverResponse = WebhookReplayResponse & {
  recoveryStatus: 'recovered' | 'failed' | 'not_recoverable';
};

export type OperationalJobRetryResponse = {
  ok: boolean;
  operationalJobId?: string;
  webhookEventId?: string | null;
  jobStatus?: string | null;
  retryStatus: 'retried' | 'failed' | 'not_retryable';
  processingStatus: string;
  skippedReason?: string;
  errorSummary?: string | null;
  message?: string;
};

export type ReconciliationSummary = {
  stuckReceived: number;
  processingReviewRequiredCount: number;
  failedWebhooks: number;
  fulfillmentSyncFailures: number;
  missingPayload: number;
  staleAllocations: number;
  scheduledReconciliationJobs: number;
  missingShopifyOrders: number;
  total: number;
};

export type ReconciliationItem = {
  id: string;
  type:
    | 'stuck_webhook'
    | 'failed_webhook'
    | 'fulfillment_sync_failed'
    | 'missing_payload'
    | 'stale_allocation'
    | 'scheduled_reconciliation'
    | 'processing_review_required'
    | 'shopify_order_missing_local';
  severity: SyncDiagnosticSeverity;
  title: string;
  description: string;
  relatedWebhookEventId: string | null;
  relatedShopifyOrderId: string | null;
  relatedAllocationId: string | null;
  status: string;
  createdAt: string;
  suggestedAction: string;
  payloadAvailable: boolean | null;
  operationalJobId?: string | null;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  reconciliationReason?: string | null;
  relatedShopifyOrderNumber?: string | null;
  shopifyCreatedAt?: string | null;
  firstDetectedAt?: string | null;
  signalId?: string | null;
  webhookEventId?: string | null;
  shopifyWebhookId?: string | null;
  receivedAt?: string | null;
  receivedAgeMs?: number | null;
  latestJobStatus?: string | null;
  latestJobId?: string | null;
  latestJobStartedAt?: string | null;
  latestJobLastAttemptAt?: string | null;
  latestJobUpdatedAt?: string | null;
  latestJobRetryCount?: number | null;
  currentJobSuppressesMissedOrderDiscovery?: boolean | null;
  localCommerceClassification?:
    | 'LOCAL_ORDER_ABSENT'
    | 'LOCAL_ORDER_EXISTS'
    | 'LOCAL_ORDER_EXISTS_WITH_ALLOCATIONS'
    | 'LOCAL_ORDER_EXISTS_WITH_FINANCE'
    | 'AMBIGUOUS_QUERY_FAILED'
    | null;
  localOrderExists?: boolean | null;
  allocationCount?: number | null;
  saleLedgerCount?: number | null;
};

export type ReconciliationResponse = {
  summary: ReconciliationSummary;
  items: ReconciliationItem[];
};

export type ReturnVisibilityDiagnostic = {
  query: string;
  localOrder: {
    found: boolean;
    id: string | null;
    sourceShopifyOrderId: string | null;
    sourceShopifyOrderNumber: string | null;
    allocationCount: number;
  };
  allocations: Array<{
    id: string;
    vendorId: string;
    originalVendorId: string;
    assignedVendorId: string;
    lineItems: Array<{
      sourceLineItemId: string;
      sku: string | null;
      title: string | null;
      quantity: number;
    }>;
  }>;
  returnRecords: Array<{
    id: string;
    vendorAllocationId: string;
    vendorId: string;
    sourceShopifyReturnId: string | null;
    sourceShopifyReturnGid: string | null;
    sourceShopifyLineItemId: string | null;
    status: string;
    returnRequestSource: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  webhookEvents: Array<{
    id: string;
    topic: string;
    status: string;
    receivedAt: string;
    processedAt: string | null;
    errorSummary: string | null;
    shopifyReturnId: string | null;
    payloadOrderHint: string | null;
    payloadAvailable: boolean;
  }>;
  financeLedger: Array<{
    id: string;
    vendorId: string;
    vendorAllocationId: string | null;
    entryType: string;
    amount: string;
    payoutStatus: string;
  }>;
  findings: {
    localAllocationFound: boolean;
    returnsRequestWebhookFound: boolean;
    failedReturnsRequestWebhookFound: boolean;
    returnRecordFound: boolean;
    refundLedgerFound: boolean;
    mappingIssueLikely: boolean;
    productionRepairNeeded: boolean;
  };
};

export type OrderStateInspectorDiagnostic = {
  orderIdentity: {
    localOrderId: string;
    shopifyOrderId: string;
    orderNumber: string;
    createdAt: string;
    updatedAt: string;
    shopifyCreatedAt: string | null;
    vendors: Array<{ vendorId: string; vendorName: string }>;
  };
  shopifyState: {
    source: 'persisted_local_truth';
    financialStatus: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    currency: string | null;
    lineItemCount: number;
    mappedLineItemCount: number;
    unmappedLineItemCount: number;
    vendorMapping: Array<{ vendorId: string; lineItemCount: number }>;
  };
  localOrderState: {
    exists: true;
    allocationCount: number;
    isCancelled: boolean;
    hasOperationalConflict: boolean;
  };
  allocations: Array<{
    allocationId: string;
    originalVendor: { vendorId: string; vendorName: string };
    assignedVendor: { vendorId: string; vendorName: string };
    allocationStatus: string;
    fulfillmentStatus: string;
    shippingStatus: string;
    cancellationReason: string | null;
    trackingPresent: boolean;
    carrierPresent: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  shippingState: Array<{
    allocationId: string;
    shipmentRecordCount: number;
    labelExists: boolean;
    trackingPresent: boolean;
    carrier: string | null;
    providerStatuses: Array<{ provider: string; status: string; createdAt: string; updatedAt: string }>;
    eligibility: {
      eligibleFromPersistedOrderState: boolean;
      blockedReason: string | null;
      scope: 'persisted_order_state_only';
    };
  }>;
  returnRefundState: {
    returnRequests: Array<{
      id: string;
      allocationId: string;
      vendorId: string | null;
      sourceType: 'shopify_return_request';
      sourceShopifyReturnId: string | null;
      status: string;
      requestedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    refundDerivedReturns: Array<{
      id: string;
      allocationId: string;
      vendorId: string | null;
      sourceType: 'shopify_refund_derived';
      sourceShopifyRefundId: string | null;
      status: string;
      requestedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    refundRecords: Array<{
      id: string;
      allocationId: string;
      sourceShopifyRefundId: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  financeState: {
    ledgerCount: number;
    saleLedgerCount: number;
    ledgers: Array<{
      id: string;
      allocationId: string | null;
      vendorId: string;
      entryType: string;
      payoutStatus: string;
      settlementStatus: string;
      voidedAt: string | null;
      voidReason: string | null;
      approvedSettlementPresent: boolean;
      payoutBatchPresent: boolean;
      paidEvidencePresent: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    financeReviewRequired: boolean;
    events: Array<{
      id: string;
      vendorId: string;
      ledgerEntryId: string | null;
      eventType: string;
      amountMinor: number;
      currency: string;
      createdAt: string;
    }>;
  };
  operationalSignals: Array<{
    id: string;
    allocationId: string | null;
    financeLedgerEntryId: string | null;
    type: string;
    severity: string;
    status: string;
    sourceArea: string;
    title: string;
    description: string;
    suggestedAction: string | null;
    triggeredAt: string;
    resolvedAt: string | null;
    metadata: Record<string, string | number | boolean | null>;
  }>;
  webhookHistory: Array<{
    webhookEventId: string;
    topic: string;
    status: string;
    receivedAt: string;
    processedAt: string | null;
    errorMessage: string | null;
    shopifyOrderId: string | null;
    shopifyOrderNumber: string | null;
    webhookId: string | null;
    payloadAvailable: boolean;
  }>;
  repairHistory: Array<{
    jobId: string;
    repairSource: string;
    repairTimestamp: string;
    dryRun: boolean;
    executed: boolean;
    status: string;
    actorUserId: string | null;
    actorEmail: string | null;
    errorSummary: string | null;
  }>;
  projectionExplanation: {
    orderStatus: { label: string; reasons: string[] };
    fulfillment: { label: string; reasons: string[] };
    shipment: { label: string; reasons: string[] };
    tracking: { label: string; reasons: string[] };
    finance: { label: string; reasons: string[] };
    cancellationConflict: { active: boolean; reasons: string[] };
    operationalEvidence: Array<{ type: string; source: string; recordCount: number }>;
    queueState: { included: boolean; reasons: string[] };
    actions: Array<{ action: string; available: boolean; blockedReason: string | null }>;
  };
  currentStateSummary: string;
  repairReadiness: {
    repairNeeded: boolean;
    repairSupported: boolean;
    repairClassification:
      | 'no_repair_needed'
      | 'current_state_repair_required'
      | 'cancellation_conflict_review_required'
      | 'finance_review_required'
      | 'unsupported_state'
      | 'unknown';
    blockers: string[];
    recommendedNextStep: string;
  };
  limits: {
    webhookHistory: number;
    operationalSignals: number;
    financeEvents: number;
    repairHistory: number;
  };
};
