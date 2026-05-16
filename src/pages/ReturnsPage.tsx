import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  FilterBar,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SideDetailPanel,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getReturn, listReturns, type ReturnDetail, type ReturnLineItem, type ReturnSummary } from '../features/returns/api';
import { getAvailableVendors, getCurrentUser, getCurrentVendorContext, getToken } from '../lib/auth';
import { runtimeConfig } from '../config/runtime';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { isReturnsTitleDebugEnabled, logReturnsTitleDebugSnapshot, summarizeReturnTitlePayload } from '../lib/returnsTitleDebug';

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

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateParts(value: string | null | undefined) {
  if (!value) {
    return { date: '—', time: '' };
  }

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

function getReturnKind(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' ? 'Return requested' : 'Refunded';
}

function getRefundStatusLabel(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' ? 'Refund pending' : 'Refunded';
}

function getVendorReason(reason: string | null | undefined) {
  const value = reason?.trim();
  if (!value) {
    return 'Return requested';
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
    return 'Return requested';
  }

  return value;
}

function getVendorStatusLabel(item: ReturnSummary) {
  const normalized = item.status.toLowerCase();
  if (item.sourceType === 'shopify_return_request' && normalized === 'requested') {
    return 'Awaiting review';
  }
  if (normalized === 'processed' || normalized === 'refunded') {
    return 'Refunded';
  }
  if (normalized === 'pending' || normalized === 'in review') {
    return 'Under review';
  }
  return item.status;
}

function getStatusTone(item: ReturnSummary) {
  const normalized = item.status.toLowerCase();
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
  return item.sourceType === 'shopify_return_request';
}

function needsAttention(item: ReturnSummary) {
  const normalized = item.status.toLowerCase();
  return normalized === 'requested' || normalized === 'pending' || normalized === 'in review';
}

function getVendorName(vendorId: string, vendorLookup: Map<string, string>) {
  return vendorLookup.get(vendorId) ?? vendorId;
}

function getVariantText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || text === 'Details pending' || text === 'Default' || text === 'Return item') {
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
  if (!text || text === 'Return item' || /^gid:\/\//i.test(text) || /^unknown-sku$/i.test(text)) {
    return '';
  }

  return text;
}

function readProductText(value: unknown, sku?: string | null) {
  const text = readText(value);
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
      quantity: item.quantity,
      amount: item.refundAmount,
      condition: item.condition,
    }));
  }

  return (summary.refundedSkus ?? []).map((sku) => ({
    sku,
    title: getItemTitleFallback(sku),
    variantTitle: 'Details pending',
    quantity: 1,
    amount: summary.sourceType === 'shopify_return_request' ? 'Not posted' : summary.amount,
    condition: 'Opened' as ReturnLineItem['condition'],
  }));
}

