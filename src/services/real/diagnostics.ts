import { apiClient } from '../../lib/api-client';

export type DiagnosticsWebhookSummary = {
  total: number;
  received: number;
  processed: number;
  failed: number;
  duplicates: number;
  needsAttention: number;
};

export type DiagnosticsOperationalJob = {
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

export type DiagnosticsWebhookEvent = {
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
  affectedEntities: DiagnosticsAffectedEntities;
  relatedJobs: DiagnosticsOperationalJob[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type DiagnosticsWebhookDetail = {
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
  affectedEntities: DiagnosticsAffectedEntities;
  relatedJobs: DiagnosticsOperationalJob[];
  receivedAt: string;
  processedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  relatedShopifyOrderId: string | null;
};

export type DiagnosticsAffectedEntities = {
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  shopifyReturnId: string | null;
  shopifyRefundId: string | null;
  shopifyFulfillmentId: string | null;
  vendorId: string | null;
};

export type DiagnosticsSyncEvent = {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'attention' | 'normal';
  title: string;
  description: string;
  relatedWebhookEventId: string | null;
  relatedShopifyOrderId: string | null;
  relatedAllocationId: string | null;
  status: string;
  createdAt: string;
};

export type DiagnosticsReconciliationSummary = {
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

export type DiagnosticsReconciliationItem = {
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
  severity: 'critical' | 'high' | 'warning' | 'attention' | 'normal';
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
  processingGeneration?: number | null;
  executionAttemptCount?: number | null;
  executionMaxAttempts?: number | null;
  processingLeaseExpiresAt?: string | null;
  leaseState?: 'ACTIVE' | 'EXPIRED' | 'LEGACY_NO_LEASE' | null;
  executorEnabled?: boolean | null;
  executionExhausted?: boolean | null;
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

type WebhooksResponseDto = {
  summary: DiagnosticsWebhookSummary;
  events: DiagnosticsWebhookEvent[];
};

type SyncEventsResponseDto = {
  items: DiagnosticsSyncEvent[];
};

type ReconciliationResponseDto = {
  summary: DiagnosticsReconciliationSummary;
  items: DiagnosticsReconciliationItem[];
};

export type CanonicalReconciliationRunReport = {
  id: string;
  mode: 'dry-run' | 'repair';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  lookbackDays: number;
  orderLimit: number;
  ordersScanned: number;
  repairOpportunities: number;
  wouldRepairOrders: number;
  wouldRepairFulfillment: number;
  wouldRepairRefunds: number;
  wouldRepairReturns: number;
  wouldRepairCancellations: number;
  wouldCreateSignals: number;
  wouldRepairLedgers: number;
  wouldRepairFinanceEvents: number;
  errors: Array<{ shopifyOrderId?: string; message: string }>;
  perOrderDetails: Array<{
    shopifyOrderId: string;
    status: 'scanned' | 'failed';
    wouldRepair: {
      order: number;
      fulfillment: number;
      refunds: number;
      returns: number;
      cancellations: number;
      signals: number;
      ledgers: number;
      financeEvents: number;
    };
    actions: string[];
    errors: string[];
  }>;
};

export type CanonicalReconciliationSummaryResponse = {
  lastRun: CanonicalReconciliationRunReport | null;
};

export type OrderReconciliationResult = {
  reconciliationStatus: 'in_sync' | 'repaired' | 'needs_attention';
  staleFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
  repairedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
  skippedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
  canonicalShopifySummary: {
    source: 'mock' | 'shopify_admin';
    shopifyOrderId: string;
    orderName: string | null;
    displayFulfillmentStatus: string | null;
    fulfillmentCount: number;
    fulfillmentOrderCount: number;
    fulfilledLineItemIds: string[];
    cancelledLineItemIds: string[];
  };
  localStateSummary: {
    shopifyOrderId: string;
    shopifyOrderNumber: string;
    allocationCount: number;
    refundRecordCount: number;
    returnRecordCount: number;
  };
  affectedAllocations: Array<{
    allocationId: string;
    vendorId: string;
    staleFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
    repairedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
    skippedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
    warnings: string[];
  }>;
  affectedVendorIds: string[];
  warnings: string[];
  requiresManualReview: boolean;
};

export type ReplayWebhookResponse = {
  ok: boolean;
  topic: string;
  webhookEventId?: string;
  action: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  replayStatus?: 'replayed' | 'failed' | 'not_replayable';
  recoveryStatus?: 'recovered' | 'failed' | 'not_recoverable';
  processingStatus: string;
  shopifyOrderId?: string;
  allocationCount?: number;
  refundAllocationCount?: number;
  refundClassification?: string;
  reasonCode?: string;
  affectedRecordCount?: number;
  affectedAllocationCount?: number;
  skippedReason?: string;
  errorSummary?: string | null;
  message?: string;
};

export type RecoverWebhookResponse = ReplayWebhookResponse & {
  recoveryStatus: 'recovered' | 'failed' | 'not_recoverable';
};

export type CurrentStateOrderRepairResult = {
  ok: boolean;
  orderIdentifier: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  repairSource: 'shopify_admin_current_state';
  repairTimestamp: string;
  dryRun: boolean;
  executed: boolean;
  summary: {
    shopifyOrder: 'Created' | 'Existing';
    allocation: 'Created' | 'Existing';
    finance: 'Created' | 'Existing';
    cancellationApplied: boolean;
    refundApplied: boolean;
    returnApplied: boolean;
    refundEvidence: {
      classification: 'MONETARY_REFUND' | 'ZERO_VALUE_VOID' | 'NON_FINAL_REFUND' | 'UNSUPPORTED_OR_AMBIGUOUS';
      monetaryRefundAmount: string;
      currency: string | null;
      totalTransactionCount: number;
      uniqueTransactionCount: number;
      successfulRefundTransactionCount: number;
      successfulVoidTransactionCount: number;
      nonFinalTransactionCount: number;
      duplicateTransactionCount: number;
      refundAggregateAmount: string | null;
      orderAggregateAmount: string | null;
      transactionPaginationComplete: boolean;
      lineItemPaginationComplete: boolean;
      refundsListComplete: boolean;
      aggregateMismatch: boolean;
      currencyMismatch: boolean;
      incompletePagination: boolean;
      reasonCode: string;
      sanitizedWarnings: string[];
    } | null;
    executionBlocked: boolean;
    executionBlockedReason?: 'active_shopify_order_intake' | null;
    warnings: string[];
    skipped: boolean;
  };
};

export type RetryOperationalJobResponse = {
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

export type KargonomiLocationLookupDiagnostics = {
  temporary: true;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  baseUrlParseError: string | null;
  tokenPresent: boolean;
  statesRequestUrl: string;
  statesHttpStatus: number | null;
  statesFetchError: { name: string; message: string; cause: { name: string; message: string } | string | null } | null;
  statesContentType: string | null;
  statesShapeSummary: { kind: string; itemCount?: number; topLevelKeys: string[] } | null;
  firstStateNames: string[];
  istanbulStateId: string | null;
  citiesRequestUrl: string | null;
  citiesHttpStatus: number | null;
  citiesFetchError: { name: string; message: string; cause: { name: string; message: string } | string | null } | null;
  citiesContentType: string | null;
  citiesShapeSummary: { kind: string; itemCount?: number; topLevelKeys: string[] } | null;
  firstCityNames: string[];
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
    financeReviewRequired: boolean;
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
    repairClassification: string;
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

export type NavlungoAuthDiagnostics = {
  provider: 'navlungo';
  displayName: 'Navlungo';
  dormant: true;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  baseUrlParseError: string | null;
  usernamePresent: boolean;
  passwordPresent: boolean;
  authRequestUrl: string | null;
  authHttpStatus: number | null;
  authContentType: string | null;
  responseShapeSummary: { kind: string; topLevelKeys: string[] } | null;
  responseDataShapeSummary: { kind: string; topLevelKeys: string[] } | null;
  tokenKeyPresence: {
    rootAccessToken: boolean;
    dataAccessToken: boolean;
    dataToken: boolean;
    anyTokenLikeKey: boolean;
  };
  refreshTokenKeyPresence: {
    rootRefreshToken: boolean;
    dataRefreshToken: boolean;
  };
  expiresInPresent: boolean;
  tokenTypePresent: boolean;
  tokenReceived: boolean;
  refreshTokenReceived: boolean;
  expiresIn: number | string | null;
  authValidationErrorKeys: string[];
  authValidationErrorMessages: string[];
  authFailedFieldNames: string[];
  fetchError: { name: string; message: string; cause: { name: string; message: string } | string | null } | null;
};

export type NavlungoCreatePostProbeDiagnostics = {
  provider: 'navlungo';
  dormant: true;
  authHttpStatus: number | null;
  authContentType: string | null;
  authTokenReceived: boolean;
  requestedCarrierId: number;
  requestedPostType: number;
  requestedBarcodeFormat: string;
  codPaymentIncluded: boolean;
  priceIncluded: boolean;
  requestSummary: NavlungoCreatePostRequestSummary;
  createPostHttpStatus: number | null;
  createPostContentType: string | null;
  responseShape: { kind: string; topLevelKeys: string[] } | null;
  dataShape: { kind: string; topLevelKeys: string[] } | null;
  topLevelKeys: string[];
  dataKeys: string[];
  postNumber: string | null;
  postNumberPresent: boolean;
  referenceId: string | null;
  referenceIdPresent: boolean;
  trackingUrlPresent: boolean;
  barcodeUrlPresent: boolean;
  barcodePresent: boolean;
  barcodeType: string | null;
  carrierIdPresent: boolean;
  carrierId: string | number | null;
  carrierNamePresent: boolean;
  carrierName: string | null;
  postCarrierKeys: string[];
  providerMessage: string | null;
  errorMessage: string | null;
};

export type NavlungoCreatePostRequestSummary = {
  baseUrl: string | null;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  endpointPath: string;
  method: string;
  headerKeys: string[];
  topLevelBodyKeys: string[];
  postKeys: string[];
  senderKeys: string[];
  recipientKeys: string[];
  postPayloadKeys: string[];
  barcodeFormatPresent: boolean;
  barcodeFormatType: string | null;
  codPaymentTypePresent: boolean;
  codPaymentType: string | null;
  postPricePresent: boolean;
  postPriceType: string | null;
  requestedCarrierId: number | string | null;
  requestedPostType: number | string | null;
  senderUsesAddressId: boolean;
  senderFullObjectKeysPresent: boolean;
  customData1Present: boolean;
  customData2Present: boolean;
  customData3Present: boolean;
  customData4Present: boolean;
  recipientDistrictPresent: boolean;
  recipientCityPresent: boolean;
  recipientCountryPresent: boolean;
  recipientPostCodePresent: boolean;
  recipientPhonePresent: boolean;
  recipientPhoneFormatValid: boolean;
  recipientEmailPresent: boolean;
  recipientEmailFormatValid: boolean;
  recipientAddressPresent: boolean;
  recipientAddressLength: number;
  packageCountPresent: boolean;
  packageCountType: string | null;
  requestedPackageCount: number | string | null;
  desiPresent: boolean;
  desiType: string | null;
  requestedDesi: number | string | null;
  postNotePresent: boolean;
  postNoteType: string | null;
  postNoteLength: number;
};

export type NavlungoCheckPostProbeDiagnostics = {
  provider: 'navlungo';
  dormant: true;
  postNumber: string;
  authHttpStatus: number | null;
  authContentType: string | null;
  authTokenReceived: boolean;
  checkPostHttpStatus: number | null;
  checkPostContentType: string | null;
  responseShape: { kind: string; topLevelKeys: string[] } | null;
  dataShape: { kind: string; topLevelKeys: string[] } | null;
  dataKeys: string[];
  statusKeys: string[];
  postNumberPresent: boolean;
  trackingUrlPresent: boolean;
  carrierTrackingUrlPresent: boolean;
  barcodePresent: boolean;
  barcodeType: string | null;
  carrierIdPresent: boolean;
  carrierNamePresent: boolean;
  statusCode: string | number | null;
  statusName: string | null;
  providerMessage: string | null;
  errorMessage: string | null;
};

export type NavlungoBarcodeProbeDiagnostics = {
  provider: 'navlungo';
  dormant: true;
  postNumber: string;
  barcodeEndpointPathKnown: boolean;
  skippedReason: 'barcode_endpoint_path_unknown';
  barcodeHttpStatus: number | null;
  barcodeContentType: string | null;
  responseShape: { kind: string; topLevelKeys: string[] } | null;
  barcodeFieldPresent: boolean;
  barcodeUrlPresent: boolean;
  barcodeBase64Present: boolean;
  providerMessage: string | null;
  errorMessage: string | null;
};

export type NavlungoCarrierDiagnostics = {
  provider: 'navlungo';
  displayName: 'Navlungo';
  dormant: true;
  authHttpStatus: number | null;
  authContentType: string | null;
  authTokenReceived: boolean;
  carrierEndpointPathsKnown: boolean;
  skippedReason: string | null;
  myCarriersRequestUrl: string | null;
  myCarriersHttpStatus: number | null;
  myCarriersContentType: string | null;
  myCarriersResponseShape: { kind: string; topLevelKeys: string[] } | null;
  myCarriersDataShape: { kind: string; topLevelKeys: string[] } | null;
  myCarrierCount: number | null;
  myCarrierSamples: Array<{ id: string | number | null; name: string | null; shortName: string | null; activeOrConfigured: boolean | null }>;
  listCarriersRequestUrl: string | null;
  listCarriersHttpStatus: number | null;
  listCarriersContentType: string | null;
  listCarriersResponseShape: { kind: string; topLevelKeys: string[] } | null;
  listCarriersDataShape: { kind: string; topLevelKeys: string[] } | null;
  listCarrierCount: number | null;
  listCarrierSamples: Array<{ id: string | number | null; name: string | null; shortName: string | null; activeOrConfigured: boolean | null }>;
  anyConfiguredCarrier: boolean;
  providerMessages: string[];
  fetchError: { name: string; message: string; cause: { name: string; message: string } | string | null } | null;
};

export async function listWebhookDiagnostics(options: { limit?: number; offset?: number; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  return apiClient.get<WebhooksResponseDto>(`/admin/diagnostics/webhooks${params.size ? `?${params.toString()}` : ''}`, {
    signal: options.signal,
  });
}

export async function getWebhookDiagnostic(webhookEventId: string, options: { signal?: AbortSignal } = {}) {
  return apiClient.get<DiagnosticsWebhookDetail>(`/admin/diagnostics/webhooks/${webhookEventId}`, { signal: options.signal });
}

export async function inspectOrderState(orderNumber: string, options: { signal?: AbortSignal } = {}) {
  return apiClient.get<OrderStateInspectorDiagnostic>(
    `/admin/diagnostics/orders/${encodeURIComponent(orderNumber.trim())}/state`,
    { signal: options.signal },
  );
}

export async function repairMissingShopifyOrder(orderIdentifier: string, execute = false) {
  return apiClient.post<CurrentStateOrderRepairResult>('/admin/diagnostics/shopify/order-repair', {
    orderIdentifier: orderIdentifier.trim(),
    execute,
  });
}

export async function listSyncEvents(options: { signal?: AbortSignal } = {}) {
  return apiClient.get<SyncEventsResponseDto>('/admin/diagnostics/sync-events', { signal: options.signal });
}

export async function getReconciliationDiagnostics(options: { signal?: AbortSignal; headers?: HeadersInit } = {}) {
  return apiClient.get<ReconciliationResponseDto>('/admin/diagnostics/reconciliation', { signal: options.signal, headers: options.headers });
}

export async function runKargonomiLocationLookupDiagnostics() {
  return apiClient.get<KargonomiLocationLookupDiagnostics>('/admin/diagnostics/kargonomi/location-lookup');
}

export async function runNavlungoAuthDiagnostics() {
  return apiClient.get<NavlungoAuthDiagnostics>('/admin/diagnostics/navlungo/auth');
}

export async function runNavlungoCarrierDiagnostics() {
  return apiClient.get<NavlungoCarrierDiagnostics>('/admin/diagnostics/navlungo/carriers');
}

export async function runNavlungoCreatePostProbe(confirm: 'YES') {
  return apiClient.post<NavlungoCreatePostProbeDiagnostics>('/admin/diagnostics/navlungo/create-post-probe', { confirm });
}

export async function runNavlungoCheckPostProbe(postNumber: string) {
  return apiClient.post<NavlungoCheckPostProbeDiagnostics>('/admin/diagnostics/navlungo/check-post', { postNumber });
}

export async function runNavlungoBarcodeProbe(postNumber: string) {
  return apiClient.post<NavlungoBarcodeProbeDiagnostics>('/admin/diagnostics/navlungo/barcode', { postNumber });
}

export async function replayWebhook(webhookEventId: string) {
  return apiClient.post<ReplayWebhookResponse>(`/admin/diagnostics/webhooks/${webhookEventId}/replay`);
}

export async function recoverWebhook(webhookEventId: string) {
  return apiClient.post<RecoverWebhookResponse>(`/admin/diagnostics/webhooks/${webhookEventId}/recover`);
}

export async function retryOperationalJob(operationalJobId: string) {
  return apiClient.post<RetryOperationalJobResponse>(`/admin/diagnostics/jobs/${operationalJobId}/retry`);
}

export async function reconcileAllocation(allocationId: string) {
  return apiClient.post<OrderReconciliationResult>(`/admin/reconciliation/orders/${allocationId}`);
}

export async function reconcileShopifyOrder(shopifyOrderId: string) {
  return apiClient.post<OrderReconciliationResult>(`/admin/reconciliation/shopify-order/${shopifyOrderId}`);
}

export async function canonicalReconciliationSummary(options: { signal?: AbortSignal } = {}) {
  return apiClient.get<CanonicalReconciliationSummaryResponse>('/admin/reconciliation/canonical/summary', { signal: options.signal });
}
