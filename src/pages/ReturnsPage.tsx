import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  FilterBar,
  KPIStatCard,
  MetadataGroup,
  MetadataRow,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  ShopifyEntityPill,
  SideDetailPanel,
  StatusBadge,
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getReturn, listReturns, type ReturnDetail, type ReturnLineItem, type ReturnSummary } from '../features/returns/api';
import { getAvailableVendors, getCurrentUser, getCurrentVendorContext } from '../lib/auth';
import { runtimeConfig } from '../config/runtime';

type ReturnSourceFilter = 'all' | 'pending' | 'refunded';

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Not synced';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function parseAmount(value: string) {
  return Number.parseFloat(value.replace(/[^0-9.-]/g, '') || '0');
}

function getReturnKind(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' ? 'Pending return request' : 'Processed refund';
}

function getSourceLabel(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' ? 'Return lifecycle' : 'Refund webhook';
}

function getEntityLabel(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' ? 'Shopify Return ID' : 'Shopify Refund ID';
}

function getEntityValue(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request'
    ? item.sourceShopifyReturnId || 'Not synced'
    : item.sourceShopifyRefundId || 'Not synced';
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

function isCancelledOrDeclined(item: ReturnSummary) {
  const normalized = item.status.toLowerCase();
  return normalized === 'cancelled' || normalized === 'declined' || normalized === 'rejected';
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

function getItemPreview(summary: ReturnSummary, detail: ReturnDetail | null) {
  const detailItems = detail?.refundedItems ?? [];
  if (detailItems.length > 0) {
    return detailItems.map((item) => ({
      sku: item.sku,
      title: item.name,
      variantTitle: item.variantTitle,
      quantity: item.quantity,
      amount: item.refundAmount,
      condition: item.condition,
    }));
  }

  return (summary.refundedSkus ?? []).map((sku) => ({
    sku,
    title: 'Line item detail available in return detail',
    variantTitle: 'Pending detail',
    quantity: 1,
    amount: summary.sourceType === 'shopify_return_request' ? 'Not posted' : summary.amount,
    condition: 'Opened' as ReturnLineItem['condition'],
  }));
}

function getSourceFilterLabel(filter: ReturnSourceFilter) {
  if (filter === 'pending') {
    return 'Pending requests';
  }
  if (filter === 'refunded') {
    return 'Processed refunds';
  }
  return 'All sources';
}

function buildTimeline(summary: ReturnSummary, detail: ReturnDetail | null) {
  const detailTimeline = detail?.timeline ?? [];
  if (detailTimeline.length > 0) {
    return detailTimeline.map((item) => ({
      label: item.label,
      at: formatDate(item.at),
    }));
  }

  return [
    {
      label: summary.sourceType === 'shopify_return_request' ? 'Return requested' : 'Refund received',
      at: formatDate(summary.date),
    },
    {
      label: summary.status,
      at: formatDate(summary.updatedAt ?? summary.date),
    },
  ];
}

export function ReturnsPage() {
  const { data: returns, isLoading, isError, error } = useQueryResource(queryKeys.returns.list(), listReturns);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<ReturnSourceFilter>('all');
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
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
    selectedReturn ? queryKeys.returns.detail(selectedReturn.id) : ['returns', 'detail', 'empty'],
    () => {
      if (!selectedReturn) {
        throw new Error('Return not selected.');
      }

      return getReturn(selectedReturn.id);
    },
    {
      enabled: Boolean(selectedReturn),
    },
  );

  if (isLoading) {
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

  const totalReturns = returns.length;
  const pendingCount = returns.filter((item) => item.sourceType === 'shopify_return_request' && item.status === 'Requested').length;
  const approvedCount = returns.filter((item) => item.status === 'Approved').length;
  const processedCount = returns.filter((item) => item.sourceType !== 'shopify_return_request').length;
  const cancelledDeclinedCount = returns.filter(isCancelledOrDeclined).length;
  const attentionCount = returns.filter(needsAttention).length;
  const totalRefundAmount = returns
    .filter((item) => item.sourceType !== 'shopify_return_request')
    .reduce((total, item) => total + parseAmount(item.amount), 0);
  const statuses = Array.from(new Set(returns.map((item) => item.status)));
  const vendors = Array.from(new Set(returns.map((item) => item.assignedVendorId)));
  const selectedDetail = detailQuery.data;
  const selectedItems = selectedReturn ? getItemPreview(selectedReturn, selectedDetail) : [];

  return (
    <section className="op-page returns-control-center">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Returns</p>
          <h2>{currentVendor.vendorName} returns control center</h2>
          <p className="page-description">
            {isAdmin
              ? 'Inspect vendor-scoped return requests, refund allocations, and lifecycle attention states from Shopify operations.'
              : 'Track pending return requests and processed refunds for your assigned vendor scope.'}
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone={isRealMode ? 'success' : 'neutral'}>{isRealMode ? 'Real API' : 'Mock mode'}</StatusBadge>
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
          <StatusBadge tone={attentionCount > 0 ? 'attention' : 'success'}>{attentionCount} attention</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row returns-kpi-row">
        <KPIStatCard label="Pending requests" value={pendingCount} detail="Not a refund yet" tone="attention" />
        <KPIStatCard label="Approved" value={approvedCount} detail="Awaiting next lifecycle step" tone="success" />
        <KPIStatCard label="Processed refunds" value={processedCount} detail={`${totalReturns} total records`} tone="info" />
        <KPIStatCard label="Cancelled / declined" value={cancelledDeclinedCount} detail="Closed without refund flow" tone="danger" />
        <KPIStatCard label="Refund amount" value={`TRY ${totalRefundAmount.toFixed(2)}`} detail="Posted refund webhooks" tone="neutral" />
        <KPIStatCard label="Needs attention" value={attentionCount} detail="Requested, pending, or in review" tone={attentionCount > 0 ? 'warning' : 'success'} />
      </div>

      <div className="op-control-layout returns-control-layout">
        <div className="op-main-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search order, return ID, refund ID, SKU, customer..."
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
                <option value="all">All sources</option>
                <option value="pending">Pending requests</option>
                <option value="refunded">Processed refunds</option>
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
            <span>{statusFilter === 'all' ? 'All lifecycle statuses' : statusFilter}</span>
            {isAdmin ? <span>{vendorFilter === 'all' ? 'All visible vendor rows' : getVendorName(vendorFilter, vendorLookup)}</span> : null}
          </div>

          {filteredReturns.length === 0 ? (
            <EmptyStatePanel
              title="No returns match this view"
              description="Adjust search, lifecycle, source, or vendor filters to inspect return requests and refund allocations."
            />
          ) : (
            <OperationalTable
              columns={[
                'Status',
                'Vendor',
                'Customer',
                'Shopify order',
                'Return / refund',
                'Items',
                'Amount',
                'Lifecycle',
                'Updated',
                'Indicators',
              ]}
              className="returns-op-table returns-op-table-v2"
            >
              {filteredReturns.map((item) => {
                const isSelected = selectedReturn?.id === item.id;
                const itemCount = getItemCount(item, isSelected ? selectedDetail : null);
                return (
                  <OperationalTableRow
                    key={item.id}
                    selected={isSelected}
                    onSelect={() => setSelectedReturnId(item.id)}
                  >
                    <span>
                      <StatusBadge tone={getStatusTone(item)}>{item.status}</StatusBadge>
                      <small>{getReturnKind(item)}</small>
                    </span>
                    <span>
                      <strong>{getVendorName(item.assignedVendorId, vendorLookup)}</strong>
                      <small>{item.assignedVendorId}</small>
                    </span>
                    <span>
                      <strong>{item.customer || 'Customer unavailable'}</strong>
                      <small>{item.relatedOrderId}</small>
                    </span>
                    <ShopifyEntityPill
                      label="Shopify Order"
                      primary={`#${item.sourceShopifyOrderNumber}`}
                      secondary={`ID ${item.sourceShopifyOrderId}`}
                    />
                    <ShopifyEntityPill
                      label={getEntityLabel(item)}
                      primary={getEntityValue(item)}
                      secondary={getSourceLabel(item)}
                    />
                    <div className="return-item-preview">
                      <span className="return-item-thumb" aria-hidden="true">
                        {itemCount > 1 ? itemCount : 'SKU'}
                      </span>
                      <span>
                        <strong>{itemCount} item{itemCount === 1 ? '' : 's'}</strong>
                        <small>{item.refundedSkus?.slice(0, 2).join(', ') || 'No SKU in summary'}</small>
                      </span>
                    </div>
                    <strong className={item.sourceType === 'shopify_return_request' ? 'muted' : 'op-money finance-negative'}>
                      {item.sourceType === 'shopify_return_request' ? 'Not posted' : `-${item.amount}`}
                    </strong>
                    <span>
                      <strong>{getSourceLabel(item)}</strong>
                      <small>{isPendingReturn(item) ? 'No finance ledger yet' : 'Finance-visible refund'}</small>
                    </span>
                    <span>
                      <strong>{formatDate(item.updatedAt ?? item.date)}</strong>
                      <small>Created {formatDate(item.date)}</small>
                    </span>
                    <OperationalActionGroup>
                      {needsAttention(item) ? <StatusBadge tone="attention">Review</StatusBadge> : null}
                      {isPendingReturn(item) ? <StatusBadge tone="warning">Pending</StatusBadge> : <StatusBadge tone="success">Ledger</StatusBadge>}
                      <Link
                        to={`/returns/${item.id}`}
                        className="button button-secondary button-link"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Open
                      </Link>
                    </OperationalActionGroup>
                  </OperationalTableRow>
                );
              })}
            </OperationalTable>
          )}
        </div>

        <SideDetailPanel
          eyebrow="Selected return"
          title={selectedReturn ? getReturnKind(selectedReturn) : 'No return selected'}
          action={
            selectedReturn ? (
              <Link to={`/returns/${selectedReturn.id}`} className="button button-primary button-link">
                Full detail
              </Link>
            ) : null
          }
          footer={
            selectedReturn ? (
              <OperationalActionGroup>
                <StatusBadge tone={selectedReturn.sourceType === 'shopify_return_request' ? 'warning' : 'success'}>
                  {selectedReturn.sourceType === 'shopify_return_request' ? 'Return lifecycle' : 'Refund ledger'}
                </StatusBadge>
                <span className="queue-muted-action">Vendor scoped to {getVendorName(selectedReturn.assignedVendorId, vendorLookup)}</span>
              </OperationalActionGroup>
            ) : null
          }
        >
          {selectedReturn ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getStatusTone(selectedReturn)}>{selectedReturn.status}</StatusBadge>
                <StatusBadge tone={selectedReturn.sourceType === 'shopify_return_request' ? 'warning' : 'success'}>
                  {selectedReturn.sourceType === 'shopify_return_request' ? 'No refund posted' : 'Refund processed'}
                </StatusBadge>
              </div>

              <MetadataGroup title="Operational metadata">
                <MetadataRow label="Vendor" value={getVendorName(selectedReturn.assignedVendorId, vendorLookup)} />
                <MetadataRow label="Customer" value={selectedReturn.customer || 'Customer unavailable'} />
                <MetadataRow label="Lifecycle source" value={getSourceLabel(selectedReturn)} />
                <MetadataRow label="Created" value={formatDate(selectedReturn.date)} />
                <MetadataRow label="Updated" value={formatDate(selectedReturn.updatedAt ?? selectedReturn.date)} />
                <MetadataRow
                  label="Reconciliation state"
                  value={needsAttention(selectedReturn) ? 'Review recommended' : 'No warning'}
                />
              </MetadataGroup>

              <MetadataGroup title="Shopify metadata">
                <MetadataRow label="Shopify Order #" value={`#${selectedReturn.sourceShopifyOrderNumber}`} />
                <MetadataRow label="Shopify Order ID" value={selectedReturn.sourceShopifyOrderId} />
                <MetadataRow label="Shopify Return ID" value={selectedReturn.sourceShopifyReturnId ?? 'Not synced'} />
                <MetadataRow label="Shopify Refund ID" value={selectedReturn.sourceShopifyRefundId ?? 'Not synced'} />
              </MetadataGroup>

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
                          <small>{item.variantTitle} · {item.sku}</small>
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
                <h4>Lifecycle timeline</h4>
                <TimelineBlock
                  items={[
                    ...buildTimeline(selectedReturn, selectedDetail),
                    {
                      label: selectedReturn.sourceType === 'shopify_return_request' ? 'Refund pending' : 'Finance ledger linked',
                      detail: selectedReturn.sourceType === 'shopify_return_request' ? 'Waiting for refunds/create' : 'Processed through refund webhook',
                    },
                    {
                      label: 'Fulfillment context',
                      detail: 'Tracking and fulfillment state remain allocation-scoped in order detail.',
                    },
                  ]}
                />
              </div>

              <div className="op-panel-section">
                <h4>Refund context</h4>
                <p className="page-description">
                  {selectedReturn.sourceType === 'shopify_return_request'
                    ? 'This is a pending Shopify return lifecycle record. It should not be treated as refunded money until a refunds/create webhook is ingested.'
                    : `This refund is allocated to ${getVendorName(selectedReturn.assignedVendorId, vendorLookup)} and appears in vendor-scoped finance reporting.`}
                </p>
                <MetadataRow label="Amount" value={selectedReturn.sourceType === 'shopify_return_request' ? 'No refund posted' : selectedReturn.amount} />
                <MetadataRow label="Processing owner" value={selectedDetail?.processedBy ?? 'Backend webhook ingestion'} />
              </div>

              <div className="op-panel-section">
                <h4>Diagnostics context</h4>
                <p className="page-description">
                  Diagnostics and recovery remain admin-only. This drawer only surfaces safe warning state.
                </p>
              </div>
            </>
          ) : (
            <EmptyStatePanel title="Select a return" description="Choose a record from the table to inspect lifecycle, item, and Shopify metadata." />
          )}
        </SideDetailPanel>
      </div>
    </section>
  );
}
