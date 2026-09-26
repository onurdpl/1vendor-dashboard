import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRefundAdjustmentsPage } from './AdminRefundAdjustmentsPage';
import {
  acknowledgeAdminRefundReview,
  acknowledgeAdminLegacyRefundReview,
  getAdminLegacyRefundReview,
  getAdminRefundReview,
  getAdminFinancialCorrectionPreview,
  getZeroNetReconciliationAcknowledgement,
  acknowledgeZeroNetReconciliation,
  getPaidFinancialCorrectionState,
  applyPaidFinancialCorrectionDebt,
  getPaidFinancialCorrectionCreditState,
  applyPaidFinancialCorrectionCredit,
  getBeforeSettlementFinancialCorrectionCreditState,
  applyBeforeSettlementFinancialCorrectionCredit,
  getBeforeSettlementFinancialCorrectionDeductionState,
  applyBeforeSettlementFinancialCorrectionDeduction,
  getApprovedSettlementFinancialCorrectionCreditState,
  applyApprovedSettlementFinancialCorrectionCredit,
  getApprovedSettlementFinancialCorrectionDeductionState,
  applyApprovedSettlementFinancialCorrectionDeduction,
  getDraftPayoutFinancialCorrectionState,
  applyDraftPayoutFinancialCorrection,
  listAdminRefundReviews,
  listRefundAdjustments,
  reopenAdminRefundReview,
  reopenAdminLegacyRefundReview,
  resolveAdminRefundReview,
  resolveAdminLegacyRefundReview,
  syncLegacyRefundReviews,
  type AdminRefundReviewsResponse,
  type RefundAdjustmentRecord,
  type RefundAdjustmentsListResponse,
  type LegacyRefundFinanceCandidate,
  type LegacyRefundReviewDetail,
  type TerminalRefundReview,
  type TerminalRefundReviewDetail,
  type AdminFinancialCorrectionPreview,
  type ZeroNetReconciliationAcknowledgement,
  type PaidFinancialCorrectionApplication,
  type PaidFinancialCorrectionCreditApplication,
  type BeforeSettlementFinancialCorrectionCreditApplication,
  type BeforeSettlementFinancialCorrectionDeductionApplication,
  type ApprovedSettlementFinancialCorrectionCreditApplication,
  type ApprovedSettlementFinancialCorrectionDeductionApplication,
  type DraftPayoutFinancialCorrectionApplication,
} from '../features/finance/refundAdjustmentsApi';
import { setCurrentVendorId, setSession, type CurrentUser } from '../lib/auth';

vi.mock('../features/finance/refundAdjustmentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/finance/refundAdjustmentsApi')>();
  return {
    ...actual,
    listAdminRefundReviews: vi.fn(),
    listRefundAdjustments: vi.fn(),
    getAdminRefundReview: vi.fn(),
    getAdminFinancialCorrectionPreview: vi.fn(),
    getZeroNetReconciliationAcknowledgement: vi.fn(),
    acknowledgeZeroNetReconciliation: vi.fn(),
    getPaidFinancialCorrectionState: vi.fn(),
    applyPaidFinancialCorrectionDebt: vi.fn(),
    getPaidFinancialCorrectionCreditState: vi.fn(),
    applyPaidFinancialCorrectionCredit: vi.fn(),
    getBeforeSettlementFinancialCorrectionCreditState: vi.fn(),
    applyBeforeSettlementFinancialCorrectionCredit: vi.fn(),
    getBeforeSettlementFinancialCorrectionDeductionState: vi.fn(),
    applyBeforeSettlementFinancialCorrectionDeduction: vi.fn(),
    getApprovedSettlementFinancialCorrectionCreditState: vi.fn(),
    applyApprovedSettlementFinancialCorrectionCredit: vi.fn(),
    getApprovedSettlementFinancialCorrectionDeductionState: vi.fn(),
    applyApprovedSettlementFinancialCorrectionDeduction: vi.fn(),
    getDraftPayoutFinancialCorrectionState: vi.fn(),
    applyDraftPayoutFinancialCorrection: vi.fn(),
    acknowledgeAdminRefundReview: vi.fn(),
    resolveAdminRefundReview: vi.fn(),
    reopenAdminRefundReview: vi.fn(),
    syncLegacyRefundReviews: vi.fn(),
    getAdminLegacyRefundReview: vi.fn(),
    acknowledgeAdminLegacyRefundReview: vi.fn(),
    resolveAdminLegacyRefundReview: vi.fn(),
    reopenAdminLegacyRefundReview: vi.fn(),
  };
});

const listRefundAdjustmentsMock = vi.mocked(listRefundAdjustments);
const listAdminRefundReviewsMock = vi.mocked(listAdminRefundReviews);
const getAdminRefundReviewMock = vi.mocked(getAdminRefundReview);
const getAdminFinancialCorrectionPreviewMock = vi.mocked(getAdminFinancialCorrectionPreview);
const getZeroNetAcknowledgementMock = vi.mocked(getZeroNetReconciliationAcknowledgement);
const acknowledgeZeroNetMock = vi.mocked(acknowledgeZeroNetReconciliation);
const getPaidCorrectionStateMock = vi.mocked(getPaidFinancialCorrectionState);
const applyPaidCorrectionMock = vi.mocked(applyPaidFinancialCorrectionDebt);
const getPaidCreditStateMock = vi.mocked(getPaidFinancialCorrectionCreditState);
const applyPaidCreditMock = vi.mocked(applyPaidFinancialCorrectionCredit);
const getBeforeSettlementCreditStateMock = vi.mocked(getBeforeSettlementFinancialCorrectionCreditState);
const applyBeforeSettlementCreditMock = vi.mocked(applyBeforeSettlementFinancialCorrectionCredit);
const getBeforeSettlementDeductionStateMock = vi.mocked(getBeforeSettlementFinancialCorrectionDeductionState);
const applyBeforeSettlementDeductionMock = vi.mocked(applyBeforeSettlementFinancialCorrectionDeduction);
const getApprovedSettlementCreditStateMock = vi.mocked(getApprovedSettlementFinancialCorrectionCreditState);
const applyApprovedSettlementCreditMock = vi.mocked(applyApprovedSettlementFinancialCorrectionCredit);
const getApprovedSettlementDeductionStateMock = vi.mocked(getApprovedSettlementFinancialCorrectionDeductionState);
const applyApprovedSettlementDeductionMock = vi.mocked(applyApprovedSettlementFinancialCorrectionDeduction);
const getDraftPayoutCorrectionStateMock = vi.mocked(getDraftPayoutFinancialCorrectionState);
const applyDraftPayoutCorrectionMock = vi.mocked(applyDraftPayoutFinancialCorrection);
const acknowledgeAdminRefundReviewMock = vi.mocked(acknowledgeAdminRefundReview);
const resolveAdminRefundReviewMock = vi.mocked(resolveAdminRefundReview);
const reopenAdminRefundReviewMock = vi.mocked(reopenAdminRefundReview);
const syncLegacyRefundReviewsMock = vi.mocked(syncLegacyRefundReviews);
const getAdminLegacyRefundReviewMock = vi.mocked(getAdminLegacyRefundReview);
const acknowledgeAdminLegacyRefundReviewMock = vi.mocked(acknowledgeAdminLegacyRefundReview);
const resolveAdminLegacyRefundReviewMock = vi.mocked(resolveAdminLegacyRefundReview);
const reopenAdminLegacyRefundReviewMock = vi.mocked(reopenAdminLegacyRefundReview);

