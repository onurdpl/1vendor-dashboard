import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  KPIStatCard,
  OperationalTable,
  OperationalTableRow,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { getAdminSupportAnalytics, type SupportAnalyticsCategoryInsight } from '../features/support/api';
import { formatSupportLabel } from './AdminSupportTicketsPage';

function formatHours(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }
  return `${value}h`;
}

function formatPercent(value: number) {
  return `${value}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function getCategoryTone(entry: SupportAnalyticsCategoryInsight) {
  if (entry.overduePercent >= 25) {
    return 'danger' as const;
  }
  if (entry.overduePercent > 0) {
    return 'warning' as const;
  }
  return 'success' as const;
}

export function AdminSupportAnalyticsPage() {
  const appReadiness = useAppReadiness();
  const { data: analytics, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.admin.support.analytics(),
    ({ signal }) => getAdminSupportAnalytics({ signal }),
    { enabled: appReadiness.ready },
  );

  if (!appReadiness.ready || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Support analytics"
        title="Loading support analytics"
        description="Aggregating support ticket trends and SLA health."
      />
    );
  }

  if (isError || !analytics) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Support analytics"
        title="Support analytics unavailable"
        description={error ?? 'Unable to load support analytics.'}
        diagnostics={diagnostics}
        onRetry={() => void refetch()}
      />
    );
  }

  const needsAttentionVendors = analytics.vendorInsights.filter((vendor) => vendor.needsAttention);

  return (
    <section className="op-page support-ops-page support-analytics-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Support analytics</p>
          <h1>Support Analytics</h1>
          <p>Operational support volume, SLA health, vendor trends, and assignment workload.</p>
        </div>
        <Link to="/admin/support" className="button button-secondary button-link">
          Back to queue
        </Link>
      </div>

      <div className="support-analytics-kpis">
        <KPIStatCard label="Open tickets" value={analytics.kpis.openTickets} detail="Unresolved support load" tone="info" />
        <KPIStatCard label="Overdue tickets" value={analytics.kpis.overdueTickets} detail="SLA currently breached" tone={analytics.kpis.overdueTickets ? 'danger' : 'success'} />
        <KPIStatCard label="Avg first response" value={formatHours(analytics.kpis.avgFirstResponseHours)} detail="First admin public reply" tone="neutral" />
        <KPIStatCard label="Avg resolution" value={formatHours(analytics.kpis.avgResolutionHours)} detail="Resolved or closed tickets" tone="neutral" />
        <KPIStatCard label="Waiting on vendor" value={analytics.kpis.waitingOnVendor} detail="Vendor response needed" tone="warning" />
        <KPIStatCard label="Resolved today" value={analytics.kpis.resolvedToday} detail="Closed support work" tone="success" />
      </div>

      <div className="support-analytics-grid">
        <article className="support-card">
          <div className="support-card-header">
            <div>
              <p className="eyebrow">Trends</p>
              <h3>Last 7 days</h3>
            </div>
          </div>
          <div className="support-trend-list">
            {analytics.trends.map((point) => (
              <div key={point.date} className="support-trend-row">
                <span>{formatDate(point.date)}</span>
                <div>
                  <strong>{point.created}</strong>
                  <small>created</small>
                </div>
                <div>
                  <strong>{point.resolved}</strong>
                  <small>resolved</small>
                </div>
                <div>
                  <strong>{point.overdue}</strong>
                  <small>overdue</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="support-card">
          <div className="support-card-header">
            <div>
              <p className="eyebrow">SLA</p>
              <h3>Response health</h3>
            </div>
            <StatusBadge tone={analytics.slaInsights.overdueTickets ? 'danger' : 'success'}>
              {analytics.slaInsights.overdueTickets ? 'Attention' : 'Healthy'}
            </StatusBadge>
          </div>
          <div className="support-summary-grid">
            <div>
              <span>Overdue</span>
              <strong>{analytics.slaInsights.overdueTickets}</strong>
            </div>
            <div>
              <span>Overdue rate</span>
              <strong>{formatPercent(analytics.slaInsights.overduePercent)}</strong>
            </div>
            <div>
              <span>Avg delay</span>
              <strong>{formatHours(analytics.slaInsights.avgResponseDelayHours)}</strong>
            </div>
            <div>
              <span>Avg resolution</span>
              <strong>{formatHours(analytics.slaInsights.avgResolutionHours)}</strong>
            </div>
          </div>
          <div className="support-mini-list">
            {analytics.slaInsights.breachesByCategory.length ? analytics.slaInsights.breachesByCategory.map((entry) => (
              <div key={entry.category}>
                <span>{formatSupportLabel(entry.category)}</span>
                <strong>{entry.overdueCount} overdue</strong>
              </div>
            )) : (
              <p className="page-description">No current SLA category breaches.</p>
            )}
          </div>
        </article>
      </div>

      <article className="support-card">
        <div className="support-card-header">
          <div>
            <p className="eyebrow">Vendor insights</p>
            <h3>Operational support load</h3>
          </div>
        </div>
        {analytics.vendorInsights.length ? (
          <OperationalTable columns={['Vendor', 'Tickets', 'Unresolved', 'Overdue', 'Overdue rate', 'Avg resolution', 'Signal']}>
            {analytics.vendorInsights.map((vendor) => (
              <OperationalTableRow key={vendor.vendorId}>
                <td>
                  <strong>{vendor.vendorName ?? vendor.vendorId}</strong>
                  <span>{vendor.vendorId}</span>
                </td>
                <td>{vendor.ticketCount}</td>
                <td>{vendor.unresolvedCount}</td>
                <td>{vendor.overdueCount}</td>
                <td>{formatPercent(vendor.overduePercent)}</td>
                <td>{formatHours(vendor.avgResolutionHours)}</td>
                <td>
                  <StatusBadge tone={vendor.needsAttention ? 'warning' : 'success'}>
                    {vendor.needsAttention ? 'Needs attention' : 'Stable'}
                  </StatusBadge>
                </td>
              </OperationalTableRow>
            ))}
          </OperationalTable>
        ) : (
          <EmptyStatePanel title="No vendor support data" description="Vendor support trends will appear as tickets are created." />
        )}
      </article>

      <div className="support-analytics-grid">
        <article className="support-card">
          <div className="support-card-header">
            <div>
              <p className="eyebrow">Categories</p>
              <h3>Support mix</h3>
            </div>
          </div>
          <OperationalTable columns={['Category', 'Tickets', 'Overdue', 'Overdue %', 'Avg resolution']}>
            {analytics.categoryInsights.map((entry) => (
              <OperationalTableRow key={entry.category}>
                <td>{formatSupportLabel(entry.category)}</td>
                <td>{entry.ticketCount}</td>
                <td>{entry.overdueCount}</td>
                <td>
                  <StatusBadge tone={getCategoryTone(entry)}>{formatPercent(entry.overduePercent)}</StatusBadge>
                </td>
                <td>{formatHours(entry.avgResolutionHours)}</td>
              </OperationalTableRow>
            ))}
          </OperationalTable>
        </article>

        <article className="support-card">
          <div className="support-card-header">
            <div>
              <p className="eyebrow">Assignments</p>
              <h3>Workload</h3>
            </div>
          </div>
          {analytics.assignmentInsights.length ? (
            <OperationalTable columns={['Assignee', 'Tickets', 'Overdue', 'Avg response', 'Open unassigned']}>
              {analytics.assignmentInsights.map((entry) => (
                <OperationalTableRow key={entry.assigneeName}>
                  <td>{entry.assigneeName}</td>
                  <td>{entry.ticketCount}</td>
                  <td>{entry.overdueCount}</td>
                  <td>{formatHours(entry.avgFirstResponseHours)}</td>
                  <td>{entry.unassignedOpenTickets || '—'}</td>
                </OperationalTableRow>
              ))}
            </OperationalTable>
          ) : (
            <EmptyStatePanel title="No assignment data" description="Assigned support workload will appear here." />
          )}
        </article>
      </div>

      {needsAttentionVendors.length ? (
        <article className="support-card support-attention-card">
          <div className="support-card-header">
            <div>
              <p className="eyebrow">Needs attention</p>
              <h3>Vendors with elevated support load</h3>
            </div>
          </div>
          <div className="support-mini-list">
            {needsAttentionVendors.map((vendor) => (
              <div key={vendor.vendorId}>
                <span>{vendor.vendorName ?? vendor.vendorId}</span>
                <strong>{vendor.unresolvedCount} unresolved · {vendor.overdueCount} overdue</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
}
