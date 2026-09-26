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
  status: TerminalRefundReviewStatus;
  resolutionOutcome: TerminalRefundReviewResolutionOutcome | null;
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
  createdAt: string;
  updatedAt: string;
  acceptedRecordedAmount: string;
  acceptedRecordedCurrency: string | null;
};

export type TerminalRefundReviewStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
export type TerminalRefundReviewResolutionOutcome =
  | 'NO_CORRECTION_NEEDED'
  | 'CORRECTION_REQUIRED'
  | 'INSUFFICIENT_EVIDENCE';

export type TerminalRefundReviewEvent = {
  id: string;
  eventType: 'DETECTED' | 'ACKNOWLEDGED' | 'RESOLVED' | 'REOPENED';
  actorUserId: string | null;
  actorName: string | null;
  note: string | null;
  resolutionOutcome: TerminalRefundReviewResolutionOutcome | null;
  createdAt: string;
};

export type TerminalRefundReviewDetail = TerminalRefundReview & {
  evidenceVersion: string | null;
  normalizationVersion: string | null;
  conflictSummary: unknown;
  events: TerminalRefundReviewEvent[];
};

export type LegacyRefundFinanceCandidate = {
  type: 'legacy_refund_finance';
  id: string;
  status: LegacyRefundReviewStatus;
  resolutionOutcome: LegacyRefundReviewResolutionOutcome | null;
  attribution: 'exact' | 'ambiguous';
  sourceShopifyOrderId: string | null;
  sourceShopifyRefundId: string | null;
  vendorAllocationId: string | null;
  observedVendorId: string | null;
  vendorName: string | null;
  sourceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  occurrenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LegacyRefundReviewStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
export type LegacyRefundReviewResolutionOutcome = TerminalRefundReviewResolutionOutcome;
export type LegacyRefundReviewSource = {
  id: string; artifactType: string; artifactId: string; observedAt: string; sourceState: string | null;
  recordedAmount: string | null; recordedAmountMinor: number | null; currency: string | null;
  voidedAt: string | null; supersededByLedgerId: string | null;
};
export type LegacyRefundReviewEvent = TerminalRefundReviewEvent;
export type LegacyRefundReviewDetail = Omit<LegacyRefundFinanceCandidate, 'type' | 'sourceCount'> & {
  sources: LegacyRefundReviewSource[];
  events: LegacyRefundReviewEvent[];
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
  terminalStatus?: TerminalRefundReviewStatus | null;
  terminalResolutionOutcome?: TerminalRefundReviewResolutionOutcome | null;
  legacyStatus?: LegacyRefundReviewStatus | null;
  legacyResolutionOutcome?: LegacyRefundReviewResolutionOutcome | null;
  legacyAttribution?: 'EXACT' | 'AMBIGUOUS' | null;
  legacyArtifactType?: 'REFUND_LEDGER' | 'SETTLEMENT_REFUND_ADJUSTMENT' | 'VENDOR_DEBT_EVENT' | 'FINANCE_EVENT' | null;
  signal?: AbortSignal;
} = {}) {
  const params = new URLSearchParams();
  if (input.vendorId?.trim()) params.set('vendorId', input.vendorId.trim());
  params.set('terminalLimit', String(input.terminalLimit ?? 25));
  params.set('terminalOffset', String(input.terminalOffset ?? 0));
  params.set('legacyLimit', String(input.legacyLimit ?? 25));
  params.set('legacyOffset', String(input.legacyOffset ?? 0));
  if (input.terminalStatus) params.set('terminalStatus', input.terminalStatus);
  if (input.terminalResolutionOutcome) params.set('terminalResolutionOutcome', input.terminalResolutionOutcome);
  if (input.legacyStatus) params.set('legacyStatus', input.legacyStatus);
  if (input.legacyResolutionOutcome) params.set('legacyResolutionOutcome', input.legacyResolutionOutcome);
  if (input.legacyAttribution) params.set('legacyAttribution', input.legacyAttribution);
  if (input.legacyArtifactType) params.set('legacyArtifactType', input.legacyArtifactType);
  return apiClient.get<AdminRefundReviewsResponse>(`/admin/finance/refund-reviews?${params}`, { signal: input.signal });
}

export function getAdminRefundReview(reviewId: string, signal?: AbortSignal) {
  return apiClient.get<{ ok: true; review: TerminalRefundReviewDetail }>(
    `/admin/finance/refund-reviews/${encodeURIComponent(reviewId)}`,
    { signal },
  );
}

export type FinancialCorrectionPreviewState = {
  refundAmountMinor: number;
  commissionReversalMinor: number;
  commissionVatReversalMinor: number;
  vendorPayableReversalMinor: number;
};