function reviewResponse(overrides: Partial<AdminRefundReviewsResponse> = {}): AdminRefundReviewsResponse {
  return {
    ok: true,
    writesPerformed: false,
    terminalReviews: { error: null, count: 0, limit: 25, offset: 0, items: [] },
    legacyCandidates: { error: null, count: 0, limit: 25, offset: 0, items: [] },
    ...overrides,
  };
}

const adminUser: CurrentUser = {
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  status: 'active',
  vendorAccess: ['yalispor'],
  vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalı Spor' }],
  canSwitchVendors: false,
  defaultVendorId: 'yalispor',
};

function makeAdjustment(overrides: Partial<RefundAdjustmentRecord>): RefundAdjustmentRecord {
  return {
    id: 'raw-adjustment-id-00000000',
    refundRecordId: 'raw-refund-record-id-00000000',
    refundFinanceLedgerEntryId: 'raw-ledger-id-00000000',
    vendorId: 'yalispor',
    originalOrderId: 'raw-order-id-00000000',
    originalSettlementApprovalId: 'raw-settlement-id-00000000',
    originalSettlementApprovalLineId: 'raw-settlement-line-id-00000000',
    originalSettlementCommissionInvoiceId: 'raw-commission-invoice-id-00000000',
    status: 'pending',
    amountMinor: 42500,
    originalAmountMinor: 42500,
    appliedAmountMinor: 0,
    remainingAmountMinor: 42500,
    currencyCode: 'TRY',
    reason: 'Refund review required before vendor payment.',
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    appliedSettlementApprovalId: null,
    appliedSettlementApprovalLineId: null,
    blockedReason: null,
    createdBy: 'admin@example.com',
    applications: [],
    events: [
      {
        id: 'raw-event-id-00000000',
        eventType: 'created',
        createdAt: '2026-07-01T09:05:00.000Z',
      },
    ],
    references: {
      orderLabel: 'Order #1097',
      refundLabel: 'Refund #RF-1097',
      originalSettlementLabel: 'SET-20260701-YALISPOR',
      originalCommissionInvoiceLabel: 'Invoice INV-1097',
    },
    ...overrides,
  };
}

const adjustments: RefundAdjustmentRecord[] = [
  makeAdjustment({ id: 'adjustment-pending', status: 'pending' }),
  makeAdjustment({
    id: 'adjustment-partial',
    status: 'partially_applied',
    amountMinor: 98000,
    originalAmountMinor: 98000,
    appliedAmountMinor: 36000,
    remainingAmountMinor: 62000,
    reason: 'Vendor debt balance offset pending.',
    updatedAt: '2026-07-02T10:00:00.000Z',
    references: {
      orderLabel: 'Order #1098',
      refundLabel: 'Refund #RF-1098',
      originalSettlementLabel: 'SET-20260702-YALISPOR',
      originalCommissionInvoiceLabel: null,
    },
  }),
  makeAdjustment({ id: 'adjustment-applied', status: 'applied', updatedAt: '2026-07-03T10:00:00.000Z' }),
  makeAdjustment({
    id: 'adjustment-blocked',
    status: 'blocked',
    blockedReason: 'Vendor debt exists',
    updatedAt: '2026-07-04T10:00:00.000Z',
  }),
  makeAdjustment({ id: 'adjustment-cancelled', status: 'cancelled', updatedAt: '2026-07-05T10:00:00.000Z' }),
];

function response(records = adjustments): RefundAdjustmentsListResponse {
  return {
    ok: true,
    writesPerformed: false,
    count: records.length,
    statuses: {
      pending: records.filter((record) => record.status === 'pending').length,
      partially_applied: records.filter((record) => record.status === 'partially_applied').length,
      applied: records.filter((record) => record.status === 'applied').length,
      blocked: records.filter((record) => record.status === 'blocked').length,
      cancelled: records.filter((record) => record.status === 'cancelled').length,
    },
    records,
  };
}

function makeTerminalReview(overrides: Partial<TerminalRefundReview> = {}): TerminalRefundReview {
  return {
    type: 'terminal_conflict', id: 'review-1', status: 'ACTIVE', resolutionOutcome: null,
    sourceShopifyRefundId: 'refund-1', sourceShopifyOrderId: 'order-1',
    vendorAllocationId: 'allocation-1', economicVendorId: 'yalispor', vendorName: 'Yalı Spor',
    terminalRefundFinanceLedgerEntryId: 'ledger-1', storedEvidenceSnapshotId: 'snapshot-1',
    conflictCategory: 'refund_evidence_hash_mismatch', storedEvidenceHash: 'stored-hash', incomingEvidenceHash: 'incoming-hash',
    occurrenceCount: 2, firstObservedAt: '2026-07-01T00:00:00Z', lastObservedAt: '2026-07-02T00:00:00Z',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
    acceptedRecordedAmount: '42.00', acceptedRecordedCurrency: 'TRY',
    ...overrides,
  };
}

function makeTerminalDetail(overrides: Partial<TerminalRefundReviewDetail> = {}): TerminalRefundReviewDetail {
  return {
    ...makeTerminalReview(),
    evidenceVersion: 'v1', normalizationVersion: 'n1',
    conflictSummary: { changed: ['amount'] },
    events: [{
      id: 'event-detected', eventType: 'DETECTED', actorUserId: null, actorName: null,
      note: null, resolutionOutcome: null, createdAt: '2026-07-01T00:00:00Z',
    }],
    ...overrides,
  };
}

function makeCorrectionPreview(overrides: Partial<AdminFinancialCorrectionPreview> = {}): AdminFinancialCorrectionPreview {
  return {
    previewFingerprint: 'financial-correction-preview-v1:verified',
    reviewId: 'review-1', sourceShopifyRefundId: 'refund-1', sourceShopifyOrderId: 'order-1',
    vendorAllocationId: 'allocation-1', vendorId: 'yalispor',
    historicalSaleFinanceLedgerEntryId: 'sale-1', acceptedRefundFinanceLedgerEntryId: 'ledger-1',
    currency: 'TRY',
    acceptedEvidence: { id: 'snapshot-1', hash: 'accepted-hash', version: 1, normalizationVersion: 1 },
    incomingEvidence: { id: 'incoming-1', hash: 'incoming-hash', version: 1, normalizationVersion: 1 },
    commissionPercent: '10', commissionVatPercent: '20',
    accepted: { refundAmountMinor: 10000, commissionReversalMinor: 1000, commissionVatReversalMinor: 200, vendorPayableReversalMinor: 8800 },
    corrected: { refundAmountMinor: 12000, commissionReversalMinor: 1200, commissionVatReversalMinor: 240, vendorPayableReversalMinor: 10560 },
    difference: { refundAmountMinor: 2000, commissionReversalMinor: 200, commissionVatReversalMinor: 40, vendorPayableReversalMinor: 1760 },
    economicDirection: 'VENDOR_DEDUCTION',
    ...overrides,
  };
}

