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
  ShopifyEntityDisplay,
  SideDetailPanel,
  StatusBadge,
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getOrder, listOrders, type OrderDetail, type OrderSummary } from '../features/orders/api';
import { getCurrentVendorContext } from '../lib/auth';

function formatDate(value?: string | null) {
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

function getStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('fulfilled') || normalized.includes('delivered') || normalized === 'active') {
    return 'success' as const;
  }
  if (normalized.includes('blocked') || normalized.includes('reassignment') || normalized.includes('hold')) {
    return 'warning' as const;
  }
  if (normalized.includes('pending') || normalized.includes('awaiting') || normalized.includes('processing')) {
    return 'attention' as const;
  }
  return 'neutral' as const;
}

function getLineItemCount(order: OrderSummary | OrderDetail) {
  return (
    (order as OrderDetail).lineItems?.length ??
    (order as OrderDetail).items?.length ??
    (order as OrderSummary & { lineItemCount?: number }).lineItemCount ??
    0
  );
}

function getTrackingLabel(order: OrderSummary | OrderDetail) {
  if (order.trackingNumber || order.carrier) {
    return [order.carrier, order.trackingNumber].filter(Boolean).join(' / ');
  }

  return 'No tracking';
}

function getCustomerLabel(customer?: string | null) {
  const value = customer?.trim();
  if (!value || value.toLowerCase().includes('customer details')) {
    return 'Customer unavailable';
  }
  return value;
}

function getAttentionLabel(order: OrderSummary) {
  if (order.allocationStatus === 'vendor_blocked') {
    return 'Vendor blocked';
  }
  if (order.allocationStatus === 'pending_reassignment') {
    return 'Reassignment needed';
  }
  if (order.shippingStatus === 'Awaiting Shipment') {
    return 'Awaiting shipment';
  }
  return 'In flow';
}

