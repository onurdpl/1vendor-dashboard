import { useMemo, useState } from 'react';
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

type ReturnSourceFilter = 'all' | 'pending' | 'refunded';

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

function getItemCount(summary: ReturnSummary, detail: ReturnDetail | null) {
  return detail?.refundedItems.length ?? summary.refundedSkus?.length ?? 0;
}

function getVariantText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || text === 'Details pending' || text === 'Default') {
    return '';
  }

  if (/^(gid:\/\/|sku[-_:]|unknown-sku)/i.test(text)) {
    return '';
  }

  return text;
}

function getItemPreview(summary: ReturnSummary, detail: ReturnDetail | null) {
  const detailItems = detail?.refundedItems ?? [];
  if (detailItems.length > 0) {
    return detailItems.map((item) => ({
      sku: item.sku,
      title: item.name || 'Return item',
      variantTitle: getVariantText(item.variantTitle),
      quantity: item.quantity,
      amount: item.refundAmount,
      condition: item.condition,
    }));
  }

  return (summary.refundedSkus ?? []).map((sku) => ({
    sku,
    title: 'Return item',
    variantTitle: 'Details pending',
    quantity: 1,
    amount: summary.sourceType === 'shopify_return_request' ? 'Not posted' : summary.amount,
    condition: 'Opened' as ReturnLineItem['condition'],
  }));
}

function getTableItemDisplay(summary: ReturnSummary, detail: ReturnDetail | null) {
  const firstItem = getItemPreview(summary, detail)[0];
  return {
    title: firstItem?.title || 'Return item',
    variant: getVariantText(firstItem?.variantTitle),
  };
}

function getSourceFilterLabel(filter: ReturnSourceFilter) {
  if (filter === 'pending') {
    return 'Pending returns';
  }
  if (filter === 'refunded') {
    return 'Refunds completed';
  }
  return 'All returns';
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
          String(item.sourceShopifyOrderNumber),
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
  const selectedDetail = detailQuery.data;
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

      <div className="op-control-layout returns-control-layout">
        <div className="op-main-column">
          <div className="returns-status-row" aria-label="Return workspace status">
            <StatusBadge tone={isRealMode ? 'success' : 'neutral'}>{isRealMode ? 'Real API' : 'Mock mode'}</StatusBadge>
            <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
            <StatusBadge tone={attentionCount > 0 ? 'attention' : 'success'}>{attentionCount} attention</StatusBadge>
          </div>

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
            <span>{filteredReturns.length} records</span>
            <span>{getSourceFilterLabel(sourceFilter)}</span>
            <span>{statusFilter === 'all' ? 'All statuses' : statusFilter}</span>
            {isAdmin ? <span>{vendorFilter === 'all' ? 'All visible returns' : getVendorName(vendorFilter, vendorLookup)}</span> : null}
          </div>

          {filteredReturns.length === 0 ? (
            <EmptyStatePanel
              title="No returns match this view"
              description="Adjust search or filters to find return requests and refunds."
            />
          ) : (
            <OperationalTable
              columns={[
                'Product',
                'Order #',
                'Return status',
                'Requested',
                'Action',
              ]}
              className="returns-op-table returns-op-table-v2"
            >
              {filteredReturns.map((item) => {
                const isSelected = selectedReturn?.id === item.id;
                const itemCount = getItemCount(item, isSelected ? selectedDetail : null);
                const itemDisplay = getTableItemDisplay(item, isSelected ? selectedDetail : null);
                return (
                  <OperationalTableRow
                    key={item.id}
                    selected={isSelected}
                    onSelect={() => setSelectedReturnId(item.id)}
                  >
                    <div className="return-item-preview">
                      <span className="return-item-thumb" aria-hidden="true">
                        {itemCount > 1 ? itemCount : 'R'}
                      </span>
                      <span>
                        <strong>{itemDisplay.title}</strong>
                        {itemDisplay.variant ? <small>{itemDisplay.variant}</small> : null}
                      </span>
                    </div>
                    <span>
                      <strong>#{item.sourceShopifyOrderNumber}</strong>
                      <small>{getReturnKind(item)}</small>
                    </span>
                    <span>
                      <StatusBadge tone={getStatusTone(item)}>{getVendorStatusLabel(item)}</StatusBadge>
                      <small>{getRefundStatusLabel(item)}</small>
                    </span>
                    <span>
                      <strong>{formatDate(item.date)}</strong>
                    </span>
                    <OperationalActionGroup>
                      <Link
                        to={`/returns/${item.id}`}
                        className="button button-ghost button-link returns-row-action"
                        aria-label={`View return for order ${item.sourceShopifyOrderNumber}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        ›
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
          title={selectedReturn ? `Order #${selectedReturn.sourceShopifyOrderNumber}` : 'No return selected'}
          action={
            selectedReturn ? (
              <Link to={`/returns/${selectedReturn.id}`} className="button button-primary button-link returns-panel-action">
                Review return
              </Link>
            ) : null
          }
        >
          {selectedReturn ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getStatusTone(selectedReturn)}>{getVendorStatusLabel(selectedReturn)}</StatusBadge>
              </div>

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
            <EmptyStatePanel title="Select a return" description="Choose a record from the table to inspect lifecycle, item, and Shopify metadata." />
          )}
        </SideDetailPanel>
      </div>

      <div className="returns-support-footer">
        <div>
          <h3>Need help?</h3>
          <p>Questions about a return or refund? Contact support.</p>
        </div>
        <button type="button" className="button button-secondary">
          Contact support
        </button>
      </div>
    </section>
  );
}
