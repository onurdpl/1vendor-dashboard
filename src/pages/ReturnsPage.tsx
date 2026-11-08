import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
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
import { getReturn, listReturns, listReturnStatusOptions, type ReturnsListFilters, type ReturnDetail, type ReturnLineItem, type ReturnSummary } from '../features/returns/api';
import { getAvailableVendors } from '../lib/auth';
import { useAppReadiness } from '../lib/appReadiness';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { SupportTicketModal } from '../components/SupportTicketModal';
import { ProductImagePreview } from '../components/ProductImagePreview';
import { sameNormalizedIdentifier } from '../lib/shopifyIdentifiers';
import { safeArray } from '../services/real/formatting';
import { isTerminalRefundedReturn } from '../lib/returnOperationalState';
import { getReturnWorkflowAction } from '../lib/workflowActionGuidance';
import { getRefundStatusLabel, isApprovedReturn, isClosedReturn, isRefundedReturn, isPendingReturn,
  isRequestedReturn, needsAttention } from '../lib/returnsListFilters';

type ReturnSourceFilter = 'all' | 'pending' | 'refunded';
type ReturnWorkflowTabKey = 'all' | 'requested' | 'needs-action' | 'approved' | 'refunded' | 'closed';
const RETURNS_PAGE_LIMIT = 100;
const RETURN_TARGET_PARAMS = [
  'returnId', 'id', 'return', 'shopifyReturnId', 'sourceShopifyReturnId',
  'refundId', 'shopifyRefundId', 'sourceShopifyRefundId', 'orderId',
  'shopifyOrderId', 'shopifyOrderNumber', 'orderNumber', 'order',
] as const;
type ReturnRowItemCandidate = {
  name?: unknown;
  title?: unknown;
  itemTitle?: unknown;
  displayTitle?: unknown;
  productTitle?: unknown;
  productName?: unknown;
  lineItemTitle?: unknown;
  orderLineItemTitle?: unknown;
  merchandiseTitle?: unknown;
  merchandiseName?: unknown;
  variantTitle?: unknown;
  variant?: unknown;
  optionTitle?: unknown;
  options?: unknown;
  sku?: unknown;
  imageUrl?: unknown;
  product?: ReturnRowItemCandidate;
  merchandise?: ReturnRowItemCandidate & { product?: ReturnRowItemCandidate };
  lineItem?: ReturnRowItemCandidate;
  orderLineItem?: ReturnRowItemCandidate;
  shopifyOrderLineItem?: ReturnRowItemCandidate;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatTableRequestedDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

  return `${datePart} · ${timePart}`;
}

function getVendorReason(reason: string | null | undefined, fallback = 'Return requested') {
  const value = reason?.trim();
  if (!value) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (
    normalized.includes('webhook') ||
    normalized.includes('backend') ||
    normalized.includes('allocation') ||
    normalized.includes('lifecycle') ||
    normalized.includes('shopify return request') ||
    normalized.includes('shopify refund')
  ) {
    return fallback;
  }

  return value;
}

function getVendorStatusLabel(item: ReturnSummary) {
  const normalized = item.status?.toLowerCase() ?? '';
  if (item.sourceType === 'shopify_return_request' && normalized === 'requested') {
    return 'Awaiting review';
  }
  if (normalized === 'processed' || normalized === 'refunded') {
    return 'Refunded';
  }
  if (normalized === 'pending' || normalized === 'in review') {
    return 'Under review';
  }
  return item.status || 'Unknown';
}

function getStatusTone(item: ReturnSummary) {
  const normalized = item.status?.toLowerCase() ?? '';
  if (item.sourceType === 'shopify_return_request' && normalized === 'requested') {
    return 'attention' as const;
  }
  if (normalized === 'approved' || normalized === 'processed' || normalized === 'closed' || normalized === 'refunded') {
    return 'success' as const;
  }
  if (normalized === 'declined' || normalized === 'cancelled' || normalized === 'rejected') {
    return 'danger' as const;
  }
  if (normalized === 'pending' || normalized === 'in review') {
    return 'attention' as const;
  }
  return 'info' as const;
}

function getVendorName(vendorId: string, vendorLookup: Map<string, string>) {
  return vendorLookup.get(vendorId) ?? vendorId;
}

function getVariantText(value: string | null | undefined) {
  const text = value?.trim();
  const normalized = text?.toLowerCase();
  if (
    !text ||
    text === 'Details pending' ||
    normalized === 'default' ||
    normalized === 'default title' ||
    text === 'Return item'
  ) {
    return '';
  }

  if (/^(gid:\/\/|sku[-_:]|unknown-sku)/i.test(text) || /^\d{6,}$/.test(text)) {
    return '';
  }

  return text;
}

function getSkuText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || /^unknown-sku$/i.test(text)) {
    return '—';
  }

  return text;
}

function getItemTitleFallback(sku?: string | null) {
  return getSkuText(sku) === '—' ? 'Unknown item' : getSkuText(sku);
}

function readText(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const text = value.trim();
  const normalized = text.toLowerCase();
  if (
    !text ||
    text === 'Return item' ||
    normalized === 'default' ||
    normalized === 'default title' ||
    /^gid:\/\//i.test(text) ||
    /^unknown-sku$/i.test(text)
  ) {
    return '';
  }

  return text;
}

