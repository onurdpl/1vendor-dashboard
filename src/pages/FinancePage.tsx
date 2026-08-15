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
import type { FinanceDashboard, FinanceTransaction, SupportTicket, VendorDebtHistoryEvent } from '../lib/api/contracts';
import { listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import { OperationalLinkCards, OperationalTimeline } from '../components/OperationalTimeline';
import { AdminCollaborationNotes } from '../components/AdminCollaborationNotes';
import {
  supportTicketMatchesFinance,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';
import { sameNormalizedIdentifier, sameOrderNumber, sameShopifyIdentifier } from '../lib/shopifyIdentifiers';
import { formatCurrency, formatDateParts as formatSafeDateParts, formatDateTime, getSafeTimestamp, safeArray, safeStatusLabel } from '../services/real/formatting';
import { getFinanceWorkflowAction, type WorkflowActionGuidance as WorkflowActionGuidanceModel } from '../lib/workflowActionGuidance';
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
    return getVendorFinanceScenario(record).typeLabel;
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

function getTurkishWeekday(value: string) {
  const normalized = value.trim().toUpperCase();
  const labels: Record<string, string> = {
    MONDAY: 'Pazartesi',
    TUESDAY: 'Salı',
    WEDNESDAY: 'Çarşamba',
    THURSDAY: 'Perşembe',
    FRIDAY: 'Cuma',
    SATURDAY: 'Cumartesi',
    SUNDAY: 'Pazar',
  };
  return labels[normalized] ?? safeStatusLabel(value);
}

function getOverviewPaymentDate(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>, audience: 'admin' | 'vendor') {
  if (finance.payoutBatchSummary?.latestBatch?.status === 'paid' && finance.payoutBatchSummary.latestBatch.paidAt) {
    const date = formatDateParts(finance.payoutBatchSummary.latestBatch.paidAt).date;
    return audience === 'vendor' ? `Ödendi ${date}` : `Paid ${date}`;
  }
  if (finance.payoutBatchSummary?.latestBatch?.createdAt) {
    const date = formatDateParts(finance.payoutBatchSummary.latestBatch.createdAt).date;
    return audience === 'vendor' ? `Hazırlık başladı ${date}` : `Preparation started ${date}`;
  }
  if (finance.profile?.weeklySettlementDay) {
    return audience === 'vendor'
      ? `${getTurkishWeekday(finance.profile.weeklySettlementDay)} sonrası`
      : `${safeStatusLabel(finance.profile.weeklySettlementDay)} after review`;
  }
  return audience === 'vendor' ? 'İnceleme sonrası' : 'After settlement review';
}

function getOverviewPaymentStatus(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>, audience: 'admin' | 'vendor') {
  if (audience === 'vendor') {
    const latestBatch = finance.payoutBatchSummary?.latestBatch;
    if (latestBatch?.status) {
      return getVendorPayoutBatchStatusLabel(latestBatch.status, Boolean(latestBatch.paidAt));
    }
    if (finance.payoutBatchSummary?.latestBatch || (finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0) {
      return 'Beklemede';
    }
    return 'Hesaplanıyor';
  }
  if (finance.payoutBatchSummary?.latestBatch) {
    return getPayoutBatchStatusLabel(finance.payoutBatchSummary.latestBatch.status, audience);
  }
  if ((finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0) {
    return 'Ready for review';
  }
  return 'Building balance';
}

function getVendorPayoutBatchStatusLabel(status: string, hasPaidEvidence = false) {
  if (status === 'approved') {
    return 'Hazır';
  }
  if (status === 'paid') {
    return hasPaidEvidence ? 'Ödendi' : 'İncelemede';
  }
  if (status === 'cancelled') {
    return 'Beklemede';
  }
  if (status === 'paid_placeholder') {
    return 'İncelemede';
  }
  return 'Beklemede';
}

function getRelativeActivityDay(value: string, audience: 'admin' | 'vendor' = 'admin') {
  const timestamp = getSafeTimestamp(value);
  if (!timestamp) {
    return audience === 'vendor' ? 'Yakın zamanda' : 'Recent';
  }
  const today = new Date();
  const activity = new Date(timestamp);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const activityStart = new Date(activity.getFullYear(), activity.getMonth(), activity.getDate()).getTime();
  const dayDifference = Math.round((todayStart - activityStart) / 86_400_000);
  if (dayDifference <= 0) {
    return audience === 'vendor' ? 'Bugün' : 'Today';
  }
  if (dayDifference === 1) {
    return audience === 'vendor' ? 'Dün' : 'Yesterday';
  }
  return audience === 'vendor' ? `${dayDifference} gün önce` : `${dayDifference} days ago`;
}

function getRecordActivityDate(record: FinanceTransaction) {
  return hasReliablePaidEvidence(record) ? getPaymentEvidenceDate(record) ?? record.date : record.date;
}

function getRecentChangeTitle(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  if (audience === 'vendor') {
    if (hasReliablePaidEvidence(record)) {
      return 'Ödendi';
    }
    if (record.category === 'Refund') {
      return 'İade kesildi';
    }
    if (record.category === 'Payout') {
      return 'Ödeme hazırlığı güncellendi';
    }
    if (record.category === 'Adjustment') {
      return 'Bakiye düzeltildi';
    }
    if (record.settlement?.payoutReady) {
      return 'Sipariş ödemeye hazır';
    }
    return 'Sipariş geliri kaydedildi';
  }
  if (record.category === 'Refund') {
    return 'Refund deducted';
  }
  if (hasReliablePaidEvidence(record)) {
    return 'Payment marked paid';
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

function getRecentChangeDetail(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  const orderLabel = record.shopifyOrderNumber
    ? audience === 'vendor' ? `Sipariş #${record.shopifyOrderNumber}` : `Order #${record.shopifyOrderNumber}`
    : audience === 'vendor' ? 'Mağaza hareketi' : 'Marketplace activity';
  if (audience === 'vendor') {
    if (hasReliablePaidEvidence(record)) {
      return `${orderLabel} ödendi.`;
    }
    if (record.category === 'Refund') {
      return `${orderLabel} mevcut bakiyeyi ${record.amount} azalttı.`;
    }
    if (record.category === 'Payout') {
      return `${record.amount} ödeme hazırlığına geçti.`;
    }
    if (record.category === 'Adjustment') {
      return `${record.amount} bakiyeyi değiştirdi.`;
    }
    if (record.settlement?.payoutReady) {
      return `${orderLabel} ödemeye hazır.`;
    }
    return `${orderLabel} ödeme hareketlerine eklendi.`;
  }
  if (record.category === 'Refund') {
    return `${orderLabel} reduced the current balance by ${record.amount}.`;
  }
  if (hasReliablePaidEvidence(record)) {
    return `${orderLabel} was marked paid.`;
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

function getPaymentProgressSteps(finance: NonNullable<Awaited<ReturnType<typeof getFinanceDashboard>>>, audience: 'admin' | 'vendor' = 'admin') {
  const hasActivity = safeArray(finance.transactions).length > 0;
  const hasEligibleRows = (finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0;
  const hasPaymentPreparation = Boolean(finance.payoutBatchSummary?.latestBatch);
  const hasPaidEvidence =
    Boolean(finance.payoutBatchSummary?.latestBatch?.status === 'paid' && finance.payoutBatchSummary.latestBatch.paidAt) ||
    safeArray(finance.transactions).some(hasReliablePaidEvidence);
  if (audience === 'vendor') {
    return [
      {
        label: 'Satış',
        detail: hasActivity ? 'Satış kaydedildi' : 'İlk satış bekleniyor',
        state: hasActivity ? 'complete' : 'upcoming',
      },
      {
        label: 'Teslimat',
        detail: hasEligibleRows || hasPaymentPreparation ? 'Siparişler uygun' : 'Teslimat bekleniyor',
        state: hasEligibleRows || hasPaymentPreparation ? 'complete' : hasActivity ? 'current' : 'upcoming',
      },
      {
        label: 'İnceleme',
        detail: hasEligibleRows || hasPaymentPreparation ? 'İncelemeye hazır' : 'Henüz hazır değil',
        state: hasPaymentPreparation ? 'complete' : hasEligibleRows ? 'current' : 'upcoming',
      },
      {
        label: 'Ödeme Hazırlığı',
        detail: hasPaidEvidence ? 'Tamamlandı' : hasPaymentPreparation ? 'Devam ediyor' : 'Başlamadı',
        state: hasPaidEvidence ? 'complete' : hasPaymentPreparation ? 'current' : 'upcoming',
      },
      {
        label: 'Ödendi',
        detail: hasPaidEvidence ? 'Ödeme kaydedildi' : 'Ödeme kanıtı bekleniyor',
        state: hasPaidEvidence ? 'complete' : 'upcoming',
      },
    ] as const;
  }
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
      detail: hasPaidEvidence ? 'Complete' : hasPaymentPreparation ? 'In progress' : 'Not started',
      state: hasPaidEvidence ? 'complete' : hasPaymentPreparation ? 'current' : 'upcoming',
    },
    {
      label: 'Paid',
      detail: hasPaidEvidence ? 'Payment recorded' : 'Payment evidence pending',
      state: hasPaidEvidence ? 'complete' : 'upcoming',
    },
  ] as const;
}

function getPayoutImpact(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  if (audience !== 'vendor' && isVendorBlockedFinanceHold(record)) {
    return 'Held';
  }
  if (isRefundRecord(record)) {
    return formatDeductionValue(record.payoutCalculation?.refundImpact ?? record.amount);
  }
  return record.payoutCalculation?.estimatedPayout ?? record.amount;
}

const NO_SETTLEMENT_IMPACT = '—';

function hasSameAbsoluteCurrencyValue(left: string | null | undefined, right: string | null | undefined) {
  return Math.abs(parseCurrencyValue(left)) === Math.abs(parseCurrencyValue(right));
}

function getTransactionListSettlementImpact(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  if (audience === 'vendor') {
    return getPayoutImpact(record, audience);
  }

  if (isVendorBlockedFinanceHold(record)) {
    return 'Held';
  }

  if (isRefundRecord(record)) {
    const refundImpact = record.payoutCalculation?.refundImpact;
    if (refundImpact && !hasSameAbsoluteCurrencyValue(refundImpact, record.amount)) {
      return formatDeductionValue(refundImpact);
    }
    return 'Deducts balance';
  }

  if (record.category === 'Adjustment') {
    const adjustment = record.settlementRefundAdjustments?.[0];
    if (adjustment?.status === 'applied') {
      return 'Adjustment applied';
    }
    if (adjustment?.status === 'pending' || adjustment?.status === 'partially_applied') {
      return 'Balance adjustment';
    }
    return 'Balance adjustment';
  }

  if (record.category === 'Payout') {
    if (hasReliablePaidEvidence(record)) {
      return 'Paid';
    }
    if (record.payoutBatch) {
      return getPayoutBatchStatusLabel(record.payoutBatch.status, audience);
    }
    return NO_SETTLEMENT_IMPACT;
  }

  const estimatedPayout = record.payoutCalculation?.estimatedPayout;
  if (estimatedPayout) {
    return hasSameAbsoluteCurrencyValue(estimatedPayout, record.amount) ? 'Payable estimate' : estimatedPayout;
  }
  if (record.payoutBatch?.netAmount && !hasSameAbsoluteCurrencyValue(record.payoutBatch.netAmount, record.amount)) {
    return record.payoutBatch.netAmount;
  }
  return NO_SETTLEMENT_IMPACT;
}

function getTransactionListSettlementImpactClass(record: FinanceTransaction, value: string, audience: 'admin' | 'vendor' = 'admin') {
  if (audience === 'vendor') {
    const scenario = getVendorFinanceScenario(record);
    return `${getVendorScenarioImpactClass(value, scenario) ?? ''} finance-amount-emphasis`.trim();
  }
  const normalizedValue = value.toLowerCase();
  if (value === NO_SETTLEMENT_IMPACT || value === 'Held' || value === 'Paid' || normalizedValue.includes('adjustment') || normalizedValue.includes('deduction') || normalizedValue.includes('deducts') || normalizedValue.includes('estimate')) {
    return 'finance-amount-emphasis';
  }
  if (parseCurrencyValue(value) < 0 || isRefundRecord(record)) {
    return 'finance-negative finance-amount-emphasis';
  }
  return 'finance-positive finance-amount-emphasis';
}

function formatVendorScenarioAmount(value: string, scenario: VendorFinanceScenario) {
  if (scenario.kind === 'refund') {
    return formatDeductionValue(value);
  }
  return value;
}

function getVendorScenarioAmountClass(value: string, scenario: VendorFinanceScenario) {
  const numeric = parseCurrencyValue(value);
  if (scenario.kind === 'refund' || numeric < 0) {
    return 'finance-negative finance-amount-emphasis';
  }
  if (scenario.kind === 'sale' && numeric > 0) {
    return 'finance-positive finance-amount-emphasis';
  }
  return 'finance-amount-emphasis';
}

function getVendorScenarioImpactClass(value: string, scenario: VendorFinanceScenario) {
  const numeric = parseCurrencyValue(value);
  if (scenario.kind === 'refund' || numeric < 0) {
    return 'finance-deduction-value';
  }
  if (scenario.kind === 'sale' && numeric > 0) {
    return 'finance-payout-value';
  }
  return undefined;
}

function getVendorScenarioTypeClass(scenario: VendorFinanceScenario) {
  if (scenario.kind === 'refund') {
    return 'finance-negative';
  }
  if (scenario.kind === 'sale') {
    return 'finance-positive';
  }
  return undefined;
}

function getFinanceTimelineItems(record: FinanceTransaction): FinanceTimelineItem[] {
  const reviewDisplay = getSettlementReviewDisplay(record);
  const splitRole = getSplitFinanceLedgerRole(record);
  const refundedSplitChildSaleBasis = isRefundedSplitChildSaleBasis(record);
  const settlementOffsetReviewPending = refundedSplitChildSaleBasis || isRefundDeductionSettlementReviewPending(record);
  const paymentEvidenceDate = getPaymentEvidenceDate(record);
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
    hasReliablePaidEvidence(record)
      ? {
          label: 'Payment marked paid',
          at: paymentEvidenceDate,
          status: 'Paid',
          detail: record.payoutBatch?.paymentReference ? `Payment reference ${record.payoutBatch.paymentReference}` : undefined,
        }
      : null,
  ];

  return items.filter((item): item is FinanceTimelineItem => Boolean(item));
}

function isMeaningfulFinanceTimelineEvent(event: OperationalEventInput) {
  return event.title !== 'Order captured' && event.title !== 'Settlement preview generated';
}

function getPaymentEligibilityLabel(record: FinanceTransaction, projection: FinanceOperationalProjection | null) {
  if (projection?.blockerState && projection.blockerState !== 'None') {
    return 'Not eligible';
  }
  if (record.settlement?.payoutReady || record.settlement?.status === 'payable' || record.settlement?.status === 'partially_refunded') {
    return 'Eligible';
  }
  return 'Not eligible';
}

function getSettlementReasonLabel(record: FinanceTransaction, projection: FinanceOperationalProjection | null) {
  if (isVendorBlockedFinanceHold(record)) {
    return 'Vendor blocked';
  }
  if (isSplitChildFinanceHold(record)) {
    return 'Split order assignment hold';
  }
  if (projection?.blockerState && projection.blockerState !== 'None') {
    return projection.blockerState;
  }
  return 'None';
}

function getSettlementNextActionLabel(record: FinanceTransaction, projection: FinanceOperationalProjection | null, guidance: WorkflowActionGuidanceModel | null) {
  if (isVendorBlockedFinanceHold(record)) {
    return 'Resolve vendor allocation';
  }
  if (projection?.blockerState && projection.blockerState !== 'None') {
    return guidance?.actionLabel ?? 'Review blocker';
  }
  if (record.payoutBatch || record.settlement?.review) {
    return guidance?.actionLabel ?? 'Review settlement';
  }
  if (record.settlement?.payoutReady || record.settlement?.status === 'payable' || record.settlement?.status === 'partially_refunded') {
    return 'Review settlement';
  }
  return 'Monitor eligibility';
}

function shouldShowRefundImpactRow(record: FinanceTransaction) {
  return !isZeroCurrencyValue(record.payoutCalculation?.refundImpact);
}

function shouldShowShippingFeeRow(record: FinanceTransaction, projection: FinanceOperationalProjection | null) {
  return !isZeroCurrencyValue(record.payoutCalculation?.shippingDeduction) || projection?.shippingImpact.state === 'required' || projection?.shippingImpact.state === 'completed';
}

function shouldShowBalanceAdjustmentImpact(finance: FinanceDashboard | null | undefined) {
  return (
    !isZeroCurrencyValue(finance?.payoutBatchSummary?.outstandingDebtAmount ?? finance?.summary.outstandingVendorDebt) ||
    !isZeroCurrencyValue(finance?.payoutBatchSummary?.debtOffsetPreviewAmount)
  );
}

function hasFinanceReviewCopy(value: string | null | undefined) {
  return /\bsettlement\b|\boffset review\b|\bpayout accounting\b|\bledger\b|\breference id\b|\bapproval id\b|\bcommission invoice\b/i.test(value ?? '');
}

type VendorFinanceScenarioKind = 'sale' | 'refund' | 'adjustment' | 'shipping' | 'payout';
type VendorFinanceTypeLabel = 'Sipariş Geliri' | 'İade' | 'Bakiye Düzeltmesi' | 'Kargo' | 'Ödeme';
type VendorFinanceStatusLabel = 'Hesaplanıyor' | 'İncelemede' | 'Hazır' | 'Beklemede' | 'Askıda' | 'Ödendi';
type VendorFinanceNextAction = 'İşlem Gerekmiyor' | 'İnceleme Bekleniyor' | 'Destek ile İletişime Geç';

type VendorFinanceScenario = {
  kind: VendorFinanceScenarioKind;
  typeLabel: VendorFinanceTypeLabel;
  status: VendorFinanceStatusLabel;
  nextAction: VendorFinanceNextAction;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'attention' | 'danger';
};

function getAdjustmentStatuses(record: FinanceTransaction) {
  return safeArray(record.settlementRefundAdjustments).map((adjustment) => adjustment.status);
}

function hasAdjustmentStatus(record: FinanceTransaction, statuses: Array<NonNullable<FinanceTransaction['settlementRefundAdjustments']>[number]['status']>) {
  return getAdjustmentStatuses(record).some((status) => statuses.includes(status));
}

function getPaymentEvidenceDate(record: FinanceTransaction) {
  return record.settlement?.settledAt ?? record.payoutBatch?.paidAt ?? null;
}

function hasReliablePaidEvidence(record: FinanceTransaction) {
  return Boolean(
    record.payoutStatus?.trim().toLowerCase() === 'paid' &&
      record.settlement?.status === 'settled' &&
      getPaymentEvidenceDate(record),
  );
}

function isShippingFinanceScenario(record: FinanceTransaction) {
  const calculation = record.payoutCalculation;
  const shippingDeduction = parseCurrencyValue(calculation?.shippingDeduction);
  return Boolean(
    record.description?.toLowerCase().includes('shipping') ||
      calculation?.shippingCostStatus === 'pending_provider_cost' ||
      calculation?.shippingApplied ||
      calculation?.shippingCostSnapshot ||
      shippingDeduction !== 0,
  );
}

function buildVendorFinanceScenario(
  kind: VendorFinanceScenarioKind,
  typeLabel: VendorFinanceTypeLabel,
  status: VendorFinanceStatusLabel,
  nextAction: VendorFinanceNextAction,
): VendorFinanceScenario {
  const tone =
    status === 'Hazır' || status === 'Ödendi'
      ? 'success'
      : status === 'İncelemede'
        ? 'attention'
        : status === 'Askıda'
          ? 'warning'
          : status === 'Beklemede'
            ? 'warning'
            : 'info';

  return {
    kind,
    typeLabel,
    status,
    nextAction,
    tone,
  };
}

function getVendorFinanceScenario(record: FinanceTransaction): VendorFinanceScenario {
  const normalizedStatus = normalizeFinanceStatus(record.status);
  const payoutBatchStatus = record.payoutBatch?.status;

  if (isShippingFinanceScenario(record)) {
    if (record.payoutCalculation?.shippingCostStatus === 'pending_provider_cost') {
      return buildVendorFinanceScenario('shipping', 'Kargo', 'Beklemede', 'İnceleme Bekleniyor');
    }
    return buildVendorFinanceScenario('shipping', 'Kargo', 'Hazır', 'İşlem Gerekmiyor');
  }

  if (record.category === 'Refund') {
    if (hasReliablePaidEvidence(record)) {
      return buildVendorFinanceScenario('refund', 'İade', 'Ödendi', 'İşlem Gerekmiyor');
    }
    if (hasAdjustmentStatus(record, ['blocked', 'cancelled']) || normalizedStatus === 'Failed') {
      return buildVendorFinanceScenario('refund', 'İade', 'Beklemede', 'Destek ile İletişime Geç');
    }
    if (hasAdjustmentStatus(record, ['applied'])) {
      return buildVendorFinanceScenario('refund', 'İade', 'Hazır', 'İşlem Gerekmiyor');
    }
    if (
      hasAdjustmentStatus(record, ['pending', 'partially_applied']) ||
      record.settlement?.status === 'partially_refunded' ||
      isRefundDeductionSettlementReviewPending(record)
    ) {
      return buildVendorFinanceScenario('refund', 'İade', 'İncelemede', 'İnceleme Bekleniyor');
    }
    return buildVendorFinanceScenario('refund', 'İade', 'İncelemede', 'İnceleme Bekleniyor');
  }

  if (record.category === 'Adjustment') {
    if (hasAdjustmentStatus(record, ['blocked']) || normalizedStatus === 'Failed') {
      return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'Beklemede', 'Destek ile İletişime Geç');
    }
    if (hasAdjustmentStatus(record, ['pending', 'partially_applied'])) {
      return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'İncelemede', 'İnceleme Bekleniyor');
    }
    if (hasAdjustmentStatus(record, ['applied'])) {
      return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'Hazır', 'İşlem Gerekmiyor');
    }
    return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'Beklemede', 'İşlem Gerekmiyor');
  }

  if (record.category === 'Payout') {
    if (hasReliablePaidEvidence(record)) {
      return buildVendorFinanceScenario('payout', 'Ödeme', 'Ödendi', 'İşlem Gerekmiyor');
    }
    if (payoutBatchStatus === 'approved') {
      return buildVendorFinanceScenario('payout', 'Ödeme', 'Hazır', 'İşlem Gerekmiyor');
    }
    if (payoutBatchStatus === 'paid_placeholder') {
      return buildVendorFinanceScenario('payout', 'Ödeme', 'İncelemede', 'İnceleme Bekleniyor');
    }
    return buildVendorFinanceScenario('payout', 'Ödeme', 'Beklemede', 'İşlem Gerekmiyor');
  }

  if (hasReliablePaidEvidence(record)) {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Ödendi', 'İşlem Gerekmiyor');
  }
  if (record.settlement?.status === 'disputed' || normalizedStatus === 'Failed') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Beklemede', 'Destek ile İletişime Geç');
  }
  if (record.settlement?.status === 'held') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Askıda', 'İnceleme Bekleniyor');
  }
  if (record.settlement?.status === 'partially_refunded' || isRefundDeductionSettlementReviewPending(record)) {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'İncelemede', 'İnceleme Bekleniyor');
  }
  if (payoutBatchStatus === 'approved') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Hazır', 'İşlem Gerekmiyor');
  }
  if (payoutBatchStatus === 'paid_placeholder') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'İncelemede', 'İnceleme Bekleniyor');
  }
  if (payoutBatchStatus === 'draft' || payoutBatchStatus === 'review' || payoutBatchStatus === 'execution_pending') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Beklemede', 'İşlem Gerekmiyor');
  }
  if (record.settlement?.status === 'payable' || record.settlement?.payoutReady) {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Hazır', 'İşlem Gerekmiyor');
  }
  return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Hesaplanıyor', 'İşlem Gerekmiyor');
}