function getTableItemDisplay(summary: ReturnSummary, detail: ReturnDetail | null) {
  const summaryTitle = readFirstProductText(
    summary.refundedSkus?.[0],
    summary.displayTitle,
    summary.itemTitle,
  );
  const rowItem = summaryTitle
    ? ({
        title: summaryTitle,
        variantTitle: summary.variantTitle,
        sku: summary.refundedSkus?.[0],
      } satisfies ReturnRowItemCandidate)
    : getRowItemCandidates(summary).find((item) => resolveCandidateTitle(item));
  const firstItem = rowItem
    ? {
        title: resolveCandidateTitle(rowItem),
        variantTitle: resolveCandidateVariant(rowItem),
        sku: readText(rowItem.sku),
      }
    : getItemPreview(summary, detail)[0];

  return {
    title: firstItem?.title || getItemTitleFallback(firstItem?.sku),
    variant: getVariantText(firstItem?.variantTitle) === firstItem?.title ? '' : getVariantText(firstItem?.variantTitle),
    sku: getSkuText(firstItem?.sku),
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

export function ReturnsPage() {
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
  const authContextReady = Boolean(getToken() && currentUser && currentVendor.vendorId);
  const { data: returns, isLoading, isError, error } = useQueryResource(
    queryKeys.returns.list(currentVendor.vendorId),
    () => listReturns({ vendorId: currentVendor.vendorId }),
    { enabled: authContextReady },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<ReturnSourceFilter>('all');
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const isRealMode = runtimeConfig.apiMode === 'real';
  const isAdmin = currentUser?.role === 'admin';

  const vendorLookup = useMemo(() => {
    return new Map(getAvailableVendors().map((vendor) => [vendor.vendorId, vendor.vendorName] as const));
  }, []);

  const filteredReturns = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (returns ?? []).filter((item) => {
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
        sourceFilter === 'all' ||
        (sourceFilter === 'pending' && item.sourceType === 'shopify_return_request') ||
        (sourceFilter === 'refunded' && item.sourceType !== 'shopify_return_request');
      return matchesQuery && matchesStatus && matchesVendor && matchesSource;
    });
  }, [returns, searchTerm, sourceFilter, statusFilter, vendorFilter]);

  const selectedReturn = useMemo(() => {
    if (!returns?.length) {
      return null;
    }
    return returns.find((item) => item.id === selectedReturnId) ?? filteredReturns[0] ?? returns[0];
  }, [filteredReturns, returns, selectedReturnId]);

  const detailQuery = useQueryResource(
    selectedReturn ? queryKeys.returns.detail(selectedReturn.id, currentVendor.vendorId) : ['returns', 'detail', currentVendor.vendorId, 'empty'],
    () => {
      if (!selectedReturn) {
        throw new Error('Return not selected.');
      }

      return getReturn(selectedReturn.id, { vendorId: currentVendor.vendorId });
    },
    {
      enabled: authContextReady && Boolean(selectedReturn),
    },
  );
  const selectedDetail = detailQuery.data;

  useEffect(() => {
    if (!isAdmin || !isReturnsTitleDebugEnabled()) {
      return;
    }

    const tableRows = filteredReturns.map((item) => {
      const itemDisplay = getTableItemDisplay(item, null);
      return {
        returnId: item.id,
        orderNumber: item.sourceShopifyOrderNumber,
        renderedItemColumnTitle: itemDisplay.title,
        renderedVariantLine: itemDisplay.variant || '—',
        renderedSkuColumn: itemDisplay.sku,
        mappedSummary: summarizeReturnTitlePayload(item),
      };
    });

    logReturnsTitleDebugSnapshot('ReturnsPage mapped table rows', tableRows);
    logReturnsTitleDebugSnapshot('ReturnsPage selected summary/detail comparison', {
      selectedReturnId: selectedReturn?.id ?? null,
      selectedSummary: selectedReturn ? summarizeReturnTitlePayload(selectedReturn) : null,
      selectedDetail: selectedDetail ? summarizeReturnTitlePayload(selectedDetail) : null,
      selectedDetailItemPreview: selectedReturn ? getItemPreview(selectedReturn, selectedDetail) : [],
    });
  }, [filteredReturns, isAdmin, selectedDetail, selectedReturn]);

  if (!authContextReady || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Returns"
        title="Loading returns"
        description="Fetching a structured return queue from the central data layer."
      />
    );
  }

  if (isError || !returns) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Returns"
        title="Returns unavailable"
        description={error ?? 'Unable to load returns.'}
      />
    );
  }

  const pendingCount = returns.filter((item) => item.sourceType === 'shopify_return_request' && item.status === 'Requested').length;
  const approvedCount = returns.filter((item) => item.status === 'Approved').length;
  const processedCount = returns.filter((item) => item.sourceType !== 'shopify_return_request').length;
  const attentionCount = returns.filter(needsAttention).length;
  const statuses = Array.from(new Set(returns.map((item) => item.status)));
  const vendors = Array.from(new Set(returns.map((item) => item.assignedVendorId)));
  const selectedItems = selectedReturn ? getItemPreview(selectedReturn, selectedDetail) : [];
  const kpis = [
    { label: 'Pending review', value: pendingCount, icon: 'P', tone: 'attention' },
    { label: 'Awaiting shipment', value: approvedCount, icon: 'S', tone: 'info' },
    { label: 'Refunded', value: processedCount, icon: 'R', tone: 'success' },
    { label: 'Needs action', value: attentionCount, icon: 'A', tone: attentionCount > 0 ? 'warning' : 'success' },
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
            <span className="returns-mini-kpi-icon" aria-hidden="true">{kpi.icon}</span>
            <div>
              <strong>{kpi.value}</strong>
              <span>{kpi.label}</span>
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
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <FilterBar>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as ReturnSourceFilter)}>
                <option value="all">All returns</option>
                <option value="pending">Pending returns</option>
                <option value="refunded">Refunds completed</option>
              </select>
              {isAdmin ? (
                <select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
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
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setVendorFilter('all');
                  setSourceFilter('all');
                }}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>

          <div className="returns-filter-summary">
            <button type="button" className={sourceFilter === 'all' ? 'is-active' : ''} onClick={() => setSourceFilter('all')}>
              All returns <strong>{returns.length}</strong>
            </button>
            <button type="button" className={sourceFilter === 'pending' ? 'is-active' : ''} onClick={() => setSourceFilter('pending')}>
              Pending review <strong>{pendingCount}</strong>
            </button>
            <button type="button" className={sourceFilter === 'refunded' ? 'is-active' : ''} onClick={() => setSourceFilter('refunded')}>
              Refunded <strong>{processedCount}</strong>
            </button>
            <span>Needs action <strong>{attentionCount}</strong></span>
          </div>

          {filteredReturns.length === 0 ? (
            <EmptyStatePanel
              title="No returns match this view"
              description="Adjust search or filters to find return requests and refunds."
            />
          ) : (
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
              {filteredReturns.map((item) => {
                const isSelected = selectedReturn?.id === item.id;
                const itemDisplay = getTableItemDisplay(item, null);
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
                      <small>{getReturnKind(item)}</small>
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
          )}
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
            <>
              <div className="returns-summary-card">
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
                </div>
              </div>

              <div className="op-panel-section">
                <h4>Returned items</h4>
                <div className="return-detail-items">
                  {selectedItems.length > 0 ? (
                    selectedItems.map((item) => (
                      <article key={`${item.sku}-${item.title}-${item.variantTitle}`} className="return-detail-item">
                        <span className="return-item-thumb" aria-hidden="true">
                          SKU
                        </span>
                        <div>
                          <strong>{item.title}</strong>
                          {item.variantTitle ? <small>{item.variantTitle}</small> : null}
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

              <div className="returns-actions-card">
                <h4>Actions</h4>
                <OperationalActionGroup>
                  <Link to={`/returns/${selectedReturn.id}`} className="button button-primary button-link">
                    Review return
                  </Link>
                  <button type="button" className="button button-secondary">
                    Contact support
                  </button>
                </OperationalActionGroup>
              </div>
            </>
          ) : (
            <EmptyStatePanel title="Select a return" description="Choose a record from the table to inspect return details and items." />
          )}
        </SideDetailPanel>
      </div>

    </section>
  );
}