function readProductText(value: unknown, sku?: string | null) {
  const text = readText(value)
    .replace(/\s*\/\s*default(?:\s+title)?$/i, '')
    .trim();
  const normalizedSku = readText(sku);
  if (!text || (normalizedSku && text === normalizedSku) || /^\d{6,}$/.test(text)) {
    return '';
  }

  return text;
}

function readFirstText(...values: unknown[]) {
  return values.map(readText).find(Boolean) ?? '';
}

function readFirstProductText(sku: string | null | undefined, ...values: unknown[]) {
  return values.map((value) => readProductText(value, sku)).find(Boolean) ?? '';
}

function getItemInitials(value: string | null | undefined) {
  const [first = '', second = ''] = (value ?? 'Item').trim().split(/\s+/);
  return `${first[0] ?? 'I'}${second[0] ?? ''}`.toUpperCase();
}

function readImageUrl(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function resolveCandidateTitle(item: ReturnRowItemCandidate) {
  return readFirstProductText(
    readText(item.sku),
    item.displayTitle,
    item.itemTitle,
    item.productTitle,
    item.productName,
    item.product?.title,
    item.product?.name,
    item.lineItemTitle,
    item.lineItem?.productTitle,
    item.lineItem?.productName,
    item.lineItem?.title,
    item.lineItem?.name,
    item.orderLineItemTitle,
    item.orderLineItem?.productTitle,
    item.orderLineItem?.productName,
    item.orderLineItem?.title,
    item.orderLineItem?.name,
    item.shopifyOrderLineItem?.productTitle,
    item.shopifyOrderLineItem?.productName,
    item.shopifyOrderLineItem?.title,
    item.shopifyOrderLineItem?.name,
    item.merchandiseTitle,
    item.merchandiseName,
    item.merchandise?.product?.title,
    item.merchandise?.product?.name,
    item.merchandise?.title,
    item.merchandise?.name,
    item.title,
    item.name,
    item.variantTitle,
    item.variant,
    item.optionTitle,
  );
}

function resolveCandidateVariant(item: ReturnRowItemCandidate) {
  return readFirstText(item.variantTitle, item.variant, item.optionTitle, item.options);
}

function getItemPreview(summary: ReturnSummary, detail: ReturnDetail | null) {
  const detailItems = detail?.refundedItems ?? [];
  if (detailItems.length > 0) {
    return detailItems.map((item) => ({
      sku: item.sku,
      title: readProductText(item.name, item.sku) || readProductText(item.variantTitle, item.sku) || getItemTitleFallback(item.sku),
      variantTitle: getVariantText(item.variantTitle),
      imageUrl: item.imageUrl ?? null,
      quantity: item.quantity,
      amount: item.refundAmount,
      condition: item.condition,
    }));
  }

  const summaryItems = summary.refundedItems ?? [];
  if (summaryItems.length > 0) {
    return summaryItems.map((item) => ({
      sku: item.sku,
      title: resolveCandidateTitle(item as ReturnRowItemCandidate) || getItemTitleFallback(item.sku),
      variantTitle: getVariantText(resolveCandidateVariant(item as ReturnRowItemCandidate)),
      imageUrl: item.imageUrl ?? null,
      quantity: item.quantity,
      amount: item.refundAmount,
      condition: item.condition,
    }));
  }

  return (summary.refundedSkus ?? []).map((sku) => ({
    sku,
    title: getItemTitleFallback(sku),
    variantTitle: 'Details pending',
    imageUrl: null,
    quantity: 1,
    amount: summary.sourceType === 'shopify_return_request' ? 'Not posted' : summary.amount,
    condition: 'Opened' as ReturnLineItem['condition'],
  }));
}

function getTableItemDisplay(summary: ReturnSummary) {
  const firstSummaryItem = summary.refundedItems?.[0];
  const sku = firstSummaryItem?.sku ?? summary.refundedSkus?.[0] ?? null;
  const title =
    readFirstProductText(sku, summary.displayTitle, summary.itemTitle) ||
    (firstSummaryItem ? resolveCandidateTitle(firstSummaryItem as ReturnRowItemCandidate) : '') ||
    getItemTitleFallback(sku);
  const variant = getVariantText(summary.variantTitle) ||
    (firstSummaryItem ? getVariantText(resolveCandidateVariant(firstSummaryItem as ReturnRowItemCandidate)) : '');

  return {
    title,
    variant: variant === title ? '' : variant,
    sku: getSkuText(sku),
  };
}

function getReturnedItemCount(summary: ReturnSummary) {
  const explicitCount = (summary as ReturnSummary & { refundedItemCount?: unknown }).refundedItemCount;
  if (typeof explicitCount === 'number' && explicitCount > 0) {
    return explicitCount;
  }
  if (typeof explicitCount === 'string') {
    const parsedCount = Number.parseInt(explicitCount, 10);
    if (parsedCount > 0) {
      return parsedCount;
    }
  }
  if (summary.refundedItems?.length) {
    return summary.refundedItems.length;
  }
  if (summary.refundedSkus?.length) {
    return summary.refundedSkus.length;
  }
  return 1;
}

function formatReturnedItemCount(count: number) {
  return `${count} item${count === 1 ? '' : 's'} returned`;
}

function getTableReturnedItems(summary: ReturnSummary) {
  const summaryItems = summary.refundedItems ?? [];
  if (summaryItems.length > 0) {
    return summaryItems.map((item) => {
      const candidate = item as ReturnRowItemCandidate;
      const sku = getSkuText(item.sku);
      const title = resolveCandidateTitle(candidate) || getItemTitleFallback(item.sku);
      const variant = getVariantText(resolveCandidateVariant(candidate));
      return {
        title,
        variant: variant === title ? '' : variant,
        sku,
      };
    });
  }

  return [getTableItemDisplay(summary)];
}

function getReturnedItemTitleText(item: ReturnType<typeof getTableReturnedItems>[number]) {
  return [item.title, item.variant].filter(Boolean).join(' / ');
}

function getReturnedItemSkuText(item: ReturnType<typeof getTableReturnedItems>[number]) {
  return item.sku !== '—' ? `SKU: ${item.sku}` : '';
}

function getVendorTimelineLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('requested') || normalized.includes('return')) {
    return 'Return requested';
  }
  if (normalized.includes('closed')) {
    return 'Closed';
  }
  if (normalized.includes('received') || normalized.includes('delivered')) {
    return 'Received by vendor';
  }
  if (normalized.includes('approved')) {
    return 'Approved by vendor';
  }
  if (normalized.includes('refund')) {
    return 'Refund processed';
  }
  if (normalized.includes('pending') || normalized.includes('review')) {
    return 'Vendor reviewed';
  }
  return '';
}