function getVendorPaymentWaitingSummary(status: VendorFinanceStatusLabel) {
  if (status === 'İncelemede') {
    return 'Bu işlem inceleniyor.';
  }
  if (status === 'Beklemede') {
    return 'Bu işlem beklemede.';
  }
  if (status === 'Askıda') {
    return 'Bu işlem askıda.';
  }
  return null;
}

function shouldShowVendorPaymentWaiting(status: VendorFinanceStatusLabel) {
  return status === 'İncelemede' || status === 'Beklemede' || status === 'Askıda';
}

function getVendorFinanceTimelineEvents(events: OperationalEventInput[], scenario: VendorFinanceScenario): OperationalEventInput[] {
  return events.filter((event) => !event.id.startsWith('support-group-')).map((event) => {
    const normalizedTitle = event.title.toLowerCase();
    const title = event.title === 'Refund impact captured' || scenario.kind === 'refund'
      ? 'İade'
      : normalizedTitle.includes('payment marked paid')
        ? 'Ödendi'
      : scenario.kind === 'adjustment'
        ? 'Bakiye düzeltmesi'
        : scenario.kind === 'shipping'
          ? 'Kargo'
          : scenario.kind === 'payout'
            ? 'Ödeme'
            : normalizedTitle.includes('order captured')
              ? 'Sipariş geliri'
              : normalizedTitle.includes('allocation split') || normalizedTitle.includes('assignment')
                ? 'Sipariş güncellendi'
                : normalizedTitle.includes('source transaction') || normalizedTitle.includes('held transaction') || hasFinanceReviewCopy(event.title)
                  ? 'İşlem güncellendi'
                  : 'Sipariş geliri';

    return {
      ...event,
      title,
      description: undefined,
      status: scenario.status,
    };
  });
}

