import { useEffect, useState } from 'react';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  KPIStatCard,
  MetadataRow,
  OperationalSection,
  StatusBadge,
} from '../components/OperationalPrimitives';
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
    <section className="op-page dashboard-command-center">
      <div className="op-page-heading dashboard-command-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>{dashboard.title}</h2>
          <p className="page-description">{dashboard.description}</p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">Vendor {dashboard.vendorName}</StatusBadge>
          <StatusBadge tone="attention">
            Awaiting shipment {dashboard.priorityWork.find((item) => item.label === 'Awaiting shipment')?.value ?? '0'}
          </StatusBadge>
          <StatusBadge tone="warning">
            Needs attention {getPriorityValue(dashboard.priorityWork, 'Blocked allocations') + getPriorityValue(dashboard.priorityWork, 'Refund attention')}
          </StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row dashboard-kpi-row">
        {dashboard.stats.map((stat) => (
          <KPIStatCard key={stat.label} label={stat.label} value={stat.value} detail="Current vendor scope" tone={stat.label.includes('Blocked') || stat.label.includes('Refund') ? 'attention' : 'neutral'} />
        ))}
      </div>

      <div className="dashboard-command-grid">
        <OperationalSection
          title="Priority work"
          description="Current operational work sorted by fulfillment, return, refund, and automation attention."
        >
          <div className="dashboard-priority-list">
            {dashboard.priorityWork.map((item) => (
              <article key={item.label} className="dashboard-priority-row">
                <header>
                  <div>
                    <strong>{item.label}</strong>
                    {item.description ? <p>{item.description}</p> : null}
                  </div>
                  <span className={`severity-chip ${item.tone}`}>{item.value}</span>
                </header>
              </article>
            ))}
          </div>
        </OperationalSection>

        <OperationalSection title="Finance snapshot" description="Reporting-only finance visibility. Payout execution is not enabled yet.">
          <div className="op-meta-grid">
            <MetadataRow label="Gross sales" value={dashboard.financeSnapshot?.grossSales ?? 'Not synced'} />
            <MetadataRow label="Refunds" value={dashboard.financeSnapshot?.refunds ?? 'Not synced'} />
            <MetadataRow label="Net revenue" value={dashboard.financeSnapshot?.netRevenue ?? 'Not synced'} />
            <MetadataRow label="Payout estimate" value={dashboard.financeSnapshot?.payoutEstimate ?? 'Not synced'} />
          </div>
        </OperationalSection>

        <OperationalSection title="Recent activity" description="Latest vendor-scoped operational signals.">
          {dashboard.recentActivity.length === 0 ? (
            <EmptyStatePanel title="No recent activity" description="No recent activity for the current vendor." />
          ) : (
            <ul className="dashboard-activity-list">
              {dashboard.recentActivity.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </OperationalSection>

        {currentUser?.role === 'admin' ? (
          <OperationalSection title="Diagnostics summary" description="Admin-only webhook and reconciliation attention.">
            {dashboard.diagnosticsSummary ? (
              <div className="dashboard-signal-row">
                <StatusBadge tone={dashboard.diagnosticsSummary.failedWebhooks > 0 ? 'danger' : 'success'}>
                  Failed webhooks {dashboard.diagnosticsSummary.failedWebhooks}
                </StatusBadge>
                <StatusBadge tone={dashboard.diagnosticsSummary.stuckReceived > 0 ? 'attention' : 'success'}>
                  Stuck received {dashboard.diagnosticsSummary.stuckReceived}
                </StatusBadge>
                <StatusBadge tone={dashboard.diagnosticsSummary.fulfillmentSyncFailures > 0 ? 'warning' : 'success'}>
                  Fulfillment sync failures {dashboard.diagnosticsSummary.fulfillmentSyncFailures}
                </StatusBadge>
              </div>
            ) : (
              <EmptyStatePanel title="Diagnostics unavailable" description="Not synced for this scope." />
            )}
          </OperationalSection>
        ) : null}
      </div>

      <OperationalSection title="Workspace status">
        <p>{dashboard.workspaceStatus}</p>
        {dashboard.partialDataWarnings?.length ? (
          <ul className="dashboard-activity-list">
            {dashboard.partialDataWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </OperationalSection>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