const zeroNetAcknowledgement: ZeroNetReconciliationAcknowledgement = {
  id: 'zero-net-1', reviewId: 'review-1', resolvedReviewEventId: 'event-resolved',
  acceptedEvidenceSnapshotId: 'snapshot-1', incomingConflictEvidenceId: 'incoming-1',
  previewFingerprint: 'financial-correction-preview-v1:verified', economicDirection: 'NONE',
  vendorPayableDifferenceMinor: 0, acknowledgedByUserId: 'admin-1',
  acknowledgedAt: '2026-09-25T12:00:00.000Z', note: null,
};

const appliedPaidCorrection: PaidFinancialCorrectionApplication = {
  id: 'correction-1', reviewId: 'review-1', status: 'APPLIED', economicDirection: 'VENDOR_DEDUCTION',
  authorizedDebtMinor: 1760, currency: 'TRY', authorizedByUserId: 'admin-1', reason: 'Verified evidence',
  authorizedAt: '2026-09-25T12:00:00Z', appliedAt: '2026-09-25T12:00:00Z',
  previewFingerprint: 'financial-correction-preview-v1:verified', historicalPayoutBatchId: 'paid-batch-1',
  historicalPayoutPaidAt: '2026-09-20T12:00:00Z', vendorBalanceEventId: 'debt-1',
};

const appliedPaidCredit: PaidFinancialCorrectionCreditApplication = {
  id: 'correction-credit-1', reviewId: 'review-1', creditId: 'credit-1', grossCreditMinor: 1760,
  currency: 'TRY', status: 'APPLIED', direction: 'VENDOR_CREDIT', authorizedByUserId: 'admin-1',
  authorizedAt: '2026-09-25T12:00:00Z', appliedAt: '2026-09-25T12:00:00Z',
  reason: 'Verified credit evidence', previewFingerprint: 'financial-correction-preview-v1:verified',
  historicalPayoutBatchId: 'paid-batch-1', historicalPayoutPaidAt: '2026-09-20T12:00:00Z',
  settlementApprovalId: null, settlementStatus: null, payoutBatchId: null, payoutStatus: null,
};

const appliedBeforeSettlementCredit: BeforeSettlementFinancialCorrectionCreditApplication = {
  id: 'correction-before-1', reviewId: 'review-1', creditId: 'credit-before-1', grossCreditMinor: 1760,
  currency: 'TRY', status: 'APPLIED', direction: 'VENDOR_CREDIT', route: 'BEFORE_SETTLEMENT_VENDOR_CREDIT',
  authorizedByUserId: 'admin-1', authorizedAt: '2026-09-25T12:00:00Z', appliedAt: '2026-09-25T12:00:00Z',
  reason: 'Verified before-settlement evidence', previewFingerprint: 'financial-correction-preview-v1:verified',
  settlementApprovalId: null, settlementStatus: null, payoutBatchId: null, payoutStatus: null,
};

const appliedBeforeSettlementDeduction: BeforeSettlementFinancialCorrectionDeductionApplication = {
  id: 'correction-deduction-1', reviewId: 'review-1', deductionId: 'deduction-1', grossDeductionMinor: 1760,
  currency: 'TRY', status: 'APPLIED', direction: 'VENDOR_DEDUCTION', route: 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION',
  authorizedByUserId: 'admin-1', authorizedAt: '2026-09-25T12:00:00Z', appliedAt: '2026-09-25T12:00:00Z',
  reason: 'Verified before-settlement deduction', previewFingerprint: 'financial-correction-preview-v1:verified',
  settlementApprovalId: null, settlementStatus: null, payoutBatchId: null, payoutStatus: null,
};

const appliedApprovedSettlementCredit: ApprovedSettlementFinancialCorrectionCreditApplication = {
  ...appliedBeforeSettlementCredit,
  id: 'correction-approved-1', creditId: 'credit-approved-1',
  route: 'APPROVED_SETTLEMENT_VENDOR_CREDIT',
  historicalApprovedSettlementId: 'historical-approval-1',
  historicalApprovedSettlementAt: '2026-09-20T12:00:00Z',
  historicalApprovedSettlementNetMinor: 100000,
};

const appliedApprovedSettlementDeduction: ApprovedSettlementFinancialCorrectionDeductionApplication = {
  ...appliedBeforeSettlementDeduction,
  id: 'correction-approved-deduction-1', deductionId: 'deduction-approved-1',
  route: 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION',
  historicalApprovedSettlementId: 'historical-approval-1',
  historicalApprovedSettlementAt: '2026-09-20T12:00:00Z',
  historicalApprovedSettlementNetMinor: 100000,
  coverageId: 'coverage-1', coverageAmountMinor: 1760, coverageStatus: 'ACTIVE',
};

const appliedDraftPayoutCorrection: DraftPayoutFinancialCorrectionApplication = {
  id: 'draft-correction-1', reviewId: 'review-1', route: 'DRAFT_PAYOUT_VENDOR_DEDUCTION',
  status: 'APPLIED', direction: 'VENDOR_DEDUCTION', amountMinor: 1760, currency: 'TRY',
  creditId: null, deductionId: 'draft-deduction-1', coverageId: 'draft-coverage-1',
  historicalApprovedSettlementId: 'historical-approval-1', historicalPayoutBatchId: 'draft-payout-1',
  historicalPayoutNetMinor: 100000, historicalPayoutGrossMinor: 120000,
  historicalPayoutDebtOffsetMinor: 0, historicalPayoutCancelledAt: '2026-09-25T12:00:00Z',
  authorizedByUserId: 'admin-1', reason: 'Verified draft correction',
  authorizedAt: '2026-09-25T12:00:00Z', appliedAt: '2026-09-25T12:00:00Z',
  previewFingerprint: 'financial-correction-preview-v1:verified',
};

function makeLegacyReview(overrides: Partial<LegacyRefundFinanceCandidate> = {}): LegacyRefundFinanceCandidate {
  return {
    type: 'legacy_refund_finance', id: 'legacy-review-1', status: 'ACTIVE', resolutionOutcome: null,
    attribution: 'exact', sourceShopifyOrderId: 'order-2', sourceShopifyRefundId: 'refund-2',
    vendorAllocationId: 'allocation-2', observedVendorId: 'yalispor', vendorName: 'Yalı Spor',
    sourceCount: 2, firstObservedAt: '2026-07-03T00:00:00Z', lastObservedAt: '2026-07-04T00:00:00Z',
    occurrenceCount: 1, createdAt: '2026-07-03T00:00:00Z', updatedAt: '2026-07-04T00:00:00Z',
    ...overrides,
  };
}