function formatSupportStatus(status: SupportTicket['status'], audience: 'admin' | 'vendor' = 'admin') {
  if (audience === 'vendor') {
    if (status === 'OPEN') {
      return 'Açık';
    }
    if (status === 'IN_REVIEW') {
      return 'İncelemede';
    }
    if (status === 'WAITING_FOR_VENDOR') {
      return 'Yanıt bekliyor';
    }
    if (status === 'RESOLVED') {
      return 'Çözüldü';
    }
    if (status === 'CLOSED') {
      return 'Kapalı';
    }
  }
  return safeStatusLabel(status);
}

function formatSupportPriority(priority: SupportTicket['priority'], audience: 'admin' | 'vendor' = 'admin') {
  if (audience === 'vendor') {
    const label = priority === 'high'
        ? 'Yüksek'
        : priority === 'low'
          ? 'Düşük'
          : 'Normal';
    return `Öncelik: ${label}`;
  }
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
        label: 'İncelemede',
        description: 'İncelemede bekleyen ödeme hareketleri gösteriliyor.',
        emptyTitle: 'İncelemede ödeme hareketi yok',
        emptyDescription: 'Bu görünümde incelemede bekleyen ödeme hareketi yok. Tüm hareketleri görmek için görünümü temizleyin.',
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

function getVendorDebtEventLabel(event: VendorDebtHistoryEvent) {
  if (event.type === 'VENDOR_DEBT_OFFSET') {
    return 'Bakiye düzeltmesi uygulandı';
  }
  if (event.type === 'VENDOR_DEBT_CREATED') {
    return 'Bakiye düzeltmesi oluştu';
  }
  if (event.type === 'MANUAL_ADJUSTMENT') {
    return 'Manuel bakiye düzeltmesi';
  }
  if (event.type === 'DEBT_WAIVED') {
    return 'Bakiye düzeltmesi kapatıldı';
  }
  if (event.type === 'PAYABLE_EARNED') {
    return 'Ödeme hareketi';
  }
  return 'Bakiye Düzeltmesi';
}

function VendorDebtHistorySection({
  history,
  loading,
  error,
  selectedEvent,
  onSelectEvent,
  audience = 'admin',
}: {
  history: Awaited<ReturnType<typeof getVendorDebtHistory>> | null;
  loading: boolean;
  error: string | null;
  selectedEvent: VendorDebtHistoryEvent | null;
  onSelectEvent: (eventId: string) => void;
  audience?: 'admin' | 'vendor';
}) {
  const currency = history?.currency ?? 'TRY';
  const events = safeArray(history?.events);
  const outstandingDebtMinor = history?.summary.outstandingDebtMinor ?? 0;
  const remainingDebtMinor = history?.summary.remainingDebtMinor ?? outstandingDebtMinor;
  const isVendorAudience = audience === 'vendor';

  return (
    <section className="finance-footer-card finance-debt-history-card" aria-label={isVendorAudience ? 'Bakiye düzeltmesi geçmişi' : 'Balance adjustment history'}>
      <div>
        <p className="eyebrow">{isVendorAudience ? 'Bakiye Düzeltmesi' : 'Balance adjustment'}</p>
        <h3>{isVendorAudience ? 'Bakiye Düzeltmesi Geçmişi' : 'Balance Adjustment History'}</h3>
        <p className="page-description">
          {isVendorAudience
            ? 'Ödeme sonrası iade kaynaklı bakiye düzeltmelerini ve kesintileri takip edin.'
            : 'Review refund-after-payment balance adjustments and payment deductions without opening database records.'}
        </p>
      </div>
      <div className="op-kpi-row finance-debt-summary-row">
        <article className={`op-kpi ${outstandingDebtMinor > 0 ? 'op-tone-danger' : 'op-tone-neutral'}`}>
          <span>{isVendorAudience ? 'Açık Düzeltme' : 'Outstanding Adjustment'}</span>
          <strong>{formatMinorCurrency(outstandingDebtMinor, currency)}</strong>
          <small>{outstandingDebtMinor > 0 ? isVendorAudience ? 'Gelecek ödemeden düşülür' : 'Will reduce a future payment' : isVendorAudience ? 'Açık düzeltme yok' : 'No open adjustment'}</small>
        </article>
        <article className="op-kpi op-tone-danger">
          <span>{isVendorAudience ? 'Oluşan Düzeltme' : 'Total Adjustment Created'}</span>
          <strong>{formatMinorCurrency(history?.summary.totalDebtCreatedMinor ?? 0, currency)}</strong>
        </article>
        <article className="op-kpi op-tone-success">
          <span>{isVendorAudience ? 'Uygulanan Düzeltme' : 'Total Adjustment Applied'}</span>
          <strong>{formatMinorCurrency(history?.summary.totalDebtOffsetMinor ?? 0, currency)}</strong>
        </article>
        <article className={`op-kpi ${remainingDebtMinor > 0 ? 'op-tone-danger' : 'op-tone-success'}`}>
          <span>{isVendorAudience ? 'Kalan Düzeltme' : 'Remaining Adjustment'}</span>
          <strong>{formatMinorCurrency(remainingDebtMinor, currency)}</strong>
          <small>{history?.summary.lastDebtActivityAt ? `${isVendorAudience ? 'Son hareket' : 'Last activity'} ${formatDateParts(history.summary.lastDebtActivityAt).date}` : isVendorAudience ? 'Hareket yok' : 'No activity'}</small>
        </article>
      </div>
      {error ? (
        <SectionErrorRetry
          title={isVendorAudience ? 'Bakiye düzeltmesi geçmişi yüklenemedi' : 'Balance adjustment history unavailable'}
          description={error}
        />
      ) : loading ? (
        <p className="settlement-compact-empty">{isVendorAudience ? 'Bakiye düzeltmesi geçmişi yükleniyor...' : 'Loading balance adjustment history...'}</p>
      ) : events.length === 0 ? (
        <EmptyStatePanel
          title={isVendorAudience ? 'Bakiye düzeltmesi geçmişi yok' : 'No balance adjustment history'}
          description={isVendorAudience ? 'Ödeme sonrası iade düzeltmeleri ve kesintiler oluştuğunda burada görünür.' : 'Refund-after-payment adjustments and payment deductions will appear here when they exist.'}
        />
      ) : (
        <>
          <OperationalTable
            columns={isVendorAudience
              ? ['Tarih', 'Hareket Tipi', 'Sipariş', 'Satıcı', 'Ürünler', 'Düzeltme Tutarı', 'Kalan Düzeltme', 'Kaynak']
              : ['Event Date', 'Event Type', 'Order', 'Vendor', 'Items', 'Adjustment Amount', 'Remaining Adjustment', 'Source Reference']}
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
                <StatusBadge tone={event.type === 'VENDOR_DEBT_OFFSET' ? 'success' : 'danger'}>{isVendorAudience ? getVendorDebtEventLabel(event) : event.label}</StatusBadge>
                <span>
                  <strong>{event.orderNumber ?? (isVendorAudience ? 'Sipariş yok' : 'No order')}</strong>
                  <small>{event.shopifyOrderId ?? (isVendorAudience ? 'Kaynak yok' : 'No Shopify id')}</small>
                </span>
                <span>{event.vendorName ?? event.vendorId}</span>
                <span>
                  <strong>{event.itemCount}</strong>
                  <small>{event.productCount} {isVendorAudience ? 'ürün' : 'products'}</small>
                </span>
                <strong className={getDebtImpactClass(event)}>{formatDebtImpact(event, currency)}</strong>
                <strong className={event.remainingDebtAfterEventMinor > 0 ? 'finance-deduction-value' : 'finance-payout-value'}>
                  {formatMinorCurrency(event.remainingDebtAfterEventMinor, currency)}
                </strong>
                <span className="finance-debt-source-reference">{event.sourceReference}</span>
              </OperationalTableRow>
            ))}
          </OperationalTable>
          {selectedEvent ? <VendorDebtDetailPanel event={selectedEvent} currency={currency} audience={audience} /> : null}
        </>
      )}
    </section>
  );
}