function buildTimeline(summary: ReturnSummary, detail: ReturnDetail | null) {
  const terminalRefundedReturn = isTerminalRefundedReturn({
    status: detail?.status ?? summary.status,
    returnLifecycleStatus: detail?.returnLifecycleStatus ?? summary.returnLifecycleStatus,
    sourceType: detail?.sourceType ?? summary.sourceType,
    refundStatus: getRefundStatusLabel(detail ?? summary),
    sourceShopifyRefundId: detail?.sourceShopifyRefundId ?? summary.sourceShopifyRefundId,
    vendorReceivedAt: detail?.vendorReceivedAt ?? summary.vendorReceivedAt,
    vendorReviewedAt: detail?.vendorReviewedAt ?? summary.vendorReviewedAt,
    vendorDecision: detail?.vendorDecision ?? summary.vendorDecision,
    refundedItems: detail?.refundedItems ?? summary.refundedItems,
  });

  if (terminalRefundedReturn) {
    const terminalItems = [
      {
        label: 'Return requested',
        at: formatDate(summary.date),
        rawAt: summary.date,
        enabled: Boolean(summary.date),
      },
      {
        label: 'Received by vendor',
        at: formatDate(detail?.vendorReceivedAt ?? summary.vendorReceivedAt),
        rawAt: detail?.vendorReceivedAt ?? summary.vendorReceivedAt,
        enabled: Boolean(detail?.vendorReceivedAt ?? summary.vendorReceivedAt),
      },
      {
        label: 'Approved by vendor',
        at: formatDate(detail?.vendorReviewedAt ?? summary.vendorReviewedAt),
        rawAt: detail?.vendorReviewedAt ?? summary.vendorReviewedAt,
        enabled: Boolean((detail?.vendorReviewedAt ?? summary.vendorReviewedAt) && (detail?.vendorDecision ?? summary.vendorDecision)),
      },
      {
        label: 'Refund processed',
        at: formatDate(detail?.updatedAt ?? summary.updatedAt ?? summary.date),
        rawAt: detail?.updatedAt ?? summary.updatedAt ?? summary.date,
        enabled: Boolean(detail?.sourceShopifyRefundId ?? summary.sourceShopifyRefundId),
      },
      {
        label: 'Closed',
        at: formatDate(detail?.updatedAt ?? summary.updatedAt ?? summary.date),
        rawAt: detail?.updatedAt ?? summary.updatedAt ?? summary.date,
        enabled: true,
      },
    ];

    return terminalItems
      .filter((item) => item.enabled)
      .map(({ label, at }) => ({ label, at }));
  }

  const detailTimeline = detail?.timeline ?? [];
  if (detailTimeline.length > 0) {
    const seenLabels = new Set<string>();
    const items = detailTimeline
      .map((item) => ({
        label: getVendorTimelineLabel(item.label),
        at: formatDate(item.at),
      }))
      .filter((item) => {
        if (!item.label || seenLabels.has(item.label)) {
          return false;
        }
        seenLabels.add(item.label);
        return true;
      });

    if (items.length > 0) {
      return items;
    }
  }

  return [
    {
      label: summary.sourceType === 'shopify_return_request' ? 'Return requested' : 'Refund approved',
      at: formatDate(summary.date),
    },
    {
      label: summary.sourceType === 'shopify_return_request' ? 'Vendor reviewed' : 'Refund approved',
      at: formatDate(summary.updatedAt ?? summary.date),
    },
  ];
}

function getReturnShipment(summary: ReturnSummary, detail: ReturnDetail | null) {
  return {
    carrierName: detail?.returnCarrierName ?? summary.returnCarrierName ?? null,
    trackingNumber: detail?.returnTrackingNumber ?? summary.returnTrackingNumber ?? null,
    trackingUrl: detail?.returnTrackingUrl ?? summary.returnTrackingUrl ?? null,
  };
}

