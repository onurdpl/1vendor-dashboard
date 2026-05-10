import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { listOrders, type OrderSummary } from '../features/orders/api';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function OrdersPage() {
  const { data: orders, isLoading, isError, error } = useQueryResource(queryKeys.orders.list(), listOrders);

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

  if (orders.length === 0) {
    return (
      <section className="dashboard orders-workspace">
        <div className="hero-card operational-card queue-header">
          <div className="queue-header-copy">
            <p className="eyebrow">Orders</p>
            <h2>Vendor order queue</h2>
            <p className="page-description">Operational fulfillment queue for the currently selected vendor context.</p>
          </div>
        </div>
        <article className="panel operational-card">
          <div className="queue-empty">
            <p className="eyebrow">Queue health</p>
            <h3>No active orders</h3>
            <p className="page-description">New vendor-scoped orders will appear here when available.</p>
          </div>
        </article>
      </section>
    );
  }

  const summary = {
    total: orders.length,
    awaitingShipment: orders.filter((order) => order.shippingStatus === 'Awaiting Shipment').length,
    blocked: orders.filter(
      (order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked',
    ).length,
    fulfilled: orders.filter((order) => order.fulfillmentStatus === 'Fulfilled').length,
  };

  const rankedOrders = [...orders].sort((a, b) => {
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

    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return (
    <section className="dashboard orders-workspace">
      <div className="hero-card operational-card queue-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Orders</p>
          <h2>Vendor order queue</h2>
          <p className="page-description">
            Scannable fulfillment queue for current vendor context, including shipping progress and blocker visibility.
          </p>
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-normal">Total {summary.total}</span>
          <span className="severity-chip severity-attention">Awaiting shipment {summary.awaitingShipment}</span>
          <span className="severity-chip severity-warning">Needs attention {summary.blocked}</span>
          <span className="severity-chip severity-low">Fulfilled {summary.fulfilled}</span>
        </div>
      </div>

      <div className="stats-grid queue-stats">
        <article className="stat-card operational-card">
          <span className="stat-label">Total orders</span>
          <strong>{summary.total}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Awaiting shipment</span>
          <strong>{summary.awaitingShipment}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Blocked / attention</span>
          <strong>{summary.blocked}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Fulfilled</span>
          <strong>{summary.fulfilled}</strong>
        </article>
      </div>

      <article className="panel operational-card">
        <div className="queue-list-header">
          <h3>Operational orders</h3>
          <p className="page-description">Prioritized by blockers, reassignment risk, and shipment urgency.</p>
        </div>
        <div className="queue-list">
          {rankedOrders.map((order: OrderSummary) => {
            const lineItemCount =
              (order as OrderSummary & { lineItemCount?: number }).lineItemCount ??
              (order as OrderSummary & { lineItems?: unknown[] }).lineItems?.length ??
              (order as OrderSummary & { items?: unknown[] }).items?.length ??
              null;
            const needsAttention =
              order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked';

            return (
              <article
                key={order.id}
                className={`queue-item ${needsAttention ? 'queue-high' : order.fulfillmentStatus === 'Fulfilled' ? 'queue-low' : 'queue-medium'}`}
              >
                <header className="queue-item-top">
                  <div className="queue-title-block">
                    <h4>{order.id}</h4>
                    <span className="queue-description">
                      Shopify #{order.sourceShopifyOrderNumber} · {order.customer}
                    </span>
                  </div>
                  <span className={`status-badge status-${order.allocationStatus}`}>{order.allocationStatus}</span>
                </header>

                <div className="queue-meta">
                  <span>
                    <strong>Status:</strong> {order.status}
                  </span>
                  <span>
                    <strong>Fulfillment:</strong> {order.fulfillmentStatus}
                  </span>
                  <span>
                    <strong>Shipping:</strong> {order.shippingStatus}
                  </span>
                  <span>
                    <strong>Date:</strong> {formatDate(order.date)}
                  </span>
                  <span>
                    <strong>Value:</strong> {order.amount}
                  </span>
                  <span>
                    <strong>Line items:</strong> {lineItemCount ?? '—'}
                  </span>
                </div>

                <div className="queue-actions">
                  <span
                    className={`severity-chip ${
                      needsAttention ? 'severity-warning' : order.shippingStatus === 'Awaiting Shipment' ? 'severity-attention' : 'severity-normal'
                    }`}
                  >
                    {needsAttention
                      ? 'Needs attention'
                      : order.shippingStatus === 'Awaiting Shipment'
                        ? 'Awaiting shipment'
                        : 'In flow'}
                  </span>
                  <Link className="button button-secondary" to={`/orders/${order.id}`}>
                    View order
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </article>
    </section>
  );
}
