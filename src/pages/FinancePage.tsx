import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  FilterBar,
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
  createInvoiceExecution,
  getFinanceDashboard,
  getInvoiceExecutionResponseSummary,
  preparePayoutBatch,
  retryInvoiceExecution,
  updateVendorFinancialProfile,
} from '../features/finance/api';
import { useAppReadiness } from '../lib/appReadiness';
import type { FinanceTransaction, OperationsRecommendation, SupportTicket } from '../lib/api/contracts';
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

type InvoiceExecution = NonNullable<FinanceTransaction['invoiceExecution']>;

const DEFAULT_BIZIMHESAP_CAPABILITIES: InvoiceExecution['providerCapabilities'] = {
  supportsDraftSubmission: true,
  supportsFinalInvoiceVisibility: false,
  supportsPdfLink: true,
  supportsStatusSync: false,
  note: 'BizimHesap AddInvoice is treated as accounting draft/sync visibility; finalized invoice authority is reconciled separately.',
};

type VendorProfileFormInput = {
  commissionPercent: number;
  commissionVatPercent: number;
  deductShippingEnabled: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee: number | null;
};

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
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateParts(value: string) {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date),
  };
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

function normalizeFinanceStatus(status: string) {
  const normalized = status.trim().toLowerCase();
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
  return status;
}

function getStatusTone(status: string) {
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
  if (label === 'Approved' || label === 'Scheduled' || label === 'Paid') {
    return 'success' as const;
  }
  if (label === 'Estimated') {
    return 'info' as const;
  }
  return 'attention' as const;
}

function isZeroCurrencyValue(value: string) {
  return !/[1-9]/.test(value.replace(/[^\d]/g, ''));
}

