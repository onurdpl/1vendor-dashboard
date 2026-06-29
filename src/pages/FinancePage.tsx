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
import { getPageReadinessState } from '../lib/pageReadiness';
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
import {
  VENDOR_BLOCKED_FINANCE_HOLD_REASON,
  getFinanceNeedsReviewBreakdown,
  getFinanceOperationalProjection,
  getPayoutBatchStatusLabel,
  normalizeFinanceStatus,
  type FinanceOperationalProjection,
} from '../lib/financeOperationalProjection';

type FinanceDeepLinkTarget = {
  type: 'ledger' | 'refund' | 'order' | 'shopifyOrder';
  value: string;
};

type FinanceWorkspaceTab = 'overview' | 'transactions';

type FinanceTimelineItem = {
  label: string;
  at: string | null;
  status: string;
  detail?: string;
  visibility?: 'admin';
};

const FINANCE_ESTIMATE_HELPER =
  'Values update as orders become eligible, refunds are processed, or reviews are completed.';
const FINANCE_TIMELINE_HELPER = 'Activity entries are previews until settlement review is completed.';
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

function isRefundRecord(record: FinanceTransaction) {
  return record.category === 'Refund';
}

function isVendorBlockedFinanceHold(record: FinanceTransaction) {
  return record.settlement?.holdReason === VENDOR_BLOCKED_FINANCE_HOLD_REASON;
}

type SplitFinanceLedgerRole = 'original_source' | 'remaining_source' | 'child';

function getSplitFinanceLedgerRole(record: FinanceTransaction): SplitFinanceLedgerRole | null {
  const summary = record.splitFinanceSummary;
  if (!summary) {
    return null;
  }
  if (summary.childFinanceLedgerEntryId === record.id || summary.lineageRole === 'child') {
    return 'child';
  }
  if (summary.remainingFinanceLedgerEntryId === record.id) {
    return 'remaining_source';
  }
  if (summary.sourceFinanceLedgerEntryId === record.id) {
    return 'original_source';
  }
  return summary.lineageRole === 'source' ? 'remaining_source' : null;
}

function getSplitFinanceLedgerLabel(record: FinanceTransaction) {
  if (isRefundedSplitChildSaleBasis(record)) {
    return 'Adjusted by Shopify refund';
  }
  const role = getSplitFinanceLedgerRole(record);
  if (role === 'child') {
    return 'Blocked split order assignment transaction';
  }
  if (role === 'original_source') {
    return 'Original split source transaction';
  }
  if (role === 'remaining_source') {
    return 'Remaining order assignment transaction';
  }
  return null;
}

function getSplitFinanceExplanation(record: FinanceTransaction) {
  if (isRefundedSplitChildSaleBasis(record)) {
    return 'Refund completed. This split child sale basis is balanced by the Shopify refund and awaits settlement adjustment review.';
  }
  const role = getSplitFinanceLedgerRole(record);
  if (role === 'child') {
    return 'Created from line-item reject split. Held until transfer, refund, or return resolution.';
  }
  if (role === 'original_source') {
    return 'Original source transaction was replaced when selected items were moved into a blocked order assignment.';
  }
  if (role === 'remaining_source') {
    return 'Original order assignment was split. Selected items moved into a blocked order assignment.';
  }
  return null;
}

function isSplitChildFinanceHold(record: FinanceTransaction) {
  return getSplitFinanceLedgerRole(record) === 'child' && isVendorBlockedFinanceHold(record);
}

function isRefundedSplitChildSaleBasis(record: FinanceTransaction) {
  return (
    record.category === 'Invoice' &&
    getSplitFinanceLedgerRole(record) === 'child' &&
    record.splitFinanceSummary?.refundedChildSaleBasis === true
  );
}

function isSettlementReviewPendingRecord(record: FinanceTransaction) {
  return Boolean(record.settlement?.payoutReady || record.settlement?.status === 'partially_refunded');
}

function isRefundDeductionSettlementReviewPending(record: FinanceTransaction) {
  return isRefundRecord(record) && isSettlementReviewPendingRecord(record);
}

function getPayoutActivityType(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  if (audience === 'vendor') {
    if (record.category === 'Refund') {
      return isRefundDeductionSettlementReviewPending(record) ? 'Refund review' : 'Refund deduction';
    }
    if (record.category === 'Invoice') {
      return 'Sale';
    }
    if (record.category === 'Adjustment') {
      return 'Balance adjustment';
    }
    if (record.description?.toLowerCase().includes('shipping')) {
      return 'Shipping cost';
    }
    return record.category;
  }
  if (isRefundedSplitChildSaleBasis(record)) {
    return 'Refunded split sale basis';
  }
  if (record.category === 'Invoice') {
    return 'Sale estimate';
  }
  if (record.category === 'Refund') {
    return 'Refund deduction';
  }
  return record.category;
}

function getPayoutActivityDetail(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  if (audience === 'vendor') {
    return null;
  }
  if (isRefundedSplitChildSaleBasis(record)) {
    return 'Adjusted by Shopify refund';
  }
  if (isRefundDeductionSettlementReviewPending(record)) {
    return 'Refund recorded. Awaiting settlement adjustment review.';
  }
  if (isSplitChildFinanceHold(record)) {
    return 'Split order assignment hold';
  }
  const splitLabel = getSplitFinanceLedgerLabel(record);
  if (splitLabel) {
    return splitLabel;
  }
  if (isVendorBlockedFinanceHold(record)) {
    return 'Vendor blocked';
  }
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
      description: 'This row is locked in a draft settlement review and is excluded from new review candidates.',
      tone: 'info' as const,
    },
  };
}

function getPayoutActivityStatusLabel(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  return getFinanceOperationalProjection(record, { audience }).legacyStatusLabel;
}