function makeLegacyDetail(overrides: Partial<LegacyRefundReviewDetail> = {}): LegacyRefundReviewDetail {
  return {
    ...makeLegacyReview(),
    sources: [
      { id: 'source-1', artifactType: 'refund_ledger', artifactId: 'ledger-legacy', observedAt: '2026-07-03T00:00:00Z', sourceState: 'PENDING', recordedAmount: '30.00', recordedAmountMinor: null, currency: 'TRY', voidedAt: null, supersededByLedgerId: null },
      { id: 'source-2', artifactType: 'finance_event', artifactId: 'event-legacy', observedAt: '2026-07-03T01:00:00Z', sourceState: 'REFUND_CREATED', recordedAmount: null, recordedAmountMinor: 3000, currency: 'TRY', voidedAt: null, supersededByLedgerId: null },
    ],
    events: [{ id: 'legacy-detected', eventType: 'DETECTED', actorUserId: null, actorName: null, note: null, resolutionOutcome: null, createdAt: '2026-07-03T00:00:00Z' }],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/finance/refund-adjustments']}>
        <Routes>
          <Route path="/admin/finance/refund-adjustments" element={<AdminRefundAdjustmentsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setSession('test-session', adminUser);
  setCurrentVendorId('yalispor');
  listRefundAdjustmentsMock.mockResolvedValue(response());
  listAdminRefundReviewsMock.mockResolvedValue(reviewResponse());
  getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail() });
  getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview() });
  getZeroNetAcknowledgementMock.mockResolvedValue({ ok: true, writesPerformed: false, acknowledgement: null });
  acknowledgeZeroNetMock.mockResolvedValue({ ok: true, acknowledgement: zeroNetAcknowledgement });
  getPaidCorrectionStateMock.mockResolvedValue({ ok: true, writesPerformed: false, application: null, eligible: false, reasonCode: 'NONZERO_ROUTE_UNSUPPORTED' });
  getPaidCreditStateMock.mockResolvedValue({ ok: true, writesPerformed: false, application: null, eligible: false, reasonCode: 'CREDIT_ROUTE_UNSUPPORTED' });
  getBeforeSettlementCreditStateMock.mockResolvedValue({ ok: true, writesPerformed: false, application: null, eligible: false, reasonCode: 'WRONG_CORRECTION_DIRECTION' });
  getBeforeSettlementDeductionStateMock.mockResolvedValue({ ok: true, writesPerformed: false, application: null, eligible: false, reasonCode: 'BEFORE_SETTLEMENT_ROUTE_UNAVAILABLE' });
  getApprovedSettlementCreditStateMock.mockResolvedValue({ ok: true, writesPerformed: false, application: null, eligible: false, reasonCode: 'APPROVED_SETTLEMENT_REQUIRED', approvedSettlement: null });
  getApprovedSettlementDeductionStateMock.mockResolvedValue({ ok: true, writesPerformed: false, application: null, eligible: false, reasonCode: 'APPROVED_SETTLEMENT_REQUIRED', approvedSettlement: null });
  getDraftPayoutCorrectionStateMock.mockResolvedValue({ ok: true, writesPerformed: false, application: null,
    eligible: false, reasonCode: 'DRAFT_PAYOUT_REQUIRED', draftPayout: null });
  acknowledgeAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'ACKNOWLEDGED' }) });
  resolveAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'NO_CORRECTION_NEEDED' }) });
  reopenAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail() });
  syncLegacyRefundReviewsMock.mockResolvedValue({ ok: true, candidates: 2, createdReviews: 1, updatedReviews: 0, createdSources: 2, updatedSources: 0 });
  getAdminLegacyRefundReviewMock.mockResolvedValue({ ok: true, review: makeLegacyDetail() });
  acknowledgeAdminLegacyRefundReviewMock.mockResolvedValue({ ok: true, review: makeLegacyDetail({ status: 'ACKNOWLEDGED' }) });
  resolveAdminLegacyRefundReviewMock.mockResolvedValue({ ok: true, review: makeLegacyDetail({ status: 'RESOLVED', resolutionOutcome: 'NO_CORRECTION_NEEDED' }) });
  reopenAdminLegacyRefundReviewMock.mockResolvedValue({ ok: true, review: makeLegacyDetail() });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('AdminRefundAdjustmentsPage', () => {
  it('renders the refund adjustments route and workflow tabs', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Refund Adjustments' })).toBeInTheDocument();
    expect(screen.getByText('ADMIN FINANCE')).toBeInTheDocument();
    expect(screen.getByText('Review refund deductions and balance adjustments before vendor payment.')).toBeInTheDocument();

    const tabs = screen.getByLabelText('Refund adjustment workflow tabs');
    for (const label of ['All', 'Needs Review', 'In Review', 'Approved', 'Blocked', 'Cancelled']) {
      expect(within(tabs).getByText(label)).toBeInTheDocument();
    }
  });

  it('renders the exact operational table columns', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0));

    const headers = within(screen.getByLabelText('Refund adjustments queue')).getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Vendor', 'Refund', 'Adjustment', 'Amount', 'Status', 'Next Action', 'Updated']);
    expect(screen.getAllByText('Yalı Spor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund reference RF-1097').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('selects refund adjustment rows and updates the right panel', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0));
    const rows = screen.getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const partialRow = rows.find((row) => row.textContent?.includes('Order #1098'));
    expect(partialRow).toBeTruthy();

    await user.click(partialRow!);

    expect(partialRow).toHaveClass('op-row-selected');
    const panel = screen.getByLabelText('Refund adjustment detail panel');
    expect(within(panel).getAllByText(/Order #1098/).length).toBeGreaterThan(0);
    expect(within(panel).getByText('Balance offset pending')).toBeInTheDocument();
  });

  it('renders the right panel hierarchy from queue-safe fields', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0));

    const panel = screen.getByLabelText('Refund adjustment detail panel');
    for (const section of ['Summary', 'Current Blocker', 'Next Action', 'Payment Impact', 'Related Records', 'Timeline']) {
      expect(within(panel).getByText(section)).toBeInTheDocument();
    }
    expect(within(panel).getByText('Refund review required')).toBeInTheDocument();
    expect(within(panel).getByText('Apply')).toBeInTheDocument();
    expect(within(panel).getByText('No debt adjustment')).toBeInTheDocument();
    expect(within(panel).getByText('No linked support')).toBeInTheDocument();
    expect(within(panel).queryByText('UNKNOWN')).not.toBeInTheDocument();
    expect(within(panel).queryByText('None loaded')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Not loaded')).not.toBeInTheDocument();
  });

  it('does not expose raw ledger or reference IDs in the queue layer', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Refund Adjustments' });

    for (const rawValue of [
      'raw-adjustment-id-00000000',
      'raw-refund-record-id-00000000',
      'raw-ledger-id-00000000',
      'raw-order-id-00000000',
      'raw-settlement-id-00000000',
      'raw-commission-invoice-id-00000000',
      'raw-event-id-00000000',
    ]) {
      expect(screen.queryByText(rawValue)).not.toBeInTheDocument();
    }
  });

  it('filters queue records by workflow tab', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Refund Adjustments' });

    await user.click(screen.getByRole('button', { name: /Blocked/i }));

    expect(screen.getByText('Vendor debt exists')).toBeInTheDocument();
    expect(screen.queryByText('Balance offset')).not.toBeInTheDocument();
  });

  it('shows selectable persisted exact and ambiguous legacy review cases', async () => {
    const terminal = makeTerminalReview();
    const legacy = makeLegacyReview();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 2, limit: 25, offset: 0, items: [terminal, { ...terminal, id: 'review-2' }] },
      legacyCandidates: { error: null, count: 2, limit: 25, offset: 0, items: [legacy, makeLegacyReview({ id: 'legacy-unknown', attribution: 'ambiguous', sourceShopifyOrderId: null, sourceShopifyRefundId: null, vendorAllocationId: null, sourceCount: 1 })] },
    }));
    renderPage();
    const conflicts = await screen.findByLabelText('Refund evidence conflicts');
    const legacySection = screen.getByLabelText('Legacy refund finance');
    await waitFor(() => expect(within(conflicts).getAllByText('refund_evidence_hash_mismatch')).toHaveLength(2));
    expect(within(legacySection).getByText('Refund refund-2')).toBeInTheDocument();
    expect(within(legacySection).getAllByText('UNKNOWN').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Refund adjustments queue')).toBeInTheDocument();
    expect(await within(conflicts).findByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(await within(legacySection).findByText('refund ledger')).toBeInTheDocument();
    expect(within(legacySection).getByText(/Reviews persisted historical finance without recalculating or changing it/)).toBeInTheDocument();
    expect(within(legacySection).getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(screen.queryByText(/customer@example|shipping address/i)).not.toBeInTheDocument();
  });

  it('runs explicit legacy discovery, refreshes the list, and forwards persisted filters', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Refund Adjustments' });
    await user.click(screen.getByRole('button', { name: 'Sync legacy reviews' }));
    await waitFor(() => expect(syncLegacyRefundReviewsMock).toHaveBeenCalledWith('yalispor'));
    await waitFor(() => expect(listAdminRefundReviewsMock.mock.calls.length).toBeGreaterThan(1));

    const filters = screen.getByLabelText('Legacy refund finance filters');
    await user.selectOptions(within(filters).getByRole('combobox', { name: 'Status' }), 'ACKNOWLEDGED');
    await user.selectOptions(within(filters).getByRole('combobox', { name: 'Resolution outcome' }), 'CORRECTION_REQUIRED');
    await user.selectOptions(within(filters).getByRole('combobox', { name: 'Attribution' }), 'AMBIGUOUS');
    await waitFor(() => expect(listAdminRefundReviewsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      legacyStatus: 'ACKNOWLEDGED', legacyResolutionOutcome: 'CORRECTION_REQUIRED', legacyAttribution: 'AMBIGUOUS',
    })));
  });

  it('uses the persisted legacy lifecycle and requires a resolution outcome', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      legacyCandidates: { error: null, count: 1, limit: 25, offset: 0, items: [makeLegacyReview({ status: 'ACKNOWLEDGED' })] },
    }));
    getAdminLegacyRefundReviewMock.mockResolvedValue({ ok: true, review: makeLegacyDetail({ status: 'ACKNOWLEDGED' }) });
    const user = userEvent.setup();
    renderPage();
    const actions = await screen.findByLabelText('Legacy refund finance review actions');
    const resolve = within(actions).getByRole('button', { name: 'Resolve' });
    expect(resolve).toBeDisabled();
    await user.selectOptions(within(actions).getByRole('combobox', { name: 'Resolution outcome' }), 'CORRECTION_REQUIRED');
    await user.type(within(actions).getByRole('textbox', { name: 'Optional note' }), 'Needs correction workflow');
    await user.click(resolve);
    await waitFor(() => expect(resolveAdminLegacyRefundReviewMock).toHaveBeenCalledWith('legacy-review-1', {
      expectedStatus: 'ACKNOWLEDGED', expectedUpdatedAt: '2026-07-04T00:00:00Z', expectedOccurrenceCount: 1,
      note: 'Needs correction workflow', resolutionOutcome: 'CORRECTION_REQUIRED',
    }));
    expect(screen.queryByRole('button', { name: /apply correction|correct finance/i })).not.toBeInTheDocument();
  });

  it('selects a conflict and loads safe detail history with the Admin order link', async () => {
    const first = makeTerminalReview();
    const second = makeTerminalReview({ id: 'review-2', sourceShopifyRefundId: 'refund-2', sourceShopifyOrderId: 'order-2' });
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 2, limit: 25, offset: 0, items: [first, second] },
    }));
    getAdminRefundReviewMock.mockImplementation(async (id) => ({
      ok: true,
      review: makeTerminalDetail({
        id,
        sourceShopifyRefundId: id === 'review-2' ? 'refund-2' : 'refund-1',
        sourceShopifyOrderId: id === 'review-2' ? 'order-2' : 'order-1',
      }),
    }));
    const user = userEvent.setup();
    renderPage();
    const conflicts = await screen.findByLabelText('Refund evidence conflicts');
    const secondRow = (await within(conflicts).findAllByRole('button')).find((row) => row.textContent?.includes('refund-2'));
    expect(secondRow).toBeTruthy();
    await user.click(secondRow!);
    const panel = await within(conflicts).findByLabelText('Refund evidence review detail panel');
    expect(within(panel).getByText('DETECTED')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'order-2' })).toHaveAttribute('href', '/admin/orders/order-2');
    expect(within(panel).getByText('Review actions do not change accepted finance.')).toBeInTheDocument();
  });

  it('acknowledges ACTIVE with current freshness and no finance correction control', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview()] },
    }));
    const user = userEvent.setup();
    renderPage();
    const action = await screen.findByRole('button', { name: 'Acknowledge' });
    await user.type(screen.getByRole('textbox', { name: 'Optional note' }), 'Investigating');
    await user.click(action);
    await waitFor(() => expect(acknowledgeAdminRefundReviewMock).toHaveBeenCalledWith('review-1', {
      expectedStatus: 'ACTIVE', expectedUpdatedAt: '2026-07-02T00:00:00Z', expectedOccurrenceCount: 2,
      note: 'Investigating',
    }));
    expect(screen.queryByRole('button', { name: /financial correction/i })).not.toBeInTheDocument();
  });

  it('requires a controlled outcome to resolve ACKNOWLEDGED', async () => {
    const acknowledged = makeTerminalReview({ status: 'ACKNOWLEDGED' });
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [acknowledged] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'ACKNOWLEDGED' }) });
    const user = userEvent.setup();
    renderPage();
    const resolve = await screen.findByRole('button', { name: 'Resolve' });
    expect(resolve).toBeDisabled();
    const actions = screen.getByLabelText('Refund evidence review actions');
    await user.selectOptions(within(actions).getByRole('combobox', { name: 'Resolution outcome' }), 'CORRECTION_REQUIRED');
    await user.click(resolve);
    await waitFor(() => expect(resolveAdminRefundReviewMock).toHaveBeenCalledWith('review-1', expect.objectContaining({
      expectedStatus: 'ACKNOWLEDGED', resolutionOutcome: 'CORRECTION_REQUIRED',
    })));
  });

  it('shows correction-required as information and allows explicit reopen only', async () => {
    const resolved = makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' });
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [resolved] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({
      ok: true,
      review: makeTerminalDetail({
        status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
        events: [
          ...makeTerminalDetail().events,
          { id: 'event-resolved', eventType: 'RESOLVED', actorUserId: 'admin-1', actorName: 'Admin User', note: 'Needs separate correction', resolutionOutcome: 'CORRECTION_REQUIRED', createdAt: '2026-07-02T00:00:00Z' },
        ],
      }),
    });
    renderPage();
    expect(await screen.findByText('Financial correction required. No financial correction has been applied.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply correction|correct finance/i })).not.toBeInTheDocument();
  });

  it('shows an allocation-scoped, read-only correction preview with every calculated component', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    renderPage();
    const preview = await screen.findByLabelText('Financial correction preview');
    await waitFor(() => expect(within(preview).getByText('Vendor owes Sporgym more')).toBeInTheDocument());
    for (const [label, amount] of [
      ['Accepted refund amount', 'TRY 100.00'], ['Corrected refund amount', 'TRY 120.00'], ['Refund difference', '+TRY 20.00'],
      ['Accepted commission reversal', 'TRY 10.00'], ['Corrected commission reversal', 'TRY 12.00'], ['Commission difference', '+TRY 2.00'],
      ['Accepted commission VAT reversal', 'TRY 2.00'], ['Corrected commission VAT reversal', 'TRY 2.40'], ['Commission VAT difference', '+TRY 0.40'],
      ['Accepted vendor-payable effect', 'TRY 88.00'], ['Corrected vendor-payable effect', 'TRY 105.60'], ['Final vendor-payable difference', '+TRY 17.60'],
    ]) {
      expect(within(preview).getByText(label).closest('.op-meta-row')).toHaveTextContent(amount);
    }
    expect(within(preview).getByText('allocation-1')).toBeInTheDocument();
    expect(within(preview).getByText('sale-1')).toBeInTheDocument();
    expect(within(preview).getByText('Accepted and incoming evidence verified')).toBeInTheDocument();
    expect(getAdminFinancialCorrectionPreviewMock).toHaveBeenCalledWith('review-1', expect.any(AbortSignal));
    expect(within(preview).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve & apply correction|create vendor debt|create vendor credit|add to settlement|add to payout|mark paid|cancel payout/i })).not.toBeInTheDocument();
  });

  it('requires an Admin reason and sends only the shown fingerprint for backend-proven PAID deduction', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getPaidCorrectionStateMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, application: null, eligible: true, reasonCode: null })
      .mockResolvedValue({ ok: true, writesPerformed: false, application: appliedPaidCorrection, eligible: false, reasonCode: 'ALREADY_APPLIED' });
    applyPaidCorrectionMock.mockResolvedValue({ ok: true, application: appliedPaidCorrection });
    renderPage();
    const apply = await screen.findByRole('button', { name: 'Approve & Apply Correction' });
    expect(apply).toBeDisabled();
    expect(screen.getByText(/creates a new future vendor debt/)).toHaveTextContent('TRY 17.60');
    await user.type(screen.getByRole('textbox', { name: 'Required Admin reason' }), 'Verified evidence');
    await user.click(apply);
    await waitFor(() => expect(applyPaidCorrectionMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified', reason: 'Verified evidence',
    }));
    expect(await screen.findByText('Applied')).toBeInTheDocument();
    expect(screen.getByText('paid-batch-1')).toBeInTheDocument();
    expect(screen.getByText('The historical PAID payout was not modified. This debt affects future payout balance.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve & Apply Correction' })).not.toBeInTheDocument();
  });

  it('never offers Apply when the backend has not confirmed the paid route', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    renderPage();
    expect(await screen.findByText('Vendor owes Sporgym more')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve & Apply Correction' })).not.toBeInTheDocument();
    expect(applyPaidCorrectionMock).not.toHaveBeenCalled();
  });

  it('shows a zero-net acknowledgement without hiding component differences or adding a money action', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview({
      corrected: { refundAmountMinor: 12000, commissionReversalMinor: 3000, commissionVatReversalMinor: 200, vendorPayableReversalMinor: 8800 },
      difference: { refundAmountMinor: 2000, commissionReversalMinor: 2000, commissionVatReversalMinor: 0, vendorPayableReversalMinor: 0 },
      economicDirection: 'NONE',
    }) });
    renderPage();
    const preview = await screen.findByLabelText('Financial correction preview');
    expect(await within(preview).findByText('No vendor monetary effect')).toBeInTheDocument();
    expect(within(preview).getByText('Refund difference').closest('.op-meta-row')).toHaveTextContent('20.00');
    expect(await within(preview).findByRole('button', { name: 'Acknowledge zero-net reconciliation' })).toBeInTheDocument();
    expect(within(preview).getByText('It does not move money.', { exact: false })).toBeInTheDocument();
    expect(within(preview).queryByRole('button', { name: /approve|apply|debt|credit|payout/i })).not.toBeInTheDocument();
  });

  it('submits only the current zero-net fingerprint and displays the persisted acknowledgement', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview({
      difference: { refundAmountMinor: 2000, commissionReversalMinor: 2000, commissionVatReversalMinor: 0, vendorPayableReversalMinor: 0 },
      economicDirection: 'NONE',
    }) });
    getZeroNetAcknowledgementMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, acknowledgement: null })
      .mockResolvedValue({ ok: true, writesPerformed: false, acknowledgement: zeroNetAcknowledgement });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge zero-net reconciliation' }));
    await waitFor(() => expect(acknowledgeZeroNetMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified',
    }));
    expect(await screen.findByText('Acknowledged — no vendor monetary effect')).toBeInTheDocument();
    expect(screen.getByText('admin-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge zero-net reconciliation' })).not.toBeInTheDocument();
  });

  it('refreshes the preview and history after a stale zero-net acknowledgement response', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview({
      difference: { refundAmountMinor: 2000, commissionReversalMinor: 2000, commissionVatReversalMinor: 0, vendorPayableReversalMinor: 0 },
      economicDirection: 'NONE',
    }) });
    acknowledgeZeroNetMock.mockRejectedValueOnce(new Error('PREVIEW_STALE'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge zero-net reconciliation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PREVIEW_STALE');
    await waitFor(() => expect(getAdminFinancialCorrectionPreviewMock.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(getZeroNetAcknowledgementMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows a prior zero-net acknowledgement after review Reopen without another action', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'ACTIVE', resolutionOutcome: null })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'ACTIVE', resolutionOutcome: null }) });
    getZeroNetAcknowledgementMock.mockResolvedValue({ ok: true, writesPerformed: false, acknowledgement: zeroNetAcknowledgement });
    renderPage();
    expect(await screen.findByText('Acknowledged — no vendor monetary effect')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge zero-net reconciliation' })).not.toBeInTheDocument();
    expect(getAdminFinancialCorrectionPreviewMock).not.toHaveBeenCalled();
  });

  it('renders vendor credit as a gross correction direction without netting existing debt', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview({
      corrected: { refundAmountMinor: 8000, commissionReversalMinor: 800, commissionVatReversalMinor: 160, vendorPayableReversalMinor: 7040 },
      difference: { refundAmountMinor: -2000, commissionReversalMinor: -200, commissionVatReversalMinor: -40, vendorPayableReversalMinor: -1760 },
      economicDirection: 'VENDOR_CREDIT',
    }) });
    renderPage();
    const preview = await screen.findByLabelText('Financial correction preview');
    expect(await within(preview).findByText('Sporgym owes vendor more')).toBeInTheDocument();
    expect(within(preview).getByText('Final vendor-payable difference').closest('.op-meta-row')).toHaveTextContent('-TRY 17.60');
    expect(within(preview).queryByText(/existing debt|net payable/i)).not.toBeInTheDocument();
    expect(within(preview).queryByRole('button')).not.toBeInTheDocument();
  });

  it('requires a reason and submits only the shown fingerprint for backend-eligible paid vendor credit', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview({
      corrected: { refundAmountMinor: 8000, commissionReversalMinor: 800, commissionVatReversalMinor: 160, vendorPayableReversalMinor: 7040 },
      difference: { refundAmountMinor: -2000, commissionReversalMinor: -200, commissionVatReversalMinor: -40, vendorPayableReversalMinor: -1760 },
      economicDirection: 'VENDOR_CREDIT',
    }) });
    getPaidCreditStateMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, application: null, eligible: true, reasonCode: null })
      .mockResolvedValue({ ok: true, writesPerformed: false, application: appliedPaidCredit, eligible: false, reasonCode: 'CREDIT_EFFECT_ALREADY_EXISTS' });
    applyPaidCreditMock.mockResolvedValue({ ok: true, application: appliedPaidCredit });
    renderPage();
    const apply = await screen.findByRole('button', { name: 'Approve & Apply Credit' });
    expect(apply).toBeDisabled();
    expect(screen.getByText(/creates a standalone future vendor payable credit/)).toHaveTextContent('TRY 17.60');
    await user.type(screen.getByRole('textbox', { name: 'Required Admin reason' }), 'Verified credit evidence');
    await user.click(apply);
    await waitFor(() => expect(applyPaidCreditMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified', reason: 'Verified credit evidence',
    }));
    expect(await screen.findByText('credit-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve & Apply Credit' })).not.toBeInTheDocument();
    expect(applyPaidCorrectionMock).not.toHaveBeenCalled();
  });

  it('offers before-settlement credit only on server eligibility and shows gross applied source', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview({
      corrected: { refundAmountMinor: 8000, commissionReversalMinor: 800, commissionVatReversalMinor: 160, vendorPayableReversalMinor: 7040 },
      difference: { refundAmountMinor: -2000, commissionReversalMinor: -200, commissionVatReversalMinor: -40, vendorPayableReversalMinor: -1760 },
      economicDirection: 'VENDOR_CREDIT',
    }) });
    getBeforeSettlementCreditStateMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, application: null, eligible: true, reasonCode: null })
      .mockResolvedValue({ ok: true, writesPerformed: false, application: appliedBeforeSettlementCredit, eligible: false, reasonCode: 'CREDIT_EFFECT_ALREADY_EXISTS' });
    applyBeforeSettlementCreditMock.mockResolvedValue({ ok: true, application: appliedBeforeSettlementCredit });
    renderPage();
    const apply = await screen.findByRole('button', { name: 'Approve & Apply Correction' });
    expect(apply).toBeDisabled();
    expect(screen.getByText(/This creates a separate gross future payable source/)).toHaveTextContent('TRY 17.60');
    await user.type(screen.getByRole('textbox', { name: 'Required Admin reason' }), 'Verified before-settlement evidence');
    await user.click(apply);
    await waitFor(() => expect(applyBeforeSettlementCreditMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified', reason: 'Verified before-settlement evidence',
    }));
    expect(await screen.findByText('credit-before-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve & Apply Correction' })).not.toBeInTheDocument();
    expect(applyPaidCreditMock).not.toHaveBeenCalled();
  });

  it('offers approved-settlement credit only on server eligibility and retains the historical settlement reference', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockResolvedValue({ ok: true, writesPerformed: false, preview: makeCorrectionPreview({
      corrected: { refundAmountMinor: 8000, commissionReversalMinor: 800, commissionVatReversalMinor: 160, vendorPayableReversalMinor: 7040 },
      difference: { refundAmountMinor: -2000, commissionReversalMinor: -200, commissionVatReversalMinor: -40, vendorPayableReversalMinor: -1760 },
      economicDirection: 'VENDOR_CREDIT',
    }) });
    getApprovedSettlementCreditStateMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, application: null, eligible: true,
      reasonCode: null, approvedSettlement: { id: 'historical-approval-1', approvedAt: '2026-09-20T12:00:00Z', netPayableMinor: 100000 } })
      .mockResolvedValue({ ok: true, writesPerformed: false, application: appliedApprovedSettlementCredit, eligible: false,
        reasonCode: 'CREDIT_EFFECT_ALREADY_EXISTS', approvedSettlement: null });
    applyApprovedSettlementCreditMock.mockResolvedValue({ ok: true, application: appliedApprovedSettlementCredit });
    renderPage();
    const section = await screen.findByLabelText('Approved-settlement correction credit application');
    const apply = within(section).getByRole('button', { name: 'Approve & Apply Correction' });
    expect(apply).toBeDisabled();
    expect(within(section).getByText(/Historical approved settlement:/)).toHaveTextContent('TRY 1,000.00');
    await user.type(within(section).getByRole('textbox', { name: 'Required Admin reason' }), 'Verified approved settlement evidence');
    await user.click(apply);
    await waitFor(() => expect(applyApprovedSettlementCreditMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified', reason: 'Verified approved settlement evidence',
    }));
    expect(await screen.findByText('credit-approved-1')).toBeInTheDocument();
    expect(screen.getByText('historical-approval-1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Approved-settlement correction credit application')).not.toBeInTheDocument();
    expect(applyBeforeSettlementCreditMock).not.toHaveBeenCalled();
    expect(applyPaidCreditMock).not.toHaveBeenCalled();
  });

  it('applies an eligible before-settlement deduction as reduced entitlement, never vendor debt', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getBeforeSettlementDeductionStateMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, application: null, eligible: true, reasonCode: null })
      .mockResolvedValue({ ok: true, writesPerformed: false, application: appliedBeforeSettlementDeduction, eligible: false, reasonCode: 'DEDUCTION_EFFECT_ALREADY_EXISTS' });
    applyBeforeSettlementDeductionMock.mockResolvedValue({ ok: true, application: appliedBeforeSettlementDeduction });
    renderPage();
    const apply = await screen.findByRole('button', { name: 'Approve & Apply Correction' });
    expect(apply).toBeDisabled();
    expect(screen.getByText('Unpaid vendor entitlement decreases')).toBeInTheDocument();
    expect(screen.getByText(/This reduces unpaid entitlement; it does not create vendor debt/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Required Admin reason' }), 'Verified before-settlement deduction');
    await user.click(apply);
    await waitFor(() => expect(applyBeforeSettlementDeductionMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified', reason: 'Verified before-settlement deduction',
    }));
    expect(await screen.findByText('deduction-1')).toBeInTheDocument();
    expect(screen.getByText('Unpaid vendor entitlement decreases')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve & Apply Correction' })).not.toBeInTheDocument();
    expect(applyPaidCorrectionMock).not.toHaveBeenCalled();
  });

  it('offers approved-settlement deduction only with server eligibility and shows reserved coverage after Apply', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0,
        items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true,
      review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getApprovedSettlementDeductionStateMock.mockResolvedValueOnce({ ok: true, writesPerformed: false,
      application: null, eligible: true, reasonCode: null,
      approvedSettlement: { id: 'historical-approval-1', approvedAt: '2026-09-20T12:00:00Z',
        netPayableMinor: 100000, availableCoverageMinor: 100000 } })
      .mockResolvedValue({ ok: true, writesPerformed: false,
        application: appliedApprovedSettlementDeduction, eligible: false,
        reasonCode: 'DEDUCTION_EFFECT_ALREADY_EXISTS', approvedSettlement: null });
    applyApprovedSettlementDeductionMock.mockResolvedValue({ ok: true,
      application: appliedApprovedSettlementDeduction });
    renderPage();
    const section = await screen.findByLabelText('Approved-settlement correction deduction application');
    const apply = within(section).getByRole('button', { name: 'Approve & Apply Correction' });
    expect(apply).toBeDisabled();
    expect(section).toHaveTextContent('TRY 1,000.00');
    expect(section).toHaveTextContent('This does not create vendor debt.');
    await user.type(within(section).getByRole('textbox', { name: 'Required Admin reason' }), 'Approved deduction evidence');
    await user.click(apply);
    await waitFor(() => expect(applyApprovedSettlementDeductionMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified', reason: 'Approved deduction evidence',
    }));
    expect(await screen.findByText('coverage-1')).toBeInTheDocument();
    expect(screen.getByText('deduction-approved-1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Approved-settlement correction deduction application')).not.toBeInTheDocument();
    expect(applyPaidCorrectionMock).not.toHaveBeenCalled();
  });

  it('shows a single server-gated cancel DRAFT and apply action with required reason', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0,
        items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true,
      review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getDraftPayoutCorrectionStateMock.mockResolvedValueOnce({ ok: true, writesPerformed: false,
      application: null, eligible: true, reasonCode: null,
      draftPayout: { id: 'draft-payout-1', status: 'DRAFT', netAmountMinor: 100000,
        grossAmountMinor: 120000, debtOffsetMinor: 0 } })
      .mockResolvedValue({ ok: true, writesPerformed: false, application: appliedDraftPayoutCorrection,
        eligible: false, reasonCode: 'CORRECTION_ALREADY_APPLIED', draftPayout: null });
    applyDraftPayoutCorrectionMock.mockResolvedValue({ ok: true, application: appliedDraftPayoutCorrection });
    renderPage();
    const section = await screen.findByLabelText('Draft payout correction application');
    expect(section).toHaveTextContent('draft-payout-1');
    expect(section).toHaveTextContent('No replacement payout is created automatically');
    const action = within(section).getByRole('button', { name: 'Cancel Draft Payout & Apply Correction' });
    expect(action).toBeDisabled();
    await user.type(within(section).getByRole('textbox', { name: 'Required Admin reason' }), 'Verified draft correction');
    await user.click(action);
    await waitFor(() => expect(applyDraftPayoutCorrectionMock).toHaveBeenCalledWith('review-1', {
      previewFingerprint: 'financial-correction-preview-v1:verified', reason: 'Verified draft correction',
    }));
    expect(await screen.findByText('draft-correction-1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Draft payout correction application')).not.toBeInTheDocument();
  });

  it('shows REVIEW as blocked without a cancel-and-apply action', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0,
        items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true,
      review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getDraftPayoutCorrectionStateMock.mockResolvedValue({ ok: true, writesPerformed: false,
      application: null, eligible: false, reasonCode: 'PAYOUT_ALREADY_REVIEW', draftPayout: null });
    renderPage();
    expect(await screen.findByText('Payout is already in payment review. Financial Correction cannot rebuild this payout.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel Draft Payout & Apply Correction' })).not.toBeInTheDocument();
    expect(applyDraftPayoutCorrectionMock).not.toHaveBeenCalled();
  });

  it('reports an unavailable preview without inventing a corrected amount or action', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' })] },
    }));
    getAdminRefundReviewMock.mockResolvedValue({ ok: true, review: makeTerminalDetail({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) });
    getAdminFinancialCorrectionPreviewMock.mockRejectedValue(new Error('Financial correction preview unavailable: incoming_evidence_missing.'));
    renderPage();
    const preview = await screen.findByLabelText('Financial correction preview');
    expect(await within(preview).findByRole('status')).toHaveTextContent('incoming_evidence_missing');
    expect(within(preview).queryByText('Accepted refund amount')).not.toBeInTheDocument();
    expect(within(preview).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a stale action error and refetches list and detail', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: null, count: 1, limit: 25, offset: 0, items: [makeTerminalReview()] },
    }));
    acknowledgeAdminRefundReviewMock.mockRejectedValue(new Error('Refund evidence review changed after it was loaded. Reload and try again.'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refund evidence review changed after it was loaded. Reload and try again.');
    await waitFor(() => {
      expect(listAdminRefundReviewsMock.mock.calls.length).toBeGreaterThan(1);
      expect(getAdminRefundReviewMock.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('keeps review-list errors independent from the adjustment queue and the other review list', async () => {
    listAdminRefundReviewsMock.mockResolvedValue(reviewResponse({
      terminalReviews: { error: 'Unable to load refund evidence conflicts.', count: 0, limit: 25, offset: 0, items: [] },
    }));
    renderPage();
    const conflicts = await screen.findByLabelText('Refund evidence conflicts');
    const legacySection = screen.getByLabelText('Legacy refund finance');
    await waitFor(() => expect(within(conflicts).getByText('Unable to load refund evidence conflicts.')).toBeInTheDocument());
    expect(within(conflicts).queryByText('No refund evidence conflicts')).not.toBeInTheDocument();
    expect(within(legacySection).getByText('No legacy refund finance')).toBeInTheDocument();
    expect(screen.getByLabelText('Refund adjustment detail panel')).toBeInTheDocument();
  });

  it('pages the two read-only lists independently and reuses the existing vendor filter', async () => {
    const user = userEvent.setup();
    listAdminRefundReviewsMock.mockImplementation(async (input) => reviewResponse({
      terminalReviews: { error: null, count: 60, limit: 25, offset: input.terminalOffset ?? 0, items: [] },
      legacyCandidates: { error: null, count: 60, limit: 25, offset: input.legacyOffset ?? 0, items: [] },
    }));
    renderPage();
    await screen.findByRole('button', { name: 'Next conflicts' });
    await user.click(screen.getByRole('button', { name: 'Next conflicts' }));
    await waitFor(() => expect(listAdminRefundReviewsMock).toHaveBeenCalledWith(expect.objectContaining({ terminalOffset: 25, legacyOffset: 0 })));
    await user.click(screen.getByRole('button', { name: 'Next legacy' }));
    await waitFor(() => expect(listAdminRefundReviewsMock).toHaveBeenCalledWith(expect.objectContaining({ terminalOffset: 25, legacyOffset: 25 })));
    const vendorInput = within(screen.getByLabelText('Refund adjustment filters')).getByRole('textbox', { name: 'Vendor' });
    await user.clear(vendorInput);
    await user.type(vendorInput, 'other-vendor');
    await waitFor(() => expect(listAdminRefundReviewsMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'other-vendor', terminalOffset: 0, legacyOffset: 0 })));
  });

  it('shows review loading without claiming either list is empty', async () => {
    listAdminRefundReviewsMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText('Loading refund evidence conflicts...')).toBeInTheDocument();
    expect(screen.getByText('Loading legacy refund finance...')).toBeInTheDocument();
    expect(screen.queryByText('No refund evidence conflicts')).not.toBeInTheDocument();
    expect(screen.queryByText('No legacy refund finance')).not.toBeInTheDocument();
  });
});
