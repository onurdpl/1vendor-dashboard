import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  FilterBar,
  MetadataGroup,
  MetadataRow,
  OperationalActionGroup,
  SectionErrorRetry,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SideDetailPanel,
  StatusBadge,
  TableSkeletonRows,
  WorkflowActionGuidance,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import { useActionFeedback } from '../lib/ui';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import {
  attachShippingCost,
  getFinanceDashboard,
  getVendorDebtHistory,
  preparePayoutBatch,
} from '../features/finance/api';
import { useAppReadiness } from '../lib/appReadiness';
import type { FinanceTransaction, OperationsRecommendation, SupportTicket, VendorDebtHistoryEvent } from '../lib/api/contracts';
import { listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import { OperationalLinkCards, OperationalTimeline } from '../components/OperationalTimeline';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { AdminCollaborationNotes } from '../components/AdminCollaborationNotes';
import {
  supportTicketMatchesFinance,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';
import { sameNormalizedIdentifier, sameOrderNumber, sameShopifyIdentifier } from '../lib/shopifyIdentifiers';
import { formatCurrency, formatDateParts as formatSafeDateParts, formatDateTime, getSafeTimestamp, safeArray, safeStatusLabel } from '../services/real/formatting';
import { getFinanceWorkflowAction } from '../lib/workflowActionGuidance';

type FinanceDeepLinkTarget = {
  type: 'ledger' | 'refund' | 'order' | 'shopifyOrder';
  value: string;
};

type FinanceTimelineItem = {
  label: string;
  at: string | null;
  status: string;
  visibility?: 'admin';
};

const FINANCE_ESTIMATE_HELPER =
  'Values may change after refunds, shipping reconciliation, manual review, or settlement adjustments.';
const FINANCE_TIMELINE_HELPER = 'Finance events are previews until settlement review is completed.';
const UNKNOWN_FINANCE_VALUE = 'Unknown';

function formatDate(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOptionalDate(value: string | null | undefined) {
  return value ? formatDate(value) : 'Not available';
}

function formatDateParts(value: string) {
  return formatSafeDateParts(value);
}

function formatMinorCurrency(valueMinor: number | null | undefined, currency = 'TRY') {
  return formatCurrency(((Number(valueMinor ?? 0)) / 100).toFixed(2), currency);
}

function readFinanceString(record: FinanceTransaction, key: string) {
  const value = (record as FinanceTransaction & Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isLikelyInternalOrderRouteId(value: string | null) {
  if (!value) {
    return false;
  }

  return !/^gid:\/\/shopify\//i.test(value) && !/^\d+$/.test(value);
}

function buildOrdersHref(record: FinanceTransaction) {
  const internalOrderId = [
    readFinanceString(record, 'allocationId'),
    readFinanceString(record, 'vendorAllocationId'),
    readFinanceString(record, 'relatedAllocationId'),
    readFinanceString(record, 'orderId'),
  ].find(isLikelyInternalOrderRouteId);
  if (internalOrderId) {
    return `/orders/${encodeURIComponent(internalOrderId)}`;
  }

  const shopifyOrderId =
    record.shopifyOrderId ??
    readFinanceString(record, 'sourceShopifyOrderId') ??
    readFinanceString(record, 'relatedOrderId') ??
    readFinanceString(record, 'orderId');
  const params = new URLSearchParams();
  if (record.shopifyOrderNumber) {
    params.set('order', String(record.shopifyOrderNumber));
  }
  if (shopifyOrderId) {
    params.set('shopifyOrderId', shopifyOrderId);
  }

  return params.size ? `/orders?${params.toString()}` : null;
}

function buildReturnsHref(record: FinanceTransaction) {
  const internalReturnId =
    readFinanceString(record, 'returnId') ??
    readFinanceString(record, 'returnRecordId') ??
    readFinanceString(record, 'relatedReturnId');
  if (internalReturnId) {
    return `/returns/${encodeURIComponent(internalReturnId)}`;
  }
  const sourceShopifyReturnId = readFinanceString(record, 'sourceShopifyReturnId');
  if (sourceShopifyReturnId) {
    return `/returns?shopifyReturnId=${encodeURIComponent(sourceShopifyReturnId)}`;
  }
  if (record.shopifyRefundId) {
    return `/returns?refundId=${encodeURIComponent(record.shopifyRefundId)}`;
  }
  if (record.shopifyOrderNumber) {
    return `/returns?order=${encodeURIComponent(String(record.shopifyOrderNumber))}`;
  }
  return null;
}

function buildFinanceHref(record: Pick<FinanceTransaction, 'id'>) {
  return `/finance?ledgerId=${encodeURIComponent(record.id)}`;
}

function buildOrderSettlementHref(record: FinanceTransaction) {
  const orderHref = buildOrdersHref(record);
  if (!orderHref?.startsWith('/orders/')) {
    return null;
  }

  return `${orderHref}#settlement-preview`;
}

function readFirstSearchParam(searchParams: URLSearchParams, names: string[]) {
  for (const name of names) {
    const value = searchParams.get(name)?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function getFinanceDeepLinkTarget(searchParams: URLSearchParams): FinanceDeepLinkTarget | null {
  const ledgerTarget = readFirstSearchParam(searchParams, ['ledgerId', 'financeLedgerEntryId', 'financeRecordId', 'ledger', 'id']);
  if (ledgerTarget) {
    return { type: 'ledger', value: ledgerTarget };
  }

  const refundTarget = readFirstSearchParam(searchParams, ['refundId', 'shopifyRefundId', 'sourceShopifyRefundId']);
  if (refundTarget) {
    return { type: 'refund', value: refundTarget };
  }

  const shopifyOrderTarget = readFirstSearchParam(searchParams, ['shopifyOrderId', 'sourceShopifyOrderId', 'orderId']);
  if (shopifyOrderTarget) {
    return { type: 'shopifyOrder', value: shopifyOrderTarget };
  }

  const orderTarget = readFirstSearchParam(searchParams, ['order', 'orderNumber', 'shopifyOrderNumber', 'sourceShopifyOrderNumber']);
  if (orderTarget) {
    return { type: 'order', value: orderTarget };
  }

  return null;
}

function financeRecordMatchesTarget(record: FinanceTransaction, target: FinanceDeepLinkTarget | null) {
  if (!target) {
    return false;
  }

  if (target.type === 'ledger') {
    return [
      record.id,
      readFinanceString(record, 'ledgerId'),
      readFinanceString(record, 'financeLedgerEntryId'),
      readFinanceString(record, 'financeRecordId'),
    ].some((value) => sameNormalizedIdentifier(value, target.value));
  }

  if (target.type === 'refund') {
    return [
      record.shopifyRefundId,
      readFinanceString(record, 'refundId'),
      readFinanceString(record, 'shopifyRefundId'),
      readFinanceString(record, 'sourceShopifyRefundId'),
      readFinanceString(record, 'relatedRefundId'),
    ].some((value) => sameShopifyIdentifier(value, target.value));
  }

  if (target.type === 'shopifyOrder') {
    return [
      record.shopifyOrderId,
      readFinanceString(record, 'shopifyOrderId'),
      readFinanceString(record, 'sourceShopifyOrderId'),
      readFinanceString(record, 'relatedOrderId'),
      readFinanceString(record, 'orderId'),
      readFinanceString(record, 'allocationId'),
    ].some((value) => sameNormalizedIdentifier(value, target.value));
  }

  return [
    record.shopifyOrderNumber,
    readFinanceString(record, 'orderNumber'),
    readFinanceString(record, 'shopifyOrderNumber'),
    readFinanceString(record, 'sourceShopifyOrderNumber'),
  ].some((value) => sameOrderNumber(value, target.value));
}

function normalizeFinanceStatus(status: string | null | undefined) {
  const value = status?.trim();
  if (!value) {
    return 'Unknown';
  }

  const normalized = value.toLowerCase();
  if (normalized === 'hold' || normalized === 'recorded' || normalized === 'synced' || normalized === 'posted') {
    return 'Recorded';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'Failed';
  }
  if (normalized === 'reconciled') {
    return 'Reconciled';
  }
  if (normalized === 'completed' || normalized === 'processed') {
    return 'Completed';
  }
  if (normalized === 'pending') {
    return 'Pending';
  }
  return value;
}

function getStatusTone(status: string | null | undefined) {
  const displayStatus = normalizeFinanceStatus(status);
  if (displayStatus === 'Completed' || displayStatus === 'Reconciled' || displayStatus === 'Recorded') {
    return 'success' as const;
  }
  if (displayStatus === 'Failed') {
    return 'danger' as const;
  }
  return 'attention' as const;
}

function isRefundRecord(record: FinanceTransaction) {
  return record.category === 'Refund';
}

function isPendingOrHoldRecord(record: FinanceTransaction) {
  const status = normalizeFinanceStatus(record.status);
  return status === 'Pending' || status === 'Recorded';
}

function getPayoutActivityType(record: FinanceTransaction) {
  if (record.category === 'Invoice') {
    return 'Sale estimate';
  }
  if (record.category === 'Refund') {
    return 'Refund deduction';
  }
  return record.category;
}

function getPayoutActivityDetail(record: FinanceTransaction) {
  if (record.category === 'Invoice') {
    return 'Shopify order';
  }
  if (record.category === 'Refund') {
    return 'Customer refund impact';
  }
  return 'Settlement preview';
}

function getSettlementReviewDisplay(record: FinanceTransaction) {
  const review = record.settlement?.review;
  if (!review) {
    return null;
  }
  if (review.commissionInvoiceStatus === 'created') {
    return {
      label: 'Commission invoiced',
      timelineLabel: 'Logo commission invoice created',
      timelineStatus: 'Invoiced',
      detail: review.invoiceNo ?? review.providerUuid ?? review.commissionInvoiceId ?? review.approvalId,
      guidance: {
        actionLabel: 'Review commission invoice',
        description: review.invoiceNo
          ? `Logo commission invoice ${review.invoiceNo} is linked to this approved settlement.`
          : 'Logo commission invoice is created; use the provider UUID for reconciliation until the invoice number is synced.',
        tone: 'success' as const,
      },
    };
  }
  if (review.approvalStatus === 'approved') {
    return {
      label: 'Settlement approved',
      timelineLabel: 'Settlement approved',
      timelineStatus: 'Approved',
      detail: review.approvalId,
      guidance: {
        actionLabel: 'Review approved settlement',
        description: 'This row is locked in an approved settlement and is no longer a pending settlement candidate.',
        tone: 'success' as const,
      },
    };
  }
  return {
    label: 'Settlement draft locked',
    timelineLabel: 'Settlement draft locked',
    timelineStatus: 'Draft',
    detail: review.approvalId,
    guidance: {
      actionLabel: 'Review draft settlement',
      description: 'This row is locked in a draft settlement approval and is excluded from new review candidates.',
      tone: 'info' as const,
    },
  };
}

function getPayoutActivityStatusLabel(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  const status = normalizeFinanceStatus(record.status);
  if (status === 'Failed' || record.settlement?.status === 'held' || record.settlement?.status === 'disputed') {
    return 'Blocked';
  }
  if (isRefundRecord(record) && ['Recorded', 'Completed', 'Reconciled'].includes(status)) {
    return 'Refund impact';
  }
  if (record.payoutBatch) {
    return getPayoutBatchStatusLabel(record.payoutBatch.status, audience);
  }
  const reviewDisplay = getSettlementReviewDisplay(record);
  if (reviewDisplay) {
    return reviewDisplay.label;
  }
  if (record.settlement?.payoutReady || record.settlement?.status === 'payable' || record.settlement?.status === 'partially_refunded') {
    return 'Pending review';
  }
  if (status === 'Pending' || status === 'Recorded' || status === 'Completed' || status === 'Reconciled') {
    return 'Estimated';
  }
  return status;
}

function getPayoutActivityTone(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  const label = getPayoutActivityStatusLabel(record, audience);
  if (label === 'Blocked') {
    return 'danger' as const;
  }
  if (label === 'Approved' || label === 'Scheduled' || label === 'Paid' || label === 'Settlement approved' || label === 'Commission invoiced') {
    return 'success' as const;
  }
  if (label === 'Estimated') {
    return 'info' as const;
  }
  return 'attention' as const;
}

function isZeroCurrencyValue(value: string | null | undefined) {
  return !/[1-9]/.test((value ?? '').replace(/[^\d]/g, ''));
}

function parseCurrencyValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const normalized = value.trim();
  const numeric = Number(normalized.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return normalized.startsWith('-') ? -Math.abs(numeric) : numeric;
}

function getBalanceTone(value: string | null | undefined) {
  const numeric = parseCurrencyValue(value);
  if (numeric > 0) {
    return 'success' as const;
  }
  if (numeric < 0) {
    return 'danger' as const;
  }
  return 'neutral' as const;
}

function formatDeductionValue(value: string | null | undefined) {
  if (!value) {
    return UNKNOWN_FINANCE_VALUE;
  }
  if (value.startsWith('-') || isZeroCurrencyValue(value)) {
    return value;
  }
  return `-${value}`;
}

function getPayoutBatchStatusLabel(status?: string, audience: 'admin' | 'vendor' = 'admin') {
  if (!status) {
    return 'Not batched';
  }

  if (status === 'draft') {
    return 'Estimated';
  }
  if (status === 'review') {
    return 'Pending review';
  }
  if (status === 'approved') {
    return 'Approved';
  }
  if (status === 'execution_pending') {
    return 'Scheduled';
  }
  if (status === 'paid_placeholder') {
    return audience === 'vendor' ? 'Pending review' : 'Payment evidence pending';
  }
  if (status === 'cancelled') {
    return 'Blocked';
  }
  return UNKNOWN_FINANCE_VALUE;
}

function financeValueOrUnknown(value?: string | null) {
  return typeof value === 'string' && value.trim() ? value : UNKNOWN_FINANCE_VALUE;
}

function optionalDeductionValue(value?: string | null) {
  return typeof value === 'string' && value.trim() ? formatDeductionValue(value) : UNKNOWN_FINANCE_VALUE;
}

function getUpcomingPayoutLabel(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  return finance.payoutBatchSummary?.latestBatch?.createdAt
    ? formatDateParts(finance.payoutBatchSummary.latestBatch.createdAt).date
    : financeValueOrUnknown(finance.payoutBatchSummary?.eligibleNetAmount ?? finance.summary.payableBalance ?? finance.summary.payoutEstimate);
}

function getUpcomingPayoutDetail(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  return finance.payoutBatchSummary?.latestBatch?.createdAt
    ? 'Draft review created'
    : `${finance.payoutBatchSummary?.eligibleRowCount ?? 0} rows pending review`;
}

function getPayoutImpact(record: FinanceTransaction) {
  if (isRefundRecord(record)) {
    return formatDeductionValue(record.payoutCalculation?.refundImpact ?? record.amount);
  }
  return record.payoutCalculation?.estimatedPayout ?? record.amount;
}

function getTotalDeductions(record: FinanceTransaction) {
  const values = [
    record.payoutCalculation?.commission,
    record.payoutCalculation?.commissionVat,
    record.payoutCalculation?.shippingDeduction,
    record.payoutCalculation?.refundImpact,
  ].filter((value): value is string => Boolean(value));

  if (!values.length) {
    return UNKNOWN_FINANCE_VALUE;
  }

  const total = values.reduce((sum, value) => {
    const numeric = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? sum + Math.abs(numeric) : sum;
  }, 0);
  const currency = values[0].match(/^[^\d-]+/)?.[0] ?? '$';
  return `${currency}${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getFinanceTimelineItems(record: FinanceTransaction): FinanceTimelineItem[] {
  const reviewDisplay = getSettlementReviewDisplay(record);
  const items: Array<FinanceTimelineItem | null> = [
    {
      label: isRefundRecord(record) ? 'Refund impact captured' : 'Order captured',
      at: record.date,
      status: normalizeFinanceStatus(record.status),
    },
    {
      label: reviewDisplay?.timelineLabel ?? (record.settlement?.payoutReady ? 'Settlement awaiting review' : 'Settlement preview generated'),
      at: record.settlement?.payableAt ?? record.settlement?.eligibleAt ?? null,
      status: reviewDisplay?.timelineStatus ?? (record.settlement?.payoutReady ? 'Review' : 'Preview'),
    },
    record.payoutBatch
      ? {
          label: record.payoutBatch.status === 'paid_placeholder' ? 'Payment evidence pending' : 'Included in draft review',
          at: record.payoutBatch.createdAt,
          status: getPayoutBatchStatusLabel(record.payoutBatch.status),
          visibility: 'admin' as const,
        }
      : null,
  ];

  return items.filter((item): item is FinanceTimelineItem => Boolean(item));
}

function formatSupportStatus(status: SupportTicket['status']) {
  return safeStatusLabel(status);
}

function formatSupportPriority(priority: SupportTicket['priority']) {
  return `${safeStatusLabel(priority, 'Normal')} priority`;
}

function isOpenSupportTicket(ticket: SupportTicket) {
  return ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED';
}

function getSupportLatestActivityAt(ticket: SupportTicket) {
  return ticket.lastReplyAt ?? ticket.updatedAt ?? ticket.createdAt;
}

function getLatestSupportTicket(tickets: SupportTicket[]) {
  return [...tickets].sort((left, right) => {
    const leftTime = getSafeTimestamp(getSupportLatestActivityAt(left), 0);
    const rightTime = getSafeTimestamp(getSupportLatestActivityAt(right), 0);
    return rightTime - leftTime;
  })[0] ?? null;
}

function getSupportActivitySummary(tickets: SupportTicket[]) {
  const latestTicket = getLatestSupportTicket(tickets);
  if (!latestTicket) {
    return null;
  }

  const ticketCount = tickets.length;
  const openCount = tickets.filter(isOpenSupportTicket).length;
  const latestStatus = formatSupportStatus(latestTicket.status);
  const ticketLabel = `${ticketCount} linked ticket${ticketCount === 1 ? '' : 's'}`;
  const activeLabel = openCount > 0 ? ` · ${openCount} active` : '';

  return {
    latestTicket,
    latestStatus,
    latestAt: getSupportLatestActivityAt(latestTicket),
    ticketCount,
    ticketLabel,
    description: `${ticketLabel} · Latest status: ${latestStatus}${activeLabel}`,
    tone: 'neutral' as const,
  };
}

function getFinanceWorkflowFilter(workflow: string | null) {
  if (workflow === 'settlement-review') {
    return {
      label: 'Settlement review',
      description: 'Showing settlement rows that need review.',
      emptyTitle: 'No settlement review rows currently pending',
      emptyDescription: 'This workflow queue has no settlement rows waiting for review. Clear the workflow to inspect all finance activity.',
    };
  }
  return null;
}

function isSettlementReviewWorkflowRecord(record: FinanceTransaction, audience: 'admin' | 'vendor') {
  const displayStatus = getPayoutActivityStatusLabel(record, audience);
  return record.category === 'Payout' || Boolean(record.payoutBatch) || displayStatus === 'Pending review';
}

function formatDebtImpact(event: VendorDebtHistoryEvent, currency: string) {
  if (event.type === 'VENDOR_DEBT_OFFSET') {
    return `+${formatMinorCurrency(Math.abs(event.debtAmountMinor), currency)}`;
  }
  if (event.type === 'VENDOR_DEBT_CREATED') {
    return `-${formatMinorCurrency(Math.abs(event.debtAmountMinor), currency)}`;
  }
  return formatMinorCurrency(event.amountMinor, currency);
}

function getDebtImpactClass(event: VendorDebtHistoryEvent) {
  return event.type === 'VENDOR_DEBT_OFFSET' || event.type === 'DEBT_WAIVED'
    ? 'finance-payout-value'
    : 'finance-deduction-value';
}

function formatAdjustmentStatus(status: string) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getRefundAdjustmentStatusCopy(status: string | null | undefined) {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'pending') {
    return 'Waiting for future settlement deduction';
  }
  if (normalized === 'partially_applied') {
    return 'Partially deducted; remaining amount will carry forward';
  }
  if (normalized === 'applied') {
    return 'Fully deducted from settlement';
  }
  if (normalized === 'blocked') {
    return 'Blocked; requires finance review';
  }
  if (normalized === 'cancelled') {
    return 'Cancelled';
  }
  return formatAdjustmentStatus(normalized || 'unknown');
}

function VendorDebtHistorySection({
  history,
  loading,
  error,
  selectedEvent,
  onSelectEvent,
}: {
  history: Awaited<ReturnType<typeof getVendorDebtHistory>> | null;
  loading: boolean;
  error: string | null;
  selectedEvent: VendorDebtHistoryEvent | null;
  onSelectEvent: (eventId: string) => void;
}) {
  const currency = history?.currency ?? 'TRY';
  const events = safeArray(history?.events);
  const outstandingDebtMinor = history?.summary.outstandingDebtMinor ?? 0;
  const remainingDebtMinor = history?.summary.remainingDebtMinor ?? outstandingDebtMinor;

  return (
    <section className="finance-footer-card finance-debt-history-card" aria-label="Vendor debt history">
      <div>
        <p className="eyebrow">Vendor debt</p>
        <h3>Vendor Debt History</h3>
        <p className="page-description">
          Audit refund-after-payment debt and payout offsets without opening database records.
        </p>
      </div>
      <div className="op-kpi-row finance-debt-summary-row">
        <article className={`op-kpi ${outstandingDebtMinor > 0 ? 'op-tone-danger' : 'op-tone-neutral'}`}>
          <span>Outstanding Debt</span>
          <strong>{formatMinorCurrency(outstandingDebtMinor, currency)}</strong>
          <small>{outstandingDebtMinor > 0 ? 'Vendor owes marketplace' : 'No open debt'}</small>
        </article>
        <article className="op-kpi op-tone-danger">
          <span>Total Debt Created</span>
          <strong>{formatMinorCurrency(history?.summary.totalDebtCreatedMinor ?? 0, currency)}</strong>
        </article>
        <article className="op-kpi op-tone-success">
          <span>Total Debt Offset</span>
          <strong>{formatMinorCurrency(history?.summary.totalDebtOffsetMinor ?? 0, currency)}</strong>
        </article>
        <article className={`op-kpi ${remainingDebtMinor > 0 ? 'op-tone-danger' : 'op-tone-success'}`}>
          <span>Remaining Debt</span>
          <strong>{formatMinorCurrency(remainingDebtMinor, currency)}</strong>
          <small>{history?.summary.lastDebtActivityAt ? `Last activity ${formatDateParts(history.summary.lastDebtActivityAt).date}` : 'No activity'}</small>
        </article>
      </div>
      {error ? (
        <SectionErrorRetry
          title="Vendor debt history unavailable"
          description={error}
        />
      ) : loading ? (
        <p className="settlement-compact-empty">Loading vendor debt history...</p>
      ) : events.length === 0 ? (
        <EmptyStatePanel
          title="No vendor debt history"
          description="Refund-after-payment debt and payout offsets will appear here when they exist."
        />
      ) : (
        <>
          <OperationalTable
            columns={['Event Date', 'Event Type', 'Order', 'Vendor', 'Items', 'Debt Amount', 'Remaining Debt', 'Source Reference']}
            className="finance-debt-history-table"
            stickyHeader={false}
          >
            {events.map((event) => (
              <OperationalTableRow
                key={event.id}
                selected={selectedEvent?.id === event.id}
                onSelect={() => onSelectEvent(event.id)}
              >
                <span>
                  <strong>{formatDateParts(event.createdAt).date}</strong>
                  <small>{formatDateParts(event.createdAt).time}</small>
                </span>
                <StatusBadge tone={event.type === 'VENDOR_DEBT_OFFSET' ? 'success' : 'danger'}>{event.label}</StatusBadge>
                <span>
                  <strong>{event.orderNumber ?? 'No order'}</strong>
                  <small>{event.shopifyOrderId ?? 'No Shopify id'}</small>
                </span>
                <span>{event.vendorName ?? event.vendorId}</span>
                <span>
                  <strong>{event.itemCount}</strong>
                  <small>{event.productCount} products</small>
                </span>
                <strong className={getDebtImpactClass(event)}>{formatDebtImpact(event, currency)}</strong>
                <strong className={event.remainingDebtAfterEventMinor > 0 ? 'finance-deduction-value' : 'finance-payout-value'}>
                  {formatMinorCurrency(event.remainingDebtAfterEventMinor, currency)}
                </strong>
                <span className="finance-debt-source-reference">{event.sourceReference}</span>
              </OperationalTableRow>
            ))}
          </OperationalTable>
          {selectedEvent ? <VendorDebtDetailPanel event={selectedEvent} currency={currency} /> : null}
        </>
      )}
    </section>
  );
}

function VendorDebtDetailPanel({ event, currency }: { event: VendorDebtHistoryEvent; currency: string }) {
  return (
    <div className="finance-debt-detail-panel" aria-label="Vendor debt detail">
      <div className="finance-debt-detail-heading">
        <div>
          <p className="eyebrow">Debt audit detail</p>
          <h4>{event.label}</h4>
        </div>
        <StatusBadge tone={event.remainingDebtAfterEventMinor > 0 ? 'danger' : 'success'}>
          Remaining {formatMinorCurrency(event.remainingDebtAfterEventMinor, currency)}
        </StatusBadge>
      </div>
      <div className="finance-debt-detail-grid">
        <MetadataGroup title="Order">
          <MetadataRow label="Order number" value={event.orderNumber ?? 'Unknown'} />
          <MetadataRow label="Shopify order id" value={event.shopifyOrderId ?? 'Unknown'} />
          <MetadataRow label="Vendor" value={event.vendorName ?? event.vendorId} />
          <MetadataRow label="Created date" value={formatOptionalDate(event.orderCreatedAt)} />
        </MetadataGroup>
        <MetadataGroup title="Refund">
          <MetadataRow label="Refund reference" value={event.refundReference ?? 'Not applicable'} />
          <MetadataRow label="Refund record" value={event.refundRecordId ?? 'Not applicable'} />
          <MetadataRow label="Refund amount" value={event.calculation.refundMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.refundMinor, currency)} />
        </MetadataGroup>
        <MetadataGroup title="Debt Calculation">
          <MetadataRow label="Refund amount" value={event.calculation.refundMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.refundMinor, currency)} />
          <MetadataRow label="Commission reversal" value={event.calculation.commissionReversalMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.commissionReversalMinor, currency)} />
          <MetadataRow label="Commission VAT reversal" value={event.calculation.commissionVatReversalMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.commissionVatReversalMinor, currency)} />
          <MetadataRow label="Vendor debt created" value={event.calculation.vendorDebtMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.vendorDebtMinor, currency)} />
          <MetadataRow label="Debt offset" value={event.calculation.debtOffsetMinor === null ? 'Not applicable' : formatMinorCurrency(event.calculation.debtOffsetMinor, currency)} />
          <MetadataRow label="Formula" value={event.calculation.formula ?? 'Not available'} />
        </MetadataGroup>
        <MetadataGroup title="Payout Offset">
          <MetadataRow label="Payout batch" value={event.payoutBatchId ?? 'Not applicable'} />
          <MetadataRow label="Payout batch status" value={event.payoutBatchStatus ? safeStatusLabel(event.payoutBatchStatus) : 'Not applicable'} />
          <MetadataRow label="Source reference" value={event.sourceReference} />
        </MetadataGroup>
      </div>
      <div className="finance-debt-detail-grid">
        <section className="finance-debt-detail-list">
          <h5>Products</h5>
          {event.products.length ? (
            event.products.map((product, index) => (
              <p key={`${product.sku ?? product.title ?? 'product'}-${index}`}>
                <strong>{product.title ?? 'Unknown product'}</strong>
                <span>{product.sku ?? 'No SKU'} · Qty {product.quantity}</span>
              </p>
            ))
          ) : (
            <p>No product snapshot available.</p>
          )}
        </section>
        <section className="finance-debt-detail-list">
          <h5>Offset History</h5>
          {event.offsetHistory.length ? (
            event.offsetHistory.map((offset) => (
              <p key={offset.id}>
                <strong>{formatMinorCurrency(offset.offsetAmountMinor, currency)}</strong>
                <span>
                  {offset.payoutBatchId ?? 'No payout batch'} · Remaining {formatMinorCurrency(offset.remainingDebtAfterEventMinor, currency)}
                </span>
              </p>
            ))
          ) : (
            <p>No payout offsets have been applied yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

export function FinancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const currentVendor = appReadiness.currentVendor;
  const authContextReady = appReadiness.ready;
  const { data: finance, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    ({ signal }) => getFinanceDashboard({ vendorId: currentVendor.vendorId, signal }),
    { enabled: authContextReady },
  );
  const {
    data: vendorDebtHistory,
    isLoading: debtHistoryLoading,
    isError: debtHistoryError,
    error: debtHistoryErrorMessage,
    refetch: refetchVendorDebtHistory,
  } = useQueryResource(
    queryKeys.finance.vendorDebtHistory(currentVendor.vendorId),
    ({ signal }) => getVendorDebtHistory({ vendorId: currentVendor.vendorId, signal }),
    { enabled: authContextReady },
  );
  const { data: supportTickets } = useQueryResource(
    currentUser?.role === 'admin' ? queryKeys.admin.support.tickets() : queryKeys.support.tickets(currentVendor.vendorId),
    ({ signal }) => (currentUser?.role === 'admin' ? listAdminSupportTickets({ signal }) : listVendorSupportTickets({ signal })),
    { enabled: authContextReady },
  );
  const { message, tone, showFeedback } = useActionFeedback();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedDebtEventId, setSelectedDebtEventId] = useState<string | null>(null);
  const activeWorkflowFilter = useMemo(() => getFinanceWorkflowFilter(searchParams.get('workflow')), [searchParams]);
  const requestedFinanceTarget = useMemo(() => getFinanceDeepLinkTarget(searchParams), [searchParams]);
  const [shippingCostProvider, setShippingCostProvider] = useState('Manual provider');
  const [shippingCostAmount, setShippingCostAmount] = useState('');
  const [shippingVatAmount, setShippingVatAmount] = useState('');
  const isAdmin = currentUser?.role === 'admin';
  const isVendorUser = currentUser?.role === 'vendor';
  const financeAudience = isAdmin ? 'admin' : 'vendor';

  useEffect(() => {
    setSelectedRecordId(null);
    setSelectedDebtEventId(null);
  }, [requestedFinanceTarget?.type, requestedFinanceTarget?.value]);

  useEffect(() => {
    setSelectedDebtEventId(null);
  }, [currentVendor.vendorId]);

  function clearWorkflowFilter() {
    if (!searchParams.has('workflow')) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('workflow');
    setSearchParams(nextParams, { replace: true });
  }

  function handleResetFilters() {
    clearWorkflowFilter();
    setSearchTerm('');
    setStatusFilter('all');
    setCategoryFilter('all');
  }

  const preparePayoutBatchMutation = useMutationAction(
    () => preparePayoutBatch(currentVendor.vendorId),
    {
      invalidateQueryKeys: [
        queryKeys.finance.summary(currentVendor.vendorId),
        queryKeys.finance.vendorDebtHistory(currentVendor.vendorId),
      ],
      onSuccess: async (batch) => {
        await Promise.all([refetch(), refetchVendorDebtHistory()]);
        showFeedback(`Draft settlement payout review ${batch.id} prepared.`, 'success');
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Draft review could not be prepared.', 'error'),
    },
  );
  const attachShippingCostMutation = useMutationAction(
    (input: {
      financeLedgerEntryId: string;
      providerName: string;
      providerReference: string | null;
      shippingCost: number;
      shippingVatAmount: number | null;
    }) =>
      attachShippingCost({
        vendorId: currentVendor.vendorId,
        financeLedgerEntryId: input.financeLedgerEntryId,
        providerName: input.providerName,
        providerReference: input.providerReference,
        shippingCost: input.shippingCost,
        shippingVatAmount: input.shippingVatAmount,
        status: 'confirmed',
        sourceType: 'manual',
      }),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async () => {
        await refetch();
        showFeedback('Shipping cost saved for future settlement context.', 'success');
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Shipping cost could not be saved.', 'error'),
    },
  );
  async function handleAttachShippingCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRecord) {
      return;
    }
    const formData = new FormData(event.currentTarget);

    try {
      await attachShippingCostMutation.mutateAsync({
        financeLedgerEntryId: selectedRecord.id,
        providerName: String(formData.get('providerName') ?? '').trim() || 'Manual provider',
        providerReference: String(formData.get('providerReference') ?? '').trim() || null,
        shippingCost: Number(formData.get('shippingCost') || 0),
        shippingVatAmount: String(formData.get('shippingVatAmount') ?? '').trim()
          ? Number(formData.get('shippingVatAmount'))
          : null,
      });
    } catch {
      // The mutation onError handler renders the compact save failure message.
    }
  }

  const financeKpis = useMemo(() => {
    const transactions = safeArray(finance?.transactions);
    const recordedRefunds = transactions.filter((record) => isRefundRecord(record) && normalizeFinanceStatus(record.status) === 'Recorded').length;
    const pendingOrHeld = transactions.filter(isPendingOrHoldRecord).length;
    const failed = transactions.filter((record) => normalizeFinanceStatus(record.status) === 'Failed').length;

    return {
      recordedRefunds,
      pendingOrHeld,
      failed,
    };
  }, [finance?.transactions]);

  const filteredRecords = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return safeArray(finance?.transactions).filter((record) => {
      const displayStatus = getPayoutActivityStatusLabel(record, financeAudience);
      const matchesWorkflow =
        !activeWorkflowFilter || isSettlementReviewWorkflowRecord(record, financeAudience);
      const matchesStatus = statusFilter === 'all' || displayStatus === statusFilter;
      const matchesCategory = categoryFilter === 'all' || record.category === categoryFilter;
      const searchableText = [
        record.id,
        record.description,
        record.category,
        displayStatus,
        record.amount,
        record.counterparty,
        currentVendor.vendorName,
        currentVendor.vendorId,
        record.shopifyOrderNumber ?? '',
        record.shopifyOrderId ?? '',
        record.shopifyRefundId ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return matchesWorkflow && matchesStatus && matchesCategory && (!query || searchableText.includes(query));
    });
  }, [activeWorkflowFilter, categoryFilter, currentVendor.vendorId, currentVendor.vendorName, finance?.transactions, financeAudience, searchTerm, statusFilter]);

  const selectedRecord = useMemo(() => {
    const selectedByClick = selectedRecordId ? filteredRecords.find((record) => record.id === selectedRecordId) : null;
    if (selectedByClick) {
      return selectedByClick;
    }
    if (requestedFinanceTarget) {
      return safeArray(finance?.transactions).find((record) => financeRecordMatchesTarget(record, requestedFinanceTarget)) ?? null;
    }
    if (!filteredRecords.length) {
      return null;
    }
    return filteredRecords[0];
  }, [filteredRecords, finance?.transactions, requestedFinanceTarget, selectedRecordId]);
  const selectedDebtEvent = useMemo(() => {
    const events = safeArray(vendorDebtHistory?.events);
    return events.find((event) => event.id === selectedDebtEventId) ?? events[0] ?? null;
  }, [selectedDebtEventId, vendorDebtHistory?.events]);
  const supportBasePath = isAdmin ? '/admin/support' : '/support';
  const relatedSupportTickets = useMemo(
    () =>
      selectedRecord
        ? safeArray(supportTickets).filter((ticket) =>
            supportTicketMatchesFinance(
              ticket,
              selectedRecord.id,
              selectedRecord.shopifyOrderNumber,
              selectedRecord.shopifyRefundId ?? null,
              {
                audience: isAdmin ? 'admin' : 'vendor',
                currentVendorId: currentVendor.vendorId,
              },
            ),
          )
        : [],
    [currentVendor.vendorId, isAdmin, selectedRecord, supportTickets],
  );
  const supportActivitySummary = getSupportActivitySummary(relatedSupportTickets);
  const selectedOrderSettlementHref = selectedRecord ? buildOrderSettlementHref(selectedRecord) : null;
  const selectedReviewDisplay = selectedRecord ? getSettlementReviewDisplay(selectedRecord) : null;
  const selectedFinanceGuidance = selectedRecord
    ? selectedReviewDisplay?.guidance ?? getFinanceWorkflowAction({
        status: selectedRecord.status,
        settlementStatus: selectedRecord.settlement?.status,
        payoutReady: selectedRecord.settlement?.review ? false : selectedRecord.settlement?.payoutReady,
        hasRefundImpact: isRefundRecord(selectedRecord) || Boolean(selectedRecord.payoutCalculation?.refundImpact),
        audience: financeAudience,
      })
    : null;
  const financeCrossLinks: OperationalLinkInput[] = [];
  const financeTimelineEvents: OperationalEventInput[] = [];
  if (selectedRecord) {
    if (selectedRecord.shopifyOrderNumber) {
      const orderHref = buildOrdersHref(selectedRecord);
      financeCrossLinks.push({
        id: `order-${selectedRecord.shopifyOrderNumber}`,
        eyebrow: 'Order',
        title: `Order ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)}`,
        description: orderHref
          ? 'Open the linked order record to review fulfillment context.'
          : 'Order link unavailable for this finance row.',
        href: orderHref ?? undefined,
        status: orderHref ? 'Linked' : 'Unavailable',
        tone: orderHref ? 'info' : 'neutral',
      });
    }
    if (selectedRecord.category === 'Refund') {
      const returnHref = buildReturnsHref(selectedRecord);
      financeCrossLinks.push({
        id: `return-${selectedRecord.id}`,
        eyebrow: 'Return',
        title: 'Related return',
        description: returnHref
          ? (selectedRecord.shopifyRefundId ? `Refund ${selectedRecord.shopifyRefundId}` : 'Customer return activity')
          : 'Return link unavailable for this finance row.',
        href: returnHref ?? undefined,
        status: returnHref ? 'Refund' : 'Unavailable',
        tone: returnHref ? 'warning' : 'neutral',
      });
    }
    if (supportActivitySummary) {
      financeCrossLinks.push({
        id: `support-group-${selectedRecord.id}`,
        eyebrow: 'Support',
        title: 'Support activity',
        description: supportActivitySummary.description,
        href: `${supportBasePath}/${supportActivitySummary.latestTicket.id}`,
        status: supportActivitySummary.latestStatus,
        tone: supportActivitySummary.tone,
      });
    }
    financeTimelineEvents.push(
      ...getFinanceTimelineItems(selectedRecord).map((item) => ({
        id: `finance-${selectedRecord.id}-${item.label}`,
        title: item.label,
        description: selectedRecord.category,
        at: item.at,
        status: item.status,
        tone: selectedRecord.category === 'Refund' ? ('warning' as const) : ('success' as const),
        visibility: item.visibility,
      })),
    );
    if (supportActivitySummary) {
      financeTimelineEvents.push({
        id: `support-group-${selectedRecord.id}`,
        title: 'Support activity',
        description: supportActivitySummary.description,
        at: supportActivitySummary.latestAt,
        status: supportActivitySummary.ticketLabel,
        tone: supportActivitySummary.tone,
        href: `${supportBasePath}/${supportActivitySummary.latestTicket.id}`,
      });
    }
  }
  const financeRecommendations: OperationsRecommendation[] = [];
  if (selectedRecord && isAdmin) {
    if (
      !selectedRecord.settlement?.review &&
      (selectedRecord.status === 'Pending' || selectedRecord.settlement?.status === 'held' || selectedRecord.settlement?.status === 'disputed')
    ) {
      financeRecommendations.push({
        id: `finance-rec-payout-${selectedRecord.id}`,
        type: 'finance_review',
        severity: 'warning',
        title: 'Review settlement issue',
        description: selectedRecord.shopifyOrderNumber
          ? `Settlement activity for ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)} needs operator review.`
          : 'This finance row needs operator review.',
        recommendedAction: 'Review settlement status before draft preparation',
        relatedObjectType: 'Finance row',
        relatedObjectId: selectedRecord.id,
        vendor: {
          id: currentVendor.vendorId,
          name: currentVendor.vendorName,
        },
        createdFromSignal: `finance:${selectedRecord.id}:payout`,
        deepLink: buildFinanceHref(selectedRecord),
        vendorVisible: false,
        createdAt: selectedRecord.date,
      });
    }
  }

  const financeView = finance ?? {
    summary: {
      grossSales: UNKNOWN_FINANCE_VALUE,
      refunds: UNKNOWN_FINANCE_VALUE,
      netRevenue: UNKNOWN_FINANCE_VALUE,
      platformFee: UNKNOWN_FINANCE_VALUE,
      payoutEstimate: UNKNOWN_FINANCE_VALUE,
      totalRevenue: UNKNOWN_FINANCE_VALUE,
      availableBalance: UNKNOWN_FINANCE_VALUE,
      pendingPayouts: UNKNOWN_FINANCE_VALUE,
      refundsThisMonth: UNKNOWN_FINANCE_VALUE,
      payableBalance: UNKNOWN_FINANCE_VALUE,
      accruedBalance: UNKNOWN_FINANCE_VALUE,
      heldBalance: UNKNOWN_FINANCE_VALUE,
    },
    transactions: [],
    profile: {
      vendorId: currentVendor.vendorId,
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: false,
      shippingMode: 'disabled' as const,
      fixedShippingFee: null,
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY' as const,
      weeklySettlementDay: 'WEDNESDAY' as const,
      monthlySettlementDay: 28,
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'default' as const,
    },
    payoutBatchSummary: {
      eligibleRowCount: 0,
      eligibleNetAmount: '$0.00',
      blockedRowCount: 0,
      latestBatch: null,
    },
  };

  return (
    <section className={`op-page finance-control-center finance-payout-workspace ${isVendorUser ? 'finance-vendor-workspace' : ''}`}>
      <div className="op-page-heading finance-page-header">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>Finance control center</h2>
          <p className="page-description">
            Review settlement estimates, refund impact, shipping reconciliation, and payout preparation.
          </p>
          <p className="page-description">{FINANCE_ESTIMATE_HELPER}</p>
        </div>
        <div className="op-heading-meta">
          <button type="button" className="button button-secondary button-compact">
            This week
          </button>
          <button
            type="button"
            className="button button-secondary button-compact"
            onClick={() => showFeedback('Finance export prepared for review.', 'success')}
          >
            Export
          </button>
        </div>
      </div>

      <div className="op-kpi-row finance-kpi-row">
        {[
          {
            icon: 'B',
            label: 'Settlement estimate',
            value: financeValueOrUnknown(financeView.summary.availableBalance ?? financeView.summary.payableBalance ?? financeView.summary.payoutEstimate),
            detail: 'Vendor finance ledger estimate.',
            metadata: {
              scope: 'Vendor finance ledger',
              timeWindow: 'All loaded ledger rows',
              generatedAt: 'Current finance view load',
            },
            tone: 'success',
          },
          {
            icon: 'V',
            label: 'Vendor balance',
            value: financeValueOrUnknown(financeView.summary.vendorBalance),
            detail: isZeroCurrencyValue(financeView.summary.outstandingVendorDebt)
              ? 'Outstanding vendor balance/debt.'
              : `Outstanding vendor balance/debt. Debt open: ${financeValueOrUnknown(financeView.summary.outstandingVendorDebt)}`,
            metadata: {
              scope: 'Vendor balance ledger',
              timeWindow: 'All balance events',
              generatedAt: 'Current finance view load',
            },
            tone: getBalanceTone(financeView.summary.vendorBalance),
          },
          {
            icon: 'P',
            label: 'Pending review',
            value: financeValueOrUnknown(financeView.summary.pendingPayouts ?? financeView.summary.heldBalance),
            detail: `Settlement-review candidates awaiting action. ${financeView.payoutBatchSummary?.eligibleRowCount ?? 0} estimate rows.`,
            metadata: {
              scope: 'Vendor finance ledger',
              timeWindow: 'All eligible settlement-review rows',
              generatedAt: 'Current finance view load',
            },
            tone: 'info',
          },
          {
            icon: 'R',
            label: 'Refund deductions',
            value: formatDeductionValue(financeView.summary.refundsThisMonth ?? financeView.summary.refunds),
            detail: 'Recorded refund deductions',
            metadata: {
              scope: 'Vendor finance ledger',
              timeWindow: financeView.summary.refundsThisMonth ? 'Current period' : 'All recorded refunds',
              generatedAt: 'Current finance view load',
            },
            tone: 'attention',
          },
          {
            icon: 'D',
            label: isVendorUser ? 'Settlement review' : 'Draft settlement payout review',
            value: getUpcomingPayoutLabel(financeView),
            detail: isVendorUser
              ? `Latest payout preparation state. ${financeView.payoutBatchSummary?.eligibleRowCount ?? 0} rows pending review.`
              : `Latest payout preparation state. ${getUpcomingPayoutDetail(financeView)}`,
            metadata: {
              scope: 'Vendor payout preparation',
              timeWindow: 'Latest payout batch plus current eligible rows',
              generatedAt: 'Current finance view load',
            },
            tone: 'info',
          },
          {
            icon: '!',
            label: 'Needs review',
            value: financeKpis.failed + (financeView.payoutBatchSummary?.blockedRowCount ?? 0),
            detail: 'Finance issues requiring operator attention.',
            metadata: {
              scope: 'Vendor finance review signals',
              timeWindow: 'Loaded finance rows plus payout blockers',
              generatedAt: 'Current finance view load',
            },
            tone: 'danger',
          },
        ].map((kpi) => (
          <article
            key={kpi.label}
            className={`finance-kpi-card op-tone-${kpi.tone}`}
            title={`Scope: ${kpi.metadata.scope}. Time window: ${kpi.metadata.timeWindow}. Generated: ${kpi.metadata.generatedAt}.`}
          >
            <span className="finance-kpi-icon" aria-hidden="true">{kpi.icon}</span>
            <div>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
              <small>{kpi.detail}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="op-control-layout finance-layout">
        <div className="op-main-column finance-activity-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search by order #, type, status, amount..."
              value={searchTerm}
              onChange={(event) => {
                clearWorkflowFilter();
                setSearchTerm(event.target.value);
              }}
            />
            <FilterBar>
              <select
                value={statusFilter}
                onChange={(event) => {
                  clearWorkflowFilter();
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="all">All statuses</option>
                <option value="Estimated">Estimated</option>
                <option value="Pending review">Pending review</option>
                <option value="Approved">Approved</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Refund impact">Refund impact</option>
                <option value="Blocked">Blocked</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(event) => {
                  clearWorkflowFilter();
                  setCategoryFilter(event.target.value);
                }}
              >
                <option value="all">All types</option>
                <option value="Invoice">Sale</option>
                <option value="Refund">Refund</option>
                <option value="Payout">Payout review</option>
                <option value="Adjustment">Adjustment</option>
              </select>
              <select defaultValue="week" aria-label="Date range">
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="all">All time</option>
              </select>
              <button
                type="button"
                className="button button-secondary"
                onClick={handleResetFilters}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>

          {activeWorkflowFilter ? (
            <div className="workflow-filter-banner" aria-label="Active workflow filter">
              <div>
                <span>Workflow filter</span>
                <strong>{activeWorkflowFilter.label}</strong>
                <small>{activeWorkflowFilter.description}</small>
              </div>
              <button type="button" className="button button-secondary button-compact" onClick={handleResetFilters}>
                Clear workflow
              </button>
            </div>
          ) : null}

          <div className="finance-filter-chips" aria-label="Finance quick filters">
            {['All', 'Sales', 'Refunds', 'Holds', 'Payout reviews'].map((chip) => (
              <span key={chip} className={chip === 'All' ? 'is-active' : ''}>{chip}</span>
            ))}
          </div>

          <OperationalTable
            columns={['Date', 'Type', 'Order', 'Status', 'Amount', 'Settlement impact', 'Updated', 'Action']}
            className="finance-op-table finance-op-table-v2"
          >
            {isError && !finance ? (
              <OperationalTableRow>
                <SectionErrorRetry
                  title="Finance unavailable"
                  description={error ?? 'The financial overview could not be loaded.'}
                  onRetry={() => void refetch()}
                />
              </OperationalTableRow>
            ) : !authContextReady || isLoading ? (
              <TableSkeletonRows columns={8} rows={6} />
            ) : filteredRecords.length === 0 ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title={activeWorkflowFilter?.emptyTitle ?? 'No finance preview activity in this view'}
                  description={activeWorkflowFilter?.emptyDescription ?? 'Adjust the status, type, or search filters to review settlement estimates.'}
                />
              </OperationalTableRow>
            ) : filteredRecords.map((record) => {
              const orderSettlementHref = buildOrderSettlementHref(record);
              return (
                <OperationalTableRow
                  key={record.id}
                  selected={selectedRecord?.id === record.id}
                  onSelect={() => setSelectedRecordId(record.id)}
                >
                  <span className="finance-date-cell">
                    <span className={`finance-type-icon ${isRefundRecord(record) ? 'is-refund' : 'is-sale'}`} aria-hidden="true">
                      {isRefundRecord(record) ? 'R' : 'S'}
                    </span>
                    <span>
                      <strong>{formatDateParts(record.date).date}</strong>
                      <small>{formatDateParts(record.date).time}</small>
                    </span>
                  </span>
                  <span className="finance-type-cell">
                    <span>
                      <strong>{getPayoutActivityType(record)}</strong>
                      <small>{getPayoutActivityDetail(record)}</small>
                    </span>
                  </span>
                  <span>
                    <strong>{record.shopifyOrderNumber ? `#${record.shopifyOrderNumber}` : '—'}</strong>
                    <small>{isRefundRecord(record) ? 'Customer return' : 'Shopify order'}</small>
                  </span>
                  <StatusBadge tone={getPayoutActivityTone(record, financeAudience)}>{getPayoutActivityStatusLabel(record, financeAudience)}</StatusBadge>
                  <strong className={isRefundRecord(record) || record.category === 'Adjustment' ? 'finance-negative finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {isRefundRecord(record) || record.category === 'Adjustment' ? '-' : ''}
                    {record.amount}
                  </strong>
                  <strong className={isRefundRecord(record) ? 'finance-negative finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {getPayoutImpact(record)}
                  </strong>
                  <span>
                    <strong>{formatDateParts(record.date).date}</strong>
                    <small>{formatDateParts(record.date).time}</small>
                  </span>
                  <OperationalActionGroup>
                    {orderSettlementHref ? (
                      <Link className="button button-secondary button-compact" to={orderSettlementHref}>
                        View order settlement
                      </Link>
                    ) : null}
                    <button type="button" className="button button-secondary button-compact" onClick={() => setSelectedRecordId(record.id)}>
                      View
                    </button>
                  </OperationalActionGroup>
                </OperationalTableRow>
              );
            })}
          </OperationalTable>

          <div className="finance-info-footer">
            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">Vendor profile</p>
                <h3>{currentVendor.vendorName} marketplace terms</h3>
                <p className="page-description">
                  Finance policy is edited from Vendor Profile. New payout estimates use the saved policy snapshot.
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Commission" value={`${financeView.profile?.commissionPercent ?? '10.00'}%`} />
                <MetadataRow label="Commission VAT" value={`${financeView.profile?.commissionVatPercent ?? '0.00'}%`} />
                <MetadataRow label="Shipping deduction mode" value={financeView.profile?.shippingMode ? safeStatusLabel(financeView.profile.shippingMode) : 'Disabled'} />
                <MetadataRow label="Deduct shipping after fulfillment" value={financeView.profile?.deductShippingEnabled ? 'Yes' : 'No'} />
                <MetadataRow label="Fixed shipping fee" value={financeView.profile?.fixedShippingFee ?? 'Not configured'} />
                <MetadataRow label="Settlement delay" value={`${financeView.profile?.settlementDelayDays ?? 21} days`} />
              </div>
              <StatusBadge tone="neutral">Read-only finance policy</StatusBadge>
            </section>

            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">Settlement review</p>
                <h3>{isVendorUser ? 'Settlement review' : 'Draft settlement payout review'}</h3>
                <p className="page-description">
                  {isVendorUser
                    ? 'A read-only view of estimate rows currently eligible for settlement review.'
                    : 'Prepare eligible estimate rows for review. No payment is executed here.'}
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Rows pending review" value={financeView.payoutBatchSummary?.eligibleRowCount ?? 0} />
                <MetadataRow label="Estimated payable before debt" value={financeValueOrUnknown(financeView.payoutBatchSummary?.eligibleNetAmount ?? financeView.summary.payableBalance ?? financeView.summary.payoutEstimate)} />
                <MetadataRow
                  label="Outstanding vendor debt"
                  value={<span className={isZeroCurrencyValue(financeView.payoutBatchSummary?.outstandingDebtAmount) ? undefined : 'finance-deduction-value'}>
                    {financeValueOrUnknown(financeView.payoutBatchSummary?.outstandingDebtAmount ?? financeView.summary.outstandingVendorDebt)}
                  </span>}
                />
                <MetadataRow label="Debt offset preview" value={financeValueOrUnknown(financeView.payoutBatchSummary?.debtOffsetPreviewAmount)} />
                <MetadataRow
                  label="Net after debt preview"
                  value={<span className={getBalanceTone(financeView.payoutBatchSummary?.netEligibleAfterDebtOffset ?? financeView.summary.netPayableAfterDebt) === 'danger' ? 'finance-deduction-value' : 'finance-payout-value'}>
                    {financeValueOrUnknown(financeView.payoutBatchSummary?.netEligibleAfterDebtOffset ?? financeView.summary.netPayableAfterDebt)}
                  </span>}
                />
                <MetadataRow label="Needs review" value={financeView.payoutBatchSummary?.blockedRowCount ?? 0} />
                <MetadataRow
                  label={isVendorUser ? 'Latest review status' : 'Latest draft review'}
                  value={
                    financeView.payoutBatchSummary?.latestBatch
                      ? `${getPayoutBatchStatusLabel(financeView.payoutBatchSummary.latestBatch.status, financeAudience)} · ${financeView.payoutBatchSummary.latestBatch.netAmount}`
                      : isVendorUser
                        ? 'No review scheduled'
                        : 'No draft prepared'
                  }
                />
              </div>
              {isAdmin ? (
                <div className="finance-payout-prep-actions">
                  <button
                    type="button"
                    className="button button-primary button-compact"
                    disabled={preparePayoutBatchMutation.isPending || (financeView.payoutBatchSummary?.eligibleRowCount ?? 0) === 0}
                    onClick={() => preparePayoutBatchMutation.mutate(undefined)}
                  >
                    {preparePayoutBatchMutation.isPending ? 'Preparing...' : 'Prepare draft review'}
                  </button>
                  <StatusBadge tone={(financeView.payoutBatchSummary?.eligibleRowCount ?? 0) > 0 ? 'success' : 'neutral'}>
                    {(financeView.payoutBatchSummary?.eligibleRowCount ?? 0) > 0 ? 'Rows pending review' : 'No review rows'}
                  </StatusBadge>
                </div>
              ) : (
                <StatusBadge tone="neutral">Read-only settlement preview</StatusBadge>
              )}
            </section>
          </div>
          <VendorDebtHistorySection
            history={vendorDebtHistory}
            loading={debtHistoryLoading}
            error={debtHistoryError ? debtHistoryErrorMessage : null}
            selectedEvent={selectedDebtEvent}
            onSelectEvent={setSelectedDebtEventId}
          />
        </div>

        <SideDetailPanel
          eyebrow="Settlement estimate"
          title={selectedRecord?.shopifyOrderNumber ? `Order ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)}` : 'Settlement estimate'}
        >
          {selectedRecord ? (
            <>
              {selectedFinanceGuidance ? (
                <WorkflowActionGuidance
                  actionLabel={selectedFinanceGuidance.actionLabel}
                  description={selectedFinanceGuidance.description}
                  tone={selectedFinanceGuidance.tone}
                >
                  {selectedOrderSettlementHref ? (
                    <Link className="button button-secondary button-compact finance-order-settlement-link" to={selectedOrderSettlementHref}>
                      View order settlement
                    </Link>
                  ) : null}
                </WorkflowActionGuidance>
              ) : null}
              <div className="op-detail-status-row">
                <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>{getPayoutActivityStatusLabel(selectedRecord, financeAudience)}</StatusBadge>
                <strong
                  className={
                    isRefundRecord(selectedRecord) || selectedRecord.category === 'Adjustment'
                      ? 'finance-negative'
                      : 'finance-positive'
                  }
                >
                  {isRefundRecord(selectedRecord) || selectedRecord.category === 'Adjustment' ? '-' : ''}
                  {selectedRecord.amount}
                </strong>
              </div>
              <OperationalRecommendations
                title="Suggested next steps"
                subtitle="Admin-only guidance for this finance row."
                recommendations={financeRecommendations}
                audience={isAdmin ? 'admin' : 'vendor'}
              />
              <AdminCollaborationNotes contextType="finance" contextId={selectedRecord.id} currentUser={currentUser} />
              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Settlement preview</h4>
                  <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>
                    {getPayoutActivityStatusLabel(selectedRecord, financeAudience)}
                  </StatusBadge>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow label="Order" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Review status" value={getPayoutActivityStatusLabel(selectedRecord, financeAudience)} />
                  <MetadataRow
                    label="Estimated payout"
                    value={<span className="finance-payout-value">{financeValueOrUnknown(selectedRecord.payoutCalculation?.estimatedPayout ?? selectedRecord.amount)}</span>}
                  />
                  <MetadataRow
                    label="Refund impact"
                    value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.refundImpact)}</span>}
                  />
                  <MetadataRow
                    label="Settlement impact"
                    value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : 'finance-payout-value'}>{getPayoutImpact(selectedRecord)}</span>}
                  />
                  <MetadataRow
                    label={isVendorUser ? 'Settlement review' : 'Payout review'}
                    value={
                      selectedReviewDisplay
                        ? selectedReviewDisplay.label
                        : selectedRecord.payoutBatch
                          ? (isVendorUser ? 'Pending review' : 'Draft review artifact')
                          : 'No review scheduled'
                    }
                  />
                  {selectedRecord.settlement?.review ? (
                    <MetadataRow label="Approval" value={selectedRecord.settlement.review.approvalId} />
                  ) : null}
                  {selectedReviewDisplay?.detail ? (
                    <MetadataRow
                      label={selectedRecord.settlement?.review?.commissionInvoiceStatus === 'created' ? 'Commission invoice reference' : 'Settlement reference'}
                      value={selectedReviewDisplay.detail}
                    />
                  ) : null}
                </div>
              </div>

              {selectedRecord.settlementRefundAdjustments?.length ? (
                <div className="finance-detail-card">
                  <div className="finance-detail-card-heading">
                    <h4>Refund Adjustment</h4>
                    <StatusBadge tone="warning">
                      {formatAdjustmentStatus(selectedRecord.settlementRefundAdjustments[0].status)}
                    </StatusBadge>
                  </div>
                  <div className="finance-detail-rows">
                    {selectedRecord.settlementRefundAdjustments.map((adjustment) => (
                      <MetadataGroup key={adjustment.id} title={adjustment.references?.orderLabel ?? adjustment.id}>
                        <MetadataRow label="Status" value={formatAdjustmentStatus(adjustment.status)} />
                        <MetadataRow label="Status detail" value={getRefundAdjustmentStatusCopy(adjustment.status)} />
                        <MetadataRow label="Original order" value={adjustment.references?.orderLabel ?? adjustment.originalOrderId ?? 'Unavailable'} />
                        <MetadataRow label="Original refund" value={adjustment.references?.refundLabel ?? adjustment.refundRecordId ?? 'Unavailable'} />
                        <MetadataRow
                          label="Remaining amount"
                          value={<span className="finance-deduction-value">{formatMinorCurrency(adjustment.remainingAmountMinor ?? adjustment.amountMinor, adjustment.currencyCode)}</span>}
                        />
                        <MetadataRow label="Original amount" value={formatMinorCurrency(adjustment.originalAmountMinor ?? adjustment.amountMinor, adjustment.currencyCode)} />
                        <MetadataRow label="Applied amount" value={formatMinorCurrency(adjustment.appliedAmountMinor ?? 0, adjustment.currencyCode)} />
                        <MetadataRow
                          label="Next settlement impact"
                          value={(adjustment.remainingAmountMinor ?? adjustment.amountMinor) > 0
                            ? `${formatMinorCurrency(adjustment.remainingAmountMinor ?? adjustment.amountMinor, adjustment.currencyCode)} deduction remains`
                            : 'Finished'}
                        />
                        <MetadataRow label="Reason" value={adjustment.reason} />
                        <MetadataRow label="Linked settlement" value={adjustment.references?.originalSettlementLabel ?? adjustment.originalSettlementApprovalId ?? 'Not linked'} />
                        <MetadataRow label="Linked commission invoice" value={adjustment.references?.originalCommissionInvoiceLabel ?? adjustment.originalSettlementCommissionInvoiceId ?? 'Not linked'} />
                        <MetadataRow label="Applied settlement" value={adjustment.appliedSettlementApprovalId ?? 'Not applied yet'} />
                        {adjustment.applications?.length ? (
                          <MetadataRow
                            label="Application history"
                            value={adjustment.applications
                              .map((application) => `${formatAdjustmentStatus(application.status)} ${formatMinorCurrency(application.amountMinor, application.currencyCode)} · Settlement ${application.settlementApprovalId}`)
                              .join(', ')}
                          />
                        ) : null}
                        {adjustment.events?.length ? (
                          <MetadataRow
                            label="Timeline"
                            value={adjustment.events
                              .map((event) => `${formatAdjustmentStatus(event.eventType)} · ${formatDateTime(event.createdAt)}`)
                              .join(', ')}
                          />
                        ) : null}
                        <MetadataRow label="Diagnostics id" value={adjustment.id} />
                      </MetadataGroup>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Deductions</h4>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow
                    label={`Commission (${selectedRecord.payoutCalculation?.commissionPercent ?? financeView.profile?.commissionPercent ?? '10.00'}%)`}
                    value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.commission)}</span>}
                  />
                  <MetadataRow
                    label={`Tax (${selectedRecord.payoutCalculation?.commissionVatPercent ?? financeView.profile?.commissionVatPercent ?? '0.00'}%)`}
                    value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.commissionVat)}</span>}
                  />
                  <MetadataRow
                    label="Shipping fee"
                    value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.shippingDeduction)}</span>}
                  />
                  <MetadataRow
                    label="Total deductions"
                    value={<span className="finance-deduction-value">{getTotalDeductions(selectedRecord) === UNKNOWN_FINANCE_VALUE ? UNKNOWN_FINANCE_VALUE : formatDeductionValue(getTotalDeductions(selectedRecord))}</span>}
                  />
                  <MetadataRow
                    label="Net estimate impact"
                    value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : 'finance-payout-value'}>{getPayoutImpact(selectedRecord)}</span>}
                  />
                </div>
              </div>

              <OperationalTimeline
                title="Finance timeline"
                subtitle={FINANCE_TIMELINE_HELPER}
                events={financeTimelineEvents}
                audience={financeAudience}
              />

              <OperationalLinkCards
                title="Related records"
                subtitle="Grouped order, return, and support context for this finance row."
                links={financeCrossLinks}
                audience={financeAudience}
              />

              {relatedSupportTickets.length > 1 ? (
                <details className="finance-support-history">
                  <summary>
                    <span>
                      <strong>Support history</strong>
                      {supportActivitySummary ? <small>Latest status: {supportActivitySummary.latestStatus}</small> : null}
                    </span>
                    <StatusBadge tone="neutral">{supportActivitySummary?.ticketLabel ?? `${relatedSupportTickets.length} linked tickets`}</StatusBadge>
                  </summary>
                  <div className="finance-support-history-list">
                    {relatedSupportTickets.map((ticket) => (
                      <Link key={ticket.id} to={`${supportBasePath}/${ticket.id}`}>
                        <span>
                          <strong>{ticket.subject}</strong>
                          <small>{formatSupportStatus(ticket.status)} · {formatSupportPriority(ticket.priority)}</small>
                        </span>
                        <small>{formatDate(getSupportLatestActivityAt(ticket))}</small>
                      </Link>
                    ))}
                  </div>
                </details>
              ) : null}

              {isAdmin && selectedRecord.category === 'Invoice' ? (
                <form className="finance-shipping-cost-form" aria-label="Attach shipping cost" onSubmit={handleAttachShippingCost}>
                  <h4>Shipping cost</h4>
                  <div className="op-form-grid">
                    <label>
                      <span>Source</span>
                      <input
                        name="providerName"
                        value={shippingCostProvider}
                        onChange={(event) => setShippingCostProvider(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Reference</span>
                      <input name="providerReference" placeholder="Optional" />
                    </label>
                    <label>
                      <span>Cost</span>
                      <input
                        name="shippingCost"
                        value={shippingCostAmount}
                        onChange={(event) => setShippingCostAmount(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      <span>Tax</span>
                      <input
                        name="shippingVatAmount"
                        value={shippingVatAmount}
                        onChange={(event) => setShippingVatAmount(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <button type="submit" className="button button-secondary button-compact" disabled={attachShippingCostMutation.isPending}>
                    {attachShippingCostMutation.isPending ? 'Saving...' : 'Save shipping cost'}
                  </button>
                  <p className="page-description">
                    Shipping cost can change settlement estimates after reconciliation.
                  </p>
                </form>
              ) : null}
            </>
          ) : (
            <EmptyStatePanel
              title={requestedFinanceTarget ? 'Linked finance record unavailable' : 'Select a finance record'}
              description={
                requestedFinanceTarget
                  ? 'The linked finance record is not available in the current vendor scope.'
                  : 'Choose a finance row to review settlement estimate and invoice details.'
              }
            />
          )}
        </SideDetailPanel>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
