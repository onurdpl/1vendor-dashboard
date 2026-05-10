import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useServerResource } from '../lib/data';
import { listReturns, type ReturnSummary } from '../features/returns/api';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function ReturnsPage() {
  const { data: returns, isLoading, isError, error } = useServerResource(() => listReturns(), queryKeys.returns.list());

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

  if (returns.length === 0) {
    return (
      <DataStatePanel
        tone="empty"
        eyebrow="Returns"
        title="No return requests"
        description="Return workflows will show here when operational records are available."
      />
    );
  }

  return (
    <section className="dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Returns</p>
          <h2>Return processing</h2>
          <p className="page-description">
            Track return requests, approvals, and disposition states in one structured workspace.
          </p>
        </div>
      </div>

      <div className="returns-table">
        <div className="orders-row returns-head">
          <span>Return</span>
          <span>Status</span>
          <span>Date</span>
          <span>Related order</span>
          <span>Reason</span>
        </div>

        {returns.map((item: ReturnSummary) => (
          <Link key={item.id} to={`/returns/${item.id}`} className="orders-row orders-link return-link">
            <span className="order-id">{item.id}</span>
            <span className={`status-badge status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>
              {item.status}
            </span>
            <span>{formatDate(item.date)}</span>
            <span>{item.relatedOrderId}</span>
            <span>{item.reason}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
