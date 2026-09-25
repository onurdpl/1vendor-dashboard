import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  MetadataGroup,
  MetadataRow,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  StatusBadge,
} from '../components/OperationalPrimitives';
import {
  listAdminRefundReviews,
  listRefundAdjustments,
  acknowledgeAdminRefundReview,
  getAdminRefundReview,
  getAdminFinancialCorrectionPreview,
  getZeroNetReconciliationAcknowledgement,
  acknowledgeZeroNetReconciliation,
  getPaidFinancialCorrectionState,
  applyPaidFinancialCorrectionDebt,
  reopenAdminRefundReview,
  resolveAdminRefundReview,
  acknowledgeAdminLegacyRefundReview,
  getAdminLegacyRefundReview,
  reopenAdminLegacyRefundReview,
  resolveAdminLegacyRefundReview,
  syncLegacyRefundReviews,
  type LegacyRefundReviewResolutionOutcome,
  type LegacyRefundReviewStatus,
  type RefundAdjustmentRecord,
  type RefundAdjustmentStatus,
  type TerminalRefundReviewResolutionOutcome,
  type TerminalRefundReviewStatus,
} from '../features/finance/refundAdjustmentsApi';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { formatCurrency, formatDateTime } from '../services/real/formatting';

type WorkflowTab = 'all' | 'needs_review' | 'partially_applied' | 'applied' | 'blocked' | 'cancelled';
type StatusFilter = 'all' | RefundAdjustmentStatus;
type NextAction = 'Apply' | 'Investigate' | 'View';

const HIGH_VALUE_AMOUNT_MINOR = 100000;
const REVIEW_PAGE_SIZE = 25;

