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
  listRefundAdjustments,
  type RefundAdjustmentRecord,
  type RefundAdjustmentStatus,
} from '../features/finance/refundAdjustmentsApi';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { formatCurrency, formatDateTime } from '../services/real/formatting';

type WorkflowTab = 'all' | 'needs_review' | 'partially_applied' | 'applied' | 'blocked' | 'cancelled';
type StatusFilter = 'all' | RefundAdjustmentStatus;
type NextAction = 'Review' | 'Apply' | 'Investigate' | 'No action required';

const HIGH_VALUE_AMOUNT_MINOR = 100000;

const WORKFLOW_TABS: Array<{ id: WorkflowTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'partially_applied', label: 'Partially Applied' },
  { id: 'applied', label: 'Applied' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_LABELS: Record<RefundAdjustmentStatus, string> = {
  pending: 'Needs Review',
  partially_applied: 'Partially Applied',
  applied: 'Applied',
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
    return 'No activity recorded yet.';
  }
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
    return 'Review';
  }
  if (adjustment.status === 'partially_applied') {
    return adjustment.remainingAmountMinor > 0 ? 'Apply' : 'No action required';
  }
  if (adjustment.status === 'blocked') {
    return 'Investigate';
  }
  return 'No action required';
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
  return safeReferenceLabel(adjustment.references?.refundLabel, 'Refund reference unavailable');
}

function getRefundReferenceLabel(adjustment: RefundAdjustmentRecord) {
  const label = getRefundLabel(adjustment);
  if (label === 'Refund reference unavailable') {
    const shortReference = adjustment.refundRecordId && isLikelyRawIdentifier(adjustment.refundRecordId)
      ? adjustment.refundRecordId.slice(0, 8)
      : null;
    return shortReference ? `Refund reference ${shortReference}` : 'No refund reference';
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

  const query = useQueryResource(
    ['admin', 'finance', 'refund-adjustments', vendorFilter],
    ({ signal }) => listRefundAdjustments({ vendorId: vendorFilter || null, signal }),
    {
      routeName: 'Refund adjustments',
      endpoint: '/admin/finance/refund-adjustments',
    },
  );

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
            <input value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} placeholder="Vendor id" />
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All statuses</option>
              <option value="pending">Needs Review</option>
              <option value="partially_applied">Partially Applied</option>
              <option value="applied">Applied</option>
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
                      <h4>Why is this waiting?</h4>
                      <p className="page-description">{selectedWaitingReason}</p>
                    </section>
                  ) : null}

                  <MetadataGroup title="Next Action">
                    <MetadataRow label="Action" value={getNextAction(selectedAdjustment)} />
                  </MetadataGroup>

                  <MetadataGroup title="Payment Impact">
                    <MetadataRow
                      label="Net vendor payment effect"
                      value={formatSignedMinor(-Math.abs(selectedAdjustment.remainingAmountMinor || selectedAdjustment.amountMinor), selectedAdjustment.currencyCode)}
                    />
                    <MetadataRow label="Refund deduction" value={formatMinor(selectedAdjustment.originalAmountMinor, selectedAdjustment.currencyCode)} />
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
                      <li><strong>Review started</strong><span>{selectedAdjustment.status === 'pending' ? formatDate(selectedAdjustment.createdAt) : 'No activity recorded yet.'}</span></li>
                      <li><strong>Applied</strong><span>{formatDate(eventTimestamp(selectedAdjustment, 'applied') ?? (selectedAdjustment.status === 'applied' ? selectedAdjustment.updatedAt : null))}</span></li>
                      <li><strong>Blocked</strong><span>{selectedAdjustment.status === 'blocked' ? formatDate(selectedAdjustment.updatedAt) : 'No activity recorded yet.'}</span></li>
                      <li><strong>Cancelled</strong><span>{selectedAdjustment.status === 'cancelled' ? formatDate(selectedAdjustment.updatedAt) : 'No activity recorded yet.'}</span></li>
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
    </section>
  );
}
