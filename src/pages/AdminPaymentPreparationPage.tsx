import { useMemo, useState } from 'react';
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
  cancelPayoutBatch,
  getPaymentPreparationReadiness,
  listPayoutBatches,
  markPayoutBatchPaid,
  markPayoutBatchReview,
  preparePayoutBatch,
  type FinanceDashboard,
  type PayoutBatch,
  type PayoutBatchStatus,
} from '../features/finance/paymentPreparationApi';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { formatCurrency, formatDateTime, parseSafeDate } from '../services/real/formatting';

type WorkflowTab = 'all' | 'ready_to_prepare' | 'draft' | 'review' | 'approved' | 'paid' | 'cancelled';
type StatusFilter = 'all' | 'ready_to_prepare' | PayoutBatchStatus;
type QueueStatus = 'Ready' | 'Needs Review' | 'In Review' | 'Approved' | 'Paid' | 'Cancelled';
type NextAction = 'Prepare Batch' | 'Mark for Review' | 'Mark Paid' | 'No action available';
type IssueLabel = 'Refund' | 'Debt' | 'Hold' | 'Ready';
type PaymentAction = 'prepare' | 'mark_review' | 'mark_paid' | 'cancel';

type PaymentQueueItem =
  | {
      source: 'ready';
      id: string;
      vendorId: string;
      dashboard: FinanceDashboard;
    }
  | {
      source: 'batch';
      id: string;
      vendorId: string;
      batch: PayoutBatch;
    };

const HIGH_VALUE_AMOUNT = 100000;

const WORKFLOW_TABS: Array<{ id: WorkflowTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ready_to_prepare', label: 'Ready' },
  { id: 'draft', label: 'Needs Review' },
  { id: 'review', label: 'In Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'ready_to_prepare', label: 'Ready' },
  { value: 'draft', label: 'Needs Review' },
  { value: 'review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'execution_pending', label: 'In Review' },
  { value: 'paid', label: 'Paid' },
  { value: 'paid_placeholder', label: 'Payment evidence pending' },
  { value: 'cancelled', label: 'Cancelled' },
];

function formatDate(value: string | null | undefined) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }, 'No finance activity recorded yet.');
}

function formatShortDate(value: string | null | undefined) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }, 'No payment period');
}

function getAmountValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const sanitized = trimmed.replace(/[^\d,.-]/g, '');
  const lastComma = sanitized.lastIndexOf(',');
  const lastDot = sanitized.lastIndexOf('.');
  const decimalSeparator = lastComma > lastDot ? ',' : '.';
  const normalized = sanitized
    .replace(decimalSeparator === ',' ? /\./g : /,/g, '')
    .replace(decimalSeparator, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPaymentAmount(value: string | null | undefined, currency = 'TRY') {
  if (!value) {
    return 'No payment evidence yet';
  }
  if (!/\d/.test(value)) {
    return value;
  }
  const amount = getAmountValue(value);
  if (!Number.isFinite(amount)) {
    return 'No payment evidence yet';
  }
  return formatCurrency(amount.toFixed(2), currency);
}

function formatOptionalPaymentAmount(value: string | null | undefined, emptyLabel: string) {
  return value ? formatPaymentAmount(value) : emptyLabel;
}

function hasAmount(value: string | null | undefined) {
  return Math.abs(getAmountValue(value)) > 0.0001;
}

function getSafeVendorLabel(vendorId: string, currentVendorId: string, currentVendorName: string) {
  if (vendorId === currentVendorId && currentVendorName) {
    return currentVendorName;
  }
  if (!vendorId) {
    return 'Vendor unavailable';
  }
  if (/^[0-9a-f]{8}-[0-9a-f-]{18,}$/i.test(vendorId)) {
    return 'Vendor unavailable';
  }
  return vendorId;
}

function getItemUpdatedAt(item: PaymentQueueItem) {
  return item.source === 'batch' ? item.batch.updatedAt : item.dashboard.payoutBatchSummary?.latestBatch?.updatedAt ?? null;
}

function getPaymentPeriodKey(item: PaymentQueueItem) {
  if (item.source === 'ready') {
    return 'current';
  }
  const date = parseSafeDate(item.batch.createdAt || item.batch.updatedAt);
  return date ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` : 'unknown';
}

function getPaymentPeriodLabel(key: string) {
  if (key === 'current') {
    return 'Current readiness';
  }
  if (key === 'unknown') {
    return 'No payment period';
  }
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) {
    return 'No payment period';
  }
  return formatDateTime(Date.UTC(year, month - 1, 1), { month: 'short', year: 'numeric' }, 'No payment period');
}

function getPaymentLabel(item: PaymentQueueItem) {
  if (item.source === 'ready') {
    return {
      primary: 'Ready payment preparation',
      secondary: `${item.dashboard.payoutBatchSummary?.eligibleRowCount ?? 0} eligible settlement rows`,
    };
  }
  return {
    primary: 'Payment draft',
    secondary: formatShortDate(item.batch.createdAt),
  };
}

function getGrossAmount(item: PaymentQueueItem) {
  if (item.source === 'ready') {
    return item.dashboard.summary?.grossSales ?? 'No payment evidence yet';
  }
  return item.batch.grossAmount;
}

function getNetPayable(item: PaymentQueueItem) {
  if (item.source === 'ready') {
    const summary = item.dashboard.payoutBatchSummary;
    return summary?.netEligibleAfterDebtOffset ?? summary?.eligibleNetAmount ?? item.dashboard.summary?.payableBalance ?? 'No payment evidence yet';
  }
  return item.batch.netAmount;
}

function getQueueStatus(item: PaymentQueueItem): QueueStatus {
  if (item.source === 'ready') {
    return 'Ready';
  }
  if (item.batch.status === 'draft') {
    return 'Needs Review';
  }
  if (item.batch.status === 'review') {
    return 'In Review';
  }
  if (item.batch.status === 'approved') {
    return 'Approved';
  }
  if (item.batch.status === 'execution_pending') {
    return 'In Review';
  }
  if (item.batch.status === 'paid') {
    return 'Paid';
  }
  if (item.batch.status === 'paid_placeholder') {
    return 'In Review';
  }
  if (item.batch.status === 'cancelled') {
    return 'Cancelled';
  }
  return 'In Review';
}

function getStatusTone(status: QueueStatus) {
  if (status === 'Ready' || status === 'Approved' || status === 'Paid') return 'success' as const;
  if (status === 'Needs Review') return 'info' as const;
  if (status === 'In Review') return 'attention' as const;
  if (status === 'Cancelled') return 'neutral' as const;
  return 'neutral' as const;
}

function getIssues(item: PaymentQueueItem): IssueLabel[] {
  const issues: IssueLabel[] = [];
  if (item.source === 'ready') {
    const summary = item.dashboard.payoutBatchSummary;
    if ((summary?.blockedRowCount ?? 0) > 0) {
      issues.push('Hold');
    }
    if (hasAmount(summary?.outstandingDebtAmount) || hasAmount(summary?.debtOffsetPreviewAmount)) {
      issues.push('Debt');
    }
    return issues.length > 0 ? issues : ['Ready'];
  }

  if (hasAmount(item.batch.refundAmount)) {
    issues.push('Refund');
  }
  if (hasAmount(item.batch.outstandingDebtAmount) || hasAmount(item.batch.debtOffsetAmount) || hasAmount(item.batch.remainingDebtAmount)) {
    issues.push('Debt');
  }
  if (item.batch.warning) {
    issues.push('Hold');
  }
  if (item.batch.status === 'execution_pending') {
    issues.push('Hold');
  }
  return issues.length > 0 ? issues : ['Ready'];
}

function getWaitingReason(item: PaymentQueueItem) {
  if (item.source === 'ready') {
    const summary = item.dashboard.payoutBatchSummary;
    if ((summary?.blockedRowCount ?? 0) > 0) {
      return 'Missing payment evidence';
    }
    if (hasAmount(summary?.outstandingDebtAmount) || hasAmount(summary?.debtOffsetPreviewAmount)) {
      return 'Refund adjustment pending';
    }
    return null;
  }

  if (item.batch.warning) {
    return item.batch.warning;
  }
  if (hasAmount(item.batch.remainingDebtAmount)) {
    return 'Vendor hold';
  }
  if (item.batch.status === 'execution_pending') {
    return 'Export not ready';
  }
  return null;
}

function getNextAction(item: PaymentQueueItem): NextAction {
  if (item.source === 'ready') {
    return 'Prepare Batch';
  }
  if (item.batch.status === 'draft') {
    return 'Mark for Review';
  }
  if (item.batch.status === 'review') {
    return 'Mark Paid';
  }
  return 'No action available';
}

function getSupportedPaymentActions(item: PaymentQueueItem): PaymentAction[] {
  if (item.source === 'ready') {
    return ['prepare'];
  }
  if (item.batch.status === 'draft') {
    return ['mark_review', 'cancel'];
  }
  if (item.batch.status === 'review') {
    return ['mark_paid'];
  }
  return [];
}

function matchesWorkflow(item: PaymentQueueItem, workflow: WorkflowTab) {
  if (workflow === 'all') {
    return true;
  }
  if (workflow === 'ready_to_prepare') {
    return item.source === 'ready';
  }
  if (item.source !== 'batch') {
    return false;
  }
  if (workflow === 'paid') {
    return item.batch.status === 'paid';
  }
  if (workflow === 'approved') {
    return item.batch.status === 'approved' || item.batch.status === 'execution_pending';
  }
  return item.batch.status === workflow;
}

function matchesStatusFilter(item: PaymentQueueItem, statusFilter: StatusFilter) {
  if (statusFilter === 'all') {
    return true;
  }
  if (statusFilter === 'ready_to_prepare') {
    return item.source === 'ready';
  }
  return item.source === 'batch' && item.batch.status === statusFilter;
}

function buildSearchHaystack(item: PaymentQueueItem, vendorLabel: string) {
  const payment = getPaymentLabel(item);
  return [
    vendorLabel,
    item.vendorId,
    payment.primary,
    payment.secondary,
    getQueueStatus(item),
    getNextAction(item),
    getIssues(item).join(' '),
    getWaitingReason(item),
    getGrossAmount(item),
    getNetPayable(item),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildQueueItems(vendorId: string, dashboard: FinanceDashboard | null, batches: PayoutBatch[]) {
  const items: PaymentQueueItem[] = [];
  const summary = dashboard?.payoutBatchSummary;
  if (vendorId && summary && summary.eligibleRowCount > 0 && !summary.latestBatch) {
    items.push({
      source: 'ready',
      id: `ready:${vendorId}`,
      vendorId,
      dashboard,
    });
  }
  for (const batch of batches) {
    items.push({
      source: 'batch',
      id: `batch:${batch.id}`,
      vendorId: batch.vendorId,
      batch,
    });
  }
  return items;
}

function PaymentActionConfirmationModal({
  action,
  paymentReference,
  internalNote,
  submitting,
  onCancel,
  onConfirm,
  onPaymentReferenceChange,
  onInternalNoteChange,
}: {
  action: PaymentAction;
  paymentReference: string;
  internalNote: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onPaymentReferenceChange: (value: string) => void;
  onInternalNoteChange: (value: string) => void;
}) {
  const actionConfig: Record<PaymentAction, { title: string; body: string; confirmLabel: string; pendingLabel: string }> = {
    prepare: {
      title: 'Prepare payout batch?',
      body: 'This will prepare a payout batch for the selected payment period.',
      confirmLabel: 'Prepare Batch',
      pendingLabel: 'Preparing...',
    },
    mark_review: {
      title: 'Mark payment batch for review?',
      body: 'This payment batch will move into Finance review.',
      confirmLabel: 'Mark for Review',
      pendingLabel: 'Moving...',
    },
    mark_paid: {
      title: 'Mark payment paid?',
      body: 'Confirm that accounting has completed the EFT outside the application.',
      confirmLabel: 'Mark Paid',
      pendingLabel: 'Marking paid...',
    },
    cancel: {
      title: 'Cancel payment batch?',
      body: 'This will cancel the selected payment batch.',
      confirmLabel: 'Cancel Batch',
      pendingLabel: 'Cancelling...',
    },
  };
  const config = actionConfig[action];

  return (
    <div className="scheduled-settlements-modal" role="dialog" aria-modal="true" aria-labelledby="payment-action-confirmation-title">
      <div className="scheduled-settlements-modal-card">
        <p className="eyebrow">Payment preparation</p>
        <h3 id="payment-action-confirmation-title">{config.title}</h3>
        <p className="page-description">{config.body}</p>
        {action === 'mark_paid' ? (
          <div className="op-form-grid">
            <label>
              <span>Payment reference optional</span>
              <input
                value={paymentReference}
                onChange={(event) => onPaymentReferenceChange(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Internal note optional</span>
              <textarea
                value={internalNote}
                onChange={(event) => onInternalNoteChange(event.currentTarget.value)}
                rows={3}
              />
            </label>
          </div>
        ) : null}
        <div className="scheduled-settlements-modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={onConfirm} disabled={submitting}>
            {submitting ? config.pendingLabel : config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminPaymentPreparationPage() {
  const appReadiness = useAppReadiness();
  const currentVendorId = appReadiness.currentVendor.vendorId;
  const currentVendorName = appReadiness.currentVendor.vendorName;
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>('all');
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(currentVendorId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [highValueOnly, setHighValueOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PaymentAction | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const batchesQuery = useQueryResource(
    ['admin', 'finance', 'payment-preparation', 'batches', vendorFilter],
    ({ signal }) => listPayoutBatches({ vendorId: vendorFilter || null, signal }),
    {
      routeName: 'Payment preparation',
      endpoint: '/admin/payout-batches',
    },
  );

  const readinessQuery = useQueryResource(
    ['admin', 'finance', 'payment-preparation', 'readiness', vendorFilter],
    ({ signal }) => getPaymentPreparationReadiness({ vendorId: vendorFilter || null, signal }),
    {
      routeName: 'Payment preparation',
      endpoint: '/finance',
    },
  );

  const batches = batchesQuery.data ?? [];
  const readiness = readinessQuery.data ?? null;
  const queueItems = useMemo(() => buildQueueItems(vendorFilter, readiness, batches), [batches, readiness, vendorFilter]);

  const periodOptions = useMemo(() => {
    const keys = Array.from(new Set(queueItems.map(getPaymentPeriodKey)));
    return keys.sort((left, right) => right.localeCompare(left));
  }, [queueItems]);

  const advancedFilteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return queueItems.filter((item) => {
      const vendorLabel = getSafeVendorLabel(item.vendorId, currentVendorId, currentVendorName);
      if (!matchesStatusFilter(item, statusFilter)) {
        return false;
      }
      if (periodFilter !== 'all' && getPaymentPeriodKey(item) !== periodFilter) {
        return false;
      }
      if (highValueOnly && Math.abs(getAmountValue(getNetPayable(item))) < HIGH_VALUE_AMOUNT) {
        return false;
      }
      if (normalizedSearch && !buildSearchHaystack(item, vendorLabel).includes(normalizedSearch)) {
        return false;
      }
      return true;
    });
  }, [currentVendorId, currentVendorName, highValueOnly, periodFilter, queueItems, search, statusFilter]);

  const workflowCounts = WORKFLOW_TABS.reduce<Record<WorkflowTab, number>>((counts, tab) => {
    counts[tab.id] = advancedFilteredItems.filter((item) => matchesWorkflow(item, tab.id)).length;
    return counts;
  }, {
    all: 0,
    ready_to_prepare: 0,
    draft: 0,
    review: 0,
    approved: 0,
    paid: 0,
    cancelled: 0,
  });

  const visibleItems = advancedFilteredItems.filter((item) => matchesWorkflow(item, workflowTab));
  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null;
  const selectedWaitingReason = selectedItem ? getWaitingReason(selectedItem) : null;
  const supportedActions = selectedItem ? getSupportedPaymentActions(selectedItem) : [];
  const loading = batchesQuery.isLoading || readinessQuery.isLoading;
  const blockingError = batchesQuery.isError || readinessQuery.isError;
  const errorDescription =
    batchesQuery.error ?? readinessQuery.error ?? 'Unable to load payment preparation data.';

  async function refetchQueue() {
    await Promise.all([
      batchesQuery.refetch(),
      readinessQuery.refetch(),
    ]);
  }

  function openAction(action: PaymentAction) {
    setActionError(null);
    setActionSuccess(null);
    setPaymentReference('');
    setInternalNote('');
    setPendingAction(action);
  }

  async function handleConfirmAction() {
    if (!pendingAction || !selectedItem) {
      return;
    }
    setActionSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      if (pendingAction === 'prepare') {
        await preparePayoutBatch(selectedItem.vendorId);
        setActionSuccess('Payment batch prepared.');
      } else if (pendingAction === 'mark_review' && selectedItem.source === 'batch') {
        await markPayoutBatchReview(selectedItem.batch.id);
        setActionSuccess('Payment batch moved to review.');
      } else if (pendingAction === 'mark_paid' && selectedItem.source === 'batch') {
        await markPayoutBatchPaid(selectedItem.batch.id, {
          paymentReference: paymentReference.trim() || undefined,
          internalNote: internalNote.trim() || undefined,
        });
        setActionSuccess('Payment marked paid.');
      } else if (pendingAction === 'cancel' && selectedItem.source === 'batch') {
        await cancelPayoutBatch(selectedItem.batch.id);
        setActionSuccess('Payment batch cancelled.');
      }
      setPendingAction(null);
      await refetchQueue();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Payment preparation action failed.');
    } finally {
      setActionSubmitting(false);
    }
  }

  return (
    <section className="op-page payment-preparation-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">ADMIN FINANCE</p>
          <h1>Payment Preparation</h1>
          <p className="page-description">Prepare approved vendor payments before payout execution.</p>
        </div>
      </div>

      {actionSuccess ? <p className="action-feedback action-success" role="status">{actionSuccess}</p> : null}
      {actionError ? <p className="action-feedback action-error" role="alert">{actionError}</p> : null}

      <section className="settlement-review-queue payment-preparation-queue" aria-label="Payment preparation queue">
        <div className="orders-workflow-tabs settlement-review-tabs payment-preparation-tabs" aria-label="Payment preparation workflow tabs">
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

        <div className="op-toolbar settlement-review-filters payment-preparation-filters" aria-label="Payment preparation filters">
          <label className="op-search-input">
            <span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Vendor, payment, issue" />
          </label>
          <label>
            <span>Vendor</span>
            <input value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} placeholder="Vendor id" />
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Payment Period</span>
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
              <option value="all">All periods</option>
              {periodOptions.map((option) => (
                <option key={option} value={option}>{getPaymentPeriodLabel(option)}</option>
              ))}
            </select>
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

        {loading ? <p className="page-description">Loading payment preparation queue...</p> : null}
        {blockingError ? (
          <SectionErrorRetry
            description={errorDescription}
            onRetry={() => {
              void batchesQuery.refetch();
              void readinessQuery.refetch();
            }}
          />
        ) : null}

        {!loading && !blockingError && queueItems.length === 0 ? (
          <EmptyStatePanel
            title="No vendor payments found"
            description="Approved payment preparation items will appear here when existing settlement and payout data is available."
          />
        ) : null}

        {!loading && !blockingError && queueItems.length > 0 && visibleItems.length === 0 ? (
          <p className="settlement-compact-empty">No payment preparation items match the selected workflow and filters.</p>
        ) : null}

        {!loading && !blockingError && visibleItems.length > 0 ? (
          <div className="settlement-review-layout payment-preparation-layout">
            <OperationalTable
              columns={['Vendor', 'Payment', 'Amount', 'Status', 'Issues', 'Next Action', 'Updated']}
              className="settlement-review-table payment-preparation-table"
              stickyHeader={false}
            >
              {visibleItems.map((item) => {
                const vendorLabel = getSafeVendorLabel(item.vendorId, currentVendorId, currentVendorName);
                const payment = getPaymentLabel(item);
                const issues = getIssues(item);
                const status = getQueueStatus(item);
                return (
                  <OperationalTableRow
                    key={item.id}
                    selected={item.id === selectedItem?.id}
                    onSelect={() => setSelectedId(item.id)}
                  >
                    <span><strong>{vendorLabel}</strong></span>
                    <span>
                      <strong>{payment.primary}</strong>
                      <small>{payment.secondary}</small>
                    </span>
                    <span>
                      <strong>{formatPaymentAmount(getGrossAmount(item))}</strong>
                      <small>Net payable {formatPaymentAmount(getNetPayable(item))}</small>
                    </span>
                    <span>
                      <StatusBadge tone={getStatusTone(status)}>{status}</StatusBadge>
                    </span>
                    <span className="settlement-review-issue-list payment-preparation-issues">
                      {issues.map((issue) => (
                        <StatusBadge key={issue} tone={issue === 'Ready' ? 'success' : 'warning'}>{issue}</StatusBadge>
                      ))}
                    </span>
                    <span><strong>{getNextAction(item)}</strong></span>
                    <span>{formatDate(getItemUpdatedAt(item))}</span>
                  </OperationalTableRow>
                );
              })}
            </OperationalTable>

            <aside className="op-side-panel settlement-review-panel payment-preparation-panel" aria-label="Payment preparation detail panel">
              {selectedItem ? (
                <>
                  <MetadataGroup title="Summary">
                    <MetadataRow label="Vendor" value={getSafeVendorLabel(selectedItem.vendorId, currentVendorId, currentVendorName)} />
                    <MetadataRow label="Payment Period" value={getPaymentPeriodLabel(getPaymentPeriodKey(selectedItem))} />
                    <MetadataRow label="Gross Amount" value={formatPaymentAmount(getGrossAmount(selectedItem))} />
                    <MetadataRow label="Net Payable" value={formatPaymentAmount(getNetPayable(selectedItem))} />
                    <MetadataRow label="Current Status" value={getQueueStatus(selectedItem)} />
                  </MetadataGroup>

                  {selectedWaitingReason ? (
                    <section className="op-panel-section">
                      <h4>Current Blocker</h4>
                      <p className="page-description">{selectedWaitingReason}</p>
                    </section>
                  ) : null}

                  <MetadataGroup title="Next Action">
                    <MetadataRow label="Action" value={getNextAction(selectedItem)} />
                    {supportedActions.length ? (
                      <div className="scheduled-panel-actions">
                        {supportedActions.includes('prepare') ? (
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={() => openAction('prepare')}
                            disabled={actionSubmitting}
                          >
                            Prepare Batch
                          </button>
                        ) : null}
                        {supportedActions.includes('mark_review') ? (
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={() => openAction('mark_review')}
                            disabled={actionSubmitting}
                          >
                            Mark for Review
                          </button>
                        ) : null}
                        {supportedActions.includes('mark_paid') ? (
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={() => openAction('mark_paid')}
                            disabled={actionSubmitting}
                          >
                            Mark Paid
                          </button>
                        ) : null}
                        {supportedActions.includes('cancel') ? (
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => openAction('cancel')}
                            disabled={actionSubmitting}
                          >
                            Cancel Batch
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </MetadataGroup>

                  <MetadataGroup title="Payment Impact">
                    <MetadataRow
                      label="Refund deductions"
                      value={
                        selectedItem.source === 'batch'
                          ? hasAmount(selectedItem.batch.refundAmount)
                            ? formatPaymentAmount(selectedItem.batch.refundAmount)
                            : 'No refund adjustment'
                          : 'No refund adjustment'
                      }
                    />
                    <MetadataRow
                      label="Debt deductions"
                      value={
                        selectedItem.source === 'batch'
                          ? formatOptionalPaymentAmount(selectedItem.batch.debtOffsetAmount ?? selectedItem.batch.outstandingDebtAmount, 'No debt adjustment')
                          : formatOptionalPaymentAmount(
                            selectedItem.dashboard.payoutBatchSummary?.debtOffsetPreviewAmount ??
                              selectedItem.dashboard.payoutBatchSummary?.outstandingDebtAmount,
                            'No debt adjustment',
                          )
                      }
                    />
                    <MetadataRow
                      label="Other adjustments"
                      value={
                        selectedItem.source === 'batch'
                          ? `Commission ${formatPaymentAmount(selectedItem.batch.commissionAmount)} · Shipping ${formatPaymentAmount(selectedItem.batch.shippingDeductionAmount)}`
                          : 'No payment evidence yet'
                      }
                    />
                  </MetadataGroup>

                  <MetadataGroup title="Related Records">
                    <MetadataRow
                      label="Settlements"
                      value={
                        selectedItem.source === 'batch'
                          ? `${selectedItem.batch.lineCount} settlement rows`
                          : `${selectedItem.dashboard.payoutBatchSummary?.eligibleRowCount ?? 0} eligible settlement rows`
                      }
                    />
                    <MetadataRow
                      label="Refund Adjustments"
                      value={
                        selectedItem.source === 'batch' && hasAmount(selectedItem.batch.refundAmount)
                          ? 'Refund deductions present'
                          : 'No refund adjustment'
                      }
                    />
                    <MetadataRow label="Support" value="No linked support" />
                  </MetadataGroup>

                  <section className="op-panel-section">
                    <h4>Timeline</h4>
                    <ul className="settlement-review-timeline">
                      {selectedItem.source === 'batch' ? (
                        <>
                          <li><strong>Payment draft created</strong><span>{formatDate(selectedItem.batch.createdAt)}</span></li>
                          {['review', 'approved', 'execution_pending', 'paid', 'paid_placeholder'].includes(selectedItem.batch.status) ? (
                            <li><strong>Review started</strong><span>{formatDate(selectedItem.batch.updatedAt)}</span></li>
                          ) : null}
                          {['approved', 'execution_pending', 'paid'].includes(selectedItem.batch.status) ? (
                            <li><strong>Approved</strong><span>{formatDate(selectedItem.batch.updatedAt)}</span></li>
                          ) : null}
                          {selectedItem.batch.status === 'paid' && selectedItem.batch.paidAt ? (
                            <li>
                              <strong>Paid</strong>
                              <span>{formatDate(selectedItem.batch.paidAt)}</span>
                              {selectedItem.batch.paymentReference ? <small>Payment reference {selectedItem.batch.paymentReference}</small> : null}
                            </li>
                          ) : null}
                          {selectedItem.batch.status === 'cancelled' ? <li><strong>Cancelled</strong><span>{formatDate(selectedItem.batch.updatedAt)}</span></li> : null}
                        </>
                      ) : (
                        <li><strong>No finance activity recorded yet.</strong></li>
                      )}
                    </ul>
                  </section>
                </>
              ) : (
                <p className="settlement-compact-empty">Select a payment preparation item to review.</p>
              )}
            </aside>
          </div>
        ) : null}
      </section>
      {pendingAction ? (
        <PaymentActionConfirmationModal
          action={pendingAction}
          paymentReference={paymentReference}
          internalNote={internalNote}
          submitting={actionSubmitting}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirmAction()}
          onPaymentReferenceChange={setPaymentReference}
          onInternalNoteChange={setInternalNote}
        />
      ) : null}
    </section>
  );
}