export type AdminFinancialCorrectionPreview = {
  previewFingerprint: string;
  reviewId: string;
  sourceShopifyRefundId: string;
  sourceShopifyOrderId: string;
  vendorAllocationId: string;
  vendorId: string;
  historicalSaleFinanceLedgerEntryId: string;
  acceptedRefundFinanceLedgerEntryId: string;
  currency: 'TRY';
  acceptedEvidence: { id: string; hash: string; version: number; normalizationVersion: number };
  incomingEvidence: { id: string; hash: string; version: number; normalizationVersion: number };
  commissionPercent: string;
  commissionVatPercent: string;
  accepted: FinancialCorrectionPreviewState;
  corrected: FinancialCorrectionPreviewState;
  difference: FinancialCorrectionPreviewState;
  economicDirection: 'VENDOR_DEDUCTION' | 'VENDOR_CREDIT' | 'NONE';
};

export function getAdminFinancialCorrectionPreview(reviewId: string, signal?: AbortSignal) {
  return apiClient.get<{ ok: true; writesPerformed: false; preview: AdminFinancialCorrectionPreview }>(
    `/admin/finance/refund-reviews/${encodeURIComponent(reviewId)}/financial-correction-preview`,
    { signal },
  );
}

export type ZeroNetReconciliationAcknowledgement = {
  id: string;
  reviewId: string;
  resolvedReviewEventId: string;
  acceptedEvidenceSnapshotId: string;
  incomingConflictEvidenceId: string;
  previewFingerprint: string;
  economicDirection: 'NONE';
  vendorPayableDifferenceMinor: 0;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
  note: string | null;
};

const zeroNetPath = (reviewId: string) =>
  `/admin/finance/refund-reviews/${encodeURIComponent(reviewId)}/financial-correction-zero-net-acknowledgement`;

export function getZeroNetReconciliationAcknowledgement(reviewId: string, signal?: AbortSignal) {
  return apiClient.get<{ ok: true; writesPerformed: false; acknowledgement: ZeroNetReconciliationAcknowledgement | null }>(
    zeroNetPath(reviewId), { signal },
  );
}

export function acknowledgeZeroNetReconciliation(reviewId: string, input: { previewFingerprint: string; note?: string | null }) {
  return apiClient.post<{ ok: true; acknowledgement: ZeroNetReconciliationAcknowledgement }>(zeroNetPath(reviewId), input);
}

export type PaidFinancialCorrectionApplication = {
  id: string;
  reviewId: string;
  status: 'APPLIED';
  economicDirection: 'VENDOR_DEDUCTION';
  authorizedDebtMinor: number;
  currency: 'TRY';
  authorizedByUserId: string;
  reason: string;
  authorizedAt: string;
  appliedAt: string;
  previewFingerprint: string;
  historicalPayoutBatchId: string;
  historicalPayoutPaidAt: string;
  vendorBalanceEventId: string;
};

const paidCorrectionPath = (reviewId: string) =>
  `/admin/finance/refund-reviews/${encodeURIComponent(reviewId)}/financial-correction-paid-debt`;

export function getPaidFinancialCorrectionState(reviewId: string, signal?: AbortSignal) {
  return apiClient.get<{ ok: true; writesPerformed: false; application: PaidFinancialCorrectionApplication | null; eligible: boolean; reasonCode: string | null }>(
    paidCorrectionPath(reviewId), { signal },
  );
}

export function applyPaidFinancialCorrectionDebt(reviewId: string, input: { previewFingerprint: string; reason: string }) {
  return apiClient.post<{ ok: true; application: PaidFinancialCorrectionApplication }>(paidCorrectionPath(reviewId), input);
}

export type PaidFinancialCorrectionCreditApplication = {
  id: string;
  reviewId: string;
  creditId: string;
  grossCreditMinor: number;
  currency: 'TRY';
  status: 'APPLIED';
  direction: 'VENDOR_CREDIT';
  authorizedByUserId: string;
  authorizedAt: string;
  appliedAt: string;
  reason: string;
  previewFingerprint: string;
  historicalPayoutBatchId: string;
  historicalPayoutPaidAt: string;
  settlementApprovalId: string | null;
  settlementStatus: string | null;
  payoutBatchId: string | null;
  payoutStatus: string | null;
};

const paidCreditPath = (reviewId: string) =>
  `/admin/finance/refund-reviews/${encodeURIComponent(reviewId)}/financial-correction-paid-credit`;

export function getPaidFinancialCorrectionCreditState(reviewId: string, signal?: AbortSignal) {
  return apiClient.get<{ ok: true; writesPerformed: false; application: PaidFinancialCorrectionCreditApplication | null; eligible: boolean; reasonCode: string | null }>(
    paidCreditPath(reviewId), { signal },
  );
}

