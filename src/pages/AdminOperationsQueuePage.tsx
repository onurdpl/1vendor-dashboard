import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { useQueryResource } from '../hooks/useQueryResource';
import { listAdminOperationsQueue } from '../lib/api/operations';
import { queryKeys } from '../lib/api/queryKeys';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AdminOperationsQueuePage() {
  const { data: queue, isLoading, isError, error } = useQueryResource(queryKeys.admin.operations.queue(), () =>
    Promise.resolve(listAdminOperationsQueue()),
  );

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Admin operations"
        title="Loading operations queue"
        description="Collecting allocation, fulfillment, and refund attention items."
      />
    );
  }

  if (isError || !queue) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Admin operations"
        title="Queue unavailable"
        description={error ?? 'Operations queue could not be loaded.'}
      />
    );
  }

  const summary = queue.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Admin operations</p>
          <h2>Operations queue</h2>
          <p className="page-description">Central queue for reassignment, blocking, shipment, and refund attention.</p>
        </div>
      </div>

      <div className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">Pending reassignment</span>
          <strong>{summary.pending_reassignment ?? 0}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Vendor blocked</span>
          <strong>{summary.vendor_blocked ?? 0}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Awaiting shipment</span>
          <strong>{summary.awaiting_shipment ?? 0}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Refund attention</span>
          <strong>{summary.refund_attention ?? 0}</strong>
        </article>
      </div>

      <article className="panel">
        <h3>Queue items</h3>
        <div className="line-item-table">
          <div className="line-item-head">
            <span>Type</span>
            <span>Severity</span>
            <span>Vendor</span>
            <span>Related order</span>
            <span>Status</span>
            <span>Created</span>
            <span>Action</span>
          </div>
          {queue.map((item) => (
            <div key={item.id} className="line-item-row">
              <span>{item.type}</span>
              <span>{item.severity}</span>
              <span>{item.vendorName ?? item.vendorId}</span>
              <span>{item.relatedOrderId ?? item.relatedShopifyOrderId ?? 'N/A'}</span>
              <span>{item.status}</span>
              <span>{formatDate(item.createdAt)}</span>
              <span>
                {item.actionTo ? (
                  <Link className="button button-secondary" to={item.actionTo}>
                    {item.actionLabel ?? 'Open'}
                  </Link>
                ) : (
                  item.actionLabel ?? 'N/A'
                )}
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
