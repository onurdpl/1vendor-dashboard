import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  KPIStatCard,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { getAdminSupportAnalytics, type SupportAnalyticsCategoryInsight } from '../features/support/api';
import { formatSupportLabel } from './AdminSupportTicketsPage';
import { formatDateTime, safeArray } from '../services/real/formatting';

function formatHours(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value}h`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value}%`;
}

function formatDate(value: string) {
  return formatDateTime(`${value}T00:00:00.000Z`, {
    month: 'short',
    day: 'numeric',
  });
}

function getCategoryTone(entry: SupportAnalyticsCategoryInsight) {
  const overduePercent = Number.isFinite(entry.overduePercent) ? entry.overduePercent : 0;
  if (overduePercent >= 25) {
    return 'danger' as const;
  }
  if (overduePercent > 0) {
    return 'warning' as const;
  }
  return 'success' as const;
}

export function AdminSupportAnalyticsPage() {
  const appReadiness = useAppReadiness();
  const { data: analytics, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.admin.support.analytics(),
    ({ signal }) => getAdminSupportAnalytics({ signal }),
    { enabled: appReadiness.ready },
  );

  const analyticsView = analytics ?? {
    kpis: {
      openTickets: 0,
      overdueTickets: 0,
      avgFirstResponseHours: null,
      avgResolutionHours: null,
      waitingOnVendor: 0,
      resolvedToday: 0,
    },
    trends: [],
    slaInsights: {
      overdueTickets: 0,
      overduePercent: 0,
      avgResponseDelayHours: null,
      avgResolutionHours: null,
      breachesByCategory: [],
    },
    vendorInsights: [],
    categoryInsights: [],
    assignmentInsights: [],
  };
  const kpis = analyticsView.kpis ?? {
    openTickets: 0,
    overdueTickets: 0,
    avgFirstResponseHours: null,
    avgResolutionHours: null,
    waitingOnVendor: 0,
    resolvedToday: 0,
  };
  const slaInsights = analyticsView.slaInsights ?? {
    overdueTickets: 0,
    overduePercent: 0,
    avgResponseDelayHours: null,
    avgResolutionHours: null,
    breachesByCategory: [],
  };
  const trends = safeArray(analyticsView.trends);
  const breachesByCategory = safeArray(slaInsights.breachesByCategory);
  const vendorInsights = safeArray(analyticsView.vendorInsights);
  const categoryInsights = safeArray(analyticsView.categoryInsights);
  const assignmentInsights = safeArray(analyticsView.assignmentInsights);
  const needsAttentionVendors = vendorInsights.filter((vendor) => vendor.needsAttention);

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
        <KPIStatCard label="Open tickets" value={kpis.openTickets} detail="Unresolved support load" tone="info" />
        <KPIStatCard label="Overdue tickets" value={kpis.overdueTickets} detail="SLA currently breached" tone={kpis.overdueTickets ? 'danger' : 'success'} />
        <KPIStatCard label="Avg first response" value={formatHours(kpis.avgFirstResponseHours)} detail="First admin public reply" tone="neutral" />
        <KPIStatCard label="Avg resolution" value={formatHours(kpis.avgResolutionHours)} detail="Resolved or closed tickets" tone="neutral" />
        <KPIStatCard label="Waiting on vendor" value={kpis.waitingOnVendor} detail="Vendor response needed" tone="warning" />
        <KPIStatCard label="Resolved today" value={kpis.resolvedToday} detail="Closed support work" tone="success" />
      </div>
      {isError && !analytics ? (
        <SectionErrorRetry
          title="Support analytics unavailable"
          description={error ?? 'Unable to load support analytics.'}
          onRetry={() => void refetch()}
        />
      ) : !appReadiness.ready || isLoading ? (
        <SectionSkeleton title="Loading support analytics" description="Aggregating support ticket trends in the background." />
      ) : null}

      <div className="support-analytics-grid">
        <article className="support-card">
          <div className="support-card-header">
            <div>
              <p className="eyebrow">Trends</p>
              <h3>Last 7 days</h3>
            </div>
          </div>
          <div className="support-trend-list">
            {trends.map((point) => (
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
            <StatusBadge tone={slaInsights.overdueTickets ? 'danger' : 'success'}>
              {slaInsights.overdueTickets ? 'Attention' : 'Healthy'}
            </StatusBadge>
          </div>
          <div className="support-summary-grid">
            <div>
              <span>Overdue</span>
              <strong>{slaInsights.overdueTickets}</strong>
            </div>
            <div>
              <span>Overdue rate</span>
              <strong>{formatPercent(slaInsights.overduePercent)}</strong>
            </div>
            <div>
              <span>Avg delay</span>
              <strong>{formatHours(slaInsights.avgResponseDelayHours)}</strong>
            </div>
            <div>
              <span>Avg resolution</span>
              <strong>{formatHours(slaInsights.avgResolutionHours)}</strong>
            </div>
          </div>
          <div className="support-mini-list">
            {breachesByCategory.length ? breachesByCategory.map((entry) => (
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
        {vendorInsights.length ? (
          <OperationalTable columns={['Vendor', 'Tickets', 'Unresolved', 'Overdue', 'Overdue rate', 'Avg resolution', 'Signal']}>
            {vendorInsights.map((vendor) => (
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
            {categoryInsights.map((entry) => (
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
          {assignmentInsights.length ? (
            <OperationalTable columns={['Assignee', 'Tickets', 'Overdue', 'Avg response', 'Open unassigned']}>
              {assignmentInsights.map((entry) => (
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