export function applyPaidFinancialCorrectionCredit(reviewId: string, input: { previewFingerprint: string; reason: string }) {
  return apiClient.post<{ ok: true; application: PaidFinancialCorrectionCreditApplication }>(paidCreditPath(reviewId), input);
}

export type BeforeSettlementFinancialCorrectionCreditApplication = Omit<
  PaidFinancialCorrectionCreditApplication, 'historicalPayoutBatchId' | 'historicalPayoutPaidAt'
> & { route: 'BEFORE_SETTLEMENT_VENDOR_CREDIT' };

const beforeSettlementCreditPath = (reviewId: string) =>
  `/admin/finance/refund-reviews/${encodeURIComponent(reviewId)}/financial-correction-before-settlement-credit`;

export function getBeforeSettlementFinancialCorrectionCreditState(reviewId: string, signal?: AbortSignal) {
  return apiClient.get<{ ok: true; writesPerformed: false; application: BeforeSettlementFinancialCorrectionCreditApplication | null; eligible: boolean; reasonCode: string | null }>(
    beforeSettlementCreditPath(reviewId), { signal },
  );
}

export function applyBeforeSettlementFinancialCorrectionCredit(reviewId: string, input: { previewFingerprint: string; reason: string }) {
  return apiClient.post<{ ok: true; application: BeforeSettlementFinancialCorrectionCreditApplication }>(beforeSettlementCreditPath(reviewId), input);
}

type RefundReviewActionInput = {
  expectedStatus: TerminalRefundReviewStatus;
  expectedUpdatedAt: string;
  expectedOccurrenceCount: number;
  note?: string | null;
};

function postRefundReviewAction(reviewId: string, action: 'acknowledge' | 'resolve' | 'reopen', input: RefundReviewActionInput & {
  resolutionOutcome?: TerminalRefundReviewResolutionOutcome;
}) {
  return apiClient.post<{ ok: true; review: TerminalRefundReviewDetail }>(
    `/admin/finance/refund-reviews/${encodeURIComponent(reviewId)}/${action}`,
    input,
  );
}

export function acknowledgeAdminRefundReview(reviewId: string, input: RefundReviewActionInput) {
  return postRefundReviewAction(reviewId, 'acknowledge', input);
}

export function resolveAdminRefundReview(reviewId: string, input: RefundReviewActionInput & {
  resolutionOutcome: TerminalRefundReviewResolutionOutcome;
}) {
  return postRefundReviewAction(reviewId, 'resolve', input);
}

export function reopenAdminRefundReview(reviewId: string, input: RefundReviewActionInput) {
  return postRefundReviewAction(reviewId, 'reopen', input);
}

export function syncLegacyRefundReviews(vendorId?: string | null) {
  return apiClient.post<{ ok: true; candidates: number; createdReviews: number; updatedReviews: number; createdSources: number; updatedSources: number }>(
    '/admin/finance/legacy-refund-reviews/sync',
    { vendorId: vendorId?.trim() || null },
  );
}

export function getAdminLegacyRefundReview(reviewId: string, signal?: AbortSignal) {
  return apiClient.get<{ ok: true; review: LegacyRefundReviewDetail }>(
    `/admin/finance/legacy-refund-reviews/${encodeURIComponent(reviewId)}`,
    { signal },
  );
}

type LegacyReviewActionInput = {
  expectedStatus: LegacyRefundReviewStatus;
  expectedUpdatedAt: string;
  expectedOccurrenceCount: number;
  note?: string | null;
};

function postLegacyReviewAction(reviewId: string, action: 'acknowledge' | 'resolve' | 'reopen', input: LegacyReviewActionInput & { resolutionOutcome?: LegacyRefundReviewResolutionOutcome }) {
  return apiClient.post<{ ok: true; review: LegacyRefundReviewDetail }>(
    `/admin/finance/legacy-refund-reviews/${encodeURIComponent(reviewId)}/${action}`,
    input,
  );
}

export function acknowledgeAdminLegacyRefundReview(reviewId: string, input: LegacyReviewActionInput) { return postLegacyReviewAction(reviewId, 'acknowledge', input); }
export function resolveAdminLegacyRefundReview(reviewId: string, input: LegacyReviewActionInput & { resolutionOutcome: LegacyRefundReviewResolutionOutcome }) { return postLegacyReviewAction(reviewId, 'resolve', input); }
export function reopenAdminLegacyRefundReview(reviewId: string, input: LegacyReviewActionInput) { return postLegacyReviewAction(reviewId, 'reopen', input); }
