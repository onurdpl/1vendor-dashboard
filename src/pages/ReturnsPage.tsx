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
import { getReturn, listReturns, type ReturnDetail, type ReturnLineItem, type ReturnSummary } from '../features/returns/api';
import { getAvailableVendors } from '../lib/auth';
import { useAppReadiness } from '../lib/appReadiness';
import { runtimeConfig } from '../config/runtime';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { SupportTicketModal } from '../components/SupportTicketModal';
import { ProductImagePreview } from '../components/ProductImagePreview';
import { sameNormalizedIdentifier } from '../lib/shopifyIdentifiers';
import { safeArray } from '../services/real/formatting';
import { getReturnWorkflowAction } from '../lib/workflowActionGuidance';
import { isActiveReturnReviewStatus, isTerminalRefundedReturn } from '../lib/returnOperationalState';

type ReturnSourceFilter = 'all' | 'pending' | 'refunded';
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

function formatDateParts(value: string | null | undefined) {
  if (!value) {
    return { date: '—', time: '' };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: '—', time: '' };
  }

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

function getRefundStatusLabel(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' && !item.sourceShopifyRefundId ? 'Refund pending' : 'Refunded';
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

function isPendingReturn(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' && isActiveReturnReviewStatus(item);
}

function isRefundedReturn(item: ReturnSummary) {
  return (
    item.sourceType !== 'shopify_return_request' ||
    isTerminalRefundedReturn({
      status: item.status,
      sourceType: item.sourceType,
      refundStatus: getRefundStatusLabel(item),
      sourceShopifyRefundId: item.sourceShopifyRefundId,
      vendorReceivedAt: item.vendorReceivedAt,
      vendorReviewedAt: item.vendorReviewedAt,
      vendorDecision: item.vendorDecision,
      refundedItems: item.refundedItems,
    })
  );
}

function needsAttention(item: ReturnSummary) {
  const normalized = item.status?.toLowerCase() ?? '';
  return normalized === 'requested' || normalized === 'awaiting_review' || normalized === 'awaiting review' || normalized === 'pending' || normalized === 'in review';
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

function getRowItemCandidates(summary: ReturnSummary) {
  const record = summary as ReturnSummary & {
    refundedItems?: ReturnRowItemCandidate[];
    items?: ReturnRowItemCandidate[];
    returnedItems?: ReturnRowItemCandidate[];
    returnItems?: ReturnRowItemCandidate[];
    lineItems?: ReturnRowItemCandidate[];
    refundLineItems?: ReturnRowItemCandidate[];
    item?: ReturnRowItemCandidate;
    product?: ReturnRowItemCandidate;
    itemTitle?: unknown;
    displayTitle?: unknown;
    productTitle?: unknown;
    productName?: unknown;
    merchandiseTitle?: unknown;
    merchandiseName?: unknown;
    title?: unknown;
    name?: unknown;
    lineItemTitle?: unknown;
    orderLineItemTitle?: unknown;
    variantTitle?: unknown;
    variant?: unknown;
    optionTitle?: unknown;
    sku?: unknown;
  };
  const collections = [
    record.refundedItems,
    record.items,
    record.returnedItems,
    record.returnItems,
    record.lineItems,
    record.refundLineItems,
  ];
  const firstNestedItem = collections.find((items) => Array.isArray(items) && items.length > 0)?.[0];
  return [firstNestedItem, record.item, record.product, record].filter(Boolean) as ReturnRowItemCandidate[];
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

function getVendorTimelineLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('requested') || normalized.includes('return')) {
    return 'Return requested';
  }
  if (normalized.includes('approved')) {
    return 'Refund approved';
  }
  if (normalized.includes('refund')) {
    return 'Refund approved';
  }
  if (normalized.includes('pending') || normalized.includes('review')) {
    return 'Vendor reviewed';
  }
  if (normalized.includes('received') || normalized.includes('delivered')) {
    return 'Shipment received';
  }
  return '';
}

function buildTimeline(summary: ReturnSummary, detail: ReturnDetail | null) {
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
    sameNormalizedIdentifier(item.sourceShopifyOrderNumber, target)
  );
}