function returnMatchesTarget(item: ReturnSummary, target: string | null) {
  if (!target) {
    return false;
  }

  return (
    sameNormalizedIdentifier(item.id, target) ||
    sameNormalizedIdentifier(item.relatedOrderId, target) ||
    sameNormalizedIdentifier(item.sourceShopifyOrderId, target) ||
    sameNormalizedIdentifier(item.sourceShopifyRefundId, target) ||
    sameNormalizedIdentifier(item.sourceShopifyReturnId, target) ||
    sameNormalizedIdentifier(item.sourceShopifyReturnGid, target) ||
    sameNormalizedIdentifier(item.sourceShopifyOrderNumber, target)
  );
}

function getReturnsWorkflowFilter(workflow: string | null) {
  if (workflow === 'pending-review' || workflow === 'needs-action') {
    return {
      key: 'needs-action' as ReturnWorkflowTabKey,
      label: 'Needs Action',
      description: 'Received returns needing review',
      emptyTitle: 'No received returns need action',
      emptyDescription: 'Received returns that still need approval, rejection, or processing will appear here.',
      matches: needsAttention,
    };
  }
  if (workflow === 'requested') {
    return {
      key: 'requested' as ReturnWorkflowTabKey,
      label: 'Requested',
      description: 'Showing return requests waiting for product arrival.',
      emptyTitle: 'No requested returns',
      emptyDescription: 'Customer return requests will appear here until the product arrives back to the vendor.',
      matches: isRequestedReturn,
    };
  }
  if (workflow === 'approved') {
    return {
      key: 'approved' as ReturnWorkflowTabKey,
      label: 'Approved',
      description: 'Showing approved returns.',
      emptyTitle: 'No approved returns',
      emptyDescription: 'Approved returns will appear here when vendor review is complete.',
      matches: isApprovedReturn,
    };
  }
  if (workflow === 'refunded') {
    return {
      key: 'refunded' as ReturnWorkflowTabKey,
      label: 'Refunded',
      description: 'Showing refunded and completed return records.',
      emptyTitle: 'No refunded returns',
      emptyDescription: 'Refunded returns will appear here after refund evidence is recorded.',
      matches: isRefundedReturn,
    };
  }
  if (workflow === 'closed') {
    return {
      key: 'closed' as ReturnWorkflowTabKey,
      label: 'Closed',
      description: 'Showing closed, cancelled, declined, or rejected returns.',
      emptyTitle: 'No closed returns',
      emptyDescription: 'Closed return records will appear here when return work is complete without a refund.',
      matches: isClosedReturn,
    };
  }
  return null;
}

