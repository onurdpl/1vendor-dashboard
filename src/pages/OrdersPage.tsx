import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useServerResource } from '../lib/data';
import { listOrders, type OrderSummary } from '../features/orders/api';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function OrdersPage() {
  const { data: orders, isLoading, isError, error } = useServerResource(() => listOrders(), queryKeys.orders.list());

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
      <DataStatePanel
        tone="empty"
        eyebrow="Orders"
        title="No orders yet"
        description="Orders will appear here once the operations queue receives live records."
      />
    );
  }

  return (
    <section className="dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Orders</p>
          <h2>Order operations</h2>
          <p className="page-description">
            Monitor order flow, fulfillment state, and exceptions from the shared dashboard shell.
          </p>
        </div>
      </div>

      <div className="orders-table">
        <div className="orders-row orders-head">
          <span>Order</span>
          <span>Status</span>
          <span>Date</span>
          <span>Customer</span>
          <span>Amount</span>
        </div>

        {orders.map((order: OrderSummary) => (
          <Link key={order.id} to={`/orders/${order.id}`} className="orders-row orders-link">
            <span className="order-id">{order.id}</span>
            <span className={`status-badge status-${order.status.toLowerCase().replace(/\s+/g, '-')}`}>
              {order.status}
            </span>
            <span>{formatDate(order.date)}</span>
            <span>{order.customer}</span>
            <span>{order.amount}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