function getReturnsWorkflowFilter(workflow: string | null) {
  if (workflow === 'pending-review') {
    return {
      label: 'Pending review',
      description: 'Showing Shopify return requests that need vendor review.',
      emptyTitle: 'No returns currently awaiting review',
      emptyDescription: 'The pending return review queue is clear. Clear the workflow to inspect processed refunds and all return records.',
      sourceFilter: 'pending' as ReturnSourceFilter,
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
  const { data: returns, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.returns.list(currentVendor.vendorId),
    ({ signal }) => listReturns({ vendorId: currentVendor.vendorId, signal }),
    { enabled: authContextReady },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<ReturnSourceFilter>('all');
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const activeWorkflowFilter = useMemo(() => getReturnsWorkflowFilter(searchParams.get('workflow')), [searchParams]);
  const isRealMode = runtimeConfig.apiMode === 'real';
  const isAdmin = currentUser?.role === 'admin';
  const requestedReturnTarget =
    searchParams.get('returnId') ??
    searchParams.get('id') ??
    searchParams.get('return') ??
    searchParams.get('shopifyReturnId') ??
    searchParams.get('sourceShopifyReturnId') ??
    searchParams.get('refundId') ??
    searchParams.get('shopifyRefundId') ??
    searchParams.get('sourceShopifyRefundId') ??
    searchParams.get('orderId') ??
    searchParams.get('shopifyOrderId') ??
    searchParams.get('shopifyOrderNumber') ??
    searchParams.get('orderNumber') ??
    searchParams.get('order');

  useEffect(() => {
    setSelectedReturnId(null);
  }, [requestedReturnTarget]);

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
    setVendorFilter('all');
    setSourceFilter('all');
  }

  const vendorLookup = useMemo(() => {
    return new Map(getAvailableVendors().map((vendor) => [vendor.vendorId, vendor.vendorName] as const));
  }, []);
  const effectiveSourceFilter = activeWorkflowFilter?.sourceFilter ?? sourceFilter;

  const filteredReturns = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return safeArray(returns).filter((item) => {
      const matchesQuery =
        query.length === 0 ||
        [
          item.id,
          item.customer,
          item.reason,
          item.displayTitle ?? '',
          item.itemTitle ?? '',
          item.variantTitle ?? '',
          String(item.sourceShopifyOrderNumber),
          getRowItemCandidates(item)
            .map((lineItem) =>
              [
                lineItem.displayTitle,
                lineItem.itemTitle,
                lineItem.productTitle,
                lineItem.productName,
                lineItem.product?.title,
                lineItem.product?.name,
                lineItem.lineItemTitle,
                lineItem.lineItem?.productTitle,
                lineItem.lineItem?.productName,
                lineItem.lineItem?.title,
                lineItem.lineItem?.name,
                lineItem.orderLineItemTitle,
                lineItem.orderLineItem?.productTitle,
                lineItem.orderLineItem?.productName,
                lineItem.orderLineItem?.title,
                lineItem.orderLineItem?.name,
                lineItem.shopifyOrderLineItem?.productTitle,
                lineItem.shopifyOrderLineItem?.productName,
                lineItem.shopifyOrderLineItem?.title,
                lineItem.shopifyOrderLineItem?.name,
                lineItem.merchandiseTitle,
                lineItem.merchandiseName,
                lineItem.merchandise?.product?.title,
                lineItem.merchandise?.product?.name,
                lineItem.merchandise?.title,
                lineItem.merchandise?.name,
                lineItem.title,
                lineItem.name,
                lineItem.variantTitle,
                lineItem.variant,
                lineItem.optionTitle,
                lineItem.sku,
              ]
                .map(readText)
                .filter(Boolean)
                .join(' '),
            )
            .join(' '),
          item.sourceShopifyOrderId,
          item.sourceShopifyRefundId,
          item.sourceShopifyReturnId ?? '',
          item.refundedSkus?.join(' ') ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(query);
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesVendor = vendorFilter === 'all' || item.assignedVendorId === vendorFilter;
      const matchesSource =
        effectiveSourceFilter === 'all' ||
        (effectiveSourceFilter === 'pending' && isPendingReturn(item)) ||
        (effectiveSourceFilter === 'refunded' && isRefundedReturn(item));
      return matchesQuery && matchesStatus && matchesVendor && matchesSource;
    });
  }, [effectiveSourceFilter, returns, searchTerm, statusFilter, vendorFilter]);

  const selectedReturn = useMemo(() => {
    const returnList = safeArray(returns);
    if (!returnList.length) {
      return null;
    }
    const selectedByClick = selectedReturnId ? returnList.find((item) => item.id === selectedReturnId) : null;
    if (selectedByClick) {
      return selectedByClick;
    }
    if (requestedReturnTarget) {
      return returnList.find((item) => returnMatchesTarget(item, requestedReturnTarget)) ?? null;
    }
    return filteredReturns[0] ?? null;
  }, [filteredReturns, requestedReturnTarget, returns, selectedReturnId]);

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
    },
  );
  const selectedDetail = detailQuery.data;

  const returnRows = safeArray(returns);
  const pendingCount = returnRows.filter(isPendingReturn).length;
  const approvedCount = returnRows.filter((item) => item.status === 'Approved').length;
  const processedCount = returnRows.filter(isRefundedReturn).length;
  const attentionCount = returnRows.filter(needsAttention).length;
  const statuses = Array.from(new Set(returnRows.map((item) => item.status)));
  const vendors = Array.from(new Set(returnRows.map((item) => item.assignedVendorId)));
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
  const kpis = [
    { label: 'Pending review', value: pendingCount, helper: 'Open requests', tone: 'attention' },
    { label: 'Awaiting shipment', value: approvedCount, helper: 'Approved returns', tone: 'info' },
    { label: 'Refunded', value: processedCount, helper: 'Completed refunds', tone: 'success' },
    { label: 'Needs action', value: attentionCount, helper: 'Operational queue', tone: attentionCount > 0 ? 'warning' : 'success' },
  ] as const;

  return (
    <section className="op-page returns-control-center">
      <div className="op-page-heading returns-compact-heading">
        <div>
          <p className="eyebrow">Returns</p>
          <h2>Return requests</h2>
        </div>
        <StatusBadge tone="info">Phase 16A foundation</StatusBadge>
      </div>

      <div className="returns-kpi-strip" aria-label="Returns summary">
        {kpis.map((kpi) => (
          <article key={kpi.label} className={`returns-mini-kpi returns-mini-kpi-${kpi.tone}`}>
            <div>
              <strong>{kpi.value}</strong>
              <span>{kpi.label}</span>
              <small>{kpi.helper}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="returns-status-row" aria-label="Return workspace status">
        <StatusBadge tone={isRealMode ? 'success' : 'neutral'}>{isRealMode ? 'Real API' : 'Mock mode'}</StatusBadge>
        <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
        <StatusBadge tone={attentionCount > 0 ? 'attention' : 'success'}>{attentionCount} attention</StatusBadge>
      </div>

      <div className="op-control-layout returns-control-layout">
        <div className="op-main-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search returns by order, return #, customer or SKU..."
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
                    setVendorFilter(event.target.value);
                  }}
                >
                  <option value="all">All visible vendors</option>
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

          <div className="returns-filter-summary">
            <button
              type="button"
              className={effectiveSourceFilter === 'all' ? 'is-active' : ''}
              onClick={() => {
                clearWorkflowFilter();
                setSourceFilter('all');
              }}
            >
              All returns <strong>{returnRows.length}</strong>
            </button>
            <button
              type="button"
              className={effectiveSourceFilter === 'pending' ? 'is-active' : ''}
              onClick={() => {
                clearWorkflowFilter();
                setSourceFilter('pending');
              }}
            >
              Pending review <strong>{pendingCount}</strong>
            </button>
            <button
              type="button"
              className={effectiveSourceFilter === 'refunded' ? 'is-active' : ''}
              onClick={() => {
                clearWorkflowFilter();
                setSourceFilter('refunded');
              }}
            >
              Refunded <strong>{processedCount}</strong>
            </button>
            <span>Needs action <strong>{attentionCount}</strong></span>
          </div>

          <OperationalTable
            columns={[
              'Item',
              'SKU',
              'Order #',
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
            ) : !authContextReady || isLoading ? (
              <TableSkeletonRows columns={6} rows={5} />
            ) : filteredReturns.length === 0 ? (
              <OperationalTableRow>
                <EmptyStatePanel
                  title={activeWorkflowFilter?.emptyTitle ?? 'No returns match this view'}
                  description={activeWorkflowFilter?.emptyDescription ?? 'Adjust search or filters to find return requests and refunds.'}
                />
              </OperationalTableRow>
            ) : filteredReturns.map((item) => {
                const isSelected = selectedReturn?.id === item.id;
                const itemDisplay = getTableItemDisplay(item);
                const requestedAt = formatDateParts(item.date);
                return (
                  <OperationalTableRow
                    key={item.id}
                    selected={isSelected}
                    onSelect={() => setSelectedReturnId(item.id)}
                  >
                    <div className="return-item-preview">
                      <span className="return-item-thumb" aria-hidden="true">
                        ↩
                      </span>
                      <span>
                        <strong>{itemDisplay.title}</strong>
                        {itemDisplay.variant ? <small>{itemDisplay.variant}</small> : null}
                      </span>
                    </div>
                    <span className="returns-sku-cell">{itemDisplay.sku}</span>
                    <span>
                      <strong>{formatShopifyOrderNumber(item.sourceShopifyOrderNumber)}</strong>
                      <small>{getVendorName(item.assignedVendorId, vendorLookup)}</small>
                    </span>
                    <span>
                      <StatusBadge tone={getStatusTone(item)}>{getVendorStatusLabel(item)}</StatusBadge>
                      <small>{getRefundStatusLabel(item)}</small>
                    </span>
                    <span className="returns-requested-cell">
                      <strong>{requestedAt.date}</strong>
                      {requestedAt.time ? <small>{requestedAt.time}</small> : null}
                    </span>
                    <OperationalActionGroup>
                      <Link
                        to={`/returns/${item.id}`}
                        className="button button-ghost button-link returns-row-action"
                        aria-label={`İncele return for order ${formatShopifyOrderNumber(item.sourceShopifyOrderNumber)}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        İncele
                      </Link>
                    </OperationalActionGroup>
                  </OperationalTableRow>
                );
              })}
          </OperationalTable>
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
              const workflowGuidance = getReturnWorkflowAction({
                status: selectedReturn.status,
                sourceType: selectedReturn.sourceType,
                refundStatus: getRefundStatusLabel(selectedReturn),
              });

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
                <h4>Actions</h4>
                <WorkflowActionGuidance
                  actionLabel={workflowGuidance.actionLabel}
                  description={workflowGuidance.description}
                  tone={workflowGuidance.tone}
                />
                <OperationalActionGroup>
                  <Link to={`/returns/${selectedReturn.id}`} className="button button-primary button-link">
                    Review return
                  </Link>
                  <button type="button" className="button button-secondary" onClick={() => setSupportOpen(true)}>
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
          open={supportOpen}
          contextType="return"
          contextId={selectedReturn.id}
          contextSnapshot={supportSnapshot}
          defaultSubject={`Help with return ${formatShopifyOrderNumber(selectedReturn.sourceShopifyOrderNumber)}`}
          onClose={() => setSupportOpen(false)}
        />
      ) : null}

    </section>
  );
}