const WORKFLOW_TABS: Array<{ id: WorkflowTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'partially_applied', label: 'In Review' },
  { id: 'applied', label: 'Approved' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_LABELS: Record<RefundAdjustmentStatus, string> = {
  pending: 'Needs Review',
  partially_applied: 'In Review',
  applied: 'Approved',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

function formatMinor(amountMinor: number | null | undefined, currency = 'TRY') {
  return formatCurrency((Number(amountMinor ?? 0) / 100).toFixed(2), currency);
}

function formatSignedMinor(amountMinor: number | null | undefined, currency = 'TRY') {
  const amount = Number(amountMinor ?? 0);
  const prefix = amount < 0 ? '-' : amount > 0 ? '+' : '';
  return `${prefix}${formatMinor(Math.abs(amount), currency)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'No finance activity recorded yet.';
  }
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRecordedMoney(amount: string | null, amountMinor: number | null, currency: string | null) {
  if (!currency) {
    if (amount !== null) return `${amount} (currency UNKNOWN)`;
    if (amountMinor !== null) return `${amountMinor} minor units (currency UNKNOWN)`;
    return 'UNKNOWN';
  }
  if (amount !== null) return formatCurrency(amount, currency);
  if (amountMinor !== null) return formatCurrency((amountMinor / 100).toFixed(2), currency);
  return 'UNKNOWN';
}

function formatReviewOutcome(outcome: TerminalRefundReviewResolutionOutcome | null) {
  if (!outcome) return 'Not resolved';
  if (outcome === 'NO_CORRECTION_NEEDED') return 'No correction needed';
  if (outcome === 'CORRECTION_REQUIRED') return 'Correction required';
  return 'Insufficient evidence';
}

function formatReviewJson(value: unknown) {
  if (value === null || value === undefined) return 'UNKNOWN';
  return JSON.stringify(value);
}

function getStatusTone(status: RefundAdjustmentStatus) {
  if (status === 'applied') return 'success' as const;
  if (status === 'blocked') return 'danger' as const;
  if (status === 'cancelled') return 'neutral' as const;
  if (status === 'partially_applied') return 'warning' as const;
  return 'attention' as const;
}

function getNextAction(adjustment: RefundAdjustmentRecord): NextAction {
  if (adjustment.status === 'pending') {
    return 'Apply';
  }
  if (adjustment.status === 'partially_applied') {
    return adjustment.remainingAmountMinor > 0 ? 'Apply' : 'View';
  }
  if (adjustment.status === 'blocked') {
    return 'Investigate';
  }
  return 'View';
}

function getAdjustmentType(adjustment: RefundAdjustmentRecord) {
  const reason = adjustment.reason.toLowerCase();
  if (reason.includes('debt')) {
    return 'Vendor debt';
  }
  if (adjustment.status === 'partially_applied' || adjustment.appliedAmountMinor > 0) {
    return 'Balance offset';
  }
  if (reason.includes('payment')) {
    return 'Payment adjustment';
  }
  return 'Refund deduction';
}

function getWaitingReason(adjustment: RefundAdjustmentRecord) {
  if (adjustment.status === 'pending') {
    return 'Refund review required';
  }
  if (adjustment.status === 'partially_applied') {
    return 'Balance offset pending';
  }
  if (adjustment.status === 'blocked') {
    return adjustment.blockedReason || 'Blocked adjustment';
  }
  return null;
}

function isLikelyRawIdentifier(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f-]{18,}$/i.test(value) || /^[a-z_]+-[0-9a-f]{8,}/i.test(value);
}

function safeReferenceLabel(value: string | null | undefined, fallback: string) {
  if (!value || isLikelyRawIdentifier(value)) {
    return fallback;
  }
  if (/^(Order|Refund|Settlement|Invoice) [0-9a-f-]{8,}$/i.test(value)) {
    return fallback;
  }
  return value;
}

function getOrderLabel(adjustment: RefundAdjustmentRecord) {
  return safeReferenceLabel(adjustment.references?.orderLabel, 'Order unavailable');
}

function getRefundLabel(adjustment: RefundAdjustmentRecord) {
  return safeReferenceLabel(adjustment.references?.refundLabel, 'Refund Recorded');
}

function getRefundReferenceLabel(adjustment: RefundAdjustmentRecord) {
  const label = getRefundLabel(adjustment);
  if (label === 'Refund Recorded') {
    return label;
  }
  return `Refund reference ${label.replace(/^Refund\s*#?/i, '').trim() || label}`;
}

function getSettlementLabel(adjustment: RefundAdjustmentRecord) {
  const label = safeReferenceLabel(adjustment.references?.originalSettlementLabel, '');
  return label || (adjustment.originalSettlementApprovalId ? 'Linked settlement' : 'No linked settlement');
}

function getVendorLabel(adjustment: RefundAdjustmentRecord, currentVendorId: string, currentVendorName: string) {
  if (adjustment.vendorId === currentVendorId && currentVendorName) {
    return currentVendorName;
  }
  return adjustment.vendorId || 'Vendor unavailable';
}

function matchesWorkflow(adjustment: RefundAdjustmentRecord, workflow: WorkflowTab) {
  if (workflow === 'all') {
    return true;
  }
  if (workflow === 'needs_review') {
    return adjustment.status === 'pending';
  }
  if (workflow === 'partially_applied') {
    return adjustment.status === 'partially_applied';
  }
  return adjustment.status === workflow;
}

function eventTimestamp(adjustment: RefundAdjustmentRecord, eventType: RefundAdjustmentRecord['events'][number]['eventType']) {
  return adjustment.events.find((event) => event.eventType === eventType)?.createdAt ?? null;
}

function buildSearchHaystack(adjustment: RefundAdjustmentRecord, vendorLabel: string) {
  return [
    vendorLabel,
    adjustment.vendorId,
    getOrderLabel(adjustment),
    getRefundLabel(adjustment),
    getAdjustmentType(adjustment),
    STATUS_LABELS[adjustment.status],
    getNextAction(adjustment),
    adjustment.reason,
    adjustment.blockedReason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function AdminRefundAdjustmentsPage() {
  const appReadiness = useAppReadiness();
  const currentVendorId = appReadiness.currentVendor.vendorId;
  const currentVendorName = appReadiness.currentVendor.vendorName;
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>('all');
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(currentVendorId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [highValueOnly, setHighValueOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [terminalOffset, setTerminalOffset] = useState(0);
  const [legacyOffset, setLegacyOffset] = useState(0);
  const [selectedLegacyId, setSelectedLegacyId] = useState<string | null>(null);
  const [legacyStatusFilter, setLegacyStatusFilter] = useState<'all' | LegacyRefundReviewStatus>('all');
  const [legacyOutcomeFilter, setLegacyOutcomeFilter] = useState<'all' | LegacyRefundReviewResolutionOutcome>('all');
  const [legacyAttributionFilter, setLegacyAttributionFilter] = useState<'all' | 'EXACT' | 'AMBIGUOUS'>('all');
  const [legacyActionNote, setLegacyActionNote] = useState('');
  const [legacyResolutionOutcome, setLegacyResolutionOutcome] = useState<LegacyRefundReviewResolutionOutcome | ''>('');
  const [legacyActionPending, setLegacyActionPending] = useState(false);
  const [legacyActionError, setLegacyActionError] = useState<string | null>(null);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [terminalStatusFilter, setTerminalStatusFilter] = useState<'all' | TerminalRefundReviewStatus>('all');
  const [terminalOutcomeFilter, setTerminalOutcomeFilter] = useState<'all' | TerminalRefundReviewResolutionOutcome>('all');
  const [terminalActionNote, setTerminalActionNote] = useState('');
  const [terminalResolutionOutcome, setTerminalResolutionOutcome] = useState<TerminalRefundReviewResolutionOutcome | ''>('');
  const [terminalActionPending, setTerminalActionPending] = useState(false);
  const [terminalActionError, setTerminalActionError] = useState<string | null>(null);
  const [zeroNetPending, setZeroNetPending] = useState(false);
  const [zeroNetError, setZeroNetError] = useState<string | null>(null);
  const [paidCorrectionReason, setPaidCorrectionReason] = useState<{ reviewId: string; value: string }>({ reviewId: '', value: '' });
  const [paidCorrectionPending, setPaidCorrectionPending] = useState(false);
  const [paidCorrectionError, setPaidCorrectionError] = useState<string | null>(null);

  const query = useQueryResource(
    ['admin', 'finance', 'refund-adjustments', vendorFilter],
    ({ signal }) => listRefundAdjustments({ vendorId: vendorFilter || null, signal }),
    {
      routeName: 'Refund adjustments',
      endpoint: '/admin/finance/refund-adjustments',
    },
  );
  const reviewQuery = useQueryResource(
    ['admin', 'finance', 'refund-reviews', vendorFilter, terminalOffset, legacyOffset, terminalStatusFilter, terminalOutcomeFilter, legacyStatusFilter, legacyOutcomeFilter, legacyAttributionFilter],
    ({ signal }) => listAdminRefundReviews({
      vendorId: vendorFilter || null,
      terminalLimit: REVIEW_PAGE_SIZE,
      terminalOffset,
      legacyLimit: REVIEW_PAGE_SIZE,
      legacyOffset,
      terminalStatus: terminalStatusFilter === 'all' ? null : terminalStatusFilter,
      terminalResolutionOutcome: terminalOutcomeFilter === 'all' ? null : terminalOutcomeFilter,
      legacyStatus: legacyStatusFilter === 'all' ? null : legacyStatusFilter,
      legacyResolutionOutcome: legacyOutcomeFilter === 'all' ? null : legacyOutcomeFilter,
      legacyAttribution: legacyAttributionFilter === 'all' ? null : legacyAttributionFilter,
      signal,
    }),
    { routeName: 'Refund reviews', endpoint: '/admin/finance/refund-reviews' },
  );
  const terminalPage = reviewQuery.data?.terminalReviews;
  const legacyPage = reviewQuery.data?.legacyCandidates;
  const selectedLegacyReview = legacyPage?.items.find((review) => review.id === selectedLegacyId) ?? legacyPage?.items[0] ?? null;
  const legacyDetailQuery = useQueryResource(
    ['admin', 'finance', 'legacy-refund-review', selectedLegacyReview?.id ?? 'none'],
    ({ signal }) => getAdminLegacyRefundReview(selectedLegacyReview!.id, signal),
    { routeName: 'Legacy refund finance review detail', endpoint: selectedLegacyReview ? `/admin/finance/legacy-refund-reviews/${selectedLegacyReview.id}` : '/admin/finance/legacy-refund-reviews', enabled: Boolean(selectedLegacyReview) },
  );
  const legacyDetail = legacyDetailQuery.data?.review ?? null;
  const selectedTerminalReview = terminalPage?.items.find((review) => review.id === selectedTerminalId)
    ?? terminalPage?.items[0]
    ?? null;
  const terminalDetailQuery = useQueryResource(
    ['admin', 'finance', 'refund-review', selectedTerminalReview?.id ?? 'none'],
    ({ signal }) => getAdminRefundReview(selectedTerminalReview!.id, signal),
    {
      routeName: 'Refund review detail',
      endpoint: selectedTerminalReview ? `/admin/finance/refund-reviews/${selectedTerminalReview.id}` : '/admin/finance/refund-reviews',
      enabled: Boolean(selectedTerminalReview),
    },
  );
  const terminalDetail = terminalDetailQuery.data?.review ?? null;
  const eligibleTerminalDetail = terminalDetail && selectedTerminalReview && terminalDetail.id === selectedTerminalReview.id
    && terminalDetail.status === 'RESOLVED'
    && terminalDetail.resolutionOutcome === 'CORRECTION_REQUIRED'
    ? terminalDetail : null;
  const correctionPreviewQuery = useQueryResource(
    ['admin', 'finance', 'financial-correction-preview', eligibleTerminalDetail?.id ?? 'none', eligibleTerminalDetail?.updatedAt ?? 'none', eligibleTerminalDetail?.occurrenceCount ?? 0],
    ({ signal }) => getAdminFinancialCorrectionPreview(eligibleTerminalDetail!.id, signal),
    {
      routeName: 'Financial correction preview',
      endpoint: eligibleTerminalDetail
        ? `/admin/finance/refund-reviews/${eligibleTerminalDetail.id}/financial-correction-preview`
        : '/admin/finance/refund-reviews',
      enabled: Boolean(eligibleTerminalDetail),
    },
  );
  const correctionPreview = eligibleTerminalDetail && !correctionPreviewQuery.isFetching && !correctionPreviewQuery.error
    && correctionPreviewQuery.data?.preview.reviewId === eligibleTerminalDetail.id
    ? correctionPreviewQuery.data.preview : null;
  const zeroNetQuery = useQueryResource(
    ['admin', 'finance', 'zero-net-reconciliation-acknowledgement', terminalDetail?.id ?? 'none'],
    ({ signal }) => getZeroNetReconciliationAcknowledgement(terminalDetail!.id, signal),
    {
      routeName: 'Zero-net reconciliation acknowledgement',
      endpoint: terminalDetail
        ? `/admin/finance/refund-reviews/${terminalDetail.id}/financial-correction-zero-net-acknowledgement`
        : '/admin/finance/refund-reviews',
      enabled: Boolean(terminalDetail),
    },
  );
  const zeroNetAcknowledgement = terminalDetail && zeroNetQuery.data?.acknowledgement?.reviewId === terminalDetail.id
    ? zeroNetQuery.data.acknowledgement : null;
  const paidCorrectionQuery = useQueryResource(
    ['admin', 'finance', 'paid-financial-correction', terminalDetail?.id ?? 'none', terminalDetail?.updatedAt ?? 'none'],
    ({ signal }) => getPaidFinancialCorrectionState(terminalDetail!.id, signal),
    {
      routeName: 'Paid financial correction',
      endpoint: terminalDetail ? `/admin/finance/refund-reviews/${terminalDetail.id}/financial-correction-paid-debt` : '/admin/finance/refund-reviews',
      enabled: Boolean(terminalDetail),
    },
  );
  const paidCorrectionState = terminalDetail && !paidCorrectionQuery.isFetching && !paidCorrectionQuery.error
    ? paidCorrectionQuery.data : null;
  const paidCorrectionApplication = paidCorrectionState?.application?.reviewId === terminalDetail?.id
    ? paidCorrectionState?.application ?? null : null;
  const currentPaidReason = paidCorrectionReason.reviewId === terminalDetail?.id ? paidCorrectionReason.value : '';

  const runPaidCorrection = async () => {
    if (!eligibleTerminalDetail || !correctionPreview || !paidCorrectionState?.eligible || paidCorrectionApplication ||
        paidCorrectionPending || !currentPaidReason.trim() || currentPaidReason.trim().length > 500 ||
        correctionPreview.economicDirection !== 'VENDOR_DEDUCTION' ||
        correctionPreview.difference.vendorPayableReversalMinor <= 0) return;
    setPaidCorrectionPending(true);
    setPaidCorrectionError(null);
    try {
      await applyPaidFinancialCorrectionDebt(eligibleTerminalDetail.id, {
        previewFingerprint: correctionPreview.previewFingerprint,
        reason: currentPaidReason.trim(),
      });
      setPaidCorrectionReason({ reviewId: eligibleTerminalDetail.id, value: '' });
      await paidCorrectionQuery.refetch();
    } catch (error) {
      setPaidCorrectionError(error instanceof Error ? error.message : 'Financial correction could not be applied.');
      await Promise.all([correctionPreviewQuery.refetch(), paidCorrectionQuery.refetch(), terminalDetailQuery.refetch()]);
    } finally {
      setPaidCorrectionPending(false);
    }
  };

  const runZeroNetAcknowledgement = async () => {
    if (!correctionPreview || !eligibleTerminalDetail || zeroNetPending || zeroNetQuery.isFetching ||
        zeroNetQuery.error || zeroNetAcknowledgement || correctionPreview.currency !== 'TRY' ||
        correctionPreview.economicDirection !== 'NONE' ||
        correctionPreview.difference.vendorPayableReversalMinor !== 0) return;
    setZeroNetPending(true);
    setZeroNetError(null);
    try {
      await acknowledgeZeroNetReconciliation(eligibleTerminalDetail.id, {
        previewFingerprint: correctionPreview.previewFingerprint,
      });
      await zeroNetQuery.refetch();
    } catch (error) {
      setZeroNetError(error instanceof Error ? error.message : 'Zero-net reconciliation acknowledgement failed.');
      await Promise.all([correctionPreviewQuery.refetch(), zeroNetQuery.refetch(), terminalDetailQuery.refetch()]);
    } finally {
      setZeroNetPending(false);
    }
  };

  const runTerminalReviewAction = async (action: 'acknowledge' | 'resolve' | 'reopen') => {
    if (!terminalDetail || terminalActionPending) return;
    setTerminalActionPending(true);
    setTerminalActionError(null);
    const freshness = {
      expectedStatus: terminalDetail.status,
      expectedUpdatedAt: terminalDetail.updatedAt,
      expectedOccurrenceCount: terminalDetail.occurrenceCount,
      note: terminalActionNote || null,
    };
    try {
      if (action === 'acknowledge') await acknowledgeAdminRefundReview(terminalDetail.id, freshness);
      if (action === 'reopen') await reopenAdminRefundReview(terminalDetail.id, freshness);
      if (action === 'resolve') {
        if (!terminalResolutionOutcome) {
          setTerminalActionError('Select a resolution outcome.');
          return;
        }
        await resolveAdminRefundReview(terminalDetail.id, {
          ...freshness,
          resolutionOutcome: terminalResolutionOutcome,
        });
      }
      setTerminalActionNote('');
      setTerminalResolutionOutcome('');
      await Promise.all([reviewQuery.refetch(), terminalDetailQuery.refetch()]);
    } catch (error) {
      setTerminalActionError(error instanceof Error ? error.message : 'Refund review action failed.');
      await Promise.all([reviewQuery.refetch(), terminalDetailQuery.refetch()]);
    } finally {
      setTerminalActionPending(false);
    }
  };

  const runLegacyReviewAction = async (action: 'acknowledge' | 'resolve' | 'reopen') => {
    if (!legacyDetail || legacyActionPending) return;
    setLegacyActionPending(true);
    setLegacyActionError(null);
    const freshness = { expectedStatus: legacyDetail.status, expectedUpdatedAt: legacyDetail.updatedAt, expectedOccurrenceCount: legacyDetail.occurrenceCount, note: legacyActionNote || null };
    try {
      if (action === 'acknowledge') await acknowledgeAdminLegacyRefundReview(legacyDetail.id, freshness);
      if (action === 'reopen') await reopenAdminLegacyRefundReview(legacyDetail.id, freshness);
      if (action === 'resolve') {
        if (!legacyResolutionOutcome) { setLegacyActionError('Select a resolution outcome.'); return; }
        await resolveAdminLegacyRefundReview(legacyDetail.id, { ...freshness, resolutionOutcome: legacyResolutionOutcome });
      }
      setLegacyActionNote(''); setLegacyResolutionOutcome('');
      await Promise.all([reviewQuery.refetch(), legacyDetailQuery.refetch()]);
    } catch (error) {
      setLegacyActionError(error instanceof Error ? error.message : 'Legacy refund finance review action failed.');
      await Promise.all([reviewQuery.refetch(), legacyDetailQuery.refetch()]);
    } finally { setLegacyActionPending(false); }
  };

  const records = query.data?.records ?? [];
  const advancedFilteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const start = periodStart ? new Date(`${periodStart}T00:00:00.000Z`).getTime() : null;
    const end = periodEnd ? new Date(`${periodEnd}T23:59:59.999Z`).getTime() : null;

    return records.filter((record) => {
      const vendorLabel = getVendorLabel(record, currentVendorId, currentVendorName);
      if (statusFilter !== 'all' && record.status !== statusFilter) {
        return false;
      }
      if (normalizedSearch && !buildSearchHaystack(record, vendorLabel).includes(normalizedSearch)) {
        return false;
      }
      const updatedTime = new Date(record.updatedAt || record.createdAt).getTime();
      if (start !== null && updatedTime < start) {
        return false;
      }
      if (end !== null && updatedTime > end) {
        return false;
      }
      if (highValueOnly && Math.abs(record.amountMinor) < HIGH_VALUE_AMOUNT_MINOR) {
        return false;
      }
      return true;
    });
  }, [currentVendorId, currentVendorName, highValueOnly, periodEnd, periodStart, records, search, statusFilter]);

  const workflowCounts = WORKFLOW_TABS.reduce<Record<WorkflowTab, number>>((counts, tab) => {
    counts[tab.id] = advancedFilteredRecords.filter((record) => matchesWorkflow(record, tab.id)).length;
    return counts;
  }, {
    all: 0,
    needs_review: 0,
    partially_applied: 0,
    applied: 0,
    blocked: 0,
    cancelled: 0,
  });

  const visibleRecords = advancedFilteredRecords.filter((record) => matchesWorkflow(record, workflowTab));
  const selectedAdjustment = visibleRecords.find((record) => record.id === selectedId) ?? visibleRecords[0] ?? null;
  const selectedWaitingReason = selectedAdjustment ? getWaitingReason(selectedAdjustment) : null;

  return (
    <section className="op-page refund-adjustments-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">ADMIN FINANCE</p>
          <h1>Refund Adjustments</h1>
          <p className="page-description">Review refund deductions and balance adjustments before vendor payment.</p>
        </div>
      </div>

      <section className="settlement-review-queue refund-adjustments-queue" aria-label="Refund adjustments queue">
        <div className="orders-workflow-tabs settlement-review-tabs refund-adjustments-tabs" aria-label="Refund adjustment workflow tabs">
          {WORKFLOW_TABS.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={workflowTab === tab.id ? 'is-active' : ''}
              onClick={() => setWorkflowTab(tab.id)}
            >
              <span>{tab.label}</span>
              <strong>{workflowCounts[tab.id]}</strong>
            </button>
          ))}
        </div>

        <div className="op-toolbar settlement-review-filters refund-adjustments-filters" aria-label="Refund adjustment filters">
          <label className="op-search-input">
            <span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Vendor, order, refund" />
          </label>
          <label>
            <span>Vendor</span>
            <input value={vendorFilter} onChange={(event) => {
              setVendorFilter(event.target.value);
              setTerminalOffset(0);
              setLegacyOffset(0);
            }} placeholder="Vendor id" />
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All statuses</option>
              <option value="pending">Needs Review</option>
              <option value="partially_applied">In Review</option>
              <option value="applied">Approved</option>
              <option value="blocked">Blocked</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            <span>Date from</span>
            <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </label>
          <label>
            <span>Date to</span>
            <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </label>
          <label className="op-checkbox-row settlement-review-high-value">
            <input
              type="checkbox"
              checked={highValueOnly}
              onChange={(event) => setHighValueOnly(event.currentTarget.checked)}
            />
            <span>High Value only</span>
          </label>
        </div>

        {query.isLoading ? <p className="page-description">Loading refund adjustments...</p> : null}
        {query.isError ? (
          <SectionErrorRetry
            description={query.error ?? 'Unable to load refund adjustments.'}
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {!query.isLoading && !query.isError && records.length === 0 ? (
          <EmptyStatePanel title="No refund adjustments found" description="Refund-driven payment adjustments will appear here when they require finance review." />
        ) : null}

        {!query.isLoading && !query.isError && records.length > 0 && visibleRecords.length === 0 ? (
          <p className="settlement-compact-empty">No refund adjustments match the selected workflow and filters.</p>
        ) : null}

        {!query.isLoading && !query.isError && visibleRecords.length > 0 ? (
          <div className="settlement-review-layout refund-adjustments-layout">
            <OperationalTable
              columns={['Vendor', 'Refund', 'Adjustment', 'Amount', 'Status', 'Next Action', 'Updated']}
              className="settlement-review-table refund-adjustments-table"
              stickyHeader={false}
            >
              {visibleRecords.map((adjustment) => {
                const vendorLabel = getVendorLabel(adjustment, currentVendorId, currentVendorName);
                return (
                  <OperationalTableRow
                    key={adjustment.id}
                    selected={adjustment.id === selectedAdjustment?.id}
                    onSelect={() => setSelectedId(adjustment.id)}
                  >
                    <span>
                      <strong>{vendorLabel}</strong>
                    </span>
                    <span>
                      <strong>{getOrderLabel(adjustment)}</strong>
                      <small>{getRefundReferenceLabel(adjustment)}</small>
                    </span>
                    <span>
                      <strong>{getAdjustmentType(adjustment)}</strong>
                      <small>{adjustment.reason}</small>
                    </span>
                    <span>
                      <strong>{formatSignedMinor(-Math.abs(adjustment.amountMinor), adjustment.currencyCode)}</strong>
                      <small>Remaining {formatMinor(adjustment.remainingAmountMinor, adjustment.currencyCode)}</small>
                    </span>
                    <span>
                      <StatusBadge tone={getStatusTone(adjustment.status)}>{STATUS_LABELS[adjustment.status]}</StatusBadge>
                    </span>
                    <span><strong>{getNextAction(adjustment)}</strong></span>
                    <span>{formatDate(adjustment.updatedAt)}</span>
                  </OperationalTableRow>
                );
              })}
            </OperationalTable>

            <aside className="op-side-panel settlement-review-panel refund-adjustments-panel" aria-label="Refund adjustment detail panel">
              {selectedAdjustment ? (
                <>
                  <MetadataGroup title="Summary">
                    <MetadataRow label="Vendor" value={getVendorLabel(selectedAdjustment, currentVendorId, currentVendorName)} />
                    <MetadataRow label="Order / Return" value={`${getOrderLabel(selectedAdjustment)} · ${getRefundReferenceLabel(selectedAdjustment)}`} />
                    <MetadataRow label="Refund Amount" value={formatMinor(selectedAdjustment.originalAmountMinor, selectedAdjustment.currencyCode)} />
                    <MetadataRow label="Adjustment Amount" value={formatSignedMinor(-Math.abs(selectedAdjustment.amountMinor), selectedAdjustment.currencyCode)} />
                    <MetadataRow label="Current Status" value={STATUS_LABELS[selectedAdjustment.status]} />
                  </MetadataGroup>

                  {selectedWaitingReason ? (
                    <section className="op-panel-section">
                      <h4>Current Blocker</h4>
                      <p className="page-description">{selectedWaitingReason}</p>
                    </section>
                  ) : null}

                  <MetadataGroup title="Next Action">
                    <MetadataRow label="Action" value={getNextAction(selectedAdjustment)} />
                  </MetadataGroup>

                  <MetadataGroup title="Payment Impact">
                    <MetadataRow
                      label="Remaining impact"
                      value={formatSignedMinor(-Math.abs(selectedAdjustment.remainingAmountMinor || selectedAdjustment.amountMinor), selectedAdjustment.currencyCode)}
                    />
                    <MetadataRow
                      label="Debt adjustment"
                      value={selectedAdjustment.appliedAmountMinor > 0 ? formatMinor(selectedAdjustment.appliedAmountMinor, selectedAdjustment.currencyCode) : 'No debt adjustment'}
                    />
                  </MetadataGroup>

                  <MetadataGroup title="Related Records">
                    <MetadataRow label="Order" value={getOrderLabel(selectedAdjustment)} />
                    <MetadataRow label="Return" value={getRefundReferenceLabel(selectedAdjustment)} />
                    <MetadataRow label="Settlement" value={getSettlementLabel(selectedAdjustment)} />
                    <MetadataRow label="Support" value="No linked support" />
                  </MetadataGroup>

                  <section className="op-panel-section">
                    <h4>Timeline</h4>
                    <ul className="settlement-review-timeline">
                      <li><strong>Refund recorded</strong><span>{formatDate(selectedAdjustment.createdAt)}</span></li>
                      <li><strong>Adjustment created</strong><span>{formatDate(eventTimestamp(selectedAdjustment, 'created') ?? selectedAdjustment.createdAt)}</span></li>
                      {selectedAdjustment.status === 'pending' ? <li><strong>Review started</strong><span>{formatDate(selectedAdjustment.createdAt)}</span></li> : null}
                      {eventTimestamp(selectedAdjustment, 'applied') || selectedAdjustment.status === 'applied' ? (
                        <li><strong>Applied</strong><span>{formatDate(eventTimestamp(selectedAdjustment, 'applied') ?? selectedAdjustment.updatedAt)}</span></li>
                      ) : null}
                      {selectedAdjustment.status === 'blocked' ? <li><strong>Blocked</strong><span>{formatDate(selectedAdjustment.updatedAt)}</span></li> : null}
                      {selectedAdjustment.status === 'cancelled' ? <li><strong>Cancelled</strong><span>{formatDate(selectedAdjustment.updatedAt)}</span></li> : null}
                    </ul>
                  </section>
                </>
              ) : (
                <p className="settlement-compact-empty">Select a refund adjustment to review.</p>
              )}
            </aside>
          </div>
        ) : null}
      </section>

      <section className="settlement-review-queue refund-review-queue" aria-label="Refund evidence conflicts">
        <div className="op-page-heading"><div><h2>Refund evidence conflicts</h2><p className="page-description">Terminal refund evidence requiring Admin investigation.</p></div></div>
        <div className="op-toolbar refund-review-filters" aria-label="Refund evidence conflict filters">
          <label>
            <span>Status</span>
            <select value={terminalStatusFilter} onChange={(event) => {
              setTerminalStatusFilter(event.target.value as 'all' | TerminalRefundReviewStatus);
              setTerminalOffset(0);
              setSelectedTerminalId(null);
            }}>
              <option value="all">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </label>
          <label>
            <span>Resolution outcome</span>
            <select value={terminalOutcomeFilter} onChange={(event) => {
              setTerminalOutcomeFilter(event.target.value as 'all' | TerminalRefundReviewResolutionOutcome);
              setTerminalOffset(0);
              setSelectedTerminalId(null);
            }}>
              <option value="all">All outcomes</option>
              <option value="NO_CORRECTION_NEEDED">No correction needed</option>
              <option value="CORRECTION_REQUIRED">Correction required</option>
              <option value="INSUFFICIENT_EVIDENCE">Insufficient evidence</option>
            </select>
          </label>
        </div>
        {reviewQuery.isLoading ? <p className="page-description">Loading refund evidence conflicts...</p> : null}
        {reviewQuery.isError || terminalPage?.error ? <SectionErrorRetry
          description={terminalPage?.error ?? reviewQuery.error ?? 'Unable to load refund evidence conflicts.'}
          onRetry={() => void reviewQuery.refetch()}
        /> : null}
        {!reviewQuery.isLoading && !reviewQuery.isError && !terminalPage?.error && terminalPage?.count === 0 ? (
          <EmptyStatePanel title="No refund evidence conflicts" description="No terminal refund evidence conflicts are recorded for this vendor scope." />
        ) : null}
        {!reviewQuery.isLoading && !reviewQuery.isError && !terminalPage?.error && terminalPage?.count && terminalPage.items.length === 0 ? (
          <p className="settlement-compact-empty">No refund evidence conflicts on this page.</p>
        ) : null}
        {!reviewQuery.isLoading && !reviewQuery.isError && !terminalPage?.error && terminalPage?.items.length ? (
          <div className="settlement-review-layout refund-review-layout">
            <OperationalTable columns={['Order / refund', 'Vendor', 'Allocation', 'Conflict', 'Accepted refund', 'Status', 'Observed']} className="refund-review-table" stickyHeader={false}>
              {terminalPage.items.map((review) => <OperationalTableRow
                key={review.id}
                selected={review.id === selectedTerminalReview?.id}
                onSelect={() => {
                  setSelectedTerminalId(review.id);
                  setTerminalActionNote('');
                  setTerminalResolutionOutcome('');
                  setTerminalActionError(null);
                }}
              >
                <span><strong>{review.sourceShopifyOrderId}</strong><small>Refund {review.sourceShopifyRefundId}</small></span>
                <span>{review.vendorName ?? review.economicVendorId}</span>
                <span>{review.vendorAllocationId}</span>
                <span><strong>{review.conflictCategory}</strong><small>Stored {review.storedEvidenceHash?.slice(0, 12) ?? 'UNKNOWN'} · Incoming {review.incomingEvidenceHash?.slice(0, 12) ?? 'UNKNOWN'}</small></span>
                <span>{formatRecordedMoney(review.acceptedRecordedAmount, null, review.acceptedRecordedCurrency)}</span>
                <span><StatusBadge tone={review.status === 'RESOLVED' ? 'neutral' : 'attention'}>{review.status}</StatusBadge>{review.resolutionOutcome ? <small>{formatReviewOutcome(review.resolutionOutcome)}</small> : null}<small>{review.occurrenceCount} observation(s)</small></span>
                <span><strong>{formatDate(review.lastObservedAt)}</strong><small>First {formatDate(review.firstObservedAt)}</small></span>
              </OperationalTableRow>)}
            </OperationalTable>
            <aside className="op-side-panel refund-review-detail-panel" aria-label="Refund evidence review detail panel">
              {terminalDetailQuery.isLoading ? <p className="page-description">Loading review...</p> : null}
              {terminalDetailQuery.isError ? <SectionErrorRetry
                description={terminalDetailQuery.error ?? 'Unable to load refund evidence review.'}
                onRetry={() => void terminalDetailQuery.refetch()}
              /> : null}
              {terminalDetail ? (
                <>
                  <div className="op-side-panel-heading">
                    <div><p className="eyebrow">TERMINAL REFUND REVIEW</p><h3>{terminalDetail.sourceShopifyRefundId}</h3></div>
                    <StatusBadge tone={terminalDetail.status === 'RESOLVED' ? 'neutral' : 'attention'}>{terminalDetail.status}</StatusBadge>
                  </div>
                  <p className="page-description">Review actions do not change accepted finance.</p>
                  {terminalDetail.resolutionOutcome === 'CORRECTION_REQUIRED' && paidCorrectionState && !paidCorrectionApplication ? (
                    <p className="op-alert op-tone-attention">Financial correction required. No financial correction has been applied.</p>
                  ) : null}

                  <MetadataGroup title="Review">
                    <MetadataRow label="Status" value={terminalDetail.status} />
                    <MetadataRow label="Resolution outcome" value={formatReviewOutcome(terminalDetail.resolutionOutcome)} />
                    <MetadataRow label="Conflict category" value={terminalDetail.conflictCategory} />
                    <MetadataRow label="Occurrences" value={terminalDetail.occurrenceCount} />
                    <MetadataRow label="First observed" value={formatDate(terminalDetail.firstObservedAt)} />
                    <MetadataRow label="Last observed" value={formatDate(terminalDetail.lastObservedAt)} />
                  </MetadataGroup>

                  <MetadataGroup title="References">
                    <MetadataRow label="Order" value={<Link to={`/admin/orders/${encodeURIComponent(terminalDetail.sourceShopifyOrderId)}`}>{terminalDetail.sourceShopifyOrderId}</Link>} />
                    <MetadataRow label="Refund" value={terminalDetail.sourceShopifyRefundId} />
                    <MetadataRow label="Vendor" value={terminalDetail.vendorName ?? terminalDetail.economicVendorId} />
                    <MetadataRow label="Allocation" value={terminalDetail.vendorAllocationId} />
                  </MetadataGroup>

                  <MetadataGroup title="Accepted finance">
                    <MetadataRow label="Accepted refund" value={formatRecordedMoney(terminalDetail.acceptedRecordedAmount, null, terminalDetail.acceptedRecordedCurrency)} />
                    <MetadataRow label="Currency" value={terminalDetail.acceptedRecordedCurrency ?? 'UNKNOWN'} />
                    <MetadataRow label="Ledger reference" value={terminalDetail.terminalRefundFinanceLedgerEntryId} />
                    <MetadataRow label="Snapshot reference" value={terminalDetail.storedEvidenceSnapshotId ?? 'UNKNOWN'} />
                  </MetadataGroup>

                  <MetadataGroup title="Evidence">
                    <MetadataRow label="Stored hash" value={terminalDetail.storedEvidenceHash ?? 'UNKNOWN'} />
                    <MetadataRow label="Incoming hash" value={terminalDetail.incomingEvidenceHash ?? 'UNKNOWN'} />
                    <MetadataRow label="Evidence version" value={terminalDetail.evidenceVersion ?? 'UNKNOWN'} />
                    <MetadataRow label="Normalization version" value={terminalDetail.normalizationVersion ?? 'UNKNOWN'} />
                    <MetadataRow label="Conflict summary" value={<code>{formatReviewJson(terminalDetail.conflictSummary)}</code>} />
                  </MetadataGroup>

                  {eligibleTerminalDetail ? (
                    <section className="op-panel-section" aria-label="Financial correction preview">
                      <h4>Financial correction preview</h4>
                      <p className="page-description">{paidCorrectionApplication
                        ? 'Read-only calculation. Applied correction is shown below.'
                        : paidCorrectionState
                          ? 'Read-only calculation. No financial correction has been applied.'
                          : 'Read-only calculation. Checking correction history...'}</p>
                      {correctionPreviewQuery.isFetching ? <p className="page-description">Loading correction preview...</p> : null}
                      {correctionPreviewQuery.error ? <p className="op-alert op-tone-attention" role="status">Correction preview unavailable: {correctionPreviewQuery.error}</p> : null}
                      {correctionPreview ? (
                        <>
                          <MetadataGroup title="Authority">
                            <MetadataRow label="Vendor" value={correctionPreview.vendorId} />
                            <MetadataRow label="Allocation" value={correctionPreview.vendorAllocationId} />
                            <MetadataRow label="Refund" value={correctionPreview.sourceShopifyRefundId} />
                            <MetadataRow label="Historical SALE ledger" value={correctionPreview.historicalSaleFinanceLedgerEntryId} />
                            <MetadataRow label="Accepted REFUND ledger" value={correctionPreview.acceptedRefundFinanceLedgerEntryId} />
                            <MetadataRow label="Currency" value={correctionPreview.currency} />
                            <MetadataRow label="Evidence verification" value="Accepted and incoming evidence verified" />
                            <MetadataRow label="Preview identity" value={correctionPreview.previewFingerprint} />
                          </MetadataGroup>
                          <MetadataGroup title="Allocation-scoped refund effect">
                            <MetadataRow label="Accepted refund amount" value={formatMinor(correctionPreview.accepted.refundAmountMinor)} />
                            <MetadataRow label="Corrected refund amount" value={formatMinor(correctionPreview.corrected.refundAmountMinor)} />
                            <MetadataRow label="Refund difference" value={formatSignedMinor(correctionPreview.difference.refundAmountMinor)} />
                            <MetadataRow label="Accepted commission reversal" value={formatMinor(correctionPreview.accepted.commissionReversalMinor)} />
                            <MetadataRow label="Corrected commission reversal" value={formatMinor(correctionPreview.corrected.commissionReversalMinor)} />
                            <MetadataRow label="Commission difference" value={formatSignedMinor(correctionPreview.difference.commissionReversalMinor)} />
                            <MetadataRow label="Accepted commission VAT reversal" value={formatMinor(correctionPreview.accepted.commissionVatReversalMinor)} />
                            <MetadataRow label="Corrected commission VAT reversal" value={formatMinor(correctionPreview.corrected.commissionVatReversalMinor)} />
                            <MetadataRow label="Commission VAT difference" value={formatSignedMinor(correctionPreview.difference.commissionVatReversalMinor)} />
                            <MetadataRow label="Accepted vendor-payable effect" value={formatMinor(correctionPreview.accepted.vendorPayableReversalMinor)} />
                            <MetadataRow label="Corrected vendor-payable effect" value={formatMinor(correctionPreview.corrected.vendorPayableReversalMinor)} />
                            <MetadataRow label="Final vendor-payable difference" value={formatSignedMinor(correctionPreview.difference.vendorPayableReversalMinor)} />
                            <MetadataRow label="Economic direction" value={correctionPreview.economicDirection === 'VENDOR_DEDUCTION'
                              ? 'Vendor owes Sporgym more'
                              : correctionPreview.economicDirection === 'VENDOR_CREDIT'
                                ? 'Sporgym owes vendor more'
                                : 'No vendor monetary effect'} />
                          </MetadataGroup>
                          {correctionPreview.currency === 'TRY' && correctionPreview.economicDirection === 'NONE'
                            && correctionPreview.difference.vendorPayableReversalMinor === 0 ? (
                              <section className="op-panel-section" aria-label="Zero-net reconciliation">
                                <h5>Zero-net reconciliation</h5>
                                <p className="page-description">Acknowledgement records review of this calculation. It does not move money.</p>
                                {!zeroNetAcknowledgement && !zeroNetQuery.isFetching && !zeroNetQuery.error ? (
                                  <button type="button" disabled={zeroNetPending} onClick={() => void runZeroNetAcknowledgement()}>
                                    {zeroNetPending ? 'Acknowledging...' : 'Acknowledge zero-net reconciliation'}
                                  </button>
                                ) : null}
                                {zeroNetError ? <p className="op-alert op-tone-danger" role="alert">{zeroNetError}</p> : null}
                              </section>
                            ) : null}
                          {correctionPreview.economicDirection === 'VENDOR_DEDUCTION' &&
                            correctionPreview.difference.vendorPayableReversalMinor > 0 && paidCorrectionState?.eligible &&
                            !paidCorrectionApplication ? (
                              <section className="op-panel-section" aria-label="Paid correction debt application">
                                <h5>Paid payout vendor debt</h5>
                                <p className="page-description">Applying {formatMinor(correctionPreview.difference.vendorPayableReversalMinor)} creates a new future vendor debt. The historical PAID payout remains unchanged.</p>
                                <label><span>Required Admin reason</span><textarea maxLength={500} value={currentPaidReason} onChange={(event) => setPaidCorrectionReason({ reviewId: eligibleTerminalDetail.id, value: event.target.value })} /></label>
                                <button type="button" disabled={paidCorrectionPending || !currentPaidReason.trim()} onClick={() => void runPaidCorrection()}>
                                  {paidCorrectionPending ? 'Applying...' : 'Approve & Apply Correction'}
                                </button>
                              </section>
                            ) : null}
                          {correctionPreview.economicDirection === 'VENDOR_CREDIT' ? <p className="op-alert op-tone-attention">Vendor credit correction is not supported yet. This preview is read-only.</p> : null}
                        </>
                      ) : null}
                    </section>
                  ) : null}
                  {paidCorrectionError ? <p className="op-alert op-tone-danger" role="alert">{paidCorrectionError}</p> : null}
                  {paidCorrectionQuery.error ? <p className="op-alert op-tone-attention" role="status">Paid correction history unavailable: {paidCorrectionQuery.error}</p> : null}
                  {paidCorrectionApplication ? (
                    <MetadataGroup title="Applied financial correction">
                      <MetadataRow label="Status" value="Applied" />
                      <MetadataRow label="Direction" value="Vendor deduction" />
                      <MetadataRow label="Correction debt" value={formatMinor(paidCorrectionApplication.authorizedDebtMinor)} />
                      <MetadataRow label="Admin actor" value={paidCorrectionApplication.authorizedByUserId} />
                      <MetadataRow label="Applied at" value={formatDate(paidCorrectionApplication.appliedAt)} />
                      <MetadataRow label="Correction authority" value={paidCorrectionApplication.id} />
                      <MetadataRow label="Debt event" value={paidCorrectionApplication.vendorBalanceEventId} />
                      <MetadataRow label="Historical PAID payout" value={paidCorrectionApplication.historicalPayoutBatchId} />
                      <MetadataRow label="Historical payout paid at" value={formatDate(paidCorrectionApplication.historicalPayoutPaidAt)} />
                      <MetadataRow label="Reason" value={paidCorrectionApplication.reason} />
                      <p className="page-description">The historical PAID payout was not modified. This debt affects future payout balance.</p>
                    </MetadataGroup>
                  ) : null}
                  {zeroNetQuery.error ? <p className="op-alert op-tone-attention" role="status">Zero-net acknowledgement history unavailable: {zeroNetQuery.error}</p> : null}
                  {zeroNetAcknowledgement ? (
                    <MetadataGroup title="Zero-net reconciliation acknowledgement">
                      <MetadataRow label="Status" value="Acknowledged — no vendor monetary effect" />
                      <MetadataRow label="Admin actor" value={zeroNetAcknowledgement.acknowledgedByUserId} />
                      <MetadataRow label="Acknowledged at" value={formatDate(zeroNetAcknowledgement.acknowledgedAt)} />
                      {zeroNetAcknowledgement.note ? <MetadataRow label="Note" value={zeroNetAcknowledgement.note} /> : null}
                    </MetadataGroup>
                  ) : null}

                  <section className="op-panel-section">
                    <h4>History</h4>
                    <ul className="settlement-review-timeline">
                      {terminalDetail.events.map((event) => (
                        <li key={event.id}>
                          <strong>{event.eventType}</strong>
                          <span>{formatDate(event.createdAt)}</span>
                          {event.actorName || event.actorUserId ? <small>{event.actorName ?? event.actorUserId}</small> : null}
                          {event.resolutionOutcome ? <small>{formatReviewOutcome(event.resolutionOutcome)}</small> : null}
                          {event.note ? <small>{event.note}</small> : null}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="op-panel-section" aria-label="Refund evidence review actions">
                    <h4>Review action</h4>
                    {terminalDetail.status === 'ACKNOWLEDGED' ? (
                      <label>
                        <span>Resolution outcome</span>
                        <select value={terminalResolutionOutcome} onChange={(event) => setTerminalResolutionOutcome(event.target.value as TerminalRefundReviewResolutionOutcome)}>
                          <option value="">Select outcome</option>
                          <option value="NO_CORRECTION_NEEDED">No correction needed</option>
                          <option value="CORRECTION_REQUIRED">Correction required</option>
                          <option value="INSUFFICIENT_EVIDENCE">Insufficient evidence</option>
                        </select>
                      </label>
                    ) : null}
                    <label>
                      <span>Optional note</span>
                      <textarea value={terminalActionNote} onChange={(event) => setTerminalActionNote(event.target.value)} />
                    </label>
                    {terminalActionError ? <p className="op-alert op-tone-danger" role="alert">{terminalActionError}</p> : null}
                    {terminalDetail.status === 'ACTIVE' ? <button type="button" disabled={terminalActionPending} onClick={() => void runTerminalReviewAction('acknowledge')}>Acknowledge</button> : null}
                    {terminalDetail.status === 'ACKNOWLEDGED' ? <button type="button" disabled={terminalActionPending || !terminalResolutionOutcome} onClick={() => void runTerminalReviewAction('resolve')}>Resolve</button> : null}
                    {terminalDetail.status === 'RESOLVED' ? <button type="button" disabled={terminalActionPending} onClick={() => void runTerminalReviewAction('reopen')}>Reopen</button> : null}
                  </section>
                </>
              ) : null}
            </aside>
          </div>
        ) : null}
        {terminalPage && !terminalPage.error && (terminalPage.count > REVIEW_PAGE_SIZE || terminalOffset > 0) ? <div className="op-toolbar refund-review-pagination">
          <button type="button" disabled={terminalOffset === 0} onClick={() => setTerminalOffset(Math.max(0, terminalOffset - REVIEW_PAGE_SIZE))}>Previous conflicts</button>
          <span>{terminalPage.items.length ? `${terminalOffset + 1}–${Math.min(terminalOffset + REVIEW_PAGE_SIZE, terminalPage.count)}` : '0'} of {terminalPage.count}</span>
          <button type="button" disabled={terminalOffset + REVIEW_PAGE_SIZE >= terminalPage.count} onClick={() => setTerminalOffset(terminalOffset + REVIEW_PAGE_SIZE)}>Next conflicts</button>
        </div> : null}
      </section>

      <section className="settlement-review-queue refund-review-queue" aria-label="Legacy refund finance">
        <div className="op-page-heading"><div><h2>Legacy refund finance</h2><p className="page-description">Reviews persisted historical finance without recalculating or changing it.</p></div><button type="button" onClick={async () => { await syncLegacyRefundReviews(vendorFilter || null); setLegacyOffset(0); setSelectedLegacyId(null); await reviewQuery.refetch(); }}>Sync legacy reviews</button></div>
        <div className="op-toolbar refund-review-filters" aria-label="Legacy refund finance filters">
          <label><span>Status</span><select value={legacyStatusFilter} onChange={(event) => { setLegacyStatusFilter(event.target.value as 'all' | LegacyRefundReviewStatus); setLegacyOffset(0); setSelectedLegacyId(null); }}><option value="all">All statuses</option><option value="ACTIVE">Active</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option></select></label>
          <label><span>Resolution outcome</span><select value={legacyOutcomeFilter} onChange={(event) => { setLegacyOutcomeFilter(event.target.value as 'all' | LegacyRefundReviewResolutionOutcome); setLegacyOffset(0); setSelectedLegacyId(null); }}><option value="all">All outcomes</option><option value="NO_CORRECTION_NEEDED">No correction needed</option><option value="CORRECTION_REQUIRED">Correction required</option><option value="INSUFFICIENT_EVIDENCE">Insufficient evidence</option></select></label>
          <label><span>Attribution</span><select value={legacyAttributionFilter} onChange={(event) => { setLegacyAttributionFilter(event.target.value as 'all' | 'EXACT' | 'AMBIGUOUS'); setLegacyOffset(0); setSelectedLegacyId(null); }}><option value="all">All attribution</option><option value="EXACT">Exact</option><option value="AMBIGUOUS">Ambiguous</option></select></label>
        </div>
        {reviewQuery.isLoading ? <p className="page-description">Loading legacy refund finance...</p> : null}
        {reviewQuery.isError || legacyPage?.error ? <SectionErrorRetry
          description={legacyPage?.error ?? reviewQuery.error ?? 'Unable to load legacy refund finance.'}
          onRetry={() => void reviewQuery.refetch()}
        /> : null}
        {!reviewQuery.isLoading && !reviewQuery.isError && !legacyPage?.error && legacyPage?.count === 0 ? (
          <EmptyStatePanel title="No legacy refund finance" description="No historical refund-finance candidates are recorded for this vendor scope." />
        ) : null}
        {!reviewQuery.isLoading && !reviewQuery.isError && !legacyPage?.error && legacyPage?.count && legacyPage.items.length === 0 ? (
          <p className="settlement-compact-empty">No legacy refund finance on this page.</p>
        ) : null}
        {!reviewQuery.isLoading && !reviewQuery.isError && !legacyPage?.error && legacyPage?.items.length ? (
          <div className="settlement-review-layout refund-review-layout">
          <OperationalTable columns={['Order / refund', 'Vendor', 'Allocation', 'Sources', 'Attribution', 'Status', 'Observed']} className="refund-review-table" stickyHeader={false}>
            {legacyPage.items.map((candidate) => <OperationalTableRow key={candidate.id} selected={candidate.id === selectedLegacyReview?.id} onSelect={() => { setSelectedLegacyId(candidate.id); setLegacyActionNote(''); setLegacyResolutionOutcome(''); setLegacyActionError(null); }}>
              <span><strong>{candidate.sourceShopifyOrderId ?? 'UNKNOWN'}</strong><small>Refund {candidate.sourceShopifyRefundId ?? 'UNKNOWN'}</small></span>
              <span>{candidate.vendorName ?? candidate.observedVendorId ?? 'UNKNOWN'}</span>
              <span>{candidate.vendorAllocationId ?? 'UNKNOWN'}</span>
              <span><strong>{candidate.sourceCount}</strong><small>{candidate.occurrenceCount} observation(s)</small></span>
              <span><StatusBadge tone={candidate.attribution === 'exact' ? 'neutral' : 'attention'}>{candidate.attribution}</StatusBadge></span>
              <span><StatusBadge tone={candidate.status === 'RESOLVED' ? 'neutral' : 'attention'}>{candidate.status}</StatusBadge>{candidate.resolutionOutcome ? <small>{formatReviewOutcome(candidate.resolutionOutcome)}</small> : null}</span>
              <span><strong>{formatDate(candidate.lastObservedAt)}</strong><small>First {formatDate(candidate.firstObservedAt)}</small></span>
            </OperationalTableRow>)}
          </OperationalTable>
          <aside className="op-side-panel refund-review-detail-panel" aria-label="Legacy refund finance review detail panel">
            {legacyDetailQuery.isLoading ? <p className="page-description">Loading legacy review...</p> : null}
            {legacyDetailQuery.isError ? <SectionErrorRetry description={legacyDetailQuery.error ?? 'Unable to load legacy refund finance review.'} onRetry={() => void legacyDetailQuery.refetch()} /> : null}
            {legacyDetail ? <>
              <div className="op-side-panel-heading"><div><p className="eyebrow">LEGACY FINANCE REVIEW</p><h3>{legacyDetail.sourceShopifyRefundId ?? 'UNKNOWN refund'}</h3></div><StatusBadge tone={legacyDetail.status === 'RESOLVED' ? 'neutral' : 'attention'}>{legacyDetail.status}</StatusBadge></div>
              <p className="page-description">This review records investigation of persisted historical finance. It does not recalculate or change finance.</p>
              {legacyDetail.resolutionOutcome === 'CORRECTION_REQUIRED' ? <p className="op-alert op-tone-attention">Financial correction required. No financial correction has been applied.</p> : null}
              <MetadataGroup title="Review"><MetadataRow label="Status" value={legacyDetail.status} /><MetadataRow label="Resolution outcome" value={formatReviewOutcome(legacyDetail.resolutionOutcome)} /><MetadataRow label="Attribution" value={legacyDetail.attribution} /><MetadataRow label="Occurrences" value={legacyDetail.occurrenceCount} /><MetadataRow label="First observed" value={formatDate(legacyDetail.firstObservedAt)} /><MetadataRow label="Last observed" value={formatDate(legacyDetail.lastObservedAt)} /></MetadataGroup>
              <MetadataGroup title="References"><MetadataRow label="Order" value={legacyDetail.sourceShopifyOrderId ? <Link to={`/admin/orders/${encodeURIComponent(legacyDetail.sourceShopifyOrderId)}`}>{legacyDetail.sourceShopifyOrderId}</Link> : 'UNKNOWN'} /><MetadataRow label="Refund" value={legacyDetail.sourceShopifyRefundId ?? 'UNKNOWN'} /><MetadataRow label="Vendor" value={legacyDetail.vendorName ?? legacyDetail.observedVendorId ?? 'UNKNOWN'} /><MetadataRow label="Allocation" value={legacyDetail.vendorAllocationId ?? 'UNKNOWN'} /></MetadataGroup>
              <section className="op-panel-section"><h4>Source artifacts</h4><ul className="settlement-review-timeline">{legacyDetail.sources.map((source) => <li key={source.id}><strong>{source.artifactType.replaceAll('_', ' ')}</strong><span>{source.artifactId}</span><small>{formatRecordedMoney(source.recordedAmount, source.recordedAmountMinor, source.currency)}</small><small>{source.sourceState ?? 'State UNKNOWN'} · {formatDate(source.observedAt)}</small>{source.voidedAt ? <small>Voided {formatDate(source.voidedAt)}</small> : null}{source.supersededByLedgerId ? <small>Superseded</small> : null}</li>)}</ul></section>
              <section className="op-panel-section"><h4>History</h4><ul className="settlement-review-timeline">{legacyDetail.events.map((event) => <li key={event.id}><strong>{event.eventType}</strong><span>{formatDate(event.createdAt)}</span>{event.actorName || event.actorUserId ? <small>{event.actorName ?? event.actorUserId}</small> : null}{event.resolutionOutcome ? <small>{formatReviewOutcome(event.resolutionOutcome)}</small> : null}{event.note ? <small>{event.note}</small> : null}</li>)}</ul></section>
              <section className="op-panel-section" aria-label="Legacy refund finance review actions"><h4>Review action</h4>{legacyDetail.status === 'ACKNOWLEDGED' ? <label><span>Resolution outcome</span><select value={legacyResolutionOutcome} onChange={(event) => setLegacyResolutionOutcome(event.target.value as LegacyRefundReviewResolutionOutcome)}><option value="">Select outcome</option><option value="NO_CORRECTION_NEEDED">No correction needed</option><option value="CORRECTION_REQUIRED">Correction required</option><option value="INSUFFICIENT_EVIDENCE">Insufficient evidence</option></select></label> : null}<label><span>Optional note</span><textarea value={legacyActionNote} onChange={(event) => setLegacyActionNote(event.target.value)} /></label>{legacyActionError ? <p className="op-alert op-tone-danger" role="alert">{legacyActionError}</p> : null}{legacyDetail.status === 'ACTIVE' ? <button type="button" disabled={legacyActionPending} onClick={() => void runLegacyReviewAction('acknowledge')}>Acknowledge</button> : null}{legacyDetail.status === 'ACKNOWLEDGED' ? <button type="button" disabled={legacyActionPending || !legacyResolutionOutcome} onClick={() => void runLegacyReviewAction('resolve')}>Resolve</button> : null}{legacyDetail.status === 'RESOLVED' ? <button type="button" disabled={legacyActionPending} onClick={() => void runLegacyReviewAction('reopen')}>Reopen</button> : null}</section>
            </> : null}
          </aside>
          </div>
        ) : null}
        {legacyPage && !legacyPage.error && (legacyPage.count > REVIEW_PAGE_SIZE || legacyOffset > 0) ? <div className="op-toolbar refund-review-pagination">
          <button type="button" disabled={legacyOffset === 0} onClick={() => setLegacyOffset(Math.max(0, legacyOffset - REVIEW_PAGE_SIZE))}>Previous legacy</button>
          <span>{legacyPage.items.length ? `${legacyOffset + 1}–${Math.min(legacyOffset + REVIEW_PAGE_SIZE, legacyPage.count)}` : '0'} of {legacyPage.count}</span>
          <button type="button" disabled={legacyOffset + REVIEW_PAGE_SIZE >= legacyPage.count} onClick={() => setLegacyOffset(legacyOffset + REVIEW_PAGE_SIZE)}>Next legacy</button>
        </div> : null}
      </section>
    </section>
  );
}
