import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  FilterBar,
  OperationalActionGroup,
  OperationalSection,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SideDetailPanel,
  StatusBadge,
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getOrder, listOrders, type OrderDetail, type OrderSummary } from '../features/orders/api';
import { getCurrentUser, getCurrentVendorContext, getToken } from '../lib/auth';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';

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

  return 'Tracking pending';
}

function getTrackingHelper(order: OrderSummary | OrderDetail) {
  if (order.trackingUrl) {
    return 'Tracking link synced';
  }
  if (order.trackingNumber || order.carrier) {
    return 'Waiting Shopify sync';
  }
  return 'Waiting Shopify sync';
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

function getItemInitials(name: string) {
  const [first = '', second = ''] = name.trim().split(/\s+/);
  return `${first[0] ?? 'I'}${second[0] ?? ''}`.toUpperCase();
}

export function OrdersPage() {
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
  const authContextReady = Boolean(getToken() && currentUser && currentVendor.vendorId);
  const { data: orders, isLoading, isError, error } = useQueryResource(
    queryKeys.orders.list(currentVendor.vendorId),
    () => listOrders({ vendorId: currentVendor.vendorId }),
    { enabled: authContextReady },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [shippingFilter, setShippingFilter] = useState('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

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
    selectedOrderSummary ? queryKeys.orders.detail(selectedOrderSummary.id, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId),
    () => {
      if (!selectedOrderSummary) {
        throw new Error('Order not found.');
      }
      return getOrder(selectedOrderSummary.id, { vendorId: currentVendor.vendorId });
    },
    { enabled: authContextReady && Boolean(selectedOrderSummary) },
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

  const orderKpis = [
    { label: 'Vendor orders', value: summary.total, detail: 'Current vendor scope', tone: 'orders', icon: 'O' },
    { label: 'Awaiting shipment', value: summary.awaitingShipment, detail: 'Needs fulfillment progress', tone: 'awaiting', icon: 'A' },
    { label: 'Blocked / attention', value: summary.blocked, detail: 'Reassignment or vendor block', tone: 'blocked', icon: 'B' },
    { label: 'Fulfilled', value: summary.fulfilled, detail: 'Fulfillment complete', tone: 'fulfilled', icon: 'F' },
    { label: 'Tracking visible', value: summary.tracked, detail: 'Carrier or tracking present', tone: 'tracking', icon: 'T' },
  ];

  const recentOrders = filteredOrders.slice(0, 3);

  if (!authContextReady || isLoading) {
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
    <section className="op-page orders-control-center orders-enterprise-workspace">
      <div className="orders-workspace-shell">
        <div className="orders-compact-header">
          <div>
            <div className="orders-title-row">
              <h2>Orders</h2>
              <StatusBadge tone="info">{currentVendor.vendorName}</StatusBadge>
            </div>
            <p>Manage shipments and tracking</p>
          </div>
          <div className="op-heading-meta">
            <StatusBadge tone={summary.blocked > 0 ? 'warning' : 'success'}>{summary.blocked} attention</StatusBadge>
          </div>
        </div>

        <div className="op-control-layout orders-control-layout orders-workspace-grid">
          <div className="orders-left-column">
            <div className="orders-enterprise-kpis">
              {orderKpis.map((metric) => (
                <article key={metric.label} className={`orders-enterprise-kpi orders-kpi-${metric.tone}`}>
                  <span className="orders-kpi-icon" aria-hidden="true">{metric.icon}</span>
                  <div>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </div>
                  <span className="orders-kpi-sparkline" aria-hidden="true" />
                </article>
              ))}
            </div>

            <div className="orders-filter-card">
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
            </div>

            <div className="op-main-column orders-table-shell">
            {filteredOrders.length === 0 ? (
              <EmptyStatePanel
                title="No orders in this view"
                description="Adjust the search or filters to inspect vendor-scoped Shopify orders."
              />
            ) : (
              <OperationalTable
                columns={['Order', 'Lifecycle', 'Value', 'Shipping', 'Updated', 'Actions']}
                className="orders-op-table orders-op-table-v3"
              >
                {filteredOrders.map((order) => (
                  <OperationalTableRow
                    key={order.id}
                    selected={selectedOrderSummary?.id === order.id}
                    onSelect={() => setSelectedOrderId(order.id)}
                  >
                    <span className="orders-table-order-cell">
                      <strong>{formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</strong>
                      <small>{getCustomerLabel(order.customer)}</small>
                      <small>{currentVendor.vendorName} · {order.channel}</small>
                    </span>
                    <div className="orders-table-status-cell">
                      <StatusBadge tone={getStatusTone(order.allocationStatus)}>{getAttentionLabel(order)}</StatusBadge>
                      <StatusBadge tone={getStatusTone(order.fulfillmentStatus)}>{order.fulfillmentStatus}</StatusBadge>
                      <small>{order.allocationStatus.replace(/_/g, ' ')}</small>
                    </div>
                    <span>
                      <strong className="finance-amount-emphasis">{order.amount}</strong>
                      <small>{getLineItemCount(order)} line items</small>
                    </span>
                    <span>
                      <StatusBadge tone={getStatusTone(order.shippingStatus)}>{order.shippingStatus}</StatusBadge>
                      <small>{getTrackingLabel(order)}</small>
                      <small>{getTrackingHelper(order)}</small>
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
          </div>

          <SideDetailPanel
            eyebrow="Order detail"
            title={selectedOrder ? `Shopify ${formatShopifyOrderNumber(selectedOrder.sourceShopifyOrderNumber)}` : 'No order selected'}
            action={selectedOrder ? <Link className="button button-secondary" to={`/orders/${selectedOrder.id}`}>Open</Link> : null}
          >
          {selectedOrder ? (
            <>
              <div className="orders-detail-hero">
                <div>
                  <span>Order number</span>
                  <strong>{formatShopifyOrderNumber(selectedOrder.sourceShopifyOrderNumber)}</strong>
                </div>
                <StatusBadge tone={getStatusTone(selectedOrder.status)}>{selectedOrder.status}</StatusBadge>
              </div>

              <div className="op-detail-status-row orders-detail-badges">
                <StatusBadge tone={getStatusTone(selectedOrder.allocationStatus)}>{selectedOrder.allocationStatus.replace(/_/g, ' ')}</StatusBadge>
                <StatusBadge tone={getStatusTone(selectedOrder.fulfillmentStatus)}>{selectedOrder.fulfillmentStatus}</StatusBadge>
                <StatusBadge tone={getStatusTone(selectedOrder.shippingStatus)}>{selectedOrder.shippingStatus}</StatusBadge>
              </div>

              <section className="orders-detail-card">
                <h4>Operational summary</h4>
                <div className="orders-detail-info-grid">
                  <div>
                    <span>Vendor</span>
                    <strong>{currentVendor.vendorName}</strong>
                  </div>
                  <div>
                    <span>Customer</span>
                    <strong>{getCustomerLabel(selectedOrder.customer)}</strong>
                  </div>
                  <div>
                    <span>Allocation</span>
                    <strong>{selectedOrder.id}</strong>
                  </div>
                  <div>
                    <span>Shopify ID</span>
                    <strong>{selectedOrder.sourceShopifyOrderId}</strong>
                  </div>
                  <div>
                    <span>Updated</span>
                    <strong>{formatDate(selectedOrder.shipmentUpdatedAt ?? selectedOrder.fulfilledAt ?? selectedOrder.date)}</strong>
                  </div>
                  <div>
                    <span>Source</span>
                    <strong>{selectedOrder.channel}</strong>
                  </div>
                </div>
              </section>

              <section className="orders-detail-card">
                <h4>Fulfillment and shipping</h4>
                <div className="orders-status-block-grid">
                  <div className="orders-status-block">
                    <span>Fulfillment</span>
                    <strong>{selectedOrder.fulfillmentStatus}</strong>
                  </div>
                  <div className="orders-status-block">
                    <span>Shipping</span>
                    <strong>{selectedOrder.shippingStatus}</strong>
                  </div>
                  <div className="orders-status-block">
                    <span>Tracking</span>
                    <strong>{getTrackingLabel(selectedOrder)}</strong>
                    <small>{selectedOrder.carrier ?? 'Carrier pending'}</small>
                  </div>
                </div>
                <div className="orders-detail-info-grid orders-detail-timestamps">
                  <div>
                    <span>Fulfilled at</span>
                    <strong>{formatDate(selectedOrder.fulfilledAt)}</strong>
                  </div>
                  <div>
                    <span>Shipment created</span>
                    <strong>{formatDate(selectedOrder.shipmentCreatedAt)}</strong>
                  </div>
                  <div>
                    <span>Shipment updated</span>
                    <strong>{formatDate(selectedOrder.shipmentUpdatedAt)}</strong>
                  </div>
                  <div>
                    <span>Tracking URL</span>
                    <strong>{selectedOrder.trackingUrl ? <a className="inline-link" href={selectedOrder.trackingUrl}>Open tracking</a> : 'Waiting Shopify sync'}</strong>
                  </div>
                </div>
              </section>

              <section className="orders-detail-card">
                <h4>Line items</h4>
                {(selectedOrder as OrderDetail).lineItems?.length ? (
                  <div className="order-detail-items">
                    {(selectedOrder as OrderDetail).lineItems.map((item) => (
                      <article key={item.id} className="order-detail-item">
                        <span className="order-detail-thumb" aria-hidden="true">{getItemInitials(item.name)}</span>
                        <div className="order-detail-item-copy">
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
              </section>

              <section className="orders-detail-card">
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
              </section>

              <section className="orders-detail-card orders-reconciliation-card">
                <h4>Reconciliation context</h4>
                <p className="page-description">
                  Reconcile from Diagnostics if fulfillment, shipping, or tracking looks stale.
                </p>
              </section>
            </>
          ) : (
            <EmptyStatePanel title="Select an order" description="Choose an order to inspect allocation, fulfillment, and tracking context." />
          )}
          </SideDetailPanel>
        </div>

        <div className="orders-insights-grid">
          <OperationalSection title="Operational insights" description="Current vendor-scoped order signals.">
            <div className="orders-insight-list">
              <div>
                <span>Awaiting shipment</span>
                <strong>{summary.awaitingShipment}</strong>
              </div>
              <div>
                <span>Blocked / attention</span>
                <strong>{summary.blocked}</strong>
              </div>
              <div>
                <span>Tracking visible</span>
                <strong>{summary.tracked}</strong>
              </div>
            </div>
          </OperationalSection>

          <OperationalSection title="Recent order activity" description="Latest orders in the current filtered view.">
            {recentOrders.length ? (
              <div className="orders-activity-list">
                {recentOrders.map((order) => (
                  <div key={order.id} className="orders-activity-row">
                    <span className="orders-activity-dot" aria-hidden="true" />
                    <div>
                      <strong>{formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</strong>
                      <small>{order.shippingStatus} · {formatDate(order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date)}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyStatePanel title="No records available" description="No records available." />
            )}
          </OperationalSection>

          <OperationalSection title="Automation signals" description="Order conditions that may need operator attention.">
            <div className="orders-insight-list">
              <div>
                <span>Reassignment or vendor block</span>
                <strong>{summary.blocked}</strong>
              </div>
              <div>
                <span>Awaiting shipment</span>
                <strong>{summary.awaitingShipment}</strong>
              </div>
              <div>
                <span>Current view</span>
                <strong>{filteredOrders.length}</strong>
              </div>
            </div>
          </OperationalSection>
        </div>
      </div>
    </section>
  );
}
