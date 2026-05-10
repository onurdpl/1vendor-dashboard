import { Link, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getReturn } from '../features/returns/api';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function ReturnDetailPage() {
  const { returnId } = useParams();
  const { data: returnRequest, isLoading, isError, error } = useQueryResource(
    returnId ? queryKeys.returns.detail(returnId) : queryKeys.returns.list(),
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return getReturn(returnId);
    },
  );

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Returns"
        title="Loading return request"
        description="Fetching the selected return from the central data layer."
      />
    );
  }

  if (isError || !returnRequest) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Returns"
        title="Return unavailable"
        description={error ?? 'The selected return could not be loaded.'}
        actionNode={
          <Link className="button button-secondary" to="/returns">
            Back to returns
          </Link>
        }
      />
    );
  }

  return (
    <section className="dashboard return-detail">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Returns</p>
          <h2>{returnRequest.id}</h2>
          <p className="page-description">
            {returnRequest.customer} · Related order {returnRequest.relatedOrderId}
          </p>
        </div>
        <div className={`status-badge status-${returnRequest.status.toLowerCase().replace(/\s+/g, '-')}`}>
          {returnRequest.status}
        </div>
      </div>

      <div className="detail-grid">
        <article className="panel">
          <h3>Summary</h3>
          <dl className="detail-list">
            <div>
              <dt>Date</dt>
              <dd>{formatDate(returnRequest.date)}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{returnRequest.amount}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{returnRequest.reason}</dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>{returnRequest.resolution}</dd>
            </div>
            <div>
              <dt>Refund method</dt>
              <dd>{returnRequest.refundMethod}</dd>
            </div>
            <div>
              <dt>Processed by</dt>
              <dd>{returnRequest.processedBy}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h3>Workflow timeline</h3>
          <ul className="timeline">
            {returnRequest.timeline.map((entry) => (
              <li key={entry.label}>
                <strong>{entry.label}</strong>
                <span>{formatDate(entry.at)}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="detail-grid">
        <article className="panel">
          <h3>Item details</h3>
          <div className="line-item-table">
            <div className="line-item-head">
              <span>Item</span>
              <span>Quantity</span>
              <span>Condition</span>
            </div>
            {returnRequest.items.map((item) => (
              <div key={item.name} className="line-item-row">
                <span>{item.name}</span>
                <span>{item.quantity}</span>
                <span>{item.condition}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h3>Operational context</h3>
          <p>
            This return workflow is structured to support review, approval, rejection, and refund
            states without needing to change the surrounding dashboard patterns.
          </p>
        </article>
      </div>
    </section>
  );
}