function formatDeductionValue(value: string) {
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

function getInvoiceStatusLabel(status?: string) {
  if (!status) {
    return 'Not linked';
  }

  return status
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getProviderName(provider?: string) {
  if (provider === 'bizimhesap') {
    return 'BizimHesap';
  }
  if (provider === 'parasut') {
    return 'Paraşüt';
  }
  if (provider === 'birfatura') {
    return 'BirFatura';
  }
  return 'Not linked';
}

function getInvoiceVisibilityLabel(record?: FinanceTransaction | null) {
  if (!record || record.category !== 'Invoice') {
    return 'Not applicable';
  }
  if (!record.invoiceExecution) {
    return 'Invoice visibility missing';
  }
  return record.invoiceExecution.visibilityLabel ?? getInvoiceStatusLabel(record.invoiceExecution.status);
}

function getInvoiceVisibilityTone(execution?: InvoiceExecution | null) {
  if (!execution) {
    return 'attention' as const;
  }
  if (execution.visibilityStatus === 'provider_failed' || execution.status === 'failed') {
    return 'danger' as const;
  }
  if (execution.visibilityStatus === 'invoice_linked' || execution.visibilityStatus === 'accounting_synced') {
    return 'success' as const;
  }
  if (execution.visibilityStatus === 'cancelled') {
    return 'neutral' as const;
  }
  return 'attention' as const;
}

function getFinalInvoiceStateLabel(state?: InvoiceExecution['finalInvoiceState']) {
  if (state === 'finalized_visible') {
    return 'Final invoice visible';
  }
  if (state === 'draft_or_synced') {
    return 'Accounting sync only';
  }
  if (state === 'failed') {
    return 'Sync issue';
  }
  if (state === 'cancelled') {
    return 'Cancelled';
  }
  if (state === 'not_requested') {
    return 'Not requested';
  }
  return 'Visibility unknown';
}

function getSyncSemanticsLabel(semantics?: InvoiceExecution['syncSemantics']) {
  if (semantics === 'draft_accounting_sync') {
    return 'Draft/accounting sync';
  }
  if (semantics === 'final_invoice_visibility') {
    return 'Final invoice visibility';
  }
  return 'Not synced';
}

function getProviderCapabilities(execution?: InvoiceExecution | null) {
  return execution?.providerCapabilities ?? DEFAULT_BIZIMHESAP_CAPABILITIES;
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
  const items: Array<FinanceTimelineItem | null> = [
    {
      label: isRefundRecord(record) ? 'Refund impact captured' : 'Order captured',
      at: record.date,
      status: normalizeFinanceStatus(record.status),
    },
    {
      label: record.settlement?.payoutReady ? 'Settlement awaiting review' : 'Settlement preview generated',
      at: record.settlement?.payableAt ?? record.settlement?.eligibleAt ?? null,
      status: record.settlement?.payoutReady ? 'Review' : 'Preview',
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
  return status
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatSupportPriority(priority: SupportTicket['priority']) {
  return `${priority.charAt(0).toUpperCase()}${priority.slice(1)} priority`;
}

function isOpenSupportTicket(ticket: SupportTicket) {
  return ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED';
}

function getSupportLatestActivityAt(ticket: SupportTicket) {
  return ticket.lastReplyAt ?? ticket.updatedAt ?? ticket.createdAt;
}

function getLatestSupportTicket(tickets: SupportTicket[]) {
  return [...tickets].sort((left, right) => {
    const leftTime = new Date(getSupportLatestActivityAt(left)).getTime();
    const rightTime = new Date(getSupportLatestActivityAt(right)).getTime();
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

export function FinancePage() {
  const [searchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const currentVendor = appReadiness.currentVendor;
  const authContextReady = appReadiness.ready;
  const { data: finance, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    ({ signal }) => getFinanceDashboard({ vendorId: currentVendor.vendorId, signal }),
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
  const requestedFinanceTarget = useMemo(() => getFinanceDeepLinkTarget(searchParams), [searchParams]);
  const [commissionPercent, setCommissionPercent] = useState('10.00');
  const [commissionVatPercent, setCommissionVatPercent] = useState('0.00');
  const [deductShippingEnabled, setDeductShippingEnabled] = useState(false);
  const [shippingMode, setShippingMode] = useState<'disabled' | 'fixed' | 'external_provider'>('disabled');
  const [fixedShippingFee, setFixedShippingFee] = useState('');
  const [shippingCostProvider, setShippingCostProvider] = useState('Manual provider');
  const [shippingCostAmount, setShippingCostAmount] = useState('');
  const [shippingVatAmount, setShippingVatAmount] = useState('');
  const isAdmin = currentUser?.role === 'admin';
  const isVendorUser = currentUser?.role === 'vendor';
  const financeAudience = isAdmin ? 'admin' : 'vendor';

  useEffect(() => {
    setSelectedRecordId(null);
  }, [requestedFinanceTarget?.type, requestedFinanceTarget?.value]);
  const saveProfileMutation = useMutationAction(
    (input: VendorProfileFormInput) =>
      updateVendorFinancialProfile(currentVendor.vendorId, input),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async () => {
        await refetch();
        showFeedback('Vendor financial profile saved.', 'success');
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Financial profile could not be saved.', 'error'),
    },
  );
  const preparePayoutBatchMutation = useMutationAction(
    () => preparePayoutBatch(currentVendor.vendorId),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async (batch) => {
        await refetch();
        showFeedback(`Draft payout review ${batch.id} prepared.`, 'success');
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
  const createInvoiceMutation = useMutationAction(
    (financeLedgerEntryId: string) => createInvoiceExecution(financeLedgerEntryId),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async (execution) => {
        await refetch();
        showFeedback(
          execution.status === 'created'
            ? `${execution.visibilityLabel ?? 'Accounting sync recorded'} for this finance row.`
            : `Accounting sync recorded as ${getInvoiceStatusLabel(execution.status).toLowerCase()}.`,
          execution.status === 'failed' ? 'error' : 'success',
        );
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Accounting sync could not be created.', 'error'),
    },
  );
  const retryInvoiceMutation = useMutationAction(
    (invoiceExecutionId: string) => retryInvoiceExecution(invoiceExecutionId),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async (execution) => {
        await refetch();
        showFeedback(
          execution.status === 'created'
            ? `${execution.visibilityLabel ?? 'Accounting sync recorded'} for this finance row.`
            : `Accounting sync retry recorded as ${getInvoiceStatusLabel(execution.status).toLowerCase()}.`,
          execution.status === 'failed' ? 'error' : 'success',
        );
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Accounting sync could not be retried.', 'error'),
    },
  );

  useEffect(() => {
    if (!finance?.profile) {
      return;
    }

    setCommissionPercent(finance.profile.commissionPercent);
    setCommissionVatPercent(finance.profile.commissionVatPercent);
    setDeductShippingEnabled(finance.profile.deductShippingEnabled);
    setShippingMode(finance.profile.shippingMode);
    setFixedShippingFee(finance.profile.fixedShippingFee ?? '');
  }, [finance?.profile]);

  async function handleSaveVendorProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextShippingMode = String(formData.get('shippingMode') ?? 'disabled') as VendorProfileFormInput['shippingMode'];

    try {
      await saveProfileMutation.mutateAsync({
        commissionPercent: Number(formData.get('commissionPercent') || 0),
        commissionVatPercent: Number(formData.get('commissionVatPercent') || 0),
        deductShippingEnabled: formData.has('deductShippingEnabled'),
        shippingMode: nextShippingMode,
        fixedShippingFee: String(formData.get('fixedShippingFee') ?? '').trim()
          ? Number(formData.get('fixedShippingFee'))
          : null,
      });
    } catch {
      // The mutation onError handler renders the compact save failure message.
    }
  }

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
    const transactions = finance?.transactions ?? [];
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
    return (finance?.transactions ?? []).filter((record) => {
      const displayStatus = getPayoutActivityStatusLabel(record, financeAudience);
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

      return matchesStatus && matchesCategory && (!query || searchableText.includes(query));
    });
  }, [categoryFilter, currentVendor.vendorId, currentVendor.vendorName, finance?.transactions, financeAudience, searchTerm, statusFilter]);

  const selectedRecord = useMemo(() => {
    const selectedByClick = selectedRecordId ? filteredRecords.find((record) => record.id === selectedRecordId) : null;
    if (selectedByClick) {
      return selectedByClick;
    }
    if (requestedFinanceTarget) {
      return (finance?.transactions ?? []).find((record) => financeRecordMatchesTarget(record, requestedFinanceTarget)) ?? null;
    }
    if (!filteredRecords.length) {
      return null;
    }
    return filteredRecords[0];
  }, [filteredRecords, finance?.transactions, requestedFinanceTarget, selectedRecordId]);
  const shouldLoadInvoiceResponseSummary =
    isAdmin &&
    Boolean(selectedRecord?.invoiceExecution) &&
    ['failed', 'unknown'].includes(selectedRecord?.invoiceExecution?.status ?? '');
  const invoiceResponseSummaryQuery = useQueryResource(
    queryKeys.finance.invoiceResponseSummary(selectedRecord?.invoiceExecution?.id ?? 'none'),
    ({ signal }) => getInvoiceExecutionResponseSummary(selectedRecord!.invoiceExecution!.id, { signal }),
    { enabled: shouldLoadInvoiceResponseSummary },
  );
  const selectedInvoiceCapabilities = getProviderCapabilities(selectedRecord?.invoiceExecution ?? null);
  const invoiceResponseSummary = invoiceResponseSummaryQuery.data?.response ?? null;
  const supportBasePath = isAdmin ? '/admin/support' : '/support';
  const relatedSupportTickets = useMemo(
    () =>
      selectedRecord
        ? (supportTickets ?? []).filter((ticket) =>
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
  const hasSelectedRecordActions =
    Boolean(selectedRecord?.invoiceExecution?.providerPdfUrl) || Boolean(isAdmin && selectedRecord?.category === 'Invoice');
  const selectedOrderSettlementHref = selectedRecord ? buildOrderSettlementHref(selectedRecord) : null;
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
    if (selectedRecord.invoiceExecution && ['failed', 'unknown'].includes(selectedRecord.invoiceExecution.status)) {
      financeRecommendations.push({
        id: `finance-rec-invoice-${selectedRecord.invoiceExecution.id}`,
        type: 'invoice_retry',
        severity: selectedRecord.invoiceExecution.status === 'failed' ? 'critical' : 'warning',
        title: 'Review invoice visibility',
        description: `Customer invoice visibility is ${getInvoiceVisibilityLabel(selectedRecord)} for this finance row.`,
        recommendedAction: 'Review invoice status and retry accounting sync only when safe',
        relatedObjectType: 'Finance row',
        relatedObjectId: selectedRecord.id,
        vendor: {
          id: currentVendor.vendorId,
          name: currentVendor.vendorName,
        },
        createdFromSignal: `finance:${selectedRecord.id}:invoice`,
        deepLink: buildFinanceHref(selectedRecord),
        vendorVisible: false,
        createdAt: selectedRecord.date,
      });
    }

    if (selectedRecord.status === 'Pending' || selectedRecord.settlement?.status === 'held' || selectedRecord.settlement?.status === 'disputed') {
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
    },
    transactions: [],
    profile: {
      vendorId: currentVendor.vendorId,
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: false,
      shippingMode: 'disabled' as const,
      fixedShippingFee: null,
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
            detail: 'Operational preview',
            tone: 'success',
          },
          {
            icon: 'P',
            label: 'Pending review',
            value: financeValueOrUnknown(financeView.summary.pendingPayouts ?? financeView.summary.heldBalance),
            detail: `Includes ${financeView.payoutBatchSummary?.eligibleRowCount ?? 0} estimate rows`,
            tone: 'info',
          },
          {
            icon: 'R',
            label: 'Refund deductions',
            value: formatDeductionValue(financeView.summary.refundsThisMonth ?? financeView.summary.refunds),
            detail: 'This period',
            tone: 'attention',
          },
          {
            icon: 'D',
            label: isVendorUser ? 'Settlement review' : 'Draft payout review',
            value: getUpcomingPayoutLabel(financeView),
            detail: isVendorUser
              ? `${financeView.payoutBatchSummary?.eligibleRowCount ?? 0} rows pending review`
              : getUpcomingPayoutDetail(financeView),
            tone: 'info',
          },
          {
            icon: '!',
            label: 'Needs review',
            value: financeKpis.failed + (financeView.payoutBatchSummary?.blockedRowCount ?? 0),
            detail: 'Action required',
            tone: 'danger',
          },
        ].map((kpi) => (
          <article key={kpi.label} className={`finance-kpi-card op-tone-${kpi.tone}`}>
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
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <FilterBar>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="Estimated">Estimated</option>
                <option value="Pending review">Pending review</option>
                <option value="Approved">Approved</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Refund impact">Refund impact</option>
                <option value="Blocked">Blocked</option>
              </select>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
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
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setCategoryFilter('all');
                }}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>
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
                  title="No finance preview activity in this view"
                  description="Adjust the status, type, or search filters to review settlement estimates."
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
                <p className="page-description">Applies to new payout estimates from now on. Past activity keeps its original rates.</p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Commission" value={`${financeView.profile?.commissionPercent ?? '10.00'}%`} />
                <MetadataRow label="Tax" value={`${financeView.profile?.commissionVatPercent ?? '0.00'}%`} />
                <MetadataRow label="Shipping" value={financeView.profile?.deductShippingEnabled ? 'After fulfillment' : 'Disabled'} />
              </div>
              {isAdmin ? (
                <form className="finance-profile-form" aria-label="Vendor finance profile settings" onSubmit={handleSaveVendorProfile}>
                  <div className="op-form-grid">
                    <label>
                      <span>Commission %</span>
                      <input
                        name="commissionPercent"
                        value={commissionPercent}
                        onChange={(event) => setCommissionPercent(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      <span>Commission VAT %</span>
                      <input
                        name="commissionVatPercent"
                        value={commissionVatPercent}
                        onChange={(event) => setCommissionVatPercent(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      <span>Shipping mode</span>
                      <select name="shippingMode" value={shippingMode} onChange={(event) => setShippingMode(event.target.value as typeof shippingMode)}>
                        <option value="disabled">Disabled</option>
                        <option value="fixed">Fixed</option>
                        <option value="external_provider">External provider</option>
                      </select>
                    </label>
                    <label>
                      <span>Fixed shipping fee</span>
                      <input
                        name="fixedShippingFee"
                        value={fixedShippingFee}
                        onChange={(event) => setFixedShippingFee(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <label className="op-checkbox-row">
                    <input
                      name="deductShippingEnabled"
                      type="checkbox"
                      checked={deductShippingEnabled}
                      onChange={(event) => setDeductShippingEnabled(event.target.checked)}
                    />
                    <span>Deduct shipping after fulfillment</span>
                  </label>
                  <button
                    type="submit"
                    className="button button-primary button-compact"
                    disabled={saveProfileMutation.isPending}
                  >
                    {saveProfileMutation.isPending ? 'Saving...' : 'Save vendor profile'}
                  </button>
                </form>
              ) : (
                <StatusBadge tone="neutral">Read-only vendor profile</StatusBadge>
              )}
            </section>

            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">Settlement review</p>
                <h3>{isVendorUser ? 'Settlement review' : 'Draft payout review'}</h3>
                <p className="page-description">
                  {isVendorUser
                    ? 'A read-only view of estimate rows currently eligible for settlement review.'
                    : 'Prepare eligible estimate rows for review. No payment is executed here.'}
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Rows pending review" value={financeView.payoutBatchSummary?.eligibleRowCount ?? 0} />
                <MetadataRow label="Estimated net" value={financeValueOrUnknown(financeView.payoutBatchSummary?.eligibleNetAmount ?? financeView.summary.payableBalance ?? financeView.summary.payoutEstimate)} />
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
        </div>

        <SideDetailPanel
          eyebrow="Settlement estimate"
          title={selectedRecord?.shopifyOrderNumber ? `Order ${formatShopifyOrderNumber(selectedRecord.shopifyOrderNumber)}` : 'Settlement estimate'}
        >
          {selectedRecord ? (
            <>
              {selectedOrderSettlementHref ? (
                <Link className="button button-secondary button-compact finance-order-settlement-link" to={selectedOrderSettlementHref}>
                  View order settlement
                </Link>
              ) : null}
              <div className="op-detail-status-row">
                <StatusBadge tone={getPayoutActivityTone(selectedRecord, financeAudience)}>{getPayoutActivityStatusLabel(selectedRecord, financeAudience)}</StatusBadge>
                {isAdmin && selectedRecord.category === 'Invoice' ? (
                  <StatusBadge tone={getInvoiceVisibilityTone(selectedRecord.invoiceExecution)}>
                    {getInvoiceVisibilityLabel(selectedRecord)}
                  </StatusBadge>
                ) : null}
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
              {isAdmin ? (
                <div className="finance-detail-card finance-invoice-card">
                  <div className="finance-detail-card-heading">
                    <h4>Customer invoice/accounting</h4>
                    <StatusBadge tone={getInvoiceVisibilityTone(selectedRecord.invoiceExecution)}>
                      {getInvoiceVisibilityLabel(selectedRecord)}
                    </StatusBadge>
                  </div>
                  <div className="finance-detail-rows">
                    <MetadataRow label="Provider" value={getProviderName(selectedRecord.invoiceExecution?.provider)} />
                    <MetadataRow label="Provider status" value={selectedRecord.invoiceExecution?.visibilityLabel ?? 'Not synced'} />
                    <MetadataRow label="Invoice number" value={selectedRecord.invoiceExecution?.providerInvoiceNo ?? 'Not available'} />
                    <MetadataRow
                      label="PDF"
                      value={
                        selectedRecord.invoiceExecution?.providerPdfUrl ? (
                          <a href={selectedRecord.invoiceExecution.providerPdfUrl} target="_blank" rel="noreferrer">PDF available</a>
                        ) : (
                          'Not available'
                        )
                      }
                    />
                    <MetadataRow
                      label="Final invoice state"
                      value={getFinalInvoiceStateLabel(selectedRecord.invoiceExecution?.finalInvoiceState)}
                    />
                    <MetadataRow
                      label="Accounting sync"
                      value={getSyncSemanticsLabel(selectedRecord.invoiceExecution?.syncSemantics)}
                    />
                    <MetadataRow label="Provider note" value={selectedInvoiceCapabilities.note} />
                    {shouldLoadInvoiceResponseSummary ? (
                      <div className="finance-provider-summary" aria-label="Provider issue summary">
                        <strong>Provider issue</strong>
                        {invoiceResponseSummaryQuery.isLoading ? (
                          <span>Loading safe response summary...</span>
                        ) : invoiceResponseSummary ? (
                          <>
                            <span>HTTP: {invoiceResponseSummary.httpStatus ?? 'Unknown'}</span>
                            <span>Content type: {invoiceResponseSummary.contentType ?? 'Unknown'}</span>
                            <span>Keys: {invoiceResponseSummary.bodyKeys.length ? invoiceResponseSummary.bodyKeys.join(', ') : '—'}</span>
                            <span>Provider error: {invoiceResponseSummary.providerError ?? '—'}</span>
                            <span>GUID present: {invoiceResponseSummary.parsedGuidPresent ? 'yes' : 'no'}</span>
                            <span>PDF present: {invoiceResponseSummary.parsedPdfUrlPresent ? 'yes' : 'no'}</span>
                          </>
                        ) : (
                          <span>No provider response summary available.</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
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
                    value={selectedRecord.payoutBatch ? (isVendorUser ? 'Pending review' : 'Draft review artifact') : 'No review scheduled'}
                  />
                </div>
              </div>

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

              {hasSelectedRecordActions ? (
                <div className="finance-detail-card finance-actions-card">
                  <div className="finance-detail-card-heading">
                    <h4>Actions</h4>
                  </div>
                  <OperationalActionGroup>
                    {selectedRecord.invoiceExecution?.providerPdfUrl ? (
                      <a className="button button-secondary button-compact" href={selectedRecord.invoiceExecution.providerPdfUrl} target="_blank" rel="noreferrer">
                        Download PDF
                      </a>
                    ) : null}
                    {isAdmin && selectedRecord.category === 'Invoice' ? (
                      <>
                        <button
                          type="button"
                          className="button button-primary button-compact"
                          disabled={createInvoiceMutation.isPending || Boolean(selectedRecord.invoiceExecution)}
                          onClick={() => createInvoiceMutation.mutate(selectedRecord.id)}
                        >
                          {createInvoiceMutation.isPending ? 'Syncing...' : 'Sync accounting draft'}
                        </button>
                        <button
                          type="button"
                          className="button button-secondary button-compact"
                          disabled={
                            retryInvoiceMutation.isPending ||
                            !selectedRecord.invoiceExecution ||
                            !['failed', 'unknown'].includes(selectedRecord.invoiceExecution.status)
                          }
                          onClick={() => {
                            if (selectedRecord.invoiceExecution) {
                              retryInvoiceMutation.mutate(selectedRecord.invoiceExecution.id);
                            }
                          }}
                        >
                          {retryInvoiceMutation.isPending ? 'Retrying...' : 'Retry accounting sync'}
                        </button>
                      </>
                    ) : null}
                  </OperationalActionGroup>
                </div>
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