export function OrdersPage() {
  const { data: orders, isLoading, isError, error } = useQueryResource(queryKeys.orders.list(), listOrders);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [shippingFilter, setShippingFilter] = useState('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const currentVendor = getCurrentVendorContext();

  const rankedOrders = useMemo(() => {
    const rank = (order: OrderSummary) => {
      if (order.allocationStatus === 'vendor_blocked') {
        return 0;
      }
      if (order.allocationStatus === 'pending_reassignment') {
        return 1;
      }
      if (order.shippingStatus === 'Awaiting Shipment') {
        return 2;
      }
      if (order.fulfillmentStatus === 'Fulfilled') {
        return 4;
      }
      return 3;
    };

    return [...(orders ?? [])].sort((a, b) => {
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return rankedOrders.filter((order) => {
      const matchesStatus = statusFilter === 'all' || order.allocationStatus === statusFilter || order.status === statusFilter;
      const matchesFulfillment = fulfillmentFilter === 'all' || order.fulfillmentStatus === fulfillmentFilter;
      const matchesShipping = shippingFilter === 'all' || order.shippingStatus === shippingFilter;
      const searchableText = [
        order.id,
        order.sourceShopifyOrderId,
        String(order.sourceShopifyOrderNumber),
        getCustomerLabel(order.customer),
        order.status,
        order.allocationStatus,
        order.fulfillmentStatus,
        order.shippingStatus,
        order.trackingNumber ?? '',
        order.carrier ?? '',
        order.amount,
        currentVendor.vendorName,
        currentVendor.vendorId,
      ]
        .join(' ')
        .toLowerCase();

      return matchesStatus && matchesFulfillment && matchesShipping && (!query || searchableText.includes(query));
    });
  }, [currentVendor.vendorId, currentVendor.vendorName, fulfillmentFilter, rankedOrders, searchTerm, shippingFilter, statusFilter]);

  const selectedOrderSummary = useMemo(() => {
    if (!filteredOrders.length) {
      return null;
    }
    return filteredOrders.find((order) => order.id === selectedOrderId) ?? filteredOrders[0];
  }, [filteredOrders, selectedOrderId]);

  const orderDetailQuery = useQueryResource(
    selectedOrderSummary ? queryKeys.orders.detail(selectedOrderSummary.id) : queryKeys.orders.list(),
    () => {
      if (!selectedOrderSummary) {
        throw new Error('Order not found.');
      }
      return getOrder(selectedOrderSummary.id);
    },
    { enabled: Boolean(selectedOrderSummary) },
  );

  const selectedOrder = orderDetailQuery.data ?? selectedOrderSummary;

  const summary = useMemo(() => {
    const source = orders ?? [];
    return {
      total: source.length,
      awaitingShipment: source.filter((order) => order.shippingStatus === 'Awaiting Shipment').length,
      blocked: source.filter((order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked').length,
      fulfilled: source.filter((order) => order.fulfillmentStatus === 'Fulfilled').length,
      tracked: source.filter((order) => order.trackingNumber || order.carrier).length,
    };
  }, [orders]);

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Orders"
        title="Loading orders"
        description="Fetching a structured order list from the central data layer."
      />
    );
  }

  if (isError || !orders) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Orders"
        title="Orders unavailable"
        description={error ?? 'Unable to load orders.'}
      />
    );
  }

  return (
    <section className="op-page orders-control-center">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Orders</p>
          <h2>{currentVendor.vendorName} orders control center</h2>
          <p className="page-description">
            Vendor-scoped fulfillment queue with Shopify order metadata, shipment progress, and tracking visibility.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
          <StatusBadge tone={summary.blocked > 0 ? 'warning' : 'success'}>{summary.blocked} attention</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row orders-kpi-row">
        <KPIStatCard label="Vendor orders" value={summary.total} detail="Current vendor scope" tone="info" />
        <KPIStatCard label="Awaiting shipment" value={summary.awaitingShipment} detail="Needs fulfillment progress" tone="attention" />
        <KPIStatCard label="Blocked / attention" value={summary.blocked} detail="Reassignment or vendor block" tone="warning" />
        <KPIStatCard label="Fulfilled" value={summary.fulfilled} detail="Fulfillment complete" tone="success" />
        <KPIStatCard label="Tracking visible" value={summary.tracked} detail="Carrier or tracking present" tone="neutral" />
      </div>

      <div className="op-control-layout orders-control-layout">
        <div className="op-main-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search order, customer, tracking, carrier..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <FilterBar>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All allocation states</option>
                <option value="active">Active</option>
                <option value="pending_reassignment">Pending reassignment</option>
                <option value="vendor_blocked">Vendor blocked</option>
                <option value="fulfilled">Fulfilled allocation</option>
              </select>
              <select value={fulfillmentFilter} onChange={(event) => setFulfillmentFilter(event.target.value)}>
                <option value="all">All fulfillment</option>
                <option value="Pending">Pending</option>
                <option value="Processing">Processing</option>
                <option value="Partially Fulfilled">Partially fulfilled</option>
                <option value="Fulfilled">Fulfilled</option>
              </select>
              <select value={shippingFilter} onChange={(event) => setShippingFilter(event.target.value)}>
                <option value="all">All shipping</option>
                <option value="Awaiting Shipment">Awaiting shipment</option>
                <option value="Label Created">Label created</option>
                <option value="In Transit">In transit</option>
                <option value="Delivered">Delivered</option>
              </select>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setFulfillmentFilter('all');
                  setShippingFilter('all');
                }}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>

          <div className="orders-filter-summary">
            <span>{filteredOrders.length} orders</span>
            <span>{statusFilter === 'all' ? 'All allocation states' : statusFilter.replace(/_/g, ' ')}</span>
            <span>{fulfillmentFilter === 'all' ? 'All fulfillment states' : fulfillmentFilter}</span>
            <span>{shippingFilter === 'all' ? 'All shipping states' : shippingFilter}</span>
          </div>

          {filteredOrders.length === 0 ? (
            <EmptyStatePanel
              title="No orders in this view"
              description="Adjust the search or filters to inspect vendor-scoped Shopify orders."
            />
          ) : (
            <OperationalTable
              columns={['Status', 'Shopify order', 'Customer', 'Items', 'Value', 'Fulfillment', 'Shipping', 'Tracking / carrier', 'Updated', 'Actions']}
              className="orders-op-table orders-op-table-v2"
            >
              {filteredOrders.map((order) => (
                <OperationalTableRow
                  key={order.id}
                  selected={selectedOrderSummary?.id === order.id}
                  onSelect={() => setSelectedOrderId(order.id)}
                >
                  <span>
                    <StatusBadge tone={getStatusTone(order.allocationStatus)}>{getAttentionLabel(order)}</StatusBadge>
                    <small>{order.allocationStatus.replace(/_/g, ' ')}</small>
                  </span>
                  <ShopifyEntityDisplay
                    label="Shopify order"
                    primary={`#${order.sourceShopifyOrderNumber}`}
                    secondary={order.sourceShopifyOrderId}
                  />
                  <span>
                    <strong>{getCustomerLabel(order.customer)}</strong>
                    <small>{currentVendor.vendorName}</small>
                  </span>
                  <span>
                    <strong>{getLineItemCount(order)}</strong>
                    <small>line items</small>
                  </span>
                  <strong className="finance-amount-emphasis">{order.amount}</strong>
                  <StatusBadge tone={getStatusTone(order.fulfillmentStatus)}>{order.fulfillmentStatus}</StatusBadge>
                  <StatusBadge tone={getStatusTone(order.shippingStatus)}>{order.shippingStatus}</StatusBadge>
                  <span>
                    <strong>{getTrackingLabel(order)}</strong>
                    <small>{order.trackingUrl ? 'Tracking URL' : 'No URL'}</small>
                  </span>
                  <span>
                    <strong>{formatDate(order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date)}</strong>
                    <small>{order.channel}</small>
                  </span>
                  <OperationalActionGroup>
                    <button type="button" className="button button-secondary" onClick={() => setSelectedOrderId(order.id)}>
                      View
                    </button>
                    <Link className="button button-primary" to={`/orders/${order.id}`} onClick={(event) => event.stopPropagation()}>
                      Open
                    </Link>
                  </OperationalActionGroup>
                </OperationalTableRow>
              ))}
            </OperationalTable>
          )}
        </div>

        <SideDetailPanel
          eyebrow="Order detail"
          title={selectedOrder ? `Shopify #${selectedOrder.sourceShopifyOrderNumber}` : 'No order selected'}
          action={selectedOrder ? <Link className="button button-secondary" to={`/orders/${selectedOrder.id}`}>Open</Link> : null}
        >
          {selectedOrder ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getStatusTone(selectedOrder.allocationStatus)}>{selectedOrder.allocationStatus.replace(/_/g, ' ')}</StatusBadge>
                <StatusBadge tone={getStatusTone(selectedOrder.fulfillmentStatus)}>{selectedOrder.fulfillmentStatus}</StatusBadge>
                <StatusBadge tone={getStatusTone(selectedOrder.shippingStatus)}>{selectedOrder.shippingStatus}</StatusBadge>
              </div>

              <MetadataGroup title="Shopify metadata">
                <MetadataRow label="Shopify order" value={`#${selectedOrder.sourceShopifyOrderNumber}`} />
                <MetadataRow label="Shopify order ID" value={selectedOrder.sourceShopifyOrderId} />
                <MetadataRow label="Allocation ID" value={selectedOrder.id} />
                <MetadataRow label="Vendor" value={currentVendor.vendorName} />
                <MetadataRow label="Customer" value={getCustomerLabel(selectedOrder.customer)} />
              </MetadataGroup>

              <MetadataGroup title="Fulfillment and shipment">
                <MetadataRow label="Fulfillment status" value={selectedOrder.fulfillmentStatus} />
                <MetadataRow label="Shipping status" value={selectedOrder.shippingStatus} />
                <MetadataRow label="Carrier" value={selectedOrder.carrier ?? 'No carrier'} />
                <MetadataRow label="Tracking number" value={selectedOrder.trackingNumber ?? 'No tracking'} />
                <MetadataRow
                  label="Tracking URL"
                  value={selectedOrder.trackingUrl ? <a className="inline-link" href={selectedOrder.trackingUrl}>Open tracking</a> : 'No URL'}
                />
                <MetadataRow label="Fulfilled at" value={formatDate(selectedOrder.fulfilledAt)} />
                <MetadataRow label="Shipment created" value={formatDate(selectedOrder.shipmentCreatedAt)} />
                <MetadataRow label="Shipment updated" value={formatDate(selectedOrder.shipmentUpdatedAt)} />
              </MetadataGroup>

              <div className="op-panel-section">
                <h4>Line items</h4>
                {(selectedOrder as OrderDetail).lineItems?.length ? (
                  <div className="order-detail-items">
                    {(selectedOrder as OrderDetail).lineItems.map((item) => (
                      <article key={item.id} className="order-detail-item">
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.sku} · {item.variantTitle}</small>
                        </div>
                        <div className="return-detail-item-meta">
                          <span>Qty {item.quantity}</span>
                          <span>{item.price}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="page-description">No line items synced.</p>
                )}
              </div>

              <div className="op-panel-section">
                <h4>Operational timeline</h4>
                <TimelineBlock
                  items={[
                    { label: 'Order received', at: formatDate(selectedOrder.date) },
                    { label: 'Fulfillment status', detail: selectedOrder.fulfillmentStatus },
                    { label: 'Shipping status', detail: selectedOrder.shippingStatus },
                    { label: 'Fulfilled', at: formatDate(selectedOrder.fulfilledAt) },
                    { label: selectedOrder.trackingNumber ? 'Tracking synced' : 'Tracking pending', detail: getTrackingLabel(selectedOrder) },
                  ]}
                />
              </div>

              <div className="op-panel-section">
                <h4>Reconciliation context</h4>
                <p className="page-description">
                  Reconcile from Diagnostics if fulfillment, shipping, or tracking looks stale.
                </p>
              </div>
            </>
          ) : (
            <EmptyStatePanel title="Select an order" description="Choose an order to inspect allocation, fulfillment, and tracking context." />
          )}
        </SideDetailPanel>
      </div>
    </section>
  );
}