function getPayoutActivityTone(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  return getFinanceOperationalProjection(record, { audience }).tone;
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

function formatLikeCurrencyReference(value: number, reference: string | null | undefined) {
  const currency = reference?.match(/^[^\d-]+/)?.[0] ?? '$';
  return `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  if (value === UNKNOWN_FINANCE_VALUE) {
    return value;
  }
  if (value.startsWith('-') || isZeroCurrencyValue(value)) {
    return value;
  }
  return `-${value}`;
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

function getOverviewBalanceValue(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  return financeValueOrUnknown(finance.summary.payableBalance ?? finance.summary.availableBalance ?? finance.summary.payoutEstimate);
}

function getOverviewPendingValue(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  return financeValueOrUnknown(finance.summary.accruedBalance ?? finance.summary.pendingPayouts ?? finance.summary.pendingSettlement);
}

function getOverviewHoldValue(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  return financeValueOrUnknown(finance.summary.heldBalance);
}

function getOverviewPaymentValue(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  return financeValueOrUnknown(
    finance.payoutBatchSummary?.netEligibleAfterDebtOffset ??
      finance.payoutBatchSummary?.eligibleNetAmount ??
      finance.summary.netPayableAfterDebt ??
      finance.summary.payoutEstimate,
  );
}

function getOverviewPaymentDate(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  if (finance.payoutBatchSummary?.latestBatch?.createdAt) {
    return `Preparation started ${formatDateParts(finance.payoutBatchSummary.latestBatch.createdAt).date}`;
  }
  if (finance.profile?.weeklySettlementDay) {
    return `${safeStatusLabel(finance.profile.weeklySettlementDay)} after review`;
  }
  return 'After settlement review';
}

function getOverviewPaymentStatus(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>, audience: 'admin' | 'vendor') {
  if (finance.payoutBatchSummary?.latestBatch) {
    return getPayoutBatchStatusLabel(finance.payoutBatchSummary.latestBatch.status, audience);
  }
  if ((finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0) {
    return 'Ready for review';
  }
  return 'Building balance';
}

function getRelativeActivityDay(value: string) {
  const timestamp = getSafeTimestamp(value);
  if (!timestamp) {
    return 'Recent';
  }
  const today = new Date();
  const activity = new Date(timestamp);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const activityStart = new Date(activity.getFullYear(), activity.getMonth(), activity.getDate()).getTime();
  const dayDifference = Math.round((todayStart - activityStart) / 86_400_000);
  if (dayDifference <= 0) {
    return 'Today';
  }
  if (dayDifference === 1) {
    return 'Yesterday';
  }
  return `${dayDifference} days ago`;
}

function getRecentChangeTitle(record: FinanceTransaction) {
  if (record.category === 'Refund') {
    return 'Refund deducted';
  }
  if (record.category === 'Payout') {
    return 'Payment preparation updated';
  }
  if (record.category === 'Adjustment') {
    return 'Balance adjusted';
  }
  if (record.settlement?.payoutReady) {
    return 'Order became eligible';
  }
  return 'Sale recorded';
}

function getRecentChangeDetail(record: FinanceTransaction) {
  const orderLabel = record.shopifyOrderNumber ? `Order #${record.shopifyOrderNumber}` : 'Marketplace activity';
  if (record.category === 'Refund') {
    return `${orderLabel} reduced the current balance by ${record.amount}.`;
  }
  if (record.category === 'Payout') {
    return `${record.amount} moved through payment preparation.`;
  }
  if (record.category === 'Adjustment') {
    return `${record.amount} changed the balance.`;
  }
  if (record.settlement?.payoutReady) {
    return `${orderLabel} is now ready for payment review.`;
  }
  return `${orderLabel} was added to finance activity.`;
}

function getPaymentProgressSteps(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>) {
  const hasActivity = safeArray(finance.transactions).length > 0;
  const hasEligibleRows = (finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0;
  const hasPaymentPreparation = Boolean(finance.payoutBatchSummary?.latestBatch);
  return [
    {
      label: 'Sales',
      detail: hasActivity ? 'Sales recorded' : 'Waiting for first sale',
      state: hasActivity ? 'complete' : 'upcoming',
    },
    {
      label: 'Delivered',
      detail: hasEligibleRows || hasPaymentPreparation ? 'Orders eligible' : 'Waiting for delivery',
      state: hasEligibleRows || hasPaymentPreparation ? 'complete' : hasActivity ? 'current' : 'upcoming',
    },
    {
      label: 'Settlement',
      detail: hasEligibleRows || hasPaymentPreparation ? 'Review ready' : 'Not ready yet',
      state: hasPaymentPreparation ? 'complete' : hasEligibleRows ? 'current' : 'upcoming',
    },
    {
      label: 'Payment preparation',
      detail: hasPaymentPreparation ? 'In progress' : 'Not started',
      state: hasPaymentPreparation ? 'current' : 'upcoming',
    },
    {
      label: 'Paid',
      detail: 'Payment evidence pending',
      state: 'upcoming',
    },
  ] as const;
}

function getPayoutImpact(record: FinanceTransaction) {
  if (isVendorBlockedFinanceHold(record)) {
    return 'Held';
  }
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
  const splitRole = getSplitFinanceLedgerRole(record);
  const refundedSplitChildSaleBasis = isRefundedSplitChildSaleBasis(record);
  const settlementOffsetReviewPending = refundedSplitChildSaleBasis || isRefundDeductionSettlementReviewPending(record);
  const splitItems: Array<FinanceTimelineItem | null> = record.splitFinanceSummary
    ? [
        {
          label: 'Allocation split created',
          at: record.splitFinanceSummary.splitCreatedAt,
          status: 'Split',
        },
        splitRole === 'child'
          ? {
              label: refundedSplitChildSaleBasis ? 'Child order assignment operationally resolved' : 'Child held transaction created',
              at: record.splitFinanceSummary.splitCreatedAt,
              status: refundedSplitChildSaleBasis ? 'Resolved' : 'Held',
            }
          : null,
        splitRole === 'remaining_source' || splitRole === 'original_source'
          ? {
              label: 'Source transaction replaced',
              at: record.splitFinanceSummary.splitCreatedAt,
              status: 'Transaction',
            }
          : null,
      ]
    : [];
  const items: Array<FinanceTimelineItem | null> = [
    {
      label: isRefundRecord(record) ? 'Refund impact captured' : 'Order captured',
      at: record.date,
      status: normalizeFinanceStatus(record.status),
    },
    ...splitItems,
    {
      label: reviewDisplay?.timelineLabel ?? (settlementOffsetReviewPending ? 'Settlement adjustment awaiting review' : record.settlement?.payoutReady ? 'Settlement awaiting review' : 'Settlement preview generated'),
      at: record.settlement?.payableAt ?? record.settlement?.eligibleAt ?? null,
      status: reviewDisplay?.timelineStatus ?? (record.settlement?.payoutReady ? 'Review' : 'Preview'),
      detail: settlementOffsetReviewPending ? 'Operational resolution completed. Only settlement accounting review remains.' : undefined,
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

function hasFinanceReviewCopy(value: string | null | undefined) {
  return /\bsettlement\b|\boffset review\b|\bpayout accounting\b|\bledger\b|\breference id\b|\bapproval id\b|\bcommission invoice\b/i.test(value ?? '');
}

type VendorFinanceStatusLabel = 'Review' | 'Ready' | 'Preparing' | 'On hold' | 'Blocked' | 'Estimated' | 'Paid';

function getVendorFinanceStatusLabel(
  record: FinanceTransaction,
  projection: FinanceOperationalProjection | null,
  settlementOffsetReviewPending: boolean,
): VendorFinanceStatusLabel {
  const candidates = [
    projection?.payoutReadiness,
    projection?.legacyStatusLabel,
    projection?.settlementState,
    projection?.payoutState,
    projection?.blockerState,
    record.settlement?.status,
    record.payoutBatch?.status,
  ].filter((value): value is string => Boolean(value));
  const combined = candidates.join(' ').toLowerCase();

  if (settlementOffsetReviewPending || combined.includes('refund offset') || combined.includes('offset review')) {
    return 'Review';
  }
  if (combined.includes('draft') || combined.includes('locked') || combined.includes('batch')) {
    return 'Preparing';
  }
  if (combined.includes('paid') || combined.includes('completed') || combined.includes('reconciled')) {
    return 'Paid';
  }
  if (combined.includes('ready') || combined.includes('payable')) {
    return 'Ready';
  }
  if (combined.includes('held') || combined.includes('hold')) {
    return 'On hold';
  }
  if (combined.includes('blocked') || combined.includes('disputed')) {
    return 'Blocked';
  }
  if (hasFinanceReviewCopy(projection?.legacyStatusLabel)) {
    return 'Review';
  }

  return 'Estimated';
}

function getVendorPaymentWaitingSummary(status: VendorFinanceStatusLabel) {
  if (status === 'Review') {
    return 'A review is in progress. Payment will continue after review.';
  }
  if (status === 'Preparing') {
    return 'Payment is being prepared. No action is needed right now.';
  }
  if (status === 'On hold') {
    return 'This payment is on hold until the issue is resolved.';
  }
  if (status === 'Blocked') {
    return 'This payment is blocked until the issue is resolved.';
  }
  return null;
}

function getVendorNextActionCopy(status: VendorFinanceStatusLabel) {
  if (status === 'On hold' || status === 'Blocked') {
    return {
      title: 'Review required',
      body: 'Open the related order or contact support.',
    };
  }
  if (status === 'Review') {
    return {
      title: 'No action needed',
      body: 'We are reviewing this payment.',
    };
  }
  if (status === 'Preparing') {
    return {
      title: 'No action needed',
      body: 'Payment preparation is in progress.',
    };
  }
  if (status === 'Ready') {
    return {
      title: 'No action needed',
      body: 'This amount is ready for payment.',
    };
  }
  if (status === 'Paid') {
    return {
      title: 'No action needed',
      body: 'This amount has already been paid.',
    };
  }
  return {
    title: 'No action needed',
    body: 'This amount is not ready for payment yet.',
  };
}

function shouldShowVendorPaymentWaiting(status: VendorFinanceStatusLabel) {
  return status === 'Review' || status === 'Preparing' || status === 'On hold' || status === 'Blocked';
}

function getVendorFinanceTimelineEvents(events: OperationalEventInput[], status: VendorFinanceStatusLabel): OperationalEventInput[] {
  return events.filter((event) => !event.id.startsWith('support-group-')).map((event) => {
    const title = event.title === 'Refund impact captured'
      ? 'Refund recorded'
      : hasFinanceReviewCopy(event.title)
        ? status === 'Preparing'
          ? 'Payment preparing'
          : 'Review in progress'
        : status === 'Ready'
          ? 'Payment ready'
          : status === 'Preparing'
            ? 'Payment preparing'
            : status === 'On hold'
              ? 'Payment held'
              : status === 'Blocked'
                ? 'Payment blocked'
                : status === 'Paid'
                  ? 'Payment paid'
                  : event.title;

    return {
      ...event,
      title,
      description: undefined,
      status,
    };
  });
}

function shouldShowFinanceValue(value: string | null | undefined, paymentImpact: string) {
  if (!value || value === UNKNOWN_FINANCE_VALUE || isZeroCurrencyValue(value)) {
    return false;
  }
  return parseCurrencyValue(value) !== parseCurrencyValue(paymentImpact);
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

function getFinanceWorkflowFilter(workflow: string | null, audience: 'admin' | 'vendor' = 'admin') {
  if (workflow === 'settlement-review') {
    if (audience === 'vendor') {
      return {
        label: 'Payment review',
        description: 'Showing payment rows waiting for review.',
        emptyTitle: 'No payment review rows currently pending',
        emptyDescription: 'This workflow queue has no payment rows waiting for review. Clear the workflow to inspect all finance activity.',
      };
    }
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
    <section className="finance-footer-card finance-debt-history-card" aria-label="Balance adjustment history">
      <div>
        <p className="eyebrow">Balance adjustment</p>
        <h3>Balance Adjustment History</h3>
        <p className="page-description">
          Review refund-after-payment balance adjustments and payment deductions without opening database records.
        </p>
      </div>
      <div className="op-kpi-row finance-debt-summary-row">
        <article className={`op-kpi ${outstandingDebtMinor > 0 ? 'op-tone-danger' : 'op-tone-neutral'}`}>
          <span>Outstanding Adjustment</span>
          <strong>{formatMinorCurrency(outstandingDebtMinor, currency)}</strong>
          <small>{outstandingDebtMinor > 0 ? 'Will reduce a future payment' : 'No open adjustment'}</small>
        </article>
        <article className="op-kpi op-tone-danger">
          <span>Total Adjustment Created</span>
          <strong>{formatMinorCurrency(history?.summary.totalDebtCreatedMinor ?? 0, currency)}</strong>
        </article>
        <article className="op-kpi op-tone-success">
          <span>Total Adjustment Applied</span>
          <strong>{formatMinorCurrency(history?.summary.totalDebtOffsetMinor ?? 0, currency)}</strong>
        </article>
        <article className={`op-kpi ${remainingDebtMinor > 0 ? 'op-tone-danger' : 'op-tone-success'}`}>
          <span>Remaining Adjustment</span>
          <strong>{formatMinorCurrency(remainingDebtMinor, currency)}</strong>
          <small>{history?.summary.lastDebtActivityAt ? `Last activity ${formatDateParts(history.summary.lastDebtActivityAt).date}` : 'No activity'}</small>
        </article>
      </div>
      {error ? (
        <SectionErrorRetry
          title="Balance adjustment history unavailable"
          description={error}
        />
      ) : loading ? (
        <p className="settlement-compact-empty">Loading balance adjustment history...</p>
      ) : events.length === 0 ? (
        <EmptyStatePanel
          title="No balance adjustment history"
          description="Refund-after-payment adjustments and payment deductions will appear here when they exist."
        />
      ) : (
        <>
          <OperationalTable
            columns={['Event Date', 'Event Type', 'Order', 'Vendor', 'Items', 'Adjustment Amount', 'Remaining Adjustment', 'Source Reference']}
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
    <div className="finance-debt-detail-panel" aria-label="Balance adjustment detail">
      <div className="finance-debt-detail-heading">
        <div>
          <p className="eyebrow">Balance adjustment detail</p>
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
        <MetadataGroup title="Balance Adjustment Calculation">
          <MetadataRow label="Refund amount" value={event.calculation.refundMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.refundMinor, currency)} />
          <MetadataRow label="Commission reversal" value={event.calculation.commissionReversalMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.commissionReversalMinor, currency)} />
          <MetadataRow label="Commission VAT reversal" value={event.calculation.commissionVatReversalMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.commissionVatReversalMinor, currency)} />
          <MetadataRow label="Balance adjustment created" value={event.calculation.vendorDebtMinor === null ? 'Unknown' : formatMinorCurrency(event.calculation.vendorDebtMinor, currency)} />
          <MetadataRow label="Balance adjustment applied" value={event.calculation.debtOffsetMinor === null ? 'Not applicable' : formatMinorCurrency(event.calculation.debtOffsetMinor, currency)} />
          <MetadataRow label="Formula" value={event.calculation.formula ?? 'Not available'} />
        </MetadataGroup>
        <MetadataGroup title="Payment Adjustment">
          <MetadataRow label="Payment preparation" value={event.payoutBatchId ?? 'Not applicable'} />
          <MetadataRow label="Payment preparation status" value={event.payoutBatchStatus ? safeStatusLabel(event.payoutBatchStatus) : 'Not applicable'} />
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
          <h5>Adjustment History</h5>
          {event.offsetHistory.length ? (
            event.offsetHistory.map((offset) => (
              <p key={offset.id}>
                <strong>{formatMinorCurrency(offset.offsetAmountMinor, currency)}</strong>
                <span>
                  {offset.payoutBatchId ?? 'No payment preparation'} · Remaining {formatMinorCurrency(offset.remainingDebtAfterEventMinor, currency)}
                </span>
              </p>
            ))
          ) : (
            <p>No payment adjustments have been applied yet.</p>
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
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: true,
    currentVendorId: currentVendor.vendorId,
  });
  const authContextReady = pageReadiness.ready;
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
  const [activeFinanceTab, setActiveFinanceTab] = useState<FinanceWorkspaceTab>('overview');
  const isAdmin = currentUser?.role === 'admin';
  const isVendorUser = currentUser?.role === 'vendor';
  const financeAudience = isAdmin ? 'admin' : 'vendor';
  const activeWorkflowFilter = useMemo(() => getFinanceWorkflowFilter(searchParams.get('workflow'), financeAudience), [financeAudience, searchParams]);
  const requestedFinanceTarget = useMemo(() => getFinanceDeepLinkTarget(searchParams), [searchParams]);
  const [shippingCostProvider, setShippingCostProvider] = useState('Manual provider');
  const [shippingCostAmount, setShippingCostAmount] = useState('');
  const [shippingVatAmount, setShippingVatAmount] = useState('');

  useEffect(() => {
    setSelectedRecordId(null);
    setSelectedDebtEventId(null);
  }, [requestedFinanceTarget?.type, requestedFinanceTarget?.value]);

  useEffect(() => {
    setSelectedDebtEventId(null);
  }, [currentVendor.vendorId]);

  useEffect(() => {
    if (requestedFinanceTarget || activeWorkflowFilter) {
      setActiveFinanceTab('transactions');
    }
  }, [activeWorkflowFilter, requestedFinanceTarget]);

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
        showFeedback(`Draft settlement payment review ${batch.id} prepared.`, 'success');
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
  const selectedOperationalProjection = selectedRecord
    ? getFinanceOperationalProjection(selectedRecord, { audience: financeAudience })
    : null;
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
  const selectedSplitLedgerLabel = selectedRecord ? getSplitFinanceLedgerLabel(selectedRecord) : null;
  const selectedSplitExplanation = selectedRecord ? getSplitFinanceExplanation(selectedRecord) : null;
  const selectedRefundedSplitChildSaleBasis = selectedRecord ? isRefundedSplitChildSaleBasis(selectedRecord) : false;
  const selectedSettlementOffsetReviewPending =
    selectedRecord ? selectedRefundedSplitChildSaleBasis || isRefundDeductionSettlementReviewPending(selectedRecord) : false;
  const selectedSettlementReviewStatusLabel =
    selectedSettlementOffsetReviewPending ? 'Settlement adjustment review pending' : selectedRecord ? getPayoutActivityStatusLabel(selectedRecord, financeAudience) : UNKNOWN_FINANCE_VALUE;
  const selectedRefundOffsetValue = selectedRecord?.payoutCalculation?.refundImpact ?? null;
  const selectedRefundedSplitChildNetEffect =
    selectedRecord && selectedRefundedSplitChildSaleBasis
      ? formatLikeCurrencyReference(
          parseCurrencyValue(selectedRecord.amount) - Math.abs(parseCurrencyValue(selectedRefundOffsetValue)),
          selectedRecord.amount,
        )
      : null;
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
          : 'Order link unavailable for this transaction.',
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
          : 'Return link unavailable for this transaction.',
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
        description: item.detail ?? selectedRecord.category,
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
  const selectedVendorFinanceStatusLabel = selectedRecord
    ? getVendorFinanceStatusLabel(selectedRecord, selectedOperationalProjection, selectedSettlementOffsetReviewPending)
    : 'Estimated';
  const selectedVendorPaymentWaitingSummary = getVendorPaymentWaitingSummary(selectedVendorFinanceStatusLabel);
  const selectedVendorNextAction = getVendorNextActionCopy(selectedVendorFinanceStatusLabel);
  const vendorFinanceTimelineEvents = getVendorFinanceTimelineEvents(financeTimelineEvents, selectedVendorFinanceStatusLabel);
  const selectedPaymentImpact = selectedRecord ? getPayoutImpact(selectedRecord) : UNKNOWN_FINANCE_VALUE;
  const selectedEstimatedPayment = selectedRecord?.payoutCalculation?.estimatedPayout ?? null;
  const selectedRefundImpact = selectedRecord?.payoutCalculation?.refundImpact
    ? optionalDeductionValue(selectedRecord.payoutCalculation.refundImpact)
    : null;
  const showSelectedEstimatedPayment = shouldShowFinanceValue(selectedEstimatedPayment, selectedPaymentImpact);
  const showSelectedRefundImpact = shouldShowFinanceValue(selectedRefundImpact, selectedPaymentImpact);
  const vendorFinanceCrossLinks = financeCrossLinks
    .filter((link) => link.eyebrow !== 'Support')
    .map((link) => ({
      ...link,
      description: undefined,
      status: undefined,
    }));
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
          : 'This transaction needs operator review.',
        recommendedAction: 'Review settlement status before draft preparation',
        relatedObjectType: 'Transaction',
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
  const needsReviewBreakdown = getFinanceNeedsReviewBreakdown(
    safeArray(financeView.transactions),
    financeView.payoutBatchSummary,
    financeView.summary,
    financeAudience,
  );
  const settlementEstimate = financeValueOrUnknown(financeView.summary.availableBalance ?? financeView.summary.payableBalance ?? financeView.summary.payoutEstimate);
  const refundDeductions = formatDeductionValue(financeView.summary.refundsThisMonth ?? financeView.summary.refunds);
  const vendorBalance = financeValueOrUnknown(financeView.summary.vendorBalance);
  const latestReview = getUpcomingPayoutLabel(financeView);
  const overviewAvailableBalance = getOverviewBalanceValue(financeView);
  const overviewPendingBalance = getOverviewPendingValue(financeView);
  const overviewHoldBalance = getOverviewHoldValue(financeView);
  const overviewPaymentEstimate = getOverviewPaymentValue(financeView);
  const overviewPaymentDate = getOverviewPaymentDate(financeView);
  const overviewPaymentStatus = getOverviewPaymentStatus(financeView, financeAudience);
  const overviewRecentActivity = safeArray(financeView.transactions).slice(0, 5);
  const overviewProgressSteps = getPaymentProgressSteps(financeView);

  return (
    <section className={`op-page finance-control-center finance-payout-workspace ${isVendorUser ? 'finance-vendor-workspace' : ''}`}>
      <div className="op-page-heading finance-page-header">
        <div>
          {isVendorUser ? null : <p className="eyebrow">Finance</p>}
          <h2>{isVendorUser ? 'Finance' : 'Finance workspace'}</h2>
          <p className="page-description">
            {isVendorUser
              ? 'Track balances, upcoming payments, and recent payment activity.'
              : 'Track balances, upcoming payments, and recent finance activity for your marketplace sales.'}
          </p>
          {isVendorUser ? null : <p className="page-description">{FINANCE_ESTIMATE_HELPER}</p>}
        </div>
        {isVendorUser ? null : (
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
        )}
      </div>

      <div className="finance-workspace-tabs" role="tablist" aria-label="Finance workspace sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeFinanceTab === 'overview'}
          className={activeFinanceTab === 'overview' ? 'is-active' : undefined}
          onClick={() => setActiveFinanceTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFinanceTab === 'transactions'}
          className={activeFinanceTab === 'transactions' ? 'is-active' : undefined}
          onClick={() => setActiveFinanceTab('transactions')}
        >
          Transactions
        </button>
      </div>

      {activeFinanceTab === 'overview' ? (
        <section className="finance-overview-workspace" aria-label="Finance overview">
          <section className="finance-money-home" aria-label="Finance money summary">
            <article className="finance-available-hero">
              <div>
                <p className="eyebrow">Available balance</p>
                <strong>{overviewAvailableBalance}</strong>
                <span>Ready to be included in your next payment review.</span>
              </div>
            </article>

            <aside className="finance-next-payment-card" aria-label="Next payment">
              <div>
                <p className="eyebrow">Estimated payment</p>
                <strong>{overviewPaymentEstimate}</strong>
                <span>{overviewPaymentDate}</span>
                <span>Preparing your next payment.</span>
              </div>
              <StatusBadge tone={(financeView.payoutBatchSummary?.latestBatch || (financeView.payoutBatchSummary?.eligibleRowCount ?? 0) > 0) ? 'success' : 'neutral'}>
                {overviewPaymentStatus}
              </StatusBadge>
            </aside>

            <div className="finance-balance-secondary-grid">
              <article>
                <span>Waiting to become payable</span>
                <strong>{overviewPendingBalance}</strong>
                <small>Orders waiting for delivery, timing, or payment readiness.</small>
              </article>
              <article>
                <span>Waiting for review</span>
                <strong>{overviewHoldBalance}</strong>
                <small>Money paused until an operational or finance review is resolved.</small>
              </article>
            </div>
          </section>

          <section className="finance-overview-panel finance-balance-story" aria-label="Balance explanation">
            <div>
              <p className="eyebrow">How your balance moves</p>
              <h3>Payment stages</h3>
            </div>
            <div className="finance-balance-story-grid">
              <p>
                <strong>Available</strong>
                <span>Ready for payment review.</span>
              </p>
              <p>
                <strong>Pending</strong>
                <span>Waiting to become payable.</span>
              </p>
              <p>
                <strong>Waiting for review</strong>
                <span>Paused until a review is resolved.</span>
              </p>
              <p>
                <strong>Changed recently</strong>
                <span>Recent sales, refunds, and adjustments.</span>
              </p>
            </div>
          </section>

          <section className="finance-overview-panel finance-recent-activity" aria-label="Recent payment activity">
            <div className="finance-overview-panel-heading">
              <div>
                <p className="eyebrow">Recent payment activity</p>
                <h3>What changed since your last check</h3>
              </div>
            </div>
            {isError && !finance ? (
              <SectionErrorRetry
                title="Finance overview unavailable"
                description={error ?? 'The finance overview could not be loaded.'}
                onRetry={() => void refetch()}
              />
            ) : pageReadiness.status === 'missing_vendor_context' ? (
              <EmptyStatePanel
                title="Select vendor"
                description="No vendor context available. Choose a vendor context before loading finance activity."
              />
            ) : pageReadiness.status === 'waiting_vendor_context' ? (
              <EmptyStatePanel
                title="Waiting for vendor context"
                description="Finance activity will load after the authenticated vendor scope is ready."
              />
            ) : pageReadiness.status === 'unauthorized' ? (
              <EmptyStatePanel title="Sign in required" description="Sign in before loading finance activity." />
            ) : isLoading ? (
              <div className="finance-overview-activity-skeleton" aria-label="Loading recent finance activity">
                <TableSkeletonRows columns={4} rows={3} />
              </div>
            ) : overviewRecentActivity.length === 0 ? (
              <EmptyStatePanel
                title="No finance activity yet"
                description="Sales, refunds, and payment preparation updates will appear here after your first finance event."
              />
            ) : (
              <ol className="finance-recent-change-timeline">
                {overviewRecentActivity.map((record) => (
                  <li key={record.id}>
                    <time>{getRelativeActivityDay(record.date)}</time>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRecordId(record.id);
                        setActiveFinanceTab('transactions');
                      }}
                    >
                      <strong>{getRecentChangeTitle(record)}</strong>
                      <span>{getRecentChangeDetail(record)}</span>
                    </button>
                    <b className={isRefundRecord(record) || record.category === 'Adjustment' ? 'finance-negative' : 'finance-positive'}>
                      {isRefundRecord(record) || record.category === 'Adjustment' ? '-' : ''}
                      {record.amount}
                    </b>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="finance-overview-panel finance-payment-progress" aria-label="Payment progress">
            <div className="finance-overview-panel-heading">
              <div>
                <p className="eyebrow">Payment progress</p>
                <h3>How sales become money paid out</h3>
              </div>
            </div>
            <ol className="finance-payment-progress-steps">
              {overviewProgressSteps.map((step) => (
                <li key={step.label} className={`is-${step.state}`}>
                  <span aria-hidden="true" />
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </li>
              ))}
            </ol>
          </section>

        </section>
      ) : (
        <>
      {isAdmin ? (
        <section className="finance-compact-summary" aria-label="Finance workflow summary">
          <div className="finance-compact-primary">
            <span className="finance-compact-label">Action required</span>
            <strong>{needsReviewBreakdown.needsReviewTotal}</strong>
            <small aria-label="Needs review breakdown">
              Breakdown: Refund {needsReviewBreakdown.refundReview} · Blocked {needsReviewBreakdown.blockedRows} · Shipping {needsReviewBreakdown.shippingReconciliation} · Balance adjustment {needsReviewBreakdown.debtReview}
            </small>
          </div>
          <div className="finance-compact-metrics" aria-label="Financial Totals">
            <span><strong>{financeView.payoutBatchSummary?.eligibleRowCount ?? 0}</strong> settlement review</span>
            <span><strong>{settlementEstimate}</strong> settlement estimate</span>
            <span><strong>{refundDeductions}</strong> refund deductions</span>
            <span><strong>{vendorBalance}</strong> vendor balance</span>
            <span><strong>{latestReview}</strong> latest draft</span>
          </div>
        </section>
      ) : null}

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
                <option value="Payout">Payment review</option>
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

          <OperationalTable
            columns={['Date', 'Type', 'Order', 'Status', 'Amount', 'Payment impact', 'Action']}
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
            ) : pageReadiness.status === 'missing_vendor_context' ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title="Select vendor"
                  description="No vendor context available. Choose a vendor context before loading vendor-scoped finance activity."
                />
              </OperationalTableRow>
            ) : pageReadiness.status === 'waiting_vendor_context' ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title="Waiting for vendor context"
                  description="Finance activity will load after the authenticated vendor scope is ready."
                />
              </OperationalTableRow>
            ) : pageReadiness.status === 'unauthorized' ? (
              <OperationalTableRow>
                <EmptyStatePanel title="Sign in required" description="Sign in before loading finance activity." />
              </OperationalTableRow>
            ) : isLoading ? (
              <TableSkeletonRows columns={7} rows={6} />
            ) : filteredRecords.length === 0 ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title={activeWorkflowFilter?.emptyTitle ?? 'No finance preview activity in this view'}
                  description={activeWorkflowFilter?.emptyDescription ?? (isVendorUser
                    ? 'Adjust the status, type, or search filters to review payment activity.'
                    : 'Adjust the status, type, or search filters to review settlement estimates.')}
                />
              </OperationalTableRow>
            ) : filteredRecords.map((record) => {
              const vendorBlockedHold = isVendorBlockedFinanceHold(record);
              const orderSettlementHref = vendorBlockedHold ? buildOrdersHref(record) : isVendorUser ? null : buildOrderSettlementHref(record);
              const projection = getFinanceOperationalProjection(record, { audience: financeAudience });
              const rowSettlementOffsetReviewPending = isRefundedSplitChildSaleBasis(record) || isRefundDeductionSettlementReviewPending(record);
              const rowStatusLabel = isVendorUser
                ? getVendorFinanceStatusLabel(record, projection, rowSettlementOffsetReviewPending)
                : projection.legacyStatusLabel;
              const rowStatusDetail = isVendorUser
                ? null
                : projection.blockerState === 'None' ? projection.payoutReadiness : projection.blockerState;
              const rowActivityDetail = getPayoutActivityDetail(record, financeAudience);
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
                      <strong>{getPayoutActivityType(record, financeAudience)}</strong>
                      {rowActivityDetail ? <small>{rowActivityDetail}</small> : null}
                      {record.splitFinanceSummary ? (
                        <span className="finance-split-badge">Split order assignment</span>
                      ) : null}
                    </span>
                  </span>
                  <span>
                    <strong>{record.shopifyOrderNumber ? `#${record.shopifyOrderNumber}` : '—'}</strong>
                    {isVendorUser ? null : <small>{isRefundRecord(record) ? 'Customer return' : 'Shopify order'}</small>}
                  </span>
                  <span className="finance-queue-state">
                    <StatusBadge tone={getPayoutActivityTone(record, financeAudience)}>{rowStatusLabel}</StatusBadge>
                    {rowStatusDetail ? <small>{rowStatusDetail}</small> : null}
                  </span>
                  <strong className={isRefundRecord(record) || record.category === 'Adjustment' ? 'finance-negative finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {isRefundRecord(record) || record.category === 'Adjustment' ? '-' : ''}
                    {record.amount}
                  </strong>
                  <strong className={isRefundRecord(record) ? 'finance-negative finance-amount-emphasis' : vendorBlockedHold ? 'finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {getPayoutImpact(record)}
                  </strong>
                  <OperationalActionGroup>
                    {orderSettlementHref ? (
                      <Link className="button button-secondary button-compact" to={orderSettlementHref}>
                        {isVendorUser ? 'Review order' : vendorBlockedHold ? 'Review assignment' : 'View order settlement'}
                      </Link>
                    ) : null}
                    <button type="button" className="button button-secondary button-compact" onClick={() => setSelectedRecordId(record.id)}>
                      {isVendorUser ? 'Open' : 'View details'}
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
                  Finance policy is edited from Vendor Profile. New payment estimates use the saved policy snapshot.
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Commission" value={`${financeView.profile?.commissionPercent ?? '10.00'}%`} />
                <MetadataRow label="Commission VAT" value={`${financeView.profile?.commissionVatPercent ?? '0.00'}%`} />
                <MetadataRow label="Shipping deduction mode" value={financeView.profile?.shippingMode ? safeStatusLabel(financeView.profile.shippingMode) : 'Disabled'} />
                <MetadataRow label="Deduct shipping after fulfillment" value={financeView.profile?.deductShippingEnabled ? 'Yes' : 'No'} />
                <MetadataRow label="Fixed shipping fee" value={financeView.profile?.fixedShippingFee ?? 'Not configured'} />
                <MetadataRow label={isVendorUser ? 'Payment waiting period' : 'Settlement delay'} value={`${financeView.profile?.settlementDelayDays ?? 21} days`} />
              </div>
              <StatusBadge tone="neutral">Read-only finance policy</StatusBadge>
            </section>

            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">{isVendorUser ? 'Payment review' : 'Settlement review'}</p>
                <h3>{isVendorUser ? 'Payment review' : 'Draft settlement payment review'}</h3>
                <p className="page-description">
                  {isVendorUser
                    ? 'A read-only view of payment rows currently waiting for review.'
                    : 'Prepare eligible estimate rows for review. No payment is executed here.'}
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Rows pending review" value={financeView.payoutBatchSummary?.eligibleRowCount ?? 0} />
                <MetadataRow label="Estimated payment before adjustments" value={financeValueOrUnknown(financeView.payoutBatchSummary?.eligibleNetAmount ?? financeView.summary.payableBalance ?? financeView.summary.payoutEstimate)} />
                <MetadataRow
                  label="Outstanding balance adjustment"
                  value={<span className={isZeroCurrencyValue(financeView.payoutBatchSummary?.outstandingDebtAmount) ? undefined : 'finance-deduction-value'}>
                    {financeValueOrUnknown(financeView.payoutBatchSummary?.outstandingDebtAmount ?? financeView.summary.outstandingVendorDebt)}
                  </span>}
                />
                <MetadataRow label="Balance adjustment preview" value={financeValueOrUnknown(financeView.payoutBatchSummary?.debtOffsetPreviewAmount)} />
                <MetadataRow
                  label="Net after balance adjustment"
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
                <StatusBadge tone="neutral">Read-only payment preview</StatusBadge>
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
          eyebrow="Selected transaction"
          title={selectedRecord?.shopifyOrderNumber ? `Order ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)}` : isVendorUser ? 'Selected transaction' : 'Settlement estimate'}
        >
          {selectedRecord ? isVendorUser ? (
            <>
              <div className="finance-selected-summary-card">
                <div className="finance-detail-card-heading">
                  <h4>Transaction Summary</h4>
                  <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>
                    {selectedVendorFinanceStatusLabel}
                  </StatusBadge>
                </div>
                <div className="finance-selected-summary-grid">
                  <MetadataRow label="Order" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : UNKNOWN_FINANCE_VALUE} />
                  {isRefundRecord(selectedRecord) && selectedRecord.shopifyRefundId ? <MetadataRow label="Return" value="Related return" /> : null}
                  <MetadataRow label="Type" value={getPayoutActivityType(selectedRecord, financeAudience)} />
                  <MetadataRow label="Status" value={selectedVendorFinanceStatusLabel} />
                  <MetadataRow
                    label="Payment impact"
                    value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : isVendorBlockedFinanceHold(selectedRecord) ? undefined : 'finance-payout-value'}>{selectedPaymentImpact}</span>}
                  />
                </div>
              </div>

              {shouldShowVendorPaymentWaiting(selectedVendorFinanceStatusLabel) && selectedVendorPaymentWaitingSummary ? (
                <div className="finance-detail-card finance-payout-readiness-card">
                  <div className="finance-detail-card-heading">
                    <h4>Why is this payment waiting?</h4>
                    <StatusBadge tone={selectedVendorFinanceStatusLabel === 'Blocked' ? 'danger' : 'warning'}>
                      {selectedVendorFinanceStatusLabel}
                    </StatusBadge>
                  </div>
                  <p className="page-description">{selectedVendorPaymentWaitingSummary}</p>
                </div>
              ) : null}

              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Next Action</h4>
                  <StatusBadge tone={selectedVendorNextAction.title === 'No action needed' ? 'success' : 'warning'}>
                    {selectedVendorNextAction.title}
                  </StatusBadge>
                </div>
                <p className="page-description">{selectedVendorNextAction.body}</p>
              </div>

              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Payment Impact</h4>
                  <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>
                    {selectedVendorFinanceStatusLabel}
                  </StatusBadge>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow
                    label="Payment impact"
                    value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : isVendorBlockedFinanceHold(selectedRecord) ? undefined : 'finance-payout-value'}>{selectedPaymentImpact}</span>}
                  />
                  {showSelectedRefundImpact ? (
                    <MetadataRow
                      label="Refund impact"
                      value={<span className="finance-deduction-value">{selectedRefundImpact}</span>}
                    />
                  ) : null}
                  {showSelectedEstimatedPayment ? (
                    <MetadataRow
                      label="Estimated payment"
                      value={<span className="finance-payout-value">{financeValueOrUnknown(selectedEstimatedPayment)}</span>}
                    />
                  ) : null}
                </div>
              </div>

              <OperationalLinkCards
                title="Related records"
                links={vendorFinanceCrossLinks}
                audience={financeAudience}
                eyebrow=""
              />

              <OperationalTimeline
                title="Activity"
                events={vendorFinanceTimelineEvents}
                audience={financeAudience}
              />

              {relatedSupportTickets.length ? (
                <details className="finance-support-history">
                  <summary>
                    <span>
                      <strong>Support</strong>
                      {supportActivitySummary ? <small>Latest status: {supportActivitySummary.latestStatus}</small> : null}
                    </span>
                    <StatusBadge tone="neutral">{supportActivitySummary?.ticketLabel ?? `${relatedSupportTickets.length} linked ticket${relatedSupportTickets.length === 1 ? '' : 's'}`}</StatusBadge>
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
            </>
          ) : (
            <>
              <div className="finance-selected-summary-card">
                <div className="finance-detail-card-heading">
                  <h4>Selected Transaction</h4>
                  <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>
                    {selectedOperationalProjection?.legacyStatusLabel ?? UNKNOWN_FINANCE_VALUE}
                  </StatusBadge>
                </div>
                <div className="finance-selected-summary-grid">
                  <MetadataRow label="Order" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Current status" value={selectedOperationalProjection?.legacyStatusLabel ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Settlement state" value={selectedOperationalProjection?.settlementState ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Payment readiness" value={selectedOperationalProjection?.payoutReadiness ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Blocker" value={selectedOperationalProjection?.blockerState ?? UNKNOWN_FINANCE_VALUE} />
                </div>
              </div>
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
              <OperationalRecommendations
                title="Suggested next steps"
                subtitle="Admin-only guidance for this transaction."
                recommendations={financeRecommendations}
                audience={isAdmin ? 'admin' : 'vendor'}
              />
              {selectedRecord.splitFinanceSummary ? (
                <div className="finance-detail-card finance-split-detail-card">
                  <div className="finance-detail-card-heading">
                    <h4>Split order context</h4>
                    <StatusBadge tone={getSplitFinanceLedgerRole(selectedRecord) === 'child' ? 'warning' : 'info'}>
                      Split order assignment
                    </StatusBadge>
                  </div>
                  <p className="page-description">{selectedSplitExplanation ?? 'This transaction is linked to an order assignment split event.'}</p>
                  <div className="finance-detail-rows">
                    <MetadataRow label="Transaction role" value={selectedSplitLedgerLabel ?? UNKNOWN_FINANCE_VALUE} />
                    <MetadataRow label="Source order assignment" value={selectedRecord.splitFinanceSummary.sourceAllocationId} />
                    <MetadataRow label="Child order assignment" value={selectedRecord.splitFinanceSummary.childAllocationId} />
                    <MetadataRow label="Split reason" value={safeStatusLabel(selectedRecord.splitFinanceSummary.splitReason)} />
                    <MetadataRow label="Split created" value={formatOptionalDate(selectedRecord.splitFinanceSummary.splitCreatedAt)} />
                    <MetadataRow label="Original source transaction" value={selectedRecord.splitFinanceSummary.sourceFinanceLedgerEntryId ?? UNKNOWN_FINANCE_VALUE} />
                    <MetadataRow label="Remaining source transaction" value={selectedRecord.splitFinanceSummary.remainingFinanceLedgerEntryId ?? UNKNOWN_FINANCE_VALUE} />
                    <MetadataRow label="Child held transaction" value={selectedRecord.splitFinanceSummary.childFinanceLedgerEntryId ?? UNKNOWN_FINANCE_VALUE} />
                  </div>
                </div>
              ) : null}
              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Settlement preview</h4>
                  <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>
                    {selectedSettlementReviewStatusLabel}
                  </StatusBadge>
                </div>
                {selectedSettlementOffsetReviewPending ? (
                  <p className="page-description">Refund completed. The Shopify refund has been processed. This review only determines how the refund adjustment is recorded in settlement accounting. No shipment, refund, or vendor action is required.</p>
                ) : null}
                <div className="finance-detail-rows">
                  <MetadataRow label="Order" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Review status" value={selectedSettlementReviewStatusLabel} />
                  {selectedRefundedSplitChildSaleBasis ? (
                    <>
                      <MetadataRow label="Operational status" value="Resolved" />
                      <MetadataRow label="Settlement status" value="Review pending" />
                      <MetadataRow label="Sale basis" value={<span className="finance-payout-value">{selectedRecord.amount}</span>} />
                      <MetadataRow label="Refund adjustment" value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRefundOffsetValue)}</span>} />
                      <MetadataRow label="Net child effect" value={<span>{selectedRefundedSplitChildNetEffect ?? UNKNOWN_FINANCE_VALUE}</span>} />
                    </>
                  ) : null}
                  <MetadataRow
                    label="Estimated payment"
                    value={<span className="finance-payout-value">{financeValueOrUnknown(selectedRecord.payoutCalculation?.estimatedPayout ?? selectedRecord.amount)}</span>}
                  />
                  <MetadataRow
                    label="Refund impact"
                    value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.refundImpact)}</span>}
                  />
                  <MetadataRow
                    label="Payment impact"
                    value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : isVendorBlockedFinanceHold(selectedRecord) ? undefined : 'finance-payout-value'}>{getPayoutImpact(selectedRecord)}</span>}
                  />
                  {isSplitChildFinanceHold(selectedRecord) ? (
                    <>
                      <MetadataRow label="Reason" value="Split order assignment hold" />
                      <MetadataRow label="Hold context" value="Vendor rejected selected line items." />
                    </>
                  ) : isVendorBlockedFinanceHold(selectedRecord) ? (
                    <MetadataRow label="Reason" value="Vendor blocked" />
                  ) : null}
                  <MetadataRow
                    label={isVendorUser ? 'Settlement review' : 'Payment review'}
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

              <div className="finance-detail-card finance-payout-readiness-card">
                <div className="finance-detail-card-heading">
                  <h4>Payment readiness</h4>
                  <StatusBadge tone={selectedOperationalProjection?.blockerState === 'None' ? 'success' : 'warning'}>
                    {selectedOperationalProjection?.payoutReadiness ?? UNKNOWN_FINANCE_VALUE}
                  </StatusBadge>
                </div>
                <p className="page-description">
                  {selectedOperationalProjection?.payoutReadinessDetail ?? 'Payment readiness is unavailable for this row.'}
                </p>
                <div className="finance-detail-rows">
                  <MetadataRow label="Settlement" value={selectedOperationalProjection?.settlementState ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Payment" value={selectedOperationalProjection?.payoutState ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Hold / blocker" value={selectedOperationalProjection?.blockerState ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Blocker detail" value={selectedOperationalProjection?.blockerDetail ?? UNKNOWN_FINANCE_VALUE} />
                </div>
              </div>

              <div className="finance-detail-card finance-debt-impact-card">
                <div className="finance-detail-card-heading">
                  <h4>Balance adjustment impact on payment</h4>
                  <StatusBadge tone={isZeroCurrencyValue(financeView.payoutBatchSummary?.outstandingDebtAmount ?? financeView.summary.outstandingVendorDebt) ? 'neutral' : 'warning'}>
                    {isZeroCurrencyValue(financeView.payoutBatchSummary?.outstandingDebtAmount ?? financeView.summary.outstandingVendorDebt) ? 'No adjustment' : 'Adjustment impact'}
                  </StatusBadge>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow label="Outstanding adjustment" value={financeValueOrUnknown(financeView.payoutBatchSummary?.outstandingDebtAmount ?? financeView.summary.outstandingVendorDebt)} />
                  <MetadataRow label="Adjustment preview" value={financeValueOrUnknown(financeView.payoutBatchSummary?.debtOffsetPreviewAmount)} />
                  <MetadataRow label="Net after adjustment" value={financeValueOrUnknown(financeView.payoutBatchSummary?.netEligibleAfterDebtOffset ?? financeView.summary.netPayableAfterDebt)} />
                </div>
              </div>

              {selectedOperationalProjection?.shippingImpact.state === 'required' && isAdmin && selectedRecord.category === 'Invoice' ? (
                <form className="finance-shipping-cost-form finance-shipping-action-card" aria-label="Attach shipping cost" onSubmit={handleAttachShippingCost}>
                  <div className="finance-detail-card-heading">
                    <h4>Shipping cost review required</h4>
                    <StatusBadge tone="warning">Action</StatusBadge>
                  </div>
                  <p className="page-description">{selectedOperationalProjection.shippingImpact.detail}</p>
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
                </form>
              ) : selectedOperationalProjection?.shippingImpact.state === 'completed' ? (
                <div className="finance-detail-card">
                  <div className="finance-detail-card-heading">
                    <h4>Shipping cost review</h4>
                    <StatusBadge tone="success">Completed</StatusBadge>
                  </div>
                  <p className="page-description">{selectedOperationalProjection.shippingImpact.detail}</p>
                  <div className="finance-detail-rows">
                    <MetadataRow label="Shipping cost status" value={safeStatusLabel(selectedRecord.payoutCalculation?.shippingCostStatus ?? 'snapshot')} />
                    <MetadataRow label="Provider" value={selectedRecord.payoutCalculation?.shippingCostProvider ?? 'Not specified'} />
                    <MetadataRow label="Shipping deduction" value={selectedRecord.payoutCalculation?.shippingDeduction ?? UNKNOWN_FINANCE_VALUE} />
                  </div>
                </div>
              ) : (
                <details className="finance-detail-card finance-shipping-collapsed">
                  <summary>
                    <span>
                      <strong>Shipping cost review</strong>
                      <small>{selectedOperationalProjection?.shippingImpact.label ?? 'Unknown'}</small>
                    </span>
                    <StatusBadge tone="neutral">Collapsed</StatusBadge>
                  </summary>
                  <p className="page-description">
                    {selectedOperationalProjection?.shippingImpact.detail ?? 'Shipping cost review state is unavailable.'}
                  </p>
                </details>
              )}

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
                        <MetadataRow label="Reference id" value={adjustment.id} />
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
                title="Activity timeline"
                subtitle={FINANCE_TIMELINE_HELPER}
                events={financeTimelineEvents}
                audience={financeAudience}
              />

              <OperationalLinkCards
                title="Related records"
                subtitle="Grouped order, return, and support context for this transaction."
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

              <AdminCollaborationNotes
                contextType="finance"
                contextId={selectedRecord.id}
                currentUser={currentUser}
                title="Finance investigation notes"
                emptyMessage="No finance investigation notes."
              />
            </>
          ) : (
            <EmptyStatePanel
              title={requestedFinanceTarget ? 'Linked transaction unavailable' : 'Select a transaction'}
              description={
                requestedFinanceTarget
                  ? 'The linked transaction is not available in the current vendor scope.'
                  : isVendorUser
                    ? 'Choose a transaction to review payment details.'
                    : 'Choose a transaction to review settlement estimate and invoice details.'
              }
            />
          )}
        </SideDetailPanel>
      </div>
        </>
      )}

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
