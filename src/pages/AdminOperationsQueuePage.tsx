import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { runtimeServices } from '../services/runtime-services';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function classifyOperationalSource(item: {
  type: string;
  title: string;
  description: string;
}) {
  const haystack = `${item.type} ${item.title} ${item.description}`.toLowerCase();

  if (item.type === 'awaiting_shipment') {
    return 'Awaiting shipment';
  }
  if (item.type === 'vendor_blocked') {
    return 'Blocked allocation';
  }
  if (item.type === 'pending_reassignment') {
    return 'Pending reassignment';
  }
  if (item.type === 'refund_attention') {
    if (haystack.includes('return request') || haystack.includes('returns/request')) {
      return 'Pending return request';
    }
    return 'Refund attention';
  }
  if (
    haystack.includes('webhook') ||
    haystack.includes('reconciliation') ||
    haystack.includes('sync failed') ||
    haystack.includes('needs attention')
  ) {
    return 'Webhook/reconciliation issue';
  }

  return 'Operational issue';
}

export function AdminOperationsQueuePage() {
  const { data: queue, isLoading, isError, error } = useQueryResource(queryKeys.admin.operations.queue(), () =>
    runtimeServices.operations.list(),
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
  const criticalCount = queue.filter((item) => item.severity === 'critical').length;
  const warningCount = queue.filter((item) => item.severity === 'high').length;
  const attentionCount = queue.filter((item) => item.severity === 'medium').length;
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const sortedQueue = [...queue].sort((a, b) => {
    const severityDiff = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  function getSeverityClass(severity: string) {
    if (severity === 'critical') {
      return 'severity-critical';
    }
    if (severity === 'high') {
      return 'severity-warning';
    }
    if (severity === 'medium') {
      return 'severity-attention';
    }
    return 'severity-normal';
  }

  function getActionLabel(type: string, fallback?: string) {
    if (type === 'pending_reassignment') {
      return 'Review Allocation';
    }
    if (type === 'vendor_blocked') {
      return 'Review Allocation';
    }
    if (type === 'awaiting_shipment') {
      return 'View Shopify Order';
    }
    if (type === 'refund_attention') {
      return 'View Shopify Order';
    }
    return fallback ?? 'View details';
  }

  return (
    <section className="dashboard operations-workspace">
      <div className="hero-card operational-card queue-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Admin operations</p>
          <h2>Operations Queue</h2>
          <p className="page-description">
            Unified control center for reassignment risk, shipping progress, blocked allocations, and refund review.
          </p>
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-critical">Critical {criticalCount}</span>
          <span className="severity-chip severity-warning">Warning {warningCount}</span>
          <span className="severity-chip severity-attention">Attention {attentionCount}</span>
          <span className="severity-chip severity-normal">Total {sortedQueue.length}</span>
        </div>
      </div>

      <div className="stats-grid queue-stats">
        <article className="stat-card operational-card">
          <span className="stat-label">Pending reassignment</span>
          <strong>{summary.pending_reassignment ?? 0}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Awaiting shipment</span>
          <strong>{summary.awaiting_shipment ?? 0}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Vendor blocked</span>
          <strong>{summary.vendor_blocked ?? 0}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Refund attention</span>
          <strong>{summary.refund_attention ?? 0}</strong>
        </article>
      </div>

      <article className="panel operational-card">
        <div className="queue-list-header">
          <h3>Operational tasks</h3>
          <p className="page-description">Prioritized admin tasks derived from current vendor allocation workflows.</p>
        </div>
        {sortedQueue.length === 0 ? (
          <div className="queue-empty">
            <p className="eyebrow">Queue health</p>
            <h3>No active operational issues</h3>
            <p className="page-description">
              Reassignment, blocked allocation, shipment, and refund queues are currently clear.
            </p>
          </div>
        ) : (
          <div className="queue-list">
            {sortedQueue.map((item) => (
              <article key={item.id} className={`queue-item queue-${item.severity}`}>
                <header className="queue-item-top">
                  <div className="queue-title-block">
                    <span className={`severity-chip ${getSeverityClass(item.severity)}`}>{item.severity}</span>
                    <h4>{item.title}</h4>
                  </div>
                  <span className={`status-badge status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>{item.status}</span>
                </header>
                <p className="queue-description">{item.description}</p>
                <div className="queue-meta">
                  <span>
                    <strong>Source:</strong> {classifyOperationalSource(item)}
                  </span>
                  <span>
                    <strong>Type:</strong> {item.type}
                  </span>
                  <span>
                    <strong>Vendor:</strong> {item.vendorName ?? item.vendorId}
                  </span>
                  <span>
                    <strong>Order:</strong> {item.relatedOrderId ?? item.relatedShopifyOrderId ?? 'N/A'}
                  </span>
                  <span>
                    <strong>Created:</strong> {formatDate(item.createdAt)}
                  </span>
                </div>
                <div className="queue-actions">
                  {item.actionTo ? (
                    <Link
                      className={item.type === 'pending_reassignment' || item.type === 'vendor_blocked' ? 'button button-primary' : 'button button-secondary'}
                      to={item.actionTo}
                    >
                      {getActionLabel(item.type, item.actionLabel)}
                    </Link>
                  ) : (
                    <span className="queue-muted-action">{item.actionLabel ?? 'No action available'}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
