import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useActionFeedback } from '../lib/ui';
import { getFinanceDashboard } from '../features/finance/api';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function FinancePage() {
  const { data: finance, isLoading, isError, error } = useQueryResource(queryKeys.finance.summary(), getFinanceDashboard);
  const { message, tone, showFeedback } = useActionFeedback();

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Finance"
        title="Loading finance overview"
        description="Fetching summary data and financial records from the central data layer."
      />
    );
  }

  if (isError || !finance) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Finance"
        title="Finance unavailable"
        description={error ?? 'The financial overview could not be loaded.'}
      />
    );
  }

  return (
    <section className="dashboard finance-dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>Finance workspace</h2>
          <p className="page-description">
            Keep payout review, invoice handling, and cashflow visibility in the same app frame.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => showFeedback('Finance snapshot exported for review.', 'success')}
        >
          Export snapshot
        </button>
      </div>

      <div className="finance-summary-grid">
        <article className="finance-summary-card">
          <span>Total revenue</span>
          <strong>{finance.summary.totalRevenue}</strong>
        </article>
        <article className="finance-summary-card">
          <span>Available balance</span>
          <strong>{finance.summary.availableBalance}</strong>
        </article>
        <article className="finance-summary-card">
          <span>Pending payouts</span>
          <strong>{finance.summary.pendingPayouts}</strong>
        </article>
        <article className="finance-summary-card">
          <span>Refunds this month</span>
          <strong>{finance.summary.refundsThisMonth}</strong>
        </article>
      </div>

      <article className="panel">
        <h3>Financial records</h3>
        {finance.transactions.length === 0 ? (
          <div className="inline-state">
            <DataStatePanel
              tone="empty"
              eyebrow="Finance"
              title="No financial records"
              description="Financial transactions will appear here once records are available."
            />
          </div>
        ) : (
          <div className="finance-table">
            <div className="finance-row finance-head">
              <span>Record</span>
              <span>Status</span>
              <span>Date</span>
              <span>Counterparty</span>
              <span>Category</span>
              <span>Amount</span>
            </div>

            {finance.transactions.map((record) => (
              <div key={record.id} className="finance-row">
                <span className="order-id">{record.id}</span>
                <span className={`status-badge status-${record.status.toLowerCase().replace(/\s+/g, '-')}`}>
                  {record.status}
                </span>
                <span>{formatDate(record.date)}</span>
                <span>{record.counterparty}</span>
                <span>{record.category}</span>
                <span>{record.amount}</span>
              </div>
            ))}
          </div>
        )}
      </article>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
