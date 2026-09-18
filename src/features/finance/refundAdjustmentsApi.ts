import { apiClient } from '../../lib/api-client';

export type RefundAdjustmentStatus = 'pending' | 'partially_applied' | 'applied' | 'blocked' | 'cancelled';

export type RefundAdjustmentApplication = {
  id: string;
  settlementApprovalId: string;
  settlementApprovalLineId: string;
  amountMinor: number;
  currencyCode: string;
  status: 'active' | 'cancelled';
  createdAt: string;
  updatedAt: string;
};

export type RefundAdjustmentEvent = {
  id: string;
  eventType: 'created' | 'partially_applied' | 'applied' | 'application_cancelled' | 'adjustment_cancelled';
  createdAt: string;
  metadataJson?: unknown;
};

export type RefundAdjustmentRecord = {
  id: string;
  refundRecordId: string;
  refundFinanceLedgerEntryId: string;
  vendorId: string;
  originalOrderId: string;
  originalSettlementApprovalId: string | null;
  originalSettlementApprovalLineId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  status: RefundAdjustmentStatus;
  amountMinor: number;
  originalAmountMinor: number;
  appliedAmountMinor: number;
  remainingAmountMinor: number;
  currencyCode: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  appliedSettlementApprovalId: string | null;
  appliedSettlementApprovalLineId: string | null;
  blockedReason: string | null;
  createdBy: string | null;
  applications: RefundAdjustmentApplication[];
  events: RefundAdjustmentEvent[];
  references?: {
    orderLabel: string;
    refundLabel: string;
    originalSettlementLabel: string | null;
    originalCommissionInvoiceLabel: string | null;
  };
};

export type RefundAdjustmentsListResponse = {
  ok: true;
  writesPerformed: false;
  count: number;
  statuses: Partial<Record<RefundAdjustmentStatus, number>>;
  records: RefundAdjustmentRecord[];
};

export function listRefundAdjustments(input: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams();
  if (input.vendorId?.trim()) {
    params.set('vendorId', input.vendorId.trim());
  }
  const query = params.toString();
  return apiClient.get<RefundAdjustmentsListResponse>(
    `/admin/finance/refund-adjustments${query ? `?${query}` : ''}`,
    { signal: input.signal },
  );
}

export type TerminalRefundReview = {
  type: 'terminal_conflict';
  id: string;
  status: string;
  sourceShopifyRefundId: string;
  sourceShopifyOrderId: string;
  vendorAllocationId: string;
  economicVendorId: string;
  vendorName: string | null;
  terminalRefundFinanceLedgerEntryId: string;
  storedEvidenceSnapshotId: string | null;
  conflictCategory: string;
  storedEvidenceHash: string | null;
  incomingEvidenceHash: string | null;
  occurrenceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  acceptedRecordedAmount: string;
  acceptedRecordedCurrency: string | null;
};

export type LegacyRefundFinanceCandidate = {
  type: 'legacy_refund_finance';
  id: string;
  artifactType: 'refund_ledger' | 'settlement_refund_adjustment' | 'vendor_debt_event' | 'finance_event';
  artifactId: string;
  attribution: 'exact' | 'ambiguous';
  sourceShopifyOrderId: string | null;
  sourceShopifyRefundId: string | null;
  vendorAllocationId: string | null;
  economicVendorId: string;
  vendorName: string | null;
  recordedAmount: string | null;
  recordedAmountMinor: number | null;
  recordedCurrency: string | null;
  observedAt: string;
  state: string | null;
  voidedAt: string | null;
  supersededByLedgerId: string | null;
  reason: string;
};

type ReviewPage<T> = { error: string | null; count: number; limit: number; offset: number; items: T[] };

export type AdminRefundReviewsResponse = {
  ok: true;
  writesPerformed: false;
  terminalReviews: ReviewPage<TerminalRefundReview>;
  legacyCandidates: ReviewPage<LegacyRefundFinanceCandidate>;
};

export function listAdminRefundReviews(input: {
  vendorId?: string | null;
  terminalLimit?: number;
  terminalOffset?: number;
  legacyLimit?: number;
  legacyOffset?: number;
  signal?: AbortSignal;
} = {}) {
  const params = new URLSearchParams();
  if (input.vendorId?.trim()) params.set('vendorId', input.vendorId.trim());
  params.set('terminalLimit', String(input.terminalLimit ?? 25));
  params.set('terminalOffset', String(input.terminalOffset ?? 0));
  params.set('legacyLimit', String(input.legacyLimit ?? 25));
  params.set('legacyOffset', String(input.legacyOffset ?? 0));
  return apiClient.get<AdminRefundReviewsResponse>(`/admin/finance/refund-reviews?${params}`, { signal: input.signal });
}
