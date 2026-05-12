import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useActionFeedback } from '../lib/ui';
import { getFinanceDashboard } from '../features/finance/api';
import { getCurrentUser, getCurrentVendorContext } from '../lib/auth';

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
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();

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
    <section className="dashboard finance-dashboard finance-workspace">
      <div className="hero-card operational-card queue-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Finance</p>
          <h2>{currentVendor.vendorName} payout workspace</h2>
          <p className="page-description">
            {currentUser?.role === 'admin'
              ? 'Vendor-scoped payout and deduction view for the selected vendor.'
              : 'Your vendor payout, deductions, and finance records in one workspace.'}
          </p>
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-normal">Vendor {currentVendor.vendorName}</span>
          <span className="severity-chip severity-attention">Refunds {finance.summary.refunds}</span>
        </div>
      </div>

      <div className="finance-summary-grid finance-kpi-grid">
        <article className="finance-summary-card operational-card">
          <span>Gross sales</span>
          <strong>{finance.summary.grossSales}</strong>
        </article>
        <article className="finance-summary-card operational-card deduction-card">
          <span>Refunds</span>
          <strong>-{finance.summary.refunds}</strong>
        </article>
        <article className="finance-summary-card operational-card">
          <span>Net revenue</span>
          <strong>{finance.summary.netRevenue}</strong>
        </article>
        <article className="finance-summary-card operational-card deduction-card">
          <span>Platform fee</span>
          <strong>-{finance.summary.platformFee}</strong>
        </article>
        <article className="finance-summary-card operational-card payout-card">
          <span>Payout estimate</span>
          <strong>{finance.summary.payoutEstimate}</strong>
        </article>
      </div>

      <article className="panel operational-card">
        <h3>Payout summary</h3>
        <div className="allocation-summary-grid finance-formula-grid">
          <div className="summary-row">
            <span>Gross sales</span>
            <strong>{finance.summary.grossSales}</strong>
          </div>
          <div className="summary-row">
            <span>Refund deductions</span>
            <strong className="finance-negative">-{finance.summary.refunds}</strong>
          </div>
          <div className="summary-row">
            <span>Platform fee</span>
            <strong className="finance-negative">-{finance.summary.platformFee}</strong>
          </div>
          <div className="summary-row">
            <span>Payout estimate</span>
            <strong>{finance.summary.payoutEstimate}</strong>
          </div>
        </div>
        <p className="page-description finance-formula-note">
          Gross sales - refunds - platform fee = payout estimate
        </p>
      </article>

      <article className="panel operational-card">
        <div className="queue-list-header">
          <h3>Finance records</h3>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => showFeedback('Finance snapshot exported for review.', 'success')}
          >
            Export snapshot
          </button>
        </div>
        {finance.transactions.length === 0 ? (
          <div className="queue-empty">
            <p className="eyebrow">Records</p>
            <h3>No finance records yet</h3>
            <p className="page-description">
              No ledger activity is recorded for this vendor scope yet. Processed sales, refunds, and fee entries will appear here.
            </p>
          </div>
        ) : (
          <div className="queue-list">
            {finance.transactions.map((record) => (
              <article key={record.id} className="queue-item queue-low finance-record">
                <header className="queue-item-top">
                  <div className="queue-title-block">
                    <h4>{record.category}</h4>
                    <span className="queue-description">{record.description}</span>
                  </div>
                  <span className={`status-badge status-${record.status.toLowerCase().replace(/\s+/g, '-')}`}>
                    {record.status}
                  </span>
                </header>
                <div className="queue-meta">
                  <span>
                    <strong>Record:</strong> {record.id}
                  </span>
                  <span>
                    <strong>Counterparty:</strong> {record.counterparty}
                  </span>
                  <span>
                    <strong>Date:</strong> {formatDate(record.date)}
                  </span>
                  <span>
                    <strong>Type:</strong> {record.category}
                  </span>
                </div>
                <div className="queue-actions">
                  <span
                    className={`finance-amount ${
                      record.category === 'Refund' || record.category === 'Adjustment' ? 'finance-negative' : 'finance-positive'
                    }`}
                  >
                    {record.category === 'Refund' || record.category === 'Adjustment' ? '-' : ''}
                    {record.amount}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
