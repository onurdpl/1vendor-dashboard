import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  FilterBar,
  KPIStatCard,
  MetadataRow,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  ShopifyEntityDisplay,
  SideDetailPanel,
  StatusBadge,
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { listReturns, type ReturnSummary } from '../features/returns/api';
import { getCurrentUser, getCurrentVendorContext } from '../lib/auth';
import { runtimeConfig } from '../config/runtime';

function formatDate(value: string) {
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

function getEntityLabel(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' ? 'Shopify Return ID' : 'Shopify Refund ID';
}

function getEntityValue(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request'
    ? item.sourceShopifyReturnId || 'Not available'
    : item.sourceShopifyRefundId || 'Not available';
}

function getStatusTone(item: ReturnSummary) {
  const normalized = item.status.toLowerCase();
  if (item.sourceType === 'shopify_return_request' && normalized === 'requested') {
    return 'attention' as const;
  }
  if (normalized === 'approved' || normalized === 'processed' || normalized === 'closed') {
    return 'success' as const;
  }
  if (normalized === 'declined' || normalized === 'cancelled' || normalized === 'rejected') {
    return 'danger' as const;
  }
  return 'info' as const;
}

export function ReturnsPage() {
  const { data: returns, isLoading, isError, error } = useQueryResource(queryKeys.returns.list(), listReturns);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
  const isRealMode = runtimeConfig.apiMode === 'real';

  const selectedReturn = useMemo(() => {
    if (!returns?.length) {
      return null;
    }
    return returns.find((item) => item.id === selectedReturnId) ?? returns[0];
  }, [returns, selectedReturnId]);

  const filteredReturns = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (returns ?? []).filter((item) => {
      const matchesQuery =
        query.length === 0 ||
        [
          item.id,
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
      return matchesQuery && matchesStatus;
    });
  }, [returns, searchTerm, statusFilter]);

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
  const totalRefundAmount = returns
    .filter((item) => item.sourceType !== 'shopify_return_request')
    .reduce((total, item) => total + parseAmount(item.amount), 0);
  const statuses = Array.from(new Set(returns.map((item) => item.status)));

  return (
    <section className="op-page returns-control-center">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Returns</p>
          <h2>{currentVendor.vendorName} returns control center</h2>
          <p className="page-description">
            {currentUser?.role === 'admin'
              ? 'Inspect vendor-scoped return requests and refund allocations from Shopify operations.'
              : 'Track pending return requests and processed refunds for your vendor scope.'}
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone={isRealMode ? 'success' : 'neutral'}>{isRealMode ? 'Real API' : 'Mock mode'}</StatusBadge>
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row">
        <KPIStatCard label="Pending requests" value={pendingCount} detail="Shopify return lifecycle" tone="attention" />
        <KPIStatCard label="Approved" value={approvedCount} detail="Awaiting next lifecycle step" tone="success" />
        <KPIStatCard label="Processed refunds" value={processedCount} detail={`${totalReturns} total return records`} tone="info" />
        <KPIStatCard label="Total refunded" value={`TRY ${totalRefundAmount.toFixed(2)}`} detail="Posted refund webhook records" tone="danger" />
      </div>

      <div className="op-control-layout">
        <div className="op-main-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search order, return, refund, SKU..."
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
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                }}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>

          {filteredReturns.length === 0 ? (
            <EmptyStatePanel
              title="No returns match this view"
              description="Adjust the search or status filter to inspect pending return requests and processed refunds."
            />
          ) : (
            <OperationalTable
              columns={['Status', 'Shopify order', 'Return / refund', 'SKU / Items', 'Amount', 'Last update', 'Actions']}
              className="returns-op-table"
            >
              {filteredReturns.map((item) => (
                <OperationalTableRow
                  key={item.id}
                  selected={selectedReturn?.id === item.id}
                  onSelect={() => setSelectedReturnId(item.id)}
                >
                  <span>
                    <StatusBadge tone={getStatusTone(item)}>{item.status}</StatusBadge>
                    <small>{getReturnKind(item)}</small>
                  </span>
                  <ShopifyEntityDisplay
                    label="Shopify Order"
                    primary={`#${item.sourceShopifyOrderNumber}`}
                    secondary={`ID ${item.sourceShopifyOrderId}`}
                  />
                  <ShopifyEntityDisplay
                    label={getEntityLabel(item)}
                    primary={getEntityValue(item)}
                    secondary={item.sourceType === 'shopify_return_request' ? 'Return lifecycle' : 'Refund webhook'}
                  />
                  <span>
                    <strong>{item.refundedSkus?.length ?? 0} SKU</strong>
                    <small>{item.refundedSkus?.slice(0, 2).join(', ') || 'Item detail available'}</small>
                  </span>
                  <strong className={item.sourceType === 'shopify_return_request' ? 'muted' : 'finance-negative'}>
                    {item.sourceType === 'shopify_return_request' ? 'Not posted' : `-${item.amount}`}
                  </strong>
                  <span>
                    <strong>{formatDate(item.updatedAt ?? item.date)}</strong>
                    <small>Created {formatDate(item.date)}</small>
                  </span>
                  <OperationalActionGroup>
                    <Link to={`/returns/${item.id}`} className="button button-secondary button-link">
                      Open
                    </Link>
                  </OperationalActionGroup>
                </OperationalTableRow>
              ))}
            </OperationalTable>
          )}
        </div>

        <SideDetailPanel
          eyebrow="Selected record"
          title={selectedReturn ? getReturnKind(selectedReturn) : 'No return selected'}
          action={
            selectedReturn ? (
              <Link to={`/returns/${selectedReturn.id}`} className="button button-primary button-link">
                Full detail
              </Link>
            ) : null
          }
        >
          {selectedReturn ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getStatusTone(selectedReturn)}>{selectedReturn.status}</StatusBadge>
                <span>{selectedReturn.id}</span>
              </div>

              <div className="op-meta-grid">
                <MetadataRow label="Shopify Order Number" value={`#${selectedReturn.sourceShopifyOrderNumber}`} />
                <MetadataRow label="Shopify Order ID" value={selectedReturn.sourceShopifyOrderId} />
                <MetadataRow label={getEntityLabel(selectedReturn)} value={getEntityValue(selectedReturn)} />
                <MetadataRow label="Vendor owner" value={selectedReturn.assignedVendorId} />
                <MetadataRow
                  label={selectedReturn.sourceType === 'shopify_return_request' ? 'Requested SKUs' : 'Refunded SKUs'}
                  value={selectedReturn.refundedSkus?.join(', ') || 'Visible in detail'}
                />
                <MetadataRow label="Amount" value={selectedReturn.sourceType === 'shopify_return_request' ? 'No refund posted' : selectedReturn.amount} />
              </div>

              <div className="op-panel-section">
                <h4>Lifecycle timeline</h4>
                <TimelineBlock
                  items={[
                    { label: selectedReturn.sourceType === 'shopify_return_request' ? 'Return requested' : 'Refund received', at: formatDate(selectedReturn.date) },
                    { label: selectedReturn.status, at: formatDate(selectedReturn.updatedAt ?? selectedReturn.date) },
                    {
                      label: selectedReturn.sourceType === 'shopify_return_request' ? 'Refund posted' : 'Finance linked',
                      detail: selectedReturn.sourceType === 'shopify_return_request' ? 'Waiting for refunds/create' : 'Processed',
                    },
                  ]}
                />
              </div>

              <div className="op-panel-section">
                <h4>Operational notes</h4>
                <p className="page-description">
                  {selectedReturn.sourceType === 'shopify_return_request'
                    ? 'This is a pending Shopify return lifecycle record. It should not be treated as refunded money until a refunds/create webhook is ingested.'
                    : 'This refund was ingested from Shopify and allocated to the selected vendor context.'}
                </p>
              </div>
            </>
          ) : (
            <EmptyStatePanel title="Select a return" description="Choose a record from the table to inspect lifecycle and Shopify metadata." />
          )}
        </SideDetailPanel>
      </div>
    </section>
  );
}
