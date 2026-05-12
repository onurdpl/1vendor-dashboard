import { useEffect, useState } from 'react';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import { useActionFeedback } from '../lib/ui';
import { getDashboardOverview } from '../lib/api/dashboard';
import { getCurrentUser, getCurrentVendorContext, onVendorChange } from '../lib/auth';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';

function getPriorityValue(items: { label: string; value: string }[], label: string) {
  return Number.parseInt(items.find((item) => item.label === label)?.value ?? '0', 10) || 0;
}

export function DashboardPage() {
  const [vendorId, setVendorId] = useState(() => getCurrentVendorContext().vendorId);
  const currentUser = getCurrentUser();
  const { message, tone } = useActionFeedback();
  const { data: dashboard, isLoading, isError, error } = useQueryResource(
    queryKeys.dashboard.overview(),
    () => getDashboardOverview(vendorId),
  );

  useEffect(() => {
    return onVendorChange(() => {
      setVendorId(getCurrentVendorContext().vendorId);
    });
  }, []);

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Dashboard"
        title="Loading operational overview"
        description="Gathering backend-derived dashboard signals for the current vendor scope."
      />
    );
  }

  if (isError || !dashboard) {
    return (
      <section className="dashboard dashboard-workspace">
        <article className="panel operational-card">
          <p className="eyebrow">Dashboard</p>
          <h2>Operational overview unavailable</h2>
          <p className="page-description">{error ?? 'The backend-derived dashboard overview could not be loaded.'}</p>
        </article>
        {message ? <ActionFeedback tone={tone} message={message} /> : null}
      </section>
    );
  }

  return (
    <section className="dashboard dashboard-workspace">
      <div className="hero-card operational-card dashboard-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Dashboard</p>
          <h2>{dashboard.title}</h2>
          <p className="page-description">{dashboard.description}</p>
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-normal">Vendor {dashboard.vendorName}</span>
          <span className="severity-chip severity-attention">
            Awaiting shipment {dashboard.priorityWork.find((item) => item.label === 'Awaiting shipment')?.value ?? '0'}
          </span>
          <span className="severity-chip severity-warning">
            Needs attention {getPriorityValue(dashboard.priorityWork, 'Blocked allocations') + getPriorityValue(dashboard.priorityWork, 'Refund attention')}
          </span>
        </div>
      </div>

      <div className="stats-grid queue-stats">
        {dashboard.stats.map((stat) => (
          <article key={stat.label} className="stat-card operational-card">
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </div>

      <div className="content-grid dashboard-grid">
        <article className="panel operational-card">
          <h3>Priority work</h3>
          <div className="queue-list">
            {dashboard.priorityWork.map((item) => (
              <article key={item.label} className="queue-item queue-medium">
                <header className="queue-item-top">
                  <h4>{item.label}</h4>
                  <span className={`severity-chip ${item.tone}`}>{item.value}</span>
                </header>
                {item.description ? <p className="queue-description">{item.description}</p> : null}
              </article>
            ))}
          </div>
        </article>

        <article className="panel operational-card">
          <h3>Finance snapshot</h3>
          <div className="allocation-summary-grid">
            <div className="summary-row">
              <span>Gross sales</span>
              <strong>{dashboard.financeSnapshot?.grossSales ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Refunds</span>
              <strong>{dashboard.financeSnapshot?.refunds ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Net revenue</span>
              <strong>{dashboard.financeSnapshot?.netRevenue ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Payout estimate</span>
              <strong>{dashboard.financeSnapshot?.payoutEstimate ?? '—'}</strong>
            </div>
          </div>
        </article>
      </div>

      <div className="content-grid dashboard-grid">
        <article className="panel operational-card">
          <h3>Recent activity</h3>
          {dashboard.recentActivity.length === 0 ? (
            <div className="queue-empty">
              <p className="page-description">No recent activity for the current vendor.</p>
            </div>
          ) : (
            <ul className="list">
              {dashboard.recentActivity.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </article>
        {currentUser?.role === 'admin' ? (
          <article className="panel operational-card">
            <h3>Diagnostics summary</h3>
            {dashboard.diagnosticsSummary ? (
              <div className="allocation-summary-grid">
                <div className="summary-row">
                  <span>Failed webhooks</span>
                  <strong>{dashboard.diagnosticsSummary.failedWebhooks}</strong>
                </div>
                <div className="summary-row">
                  <span>Stuck received</span>
                  <strong>{dashboard.diagnosticsSummary.stuckReceived}</strong>
                </div>
                <div className="summary-row">
                  <span>Fulfillment sync failures</span>
                  <strong>{dashboard.diagnosticsSummary.fulfillmentSyncFailures}</strong>
                </div>
              </div>
            ) : (
              <div className="queue-empty">
                <p className="page-description">Diagnostics summary is unavailable for the current scope.</p>
              </div>
            )}
          </article>
        ) : (
          <article className="panel operational-card">
            <h3>Operational signals</h3>
            <div className="queue-list">
              {dashboard.priorityWork.map((item) => (
                <article key={item.label} className="queue-item queue-low">
                  <header className="queue-item-top">
                    <h4>{item.label}</h4>
                    <span className={`severity-chip ${item.tone}`}>{item.value}</span>
                  </header>
                  {item.description ? <p className="queue-description">{item.description}</p> : null}
                </article>
              ))}
            </div>
          </article>
        )}
      </div>

      <article className="panel operational-card">
        <h3>Workspace status</h3>
        <p>{dashboard.workspaceStatus}</p>
        {dashboard.partialDataWarnings?.length ? (
          <ul className="list">
            {dashboard.partialDataWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </article>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