function VendorDebtDetailPanel({ event, currency, audience = 'admin' }: { event: VendorDebtHistoryEvent; currency: string; audience?: 'admin' | 'vendor' }) {
  const isVendorAudience = audience === 'vendor';
  return (
    <div className="finance-debt-detail-panel" aria-label={isVendorAudience ? 'Bakiye düzeltmesi detayı' : 'Balance adjustment detail'}>
      <div className="finance-debt-detail-heading">
        <div>
          <p className="eyebrow">{isVendorAudience ? 'Bakiye düzeltmesi detayı' : 'Balance adjustment detail'}</p>
          <h4>{isVendorAudience ? getVendorDebtEventLabel(event) : event.label}</h4>
        </div>
        <StatusBadge tone={event.remainingDebtAfterEventMinor > 0 ? 'danger' : 'success'}>
          {isVendorAudience ? 'Kalan' : 'Remaining'} {formatMinorCurrency(event.remainingDebtAfterEventMinor, currency)}
        </StatusBadge>
      </div>
      <div className="finance-debt-detail-grid">
        <MetadataGroup title={isVendorAudience ? 'Sipariş' : 'Order'}>
          <MetadataRow label={isVendorAudience ? 'Sipariş numarası' : 'Order number'} value={event.orderNumber ?? (isVendorAudience ? 'Bilinmiyor' : 'Unknown')} />
          <MetadataRow label={isVendorAudience ? 'Kaynak sipariş' : 'Shopify order id'} value={event.shopifyOrderId ?? (isVendorAudience ? 'Bilinmiyor' : 'Unknown')} />
          <MetadataRow label={isVendorAudience ? 'Satıcı' : 'Vendor'} value={event.vendorName ?? event.vendorId} />
          <MetadataRow label={isVendorAudience ? 'Oluşturulma tarihi' : 'Created date'} value={formatOptionalDate(event.orderCreatedAt)} />
        </MetadataGroup>
        <MetadataGroup title={isVendorAudience ? 'İade' : 'Refund'}>
          <MetadataRow label={isVendorAudience ? 'İade referansı' : 'Refund reference'} value={event.refundReference ?? (isVendorAudience ? 'Uygun değil' : 'Not applicable')} />
          <MetadataRow label={isVendorAudience ? 'İade kaydı' : 'Refund record'} value={event.refundRecordId ?? (isVendorAudience ? 'Uygun değil' : 'Not applicable')} />
          <MetadataRow label={isVendorAudience ? 'İade tutarı' : 'Refund amount'} value={event.calculation.refundMinor === null ? isVendorAudience ? 'Bilinmiyor' : 'Unknown' : formatMinorCurrency(event.calculation.refundMinor, currency)} />
        </MetadataGroup>
        <MetadataGroup title={isVendorAudience ? 'Bakiye Düzeltmesi' : 'Balance Adjustment Calculation'}>
          <MetadataRow label={isVendorAudience ? 'İade tutarı' : 'Refund amount'} value={event.calculation.refundMinor === null ? isVendorAudience ? 'Bilinmiyor' : 'Unknown' : formatMinorCurrency(event.calculation.refundMinor, currency)} />
          <MetadataRow label={isVendorAudience ? 'Komisyon iadesi' : 'Commission reversal'} value={event.calculation.commissionReversalMinor === null ? isVendorAudience ? 'Bilinmiyor' : 'Unknown' : formatMinorCurrency(event.calculation.commissionReversalMinor, currency)} />
          <MetadataRow label={isVendorAudience ? 'Komisyon KDV iadesi' : 'Commission VAT reversal'} value={event.calculation.commissionVatReversalMinor === null ? isVendorAudience ? 'Bilinmiyor' : 'Unknown' : formatMinorCurrency(event.calculation.commissionVatReversalMinor, currency)} />
          <MetadataRow label={isVendorAudience ? 'Oluşan düzeltme' : 'Balance adjustment created'} value={event.calculation.vendorDebtMinor === null ? isVendorAudience ? 'Bilinmiyor' : 'Unknown' : formatMinorCurrency(event.calculation.vendorDebtMinor, currency)} />
          <MetadataRow label={isVendorAudience ? 'Uygulanan düzeltme' : 'Balance adjustment applied'} value={event.calculation.debtOffsetMinor === null ? isVendorAudience ? 'Uygun değil' : 'Not applicable' : formatMinorCurrency(event.calculation.debtOffsetMinor, currency)} />
          <MetadataRow label={isVendorAudience ? 'Hesaplama' : 'Formula'} value={event.calculation.formula ?? (isVendorAudience ? 'Yok' : 'Not available')} />
        </MetadataGroup>
        <MetadataGroup title={isVendorAudience ? 'Ödeme Düzeltmesi' : 'Payment Adjustment'}>
          <MetadataRow label={isVendorAudience ? 'Ödeme hazırlığı' : 'Payment preparation'} value={event.payoutBatchId ?? (isVendorAudience ? 'Uygun değil' : 'Not applicable')} />
          <MetadataRow label={isVendorAudience ? 'Ödeme hazırlığı durumu' : 'Payment preparation status'} value={event.payoutBatchStatus ? isVendorAudience ? getVendorPayoutBatchStatusLabel(event.payoutBatchStatus) : safeStatusLabel(event.payoutBatchStatus) : isVendorAudience ? 'Uygun değil' : 'Not applicable'} />
          <MetadataRow label={isVendorAudience ? 'Kaynak' : 'Source reference'} value={event.sourceReference} />
        </MetadataGroup>
      </div>
      <div className="finance-debt-detail-grid">
        <section className="finance-debt-detail-list">
          <h5>{isVendorAudience ? 'Ürünler' : 'Products'}</h5>
          {event.products.length ? (
            event.products.map((product, index) => (
              <p key={`${product.sku ?? product.title ?? 'product'}-${index}`}>
                <strong>{product.title ?? (isVendorAudience ? 'Bilinmeyen ürün' : 'Unknown product')}</strong>
                <span>{product.sku ?? (isVendorAudience ? 'SKU yok' : 'No SKU')} · {isVendorAudience ? 'Adet' : 'Qty'} {product.quantity}</span>
              </p>
            ))
          ) : (
            <p>{isVendorAudience ? 'Ürün bilgisi yok.' : 'No product snapshot available.'}</p>
          )}
        </section>
        <section className="finance-debt-detail-list">
          <h5>{isVendorAudience ? 'Düzeltme Geçmişi' : 'Adjustment History'}</h5>
          {event.offsetHistory.length ? (
            event.offsetHistory.map((offset) => (
              <p key={offset.id}>
                <strong>{formatMinorCurrency(offset.offsetAmountMinor, currency)}</strong>
                <span>
                  {offset.payoutBatchId ?? (isVendorAudience ? 'Ödeme hazırlığı yok' : 'No payment preparation')} · {isVendorAudience ? 'Kalan' : 'Remaining'} {formatMinorCurrency(offset.remainingDebtAfterEventMinor, currency)}
                </span>
              </p>
            ))
          ) : (
            <p>{isVendorAudience ? 'Henüz ödeme düzeltmesi uygulanmadı.' : 'No payment adjustments have been applied yet.'}</p>
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
  const selectedVendorFinanceScenario = selectedRecord
    ? getVendorFinanceScenario(selectedRecord)
    : buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Hesaplanıyor', 'İşlem Gerekmiyor');
  const selectedVendorPaymentWaitingSummary = getVendorPaymentWaitingSummary(selectedVendorFinanceScenario.status);
  const vendorFinanceTimelineEvents = getVendorFinanceTimelineEvents(financeTimelineEvents, selectedVendorFinanceScenario);
  const selectedPaymentImpact = selectedRecord ? getPayoutImpact(selectedRecord, financeAudience) : UNKNOWN_FINANCE_VALUE;
  const selectedPaymentEligibility = selectedRecord
    ? getPaymentEligibilityLabel(selectedRecord, selectedOperationalProjection)
    : UNKNOWN_FINANCE_VALUE;
  const selectedSettlementReason = selectedRecord
    ? getSettlementReasonLabel(selectedRecord, selectedOperationalProjection)
    : UNKNOWN_FINANCE_VALUE;
  const selectedSettlementNextAction = selectedRecord
    ? getSettlementNextActionLabel(selectedRecord, selectedOperationalProjection, selectedFinanceGuidance)
    : UNKNOWN_FINANCE_VALUE;
  const selectedAssignmentHref = selectedRecord && isVendorBlockedFinanceHold(selectedRecord) ? buildOrdersHref(selectedRecord) : null;
  const selectedSettlementActionHref = selectedAssignmentHref ?? selectedOrderSettlementHref;
  const showSelectedRefundImpact = selectedRecord ? shouldShowRefundImpactRow(selectedRecord) : false;
  const showSelectedShippingFee = selectedRecord ? shouldShowShippingFeeRow(selectedRecord, selectedOperationalProjection) : false;
  const showSelectedBalanceAdjustmentImpact = shouldShowBalanceAdjustmentImpact(finance);
  const showSelectedTimeline = financeTimelineEvents.some(isMeaningfulFinanceTimelineEvent);
  const selectedHasSingleRelatedOrder =
    financeCrossLinks.length === 1 &&
    financeCrossLinks[0]?.eyebrow === 'Order' &&
    Boolean(financeCrossLinks[0]?.href);
  const vendorFinanceCrossLinks = financeCrossLinks
    .filter((link) => link.eyebrow !== 'Support')
    .map((link) => ({
      ...link,
      eyebrow: link.eyebrow === 'Order' ? 'İlgili Sipariş' : link.eyebrow === 'Return' ? 'İlgili İade' : link.eyebrow,
      title: link.eyebrow === 'Order' && selectedRecord?.shopifyOrderNumber
        ? `Sipariş ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)}`
        : link.eyebrow === 'Return'
          ? 'İlgili iade'
          : link.title,
      actionLabel: 'Aç',
      description: undefined,
      status: undefined,
    }));
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
  const overviewPaymentDate = getOverviewPaymentDate(financeView, financeAudience);
  const overviewPaymentStatus = getOverviewPaymentStatus(financeView, financeAudience);
  const overviewRecentActivity = safeArray(financeView.transactions).slice(0, 5);
  const overviewProgressSteps = getPaymentProgressSteps(financeView, financeAudience);

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
                <p className="eyebrow">{isVendorUser ? 'Kullanılabilir Bakiye' : 'Available balance'}</p>
                <strong>{overviewAvailableBalance}</strong>
                <span>{isVendorUser ? 'Sonraki ödeme değerlendirmesine dahil edilecek tutar.' : 'Ready to be included in your next payment review.'}</span>
              </div>
            </article>

            <aside className="finance-next-payment-card" aria-label={isVendorUser ? 'Sonraki Ödeme' : 'Next payment'}>
              <div>
                <p className="eyebrow">{isVendorUser ? 'Tahmini Ödeme' : 'Estimated payment'}</p>
                <strong>{overviewPaymentEstimate}</strong>
                <span>{overviewPaymentDate}</span>
                <span>{isVendorUser ? 'Tahmini ödeme bilgisi.' : 'Preparing your next payment.'}</span>
              </div>
              <StatusBadge tone={(financeView.payoutBatchSummary?.latestBatch || (financeView.payoutBatchSummary?.eligibleRowCount ?? 0) > 0) ? 'success' : 'neutral'}>
                {overviewPaymentStatus}
              </StatusBadge>
            </aside>

            <div className="finance-balance-secondary-grid">
              <article>
                <span>{isVendorUser ? 'Bekleyen Tutar' : 'Waiting to become payable'}</span>
                <strong>{overviewPendingBalance}</strong>
                <small>{isVendorUser ? 'Ödemeye hazır hale gelmeyi bekleyen tutar.' : 'Orders waiting for delivery, timing, or payment readiness.'}</small>
              </article>
              <article>
                <span>{isVendorUser ? 'İncelemede Bekleyen Tutar' : 'Waiting for review'}</span>
                <strong>{overviewHoldBalance}</strong>
                <small>{isVendorUser ? 'Operasyon veya finans incelemesi tamamlanınca çözülecek tutar.' : 'Money paused until an operational or finance review is resolved.'}</small>
              </article>
            </div>
          </section>

          <section className="finance-overview-panel finance-balance-story" aria-label="Balance explanation">
            <div>
              <p className="eyebrow">{isVendorUser ? 'Bakiye Hareketleri' : 'How your balance moves'}</p>
              <h3>{isVendorUser ? 'Ödeme Aşamaları' : 'Payment stages'}</h3>
            </div>
            <div className="finance-balance-story-grid">
              <p>
                <strong>{isVendorUser ? 'Kullanılabilir' : 'Available'}</strong>
                <span>{isVendorUser ? 'Ödeme değerlendirmesine hazır.' : 'Ready for payment review.'}</span>
              </p>
              <p>
                <strong>{isVendorUser ? 'Bekleyen' : 'Pending'}</strong>
                <span>{isVendorUser ? 'Ödemeye hazır hale gelmeyi bekliyor.' : 'Waiting to become payable.'}</span>
              </p>
              <p>
                <strong>{isVendorUser ? 'İncelemede' : 'Waiting for review'}</strong>
                <span>{isVendorUser ? 'İnceleme tamamlanınca çözülür.' : 'Paused until a review is resolved.'}</span>
              </p>
              <p>
                <strong>{isVendorUser ? 'Son hareketler' : 'Changed recently'}</strong>
                <span>{isVendorUser ? 'Son satış, iade ve düzeltmeler.' : 'Recent sales, refunds, and adjustments.'}</span>
              </p>
            </div>
          </section>

          <section className="finance-overview-panel finance-recent-activity" aria-label={isVendorUser ? 'Son Ödeme Hareketleri' : 'Recent payment activity'}>
            <div className="finance-overview-panel-heading">
              <div>
                <p className="eyebrow">{isVendorUser ? 'Son Ödeme Hareketleri' : 'Recent payment activity'}</p>
                <h3>{isVendorUser ? 'Son kontrolünüzden bu yana değişen hareketler.' : 'What changed since your last check'}</h3>
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
                    <time>{getRelativeActivityDay(getRecordActivityDate(record), financeAudience)}</time>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRecordId(record.id);
                        setActiveFinanceTab('transactions');
                      }}
                    >
                      <strong>{getRecentChangeTitle(record, financeAudience)}</strong>
                      <span>{getRecentChangeDetail(record, financeAudience)}</span>
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

          <section className="finance-overview-panel finance-payment-progress" aria-label={isVendorUser ? 'Ödeme Süreci' : 'Payment progress'}>
            <div className="finance-overview-panel-heading">
              <div>
                <p className="eyebrow">{isVendorUser ? 'Ödeme Süreci' : 'Payment progress'}</p>
                <h3>{isVendorUser ? 'Satışlar ödemeye nasıl dönüşür' : 'How sales become money paid out'}</h3>
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
                <option value="all">{isVendorUser ? 'Tüm durumlar' : 'All statuses'}</option>
                <option value="Estimated">{isVendorUser ? 'Hesaplanıyor' : 'Estimated'}</option>
                <option value="Pending review">{isVendorUser ? 'İncelemede' : 'Pending review'}</option>
                <option value="Approved">{isVendorUser ? 'Hazır' : 'Approved'}</option>
                <option value="Scheduled">{isVendorUser ? 'Beklemede' : 'Scheduled'}</option>
                <option value="Refund impact">{isVendorUser ? 'İade' : 'Refund impact'}</option>
                <option value="Blocked">{isVendorUser ? 'Beklemede' : 'Blocked'}</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(event) => {
                  clearWorkflowFilter();
                  setCategoryFilter(event.target.value);
                }}
              >
                <option value="all">{isVendorUser ? 'Tüm işlem tipleri' : 'All types'}</option>
                <option value="Invoice">{isVendorUser ? 'Sipariş Geliri' : 'Sale'}</option>
                <option value="Refund">{isVendorUser ? 'İade' : 'Refund'}</option>
                <option value="Payout">{isVendorUser ? 'Ödeme' : 'Payment review'}</option>
                <option value="Adjustment">{isVendorUser ? 'Bakiye Düzeltmesi' : 'Adjustment'}</option>
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
                <span>{isVendorUser ? 'Görünüm' : 'Workflow filter'}</span>
                <strong>{activeWorkflowFilter.label}</strong>
                <small>{activeWorkflowFilter.description}</small>
              </div>
              <button type="button" className="button button-secondary button-compact" onClick={handleResetFilters}>
                {isVendorUser ? 'Temizle' : 'Clear workflow'}
              </button>
            </div>
          ) : null}

          <OperationalTable
            columns={isVendorUser
              ? ['Tarih', 'İşlem Tipi', 'Sipariş', 'Durum', 'Tutar', 'Ödeme Etkisi', 'İşlem']
              : ['Date', 'Type', 'Order', 'Status', 'Source amount', 'Settlement impact', 'Action']}
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
              const rowVendorFinanceScenario = getVendorFinanceScenario(record);
              const rowPaymentImpact = getTransactionListSettlementImpact(record, financeAudience);
              const rowStatusLabel = isVendorUser
                ? rowVendorFinanceScenario.status
                : projection.legacyStatusLabel;
              const rowStatusDetail = isVendorUser
                ? null
                : vendorBlockedHold ? null : projection.blockerState === 'None' ? projection.payoutReadiness : projection.blockerState;
              const rowActivityDetail = vendorBlockedHold && !isSplitChildFinanceHold(record) ? null : getPayoutActivityDetail(record, financeAudience);
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
                      <strong>{formatDateParts(getRecordActivityDate(record)).date}</strong>
                      <small>{formatDateParts(getRecordActivityDate(record)).time}</small>
                    </span>
                  </span>
                  <span className="finance-type-cell">
                    <span>
                      <strong className={isVendorUser ? getVendorScenarioTypeClass(rowVendorFinanceScenario) : undefined}>
                        {isVendorUser ? rowVendorFinanceScenario.typeLabel : getPayoutActivityType(record, financeAudience)}
                      </strong>
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
                    <StatusBadge tone={isVendorUser ? rowVendorFinanceScenario.tone : getPayoutActivityTone(record, financeAudience)}>{rowStatusLabel}</StatusBadge>
                    {rowStatusDetail ? <small>{rowStatusDetail}</small> : null}
                  </span>
                  <strong className={isVendorUser ? getVendorScenarioAmountClass(record.amount, rowVendorFinanceScenario) : isRefundRecord(record) || record.category === 'Adjustment' ? 'finance-negative finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {isVendorUser ? formatVendorScenarioAmount(record.amount, rowVendorFinanceScenario) : `${isRefundRecord(record) || record.category === 'Adjustment' ? '-' : ''}${record.amount}`}
                  </strong>
                  <strong className={getTransactionListSettlementImpactClass(record, rowPaymentImpact, financeAudience)}>
                    {rowPaymentImpact}
                  </strong>
                  <OperationalActionGroup>
                    {orderSettlementHref ? (
                      <Link className="button button-secondary button-compact" to={orderSettlementHref}>
                        {isVendorUser ? 'Siparişi kontrol et' : vendorBlockedHold ? 'Review assignment' : 'View order settlement'}
                      </Link>
                    ) : null}
                    <button type="button" className="button button-secondary button-compact" onClick={() => setSelectedRecordId(record.id)}>
                      {isVendorUser ? 'Aç' : 'View details'}
                    </button>
                  </OperationalActionGroup>
                </OperationalTableRow>
              );
            })}
          </OperationalTable>

          <div className="finance-info-footer">
            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">{isVendorUser ? 'Satıcı Profili' : 'Vendor profile'}</p>
                <h3>{isVendorUser ? `${currentVendor.vendorName} ödeme koşulları` : `${currentVendor.vendorName} marketplace terms`}</h3>
                <p className="page-description">
                  {isVendorUser
                    ? 'Ödeme koşulları satıcı profilinden yönetilir. Yeni tahmini ödemeler kayıtlı koşullara göre hesaplanır.'
                    : 'Finance policy is edited from Vendor Profile. New payment estimates use the saved policy snapshot.'}
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label={isVendorUser ? 'Komisyon' : 'Commission'} value={`${financeView.profile?.commissionPercent ?? '10.00'}%`} />
                <MetadataRow label={isVendorUser ? 'Komisyon KDV' : 'Commission VAT'} value={`${financeView.profile?.commissionVatPercent ?? '0.00'}%`} />
                <MetadataRow label={isVendorUser ? 'Kargo ücreti modu' : 'Shipping deduction mode'} value={financeView.profile?.shippingMode ? safeStatusLabel(financeView.profile.shippingMode) : isVendorUser ? 'Kapalı' : 'Disabled'} />
                <MetadataRow label={isVendorUser ? 'Teslimattan sonra kargo kesintisi' : 'Deduct shipping after fulfillment'} value={financeView.profile?.deductShippingEnabled ? isVendorUser ? 'Evet' : 'Yes' : isVendorUser ? 'Hayır' : 'No'} />
                <MetadataRow label={isVendorUser ? 'Sabit kargo ücreti' : 'Fixed shipping fee'} value={financeView.profile?.fixedShippingFee ?? (isVendorUser ? 'Tanımlı değil' : 'Not configured')} />
                <MetadataRow label={isVendorUser ? 'Ödeme bekleme süresi' : 'Settlement delay'} value={isVendorUser ? `${financeView.profile?.settlementDelayDays ?? 21} gün` : `${financeView.profile?.settlementDelayDays ?? 21} days`} />
              </div>
              <StatusBadge tone="neutral">{isVendorUser ? 'Salt okunur ödeme koşulları' : 'Read-only finance policy'}</StatusBadge>
            </section>

            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">{isVendorUser ? 'İncelemede' : 'Settlement review'}</p>
                <h3>{isVendorUser ? 'İncelemede Bekleyen Tutar' : 'Draft settlement payment review'}</h3>
                <p className="page-description">
                  {isVendorUser
                    ? 'İncelemede bekleyen ödeme hareketlerinin salt okunur görünümü.'
                    : 'Prepare eligible estimate rows for review. No payment is executed here.'}
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label={isVendorUser ? 'İncelemede bekleyen hareket' : 'Rows pending review'} value={financeView.payoutBatchSummary?.eligibleRowCount ?? 0} />
                <MetadataRow label={isVendorUser ? 'Düzeltme öncesi tahmini ödeme' : 'Estimated payment before adjustments'} value={financeValueOrUnknown(financeView.payoutBatchSummary?.eligibleNetAmount ?? financeView.summary.payableBalance ?? financeView.summary.payoutEstimate)} />
                <MetadataRow
                  label={isVendorUser ? 'Açık bakiye düzeltmesi' : 'Outstanding balance adjustment'}
                  value={<span className={isZeroCurrencyValue(financeView.payoutBatchSummary?.outstandingDebtAmount) ? undefined : 'finance-deduction-value'}>
                    {financeValueOrUnknown(financeView.payoutBatchSummary?.outstandingDebtAmount ?? financeView.summary.outstandingVendorDebt)}
                  </span>}
                />
                <MetadataRow label={isVendorUser ? 'Bakiye düzeltmesi önizlemesi' : 'Balance adjustment preview'} value={financeValueOrUnknown(financeView.payoutBatchSummary?.debtOffsetPreviewAmount)} />
                <MetadataRow
                  label={isVendorUser ? 'Düzeltme sonrası net tutar' : 'Net after balance adjustment'}
                  value={<span className={getBalanceTone(financeView.payoutBatchSummary?.netEligibleAfterDebtOffset ?? financeView.summary.netPayableAfterDebt) === 'danger' ? 'finance-deduction-value' : 'finance-payout-value'}>
                    {financeValueOrUnknown(financeView.payoutBatchSummary?.netEligibleAfterDebtOffset ?? financeView.summary.netPayableAfterDebt)}
                  </span>}
                />
                <MetadataRow label={isVendorUser ? 'İnceleme bekleyen' : 'Needs review'} value={financeView.payoutBatchSummary?.blockedRowCount ?? 0} />
                <MetadataRow
                  label={isVendorUser ? 'Son inceleme durumu' : 'Latest draft review'}
                  value={
                    financeView.payoutBatchSummary?.latestBatch
                      ? `${isVendorUser ? getVendorPayoutBatchStatusLabel(financeView.payoutBatchSummary.latestBatch.status, Boolean(financeView.payoutBatchSummary.latestBatch.paidAt)) : getPayoutBatchStatusLabel(financeView.payoutBatchSummary.latestBatch.status, financeAudience)} · ${financeView.payoutBatchSummary.latestBatch.netAmount}`
                      : isVendorUser
                        ? 'Planlanan inceleme yok'
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
                <StatusBadge tone="neutral">Salt okunur tahmini ödeme</StatusBadge>
              )}
            </section>
          </div>
          <VendorDebtHistorySection
            history={vendorDebtHistory}
            loading={debtHistoryLoading}
            error={debtHistoryError ? debtHistoryErrorMessage : null}
            selectedEvent={selectedDebtEvent}
            onSelectEvent={setSelectedDebtEventId}
            audience={financeAudience}
          />
        </div>

        <SideDetailPanel
          eyebrow={isVendorUser ? 'İşlem' : 'Selected transaction'}
          title={isVendorUser
            ? selectedRecord?.shopifyOrderNumber
              ? `Sipariş ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)}`
              : 'İşlem'
            : selectedRecord?.shopifyOrderNumber
              ? `Order ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)}`
              : 'Settlement estimate'}
        >
          {selectedRecord ? isVendorUser ? (
            <>
              <div className="finance-selected-summary-card">
                <div className="finance-detail-card-heading">
                  <h4>İşlem Özeti</h4>
                  <StatusBadge tone={selectedVendorFinanceScenario.tone}>
                    {selectedVendorFinanceScenario.status}
                  </StatusBadge>
                </div>
                <div className="finance-selected-summary-grid">
                  <MetadataRow label="İlgili Sipariş" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : UNKNOWN_FINANCE_VALUE} />
                  {isRefundRecord(selectedRecord) && selectedRecord.shopifyRefundId ? <MetadataRow label="İlgili İade" value="İlgili iade" /> : null}
                  <MetadataRow label="İşlem Tipi" value={selectedVendorFinanceScenario.typeLabel} />
                  <MetadataRow label="Durum" value={selectedVendorFinanceScenario.status} />
                  <MetadataRow
                    label="Ödeme Etkisi"
                    value={<span className={getVendorScenarioImpactClass(selectedPaymentImpact, selectedVendorFinanceScenario)}>{selectedPaymentImpact}</span>}
                  />
                </div>
              </div>

              {shouldShowVendorPaymentWaiting(selectedVendorFinanceScenario.status) && selectedVendorPaymentWaitingSummary ? (
                <div className="finance-detail-card finance-payout-readiness-card">
                  <div className="finance-detail-card-heading">
                    <h4>Bu ödeme neden bekliyor?</h4>
                    <StatusBadge tone={selectedVendorFinanceScenario.tone}>
                      {selectedVendorFinanceScenario.status}
                    </StatusBadge>
                  </div>
                  <p className="page-description">{selectedVendorPaymentWaitingSummary}</p>
                </div>
              ) : null}

              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Sonraki Adım</h4>
                  <StatusBadge tone={selectedVendorFinanceScenario.nextAction === 'İşlem Gerekmiyor' ? 'success' : 'warning'}>
                    {selectedVendorFinanceScenario.nextAction}
                  </StatusBadge>
                </div>
              </div>

              <OperationalLinkCards
                title="İlgili Kayıtlar"
                links={vendorFinanceCrossLinks}
                audience={financeAudience}
                eyebrow=""
              />

              <OperationalTimeline
                title="Hareket Geçmişi"
                eyebrow="Hareket"
                events={vendorFinanceTimelineEvents}
                audience={financeAudience}
              />

              {relatedSupportTickets.length ? (
                <details className="finance-support-history">
	                  <summary>
	                    <span>
	                      <strong>Destek</strong>
	                      {supportActivitySummary ? <small>Son durum: {formatSupportStatus(supportActivitySummary.latestTicket.status, financeAudience)}</small> : null}
	                    </span>
	                    <StatusBadge tone="neutral">{supportActivitySummary ? `${supportActivitySummary.ticketCount} destek kaydı` : `${relatedSupportTickets.length} destek kaydı`}</StatusBadge>
	                  </summary>
                  <div className="finance-support-history-list">
                    {relatedSupportTickets.map((ticket) => (
	                      <Link key={ticket.id} to={`${supportBasePath}/${ticket.id}`}>
	                        <span>
	                          <strong>{ticket.subject}</strong>
	                          <small>{formatSupportStatus(ticket.status, financeAudience)} · {formatSupportPriority(ticket.priority, financeAudience)}</small>
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
                  <h4>Transaction</h4>
                  <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>
                    {selectedOperationalProjection?.legacyStatusLabel ?? UNKNOWN_FINANCE_VALUE}
                  </StatusBadge>
                </div>
                <div className="finance-selected-summary-grid">
                  <MetadataRow label="Order" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Type" value={getPayoutActivityType(selectedRecord, financeAudience)} />
                  <MetadataRow label="Payment impact" value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : isVendorBlockedFinanceHold(selectedRecord) ? undefined : 'finance-payout-value'}>{selectedPaymentImpact}</span>} />
                </div>
              </div>
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
                  <h4>Settlement</h4>
                  <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>
                    {selectedOperationalProjection?.legacyStatusLabel ?? UNKNOWN_FINANCE_VALUE}
                  </StatusBadge>
                </div>
                {selectedSettlementOffsetReviewPending ? (
                  <p className="page-description">Refund completed. The Shopify refund has been processed. This review only determines how the refund adjustment is recorded in settlement accounting. No shipment, refund, or vendor action is required.</p>
                ) : null}
                <div className="finance-detail-rows">
                  <MetadataRow label="Status" value={selectedOperationalProjection?.legacyStatusLabel ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Reason" value={selectedSettlementReason} />
                  {isSplitChildFinanceHold(selectedRecord) ? (
                    <MetadataRow label="Hold context" value="Vendor rejected selected line items." />
                  ) : null}
                  <MetadataRow label="Payment eligibility" value={selectedPaymentEligibility} />
                  <MetadataRow
                    label="Next action"
                    value={
                      <span>
                        {selectedSettlementNextAction}
                        {selectedSettlementActionHref ? (
                          <>
                            {' '}
                            <Link className="button button-secondary button-compact finance-order-settlement-link" to={selectedSettlementActionHref}>
                              {selectedAssignmentHref ? 'Review assignment' : 'View order settlement'}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    }
                  />
                  {selectedRefundedSplitChildSaleBasis ? (
                    <>
                      <MetadataRow label="Operational status" value="Resolved" />
                      <MetadataRow label="Settlement status" value="Review pending" />
                      <MetadataRow label="Sale basis" value={<span className="finance-payout-value">{selectedRecord.amount}</span>} />
                      <MetadataRow label="Refund adjustment" value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRefundOffsetValue)}</span>} />
                      <MetadataRow label="Net child effect" value={<span>{selectedRefundedSplitChildNetEffect ?? UNKNOWN_FINANCE_VALUE}</span>} />
                    </>
                  ) : null}
                  <MetadataRow label="Settlement state" value={selectedOperationalProjection?.settlementState ?? UNKNOWN_FINANCE_VALUE} />
                  <MetadataRow label="Payment" value={selectedOperationalProjection?.payoutState ?? UNKNOWN_FINANCE_VALUE} />
                  {selectedReviewDisplay || selectedSettlementOffsetReviewPending ? (
                    <MetadataRow label="Review status" value={selectedSettlementReviewStatusLabel} />
                  ) : null}
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

              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Financial preview</h4>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow
                    label="Gross allocation amount"
                    value={<span className="finance-payout-value">{financeValueOrUnknown(selectedRecord.payoutCalculation?.grossAmount ?? selectedRecord.amount)}</span>}
                  />
                  <MetadataRow
                    label={`Commission (${selectedRecord.payoutCalculation?.commissionPercent ?? financeView.profile?.commissionPercent ?? '10.00'}%)`}
                    value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.commission)}</span>}
                  />
                  <MetadataRow
                    label={`Commission VAT (${selectedRecord.payoutCalculation?.commissionVatPercent ?? financeView.profile?.commissionVatPercent ?? '0.00'}%)`}
                    value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.commissionVat)}</span>}
                  />
                  {showSelectedShippingFee ? (
                    <MetadataRow
                      label="Shipping fee"
                      value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.shippingDeduction)}</span>}
                    />
                  ) : null}
                  {showSelectedRefundImpact ? (
                    <MetadataRow
                      label="Refund impact"
                      value={<span className="finance-deduction-value">{optionalDeductionValue(selectedRecord.payoutCalculation?.refundImpact)}</span>}
                    />
                  ) : null}
                  <MetadataRow
                    label="Estimated vendor payable"
                    value={<span className="finance-payout-value">{financeValueOrUnknown(selectedRecord.payoutCalculation?.estimatedPayout ?? selectedRecord.amount)}</span>}
                  />
                  {selectedPaymentEligibility === 'Not eligible' ? (
                    <p className="page-description">This amount is not currently payable.</p>
                  ) : null}
                </div>
              </div>

              {showSelectedBalanceAdjustmentImpact ? (
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
              ) : null}

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

              {showSelectedTimeline ? (
                <OperationalTimeline
                  title="Activity timeline"
                  subtitle={FINANCE_TIMELINE_HELPER}
                  events={financeTimelineEvents}
                  audience={financeAudience}
                />
              ) : null}

              {selectedHasSingleRelatedOrder ? (
                <div className="finance-detail-card finance-related-inline-card">
                  <div className="finance-detail-card-heading">
                    <h4>Related</h4>
                  </div>
                  <MetadataRow
                    label={financeCrossLinks[0].title}
                    value={
                      <Link className="button button-secondary button-compact" to={financeCrossLinks[0].href!}>
                        Open
                      </Link>
                    }
                  />
                </div>
              ) : (
                <OperationalLinkCards
                  title="Related records"
                  subtitle="Grouped order, return, and support context for this transaction."
                  links={financeCrossLinks}
                  audience={financeAudience}
                />
              )}

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
                title="Internal notes"
                emptyMessage="No notes"
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