export function ReturnsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const currentVendor = appReadiness.currentVendor;
  const authContextReady = appReadiness.ready;
  const [searchTerm, setSearchTerm] = useState('');
  const requestedReturnTarget = RETURN_TARGET_PARAMS.map((name) => searchParams.get(name)).find(Boolean) ?? null;
  const workflowParam = searchParams.get('workflow');
  const activeWorkflowFilter = useMemo(() => getReturnsWorkflowFilter(workflowParam), [workflowParam]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<ReturnSourceFilter>('all');
  const [vendorFilterState, setVendorFilterState] = useState({ vendorId: currentVendor.vendorId, value: 'all' });
  const vendorFilter = vendorFilterState.vendorId === currentVendor.vendorId ? vendorFilterState.value : 'all';
  const serverFilters: ReturnsListFilters = {
    workflow: activeWorkflowFilter?.key === 'all' ? undefined : activeWorkflowFilter?.key,
    status: statusFilter === 'all' ? undefined : statusFilter,
    source: sourceFilter === 'all' ? undefined : sourceFilter,
  };
  const serverSearch = requestedReturnTarget ?? searchTerm.trim();
  const pageScope = JSON.stringify([currentVendor.vendorId, workflowParam, serverSearch, statusFilter, sourceFilter, vendorFilter]);
  const [pageState, setPageState] = useState({ scope: pageScope, page: 0 });
  const page = pageState.scope === pageScope ? pageState.page : 0;
  useEffect(() => {
    if (pageState.scope !== pageScope) setPageState({ scope: pageScope, page: 0 });
  }, [pageScope, pageState.scope]);
  const { data: returns, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.returns.list(currentVendor.vendorId, {
      limit: RETURNS_PAGE_LIMIT + 1, offset: page * RETURNS_PAGE_LIMIT, search: serverSearch, ...serverFilters,
    }),
    ({ signal }) => listReturns({ vendorId: currentVendor.vendorId,
      limit: RETURNS_PAGE_LIMIT + 1, offset: page * RETURNS_PAGE_LIMIT, search: serverSearch, ...serverFilters, signal }),
    { enabled: authContextReady && Boolean(currentVendor.vendorId), placeholderData: () => undefined },
  );
  const { data: statusOptions, isLoading: statusOptionsLoading, isError: statusOptionsError,
    error: statusOptionsErrorMessage, refetch: retryStatusOptions } = useQueryResource(
    queryKeys.returns.statusOptions(currentVendor.vendorId),
    ({ signal }) => listReturnStatusOptions({ vendorId: currentVendor.vendorId, signal }),
    { enabled: authContextReady && Boolean(currentVendor.vendorId), placeholderData: () => undefined },
  );
  const returnsMissingVendorContext = appReadiness.status === 'missing_vendor_context';
  const returnsWaitingForVendorContext = !returnsMissingVendorContext && (!authContextReady || !currentVendor.vendorId);
  const [selectedReturnTarget, setSelectedReturnTarget] = useState<{ vendorId: string; id: string } | null>(null);
  const [supportTarget, setSupportTarget] = useState<{ vendorId: string; id: string } | null>(null);
  const visibleReturns = useMemo(() => authContextReady && currentVendor.vendorId
    ? safeArray(returns).slice(0, RETURNS_PAGE_LIMIT)
    : [], [authContextReady, currentVendor.vendorId, returns]);
  const hasNextPage = authContextReady && safeArray(returns).length > RETURNS_PAGE_LIMIT;
  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    setSelectedReturnTarget(null);
  }, [requestedReturnTarget]);

  useEffect(() => {
    setSelectedReturnTarget(null);
    setSupportTarget(null);
    setVendorFilterState({ vendorId: currentVendor.vendorId, value: 'all' });
  }, [currentVendor.vendorId]);

  function clearWorkflowFilter() {
    if (!searchParams.has('workflow')) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('workflow');
    setSearchParams(nextParams, { replace: true });
  }

  function setWorkflowTab(workflow: ReturnWorkflowTabKey) {
    const nextParams = new URLSearchParams(searchParams);
    if (workflow === 'all') {
      nextParams.delete('workflow');
    } else if (workflow === 'needs-action') {
      nextParams.set('workflow', 'pending-review');
    } else {
      nextParams.set('workflow', workflow);
    }
    setSearchParams(nextParams, { replace: true });
  }

  function handleResetFilters() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('workflow');
    for (const key of RETURN_TARGET_PARAMS) nextParams.delete(key);
    if (nextParams.toString() !== searchParams.toString()) setSearchParams(nextParams, { replace: true });
    setSearchTerm('');
    setStatusFilter('all');
    setVendorFilterState({ vendorId: currentVendor.vendorId, value: 'all' });
    setSourceFilter('all');
  }

  const vendorLookup = useMemo(() => {
    return new Map(getAvailableVendors().map((vendor) => [vendor.vendorId, vendor.vendorName] as const));
  }, []);
  const effectiveSourceFilter = sourceFilter;

  const filteredReturns = useMemo(() => {
    return visibleReturns.filter((item) => vendorFilter === 'all' || item.assignedVendorId === vendorFilter);
  }, [visibleReturns, vendorFilter]);

  const selectedReturn = useMemo(() => {
    const returnList = visibleReturns;
    if (!returnList.length) {
      return null;
    }
    const selectedByClick = selectedReturnTarget?.vendorId === currentVendor.vendorId
      ? returnList.find((item) => item.id === selectedReturnTarget.id) : null;
    if (selectedByClick) {
      return selectedByClick;
    }
    if (requestedReturnTarget) {
      return returnList.find((item) => returnMatchesTarget(item, requestedReturnTarget)) ?? null;
    }
    return filteredReturns[0] ?? null;
  }, [currentVendor.vendorId, filteredReturns, requestedReturnTarget, visibleReturns, selectedReturnTarget]);

  const detailQuery = useQueryResource(
    selectedReturn ? queryKeys.returns.detail(selectedReturn.id, currentVendor.vendorId) : ['returns', 'detail', currentVendor.vendorId, 'empty'],
    ({ signal }) => {
      if (!selectedReturn) {
        throw new Error('Return not selected.');
      }

      return getReturn(selectedReturn.id, { vendorId: currentVendor.vendorId, signal });
    },
    {
      enabled: authContextReady && Boolean(selectedReturn),
      placeholderData: () => undefined,
    },
  );
  const selectedDetail = selectedReturn && detailQuery.data?.id === selectedReturn.id
    && detailQuery.data.assignedVendorId === currentVendor.vendorId ? detailQuery.data : null;

  const returnRows = visibleReturns;
  const requestedCount = returnRows.filter(isRequestedReturn).length;
  const approvedCount = returnRows.filter(isApprovedReturn).length;
  const processedCount = returnRows.filter(isRefundedReturn).length;
  const attentionCount = returnRows.filter(needsAttention).length;
  const closedCount = returnRows.filter(isClosedReturn).length;
  const statuses = safeArray(statusOptions);
  const vendors = Array.from(new Set(returnRows.map((item) => item.assignedVendorId)));
  const workflowTabs: Array<{
    key: ReturnWorkflowTabKey;
    label: string;
    description: string;
    count: number;
  }> = [
    {
      key: 'all',
      label: 'All',
      description: 'Current page',
      count: returnRows.length,
    },
    {
      key: 'requested',
      label: 'Requested',
      description: 'Awaiting arrival',
      count: requestedCount,
    },
    {
      key: 'needs-action',
      label: 'Needs Action',
      description: 'Review required',
      count: attentionCount,
    },
    {
      key: 'approved',
      label: 'Approved',
      description: 'Vendor reviewed',
      count: approvedCount,
    },
    {
      key: 'refunded',
      label: 'Refunded',
      description: 'Refund complete',
      count: processedCount,
    },
    {
      key: 'closed',
      label: 'Closed',
      description: 'No active review',
      count: closedCount,
    },
  ];
  const activeWorkflowKey = activeWorkflowFilter?.key ?? 'all';
  const selectedItems = selectedReturn ? getItemPreview(selectedReturn, selectedDetail) : [];
  const selectedShipment = selectedReturn ? getReturnShipment(selectedReturn, selectedDetail ?? null) : null;
  const hasReturnShipment = Boolean(
    selectedShipment?.carrierName || selectedShipment?.trackingNumber || selectedShipment?.trackingUrl,
  );
  const supportSnapshot = selectedReturn
    ? {
        route: location.pathname,
        orderNumber: formatShopifyOrderNumber(selectedReturn.sourceShopifyOrderNumber),
        returnStatus: getVendorStatusLabel(selectedReturn),
        refundStatus: getRefundStatusLabel(selectedReturn),
        itemTitle: selectedItems[0]?.title ?? null,
        sku: selectedItems[0]?.sku ?? null,
        returnTrackingPresent: Boolean(selectedShipment?.trackingNumber || selectedShipment?.trackingUrl),
      }
    : null;
  return (
    <section className="op-page returns-control-center">
      <div className="op-page-heading returns-compact-heading">
        <div>
          <p className="eyebrow">Returns</p>
          <h2>Return requests</h2>
        </div>
      </div>

      <div className="orders-workflow-tabs returns-workflow-tabs" aria-label="Returns workflow tabs">
        {workflowTabs.map((tab) => {
          const isActive = activeWorkflowKey === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={isActive ? 'is-active' : ''}
              aria-pressed={isActive}
              onClick={() => setWorkflowTab(tab.key)}
            >
              <span>{tab.label}</span>
              <strong>{tab.count} on page</strong>
              <small>{tab.description}</small>
            </button>
          );
        })}
      </div>

      {currentUser?.role !== 'vendor' ? (
        <div className="returns-status-row" aria-label="Return workspace status">
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
        </div>
      ) : null}

      <div className="op-control-layout returns-control-layout">
        <div className="op-main-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search returns by order, return #, customer or SKU..."
              maxLength={100}
              value={searchTerm}
              onChange={(event) => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('workflow');
                for (const key of RETURN_TARGET_PARAMS) nextParams.delete(key);
                if (nextParams.toString() !== searchParams.toString()) setSearchParams(nextParams, { replace: true });
                setSearchTerm(event.target.value);
              }}
            />
            <FilterBar>
              <select
                value={statusFilter}
                disabled={statusOptionsLoading || statusOptionsError}
                onChange={(event) => {
                  clearWorkflowFilter();
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="all">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select
                value={effectiveSourceFilter}
                onChange={(event) => {
                  clearWorkflowFilter();
                  setSourceFilter(event.target.value as ReturnSourceFilter);
                }}
              >
                <option value="all">All returns</option>
                <option value="pending">Pending returns</option>
                <option value="refunded">Refunds completed</option>
              </select>
              {isAdmin ? (
                <select
                  value={vendorFilter}
                  onChange={(event) => {
                    clearWorkflowFilter();
                    setVendorFilterState({ vendorId: currentVendor.vendorId, value: event.target.value });
                  }}
                >
                  <option value="all">All vendors on this page</option>
                  {vendors.map((vendorId) => (
                    <option key={vendorId} value={vendorId}>
                      {getVendorName(vendorId, vendorLookup)}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className="button button-secondary"
                onClick={handleResetFilters}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>
          <p>Workflow, status, source and search filter the selected Vendor's full Returns dataset before pagination.</p>
          {statusOptionsError ? <SectionErrorRetry title="Return statuses unavailable"
            description={statusOptionsErrorMessage ?? 'Unable to load return statuses.'}
            onRetry={() => void retryStatusOptions()} /> : null}

          <OperationalTable
            columns={[
              'Order',
              'Returned items',
              'Return status',
              'Requested',
              'Action',
            ]}
            className="returns-op-table returns-op-table-v2"
          >
            {isError && !returns ? (
              <OperationalTableRow>
                <SectionErrorRetry
                  title="Returns unavailable"
                  description={error ?? 'Unable to load returns.'}
                  onRetry={() => void refetch()}
                />
              </OperationalTableRow>
            ) : returnsMissingVendorContext ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title="Select vendor"
                  description="No vendor context available. Choose a vendor context before loading vendor-scoped returns."
                />
              </OperationalTableRow>
            ) : returnsWaitingForVendorContext ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title="Waiting for vendor context"
                  description="Returns will load after the authenticated vendor scope is ready."
                />
              </OperationalTableRow>
            ) : isLoading ? (
              <TableSkeletonRows columns={5} rows={5} />
            ) : filteredReturns.length === 0 ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title={activeWorkflowFilter?.emptyTitle ?? 'No returns match this view'}
                  description={visibleReturns.length === 0 && page === 0 && serverSearch && !serverFilters.workflow && !serverFilters.status && !serverFilters.source
                    ? 'No returns match this search for the selected Vendor.'
                    : visibleReturns.length === 0 && page === 0 && (serverSearch || serverFilters.workflow || serverFilters.status || serverFilters.source)
                      ? 'No returns match these filters for the selected Vendor.'
                      : visibleReturns.length === 0
                        ? 'No returns on this page.'
                        : 'No returns match the vendors on this page.'}
                />
              </OperationalTableRow>
            ) : filteredReturns.map((item) => {
                const isSelected = selectedReturn?.id === item.id;
                const itemCount = getReturnedItemCount(item);
                const tableItems = getTableReturnedItems(item);
                const visibleItems = tableItems.slice(0, 2);
                const hiddenItemCount = Math.max(itemCount - visibleItems.length, 0);
                const requestedAt = formatTableRequestedDate(item.date);
                return (
                  <OperationalTableRow
                    key={item.id}
                    selected={isSelected}
                    onSelect={() => setSelectedReturnTarget({ vendorId: currentVendor.vendorId, id: item.id })}
                  >
                    <span className="returns-order-cell">
                      <strong>{formatShopifyOrderNumber(item.sourceShopifyOrderNumber)}</strong>
                      {currentUser?.role !== 'vendor' ? <small>{getVendorName(item.assignedVendorId, vendorLookup)}</small> : null}
                      <small>{formatReturnedItemCount(itemCount)}</small>
                    </span>
                    <div className="return-items-preview">
                      {visibleItems.map((returnedItem, index) => (
                        <div key={`${returnedItem.sku}-${returnedItem.title}-${index}`} className="return-item-preview-line">
                          <span>
                            <strong>{getReturnedItemTitleText(returnedItem)}</strong>
                            {getReturnedItemSkuText(returnedItem) ? <small>{getReturnedItemSkuText(returnedItem)}</small> : null}
                          </span>
                        </div>
                      ))}
                      {hiddenItemCount > 0 ? <small className="return-item-extra">+{hiddenItemCount} more items</small> : null}
                    </div>
                    <span>
                      <StatusBadge tone={getStatusTone(item)}>{getVendorStatusLabel(item)}</StatusBadge>
                    </span>
                    <span className="returns-requested-cell">{requestedAt}</span>
                    <OperationalActionGroup>
                      <Link
                        to={`/returns/${item.id}`}
                        className="button button-ghost button-link returns-row-action"
                        aria-label={`Open detail for return order ${formatShopifyOrderNumber(item.sourceShopifyOrderNumber)}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        Open detail
                      </Link>
                    </OperationalActionGroup>
                  </OperationalTableRow>
                );
              })}
          </OperationalTable>
          {!returnsWaitingForVendorContext && !returnsMissingVendorContext && !isError && !isLoading ? (
            <nav aria-label="Returns pages">
              <button type="button" disabled={page === 0} onClick={() => setPageState({ scope: pageScope, page: page - 1 })}>Previous</button>
              <span>Page {page + 1} · {visibleReturns.length} {visibleReturns.length === 1 ? 'return' : 'returns'} on this page</span>
              <button type="button" disabled={!hasNextPage} onClick={() => setPageState({ scope: pageScope, page: page + 1 })}>Next</button>
            </nav>
          ) : null}
        </div>

        <SideDetailPanel
          eyebrow="Return summary"
          title={selectedReturn ? `Order ${formatShopifyOrderNumber(selectedReturn.sourceShopifyOrderNumber)}` : 'No return selected'}
          action={
            selectedReturn ? (
              <StatusBadge tone={getStatusTone(selectedReturn)}>{getVendorStatusLabel(selectedReturn)}</StatusBadge>
            ) : null
          }
        >
          {selectedReturn ? (
            (() => {
              const terminalRefundedReturn = isTerminalRefundedReturn({
                status: selectedDetail?.status ?? selectedReturn.status,
                returnLifecycleStatus: selectedDetail?.returnLifecycleStatus ?? selectedReturn.returnLifecycleStatus,
                sourceType: selectedDetail?.sourceType ?? selectedReturn.sourceType,
                refundStatus: getRefundStatusLabel(selectedDetail ?? selectedReturn),
                sourceShopifyRefundId: selectedDetail?.sourceShopifyRefundId ?? selectedReturn.sourceShopifyRefundId,
                vendorReceivedAt: selectedDetail?.vendorReceivedAt ?? selectedReturn.vendorReceivedAt,
                vendorReviewedAt: selectedDetail?.vendorReviewedAt ?? selectedReturn.vendorReviewedAt,
                vendorDecision: selectedDetail?.vendorDecision ?? selectedReturn.vendorDecision,
                refundedItems: selectedDetail?.refundedItems ?? selectedReturn.refundedItems,
              });
              const workflowGuidance = getReturnWorkflowAction({
                status: selectedDetail?.status ?? selectedReturn.status,
                returnLifecycleStatus: selectedDetail?.returnLifecycleStatus ?? selectedReturn.returnLifecycleStatus,
                sourceType: selectedDetail?.sourceType ?? selectedReturn.sourceType,
                vendorReceivedAt: selectedDetail?.vendorReceivedAt ?? selectedReturn.vendorReceivedAt,
                vendorReviewedAt: selectedDetail?.vendorReviewedAt ?? selectedReturn.vendorReviewedAt,
                vendorDecision: selectedDetail?.vendorDecision ?? selectedReturn.vendorDecision,
                refundStatus: getRefundStatusLabel(selectedDetail ?? selectedReturn),
                sourceShopifyRefundId: selectedDetail?.sourceShopifyRefundId ?? selectedReturn.sourceShopifyRefundId,
                refundedItems: selectedDetail?.refundedItems ?? selectedReturn.refundedItems,
              });
              const actionLabel = terminalRefundedReturn ? 'Return completed' : workflowGuidance.actionLabel;
              const actionDescription = terminalRefundedReturn
                ? 'Refund is complete. No vendor action is required.'
                : workflowGuidance.description;
              const actionTone = terminalRefundedReturn ? 'success' : workflowGuidance.tone;

              return (
            <>
              <div className="returns-summary-card returns-summary-card-compact">
                <h4>Summary</h4>
                <div className="returns-summary-grid-v2">
                  <div>
                    <span>Requested</span>
                    <strong>{formatDate(selectedReturn.date)}</strong>
                  </div>
                  <div>
                    <span>Return status</span>
                    <strong>{getVendorStatusLabel(selectedReturn)}</strong>
                  </div>
                  <div>
                    <span>Refund status</span>
                    <strong>{getRefundStatusLabel(selectedReturn)}</strong>
                  </div>
                  <div>
                    <span>Reason</span>
                    <strong>{getVendorReason(selectedReturn.reason)}</strong>
                  </div>
                  {getVendorReason(selectedReturn.returnReasonNote, '') ? (
                    <div>
                      <span>Note</span>
                      <strong>{getVendorReason(selectedReturn.returnReasonNote, '')}</strong>
                    </div>
                  ) : null}
                </div>
              </div>

              {hasReturnShipment && selectedShipment ? (
                <div className="op-panel-section returns-shipment-card">
                  <h4>Return shipment</h4>
                  <div className="returns-summary-grid-v2">
                    <div>
                      <span>Carrier</span>
                      <strong>{selectedShipment.carrierName ?? 'Not provided'}</strong>
                    </div>
                    <div>
                      <span>Tracking</span>
                      {selectedShipment.trackingUrl ? (
                        <a href={selectedShipment.trackingUrl} target="_blank" rel="noreferrer">
                          {selectedShipment.trackingNumber ?? 'Open tracking'}
                        </a>
                      ) : (
                        <strong>{selectedShipment.trackingNumber ?? 'Not provided'}</strong>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="op-panel-section">
                <h4>Returned items</h4>
                <div className="return-detail-items return-detail-items-compact">
                  {selectedItems.length > 0 ? (
                    selectedItems.map((item) => (
                      <article key={`${item.sku}-${item.title}-${item.variantTitle}`} className="return-detail-item">
                        <ProductImagePreview
                          imageUrl={readImageUrl(item.imageUrl)}
                          fallbackLabel={getItemInitials(item.title || item.sku)}
                          alt={item.title ? `${item.title} product image` : 'Returned item product image'}
                          title={item.title || item.sku || 'Returned item'}
                          subtitle={[getSkuText(item.sku), item.variantTitle].filter((value) => value && value !== '—').join(' · ')}
                          size="sidebar"
                        />
                        <div className="return-detail-item-copy">
                          <strong>{item.title}</strong>
                          <small>
                            SKU {getSkuText(item.sku)}
                            {item.variantTitle ? ` · ${item.variantTitle}` : ''}
                          </small>
                        </div>
                        <div className="return-detail-item-meta">
                          <span>Qty {item.quantity}</span>
                          <span>{item.amount}</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <EmptyStatePanel title="No item details available" description="This record has no returned item summary yet." />
                  )}
                </div>
              </div>

              <div className="op-panel-section">
                <h4>Timeline</h4>
                <ol className="returns-timeline">
                  {buildTimeline(selectedReturn, selectedDetail).map((item, index) => (
                    <li key={`${item.label}-${item.at}-${index}`}>
                      <span className="returns-timeline-dot" aria-hidden="true" />
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.at}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="returns-actions-card returns-actions-card-compact">
                <h4>{terminalRefundedReturn ? 'Next action' : 'Actions'}</h4>
                <WorkflowActionGuidance
                  actionLabel={actionLabel}
                  description={actionDescription}
                  tone={actionTone}
                />
                <OperationalActionGroup>
                  {terminalRefundedReturn ? null : (
                    <Link to={`/returns/${selectedReturn.id}`} className="button button-primary button-link">
                      Review return
                    </Link>
                  )}
                  <button type="button" className="button button-secondary" onClick={() => setSupportTarget({ vendorId: currentVendor.vendorId, id: selectedReturn.id })}>
                    Contact support
                  </button>
                </OperationalActionGroup>
              </div>
            </>
              );
            })()
          ) : (
            <EmptyStatePanel
              title={requestedReturnTarget ? 'Linked return unavailable' : 'Select a return'}
              description={
                requestedReturnTarget
                  ? 'The linked return is not available in the current vendor scope.'
                  : 'Choose a record from the table to inspect return details and items.'
              }
            />
          )}
        </SideDetailPanel>
      </div>
      {selectedReturn ? (
        <SupportTicketModal
          open={supportTarget?.vendorId === currentVendor.vendorId && supportTarget.id === selectedReturn.id}
          contextType="return"
          contextId={selectedReturn.id}
          contextSnapshot={supportSnapshot}
          defaultSubject={`Help with return ${formatShopifyOrderNumber(selectedReturn.sourceShopifyOrderNumber)}`}
          onClose={() => setSupportTarget(null)}
        />
      ) : null}

    </section>
  );
}
