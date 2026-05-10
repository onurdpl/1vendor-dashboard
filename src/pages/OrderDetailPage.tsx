import { Link, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getOrder, type OrderDetail as OrderDetailType } from '../features/orders/api';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const { data: order, isLoading, isError, error } = useQueryResource(
    orderId ? queryKeys.orders.detail(orderId) : queryKeys.orders.list(),
    () => {
      if (!orderId) {
        throw new Error('Order not found.');
      }

      return getOrder(orderId);
    },
  );

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Orders"
        title="Loading order"
        description="Fetching the selected order from the central data layer."
      />
    );
  }

  if (isError || !order) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Orders"
        title="Order unavailable"
        description={error ?? 'The selected order could not be loaded.'}
        actionLabel="Back to orders"
        actionTo="/orders"
      />
    );
  }

  return (
    <section className="dashboard order-detail">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Orders</p>
          <h2>{order.id}</h2>
          <p className="page-description">
            {order.customer} · {formatDate(order.date)}
          </p>
        </div>
        <div className={`status-badge status-${order.status.toLowerCase().replace(/\s+/g, '-')}`}>
          {order.status}
        </div>
      </div>

      <div className="detail-grid">
        <article className="panel">
          <h3>Summary</h3>
          <dl className="detail-list">
            <div>
              <dt>Amount</dt>
              <dd>{order.amount}</dd>
            </div>
            <div>
              <dt>Channel</dt>
              <dd>{order.channel}</dd>
            </div>
            <div>
              <dt>Shipping address</dt>
              <dd>{order.shippingAddress}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{order.notes}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h3>Timeline</h3>
          <ul className="timeline">
            {order.timeline.map((entry) => (
              <li key={entry.label}>
                <strong>{entry.label}</strong>
                <span>{formatDate(entry.at)}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="panel">
        <h3>Line items</h3>
        <div className="line-item-table">
          <div className="line-item-head">
            <span>Item</span>
            <span>Quantity</span>
            <span>Price</span>
          </div>
          {order.items.map((item) => (
            <div key={item.name} className="line-item-row">
              <span>{item.name}</span>
              <span>{item.quantity}</span>
              <span>{item.price}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
