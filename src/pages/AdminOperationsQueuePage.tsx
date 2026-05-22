import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  KPIStatCard,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { runtimeServices } from '../services/runtime-services';
import type {
  OperationsActivity,
  OperationsAttentionItem,
  OperationsAttentionSeverity,
  OperationsAttentionType,
  OperationsVendorRisk,
} from '../lib/api/contracts';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatAge(hours: number) {
  if (hours < 1) {
    return '<1h';
  }
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

function formatType(value: OperationsAttentionType) {
  if (value === 'vendor_risk') {
    return 'Vendor risk';
  }
  if (value === 'operational_signal') {
    return 'Operational signal';
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getSeverityTone(severity: OperationsAttentionSeverity) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'warning') {
    return 'warning' as const;
  }
  return 'info' as const;
}

function getRiskTone(risk: OperationsVendorRisk) {
  return getSeverityTone(risk.riskLevel);
}

function getSectionTone(item: OperationsAttentionItem) {
  return getSeverityTone(item.severity);
}

function getActivityTone(item: OperationsActivity) {
  return getSeverityTone(item.severity);
}

function attentionLink(item: { destinationPath: string | null }, label: string) {
  return item.destinationPath ? (
    <Link className="button button-secondary button-link button-compact" to={item.destinationPath}>
      {label}
    </Link>
  ) : (
    <span className="queue-muted-action">No link</span>
  );
}

export function AdminOperationsQueuePage() {
  const appReadiness = useAppReadiness();
  const { data, isLoading, isError, error, diagnostics, refetch } = useQueryResource(queryKeys.admin.operations.attention(), () =>
    runtimeServices.operations.attention(),
    { enabled: appReadiness.ready },
  );

  if (!appReadiness.ready || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Admin operations"
        title="Loading attention center"
        description="Deriving operational attention signals from orders, returns, finance, shipments, and support."
      />
    );
  }

  if (isError || !data) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Admin operations"
        title="Attention center unavailable"
        description={error ?? 'Operational attention signals could not be loaded.'}
        diagnostics={diagnostics}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <section className="op-page operations-control-center attention-center-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin operations</p>
          <h2>Operational attention center</h2>
          <p className="page-description">
            Unified cockpit for shipment risk, overdue support, return backlog, finance review, and vendor attention.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="danger">Critical {data.summary.critical}</StatusBadge>
          <StatusBadge tone="warning">Warning {data.summary.warning}</StatusBadge>
          <StatusBadge tone="info">Generated {formatDate(data.generatedAt)}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row attention-kpi-row">
        <KPIStatCard label="Total attention" value={data.summary.total} detail="Derived active signals" tone="info" />
        <KPIStatCard label="Critical" value={data.summary.critical} detail="Highest priority" tone="danger" />
        <KPIStatCard label="Overdue support" value={data.summary.overdueSupport} detail="SLA breached" tone="warning" />
        <KPIStatCard label="Shipment issues" value={data.summary.shipmentIssues} detail="Tracking or carrier state" tone="attention" />
        <KPIStatCard label="Return backlog" value={data.summary.returnBacklog} detail="Waiting review" tone="info" />
        <KPIStatCard label="Finance review" value={data.summary.financeReview} detail="Payout or invoice attention" tone="warning" />
      </div>

      <div className="attention-layout">
        <main className="attention-main-column">
          <OperationalRecommendations
            title="Recommended actions"
            subtitle="Read-only operator suggestions derived from active attention signals."
            recommendations={data.recommendations}
            audience="admin"
            emptyMessage="No operational recommendations right now."
          />

          <article className="attention-card">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Critical queue</p>
                <h3>Unified attention queue</h3>
                <span>Sorted by severity and unresolved age.</span>
              </div>
            </div>
            {data.queue.length ? (
              <OperationalTable
                columns={['Severity', 'Type', 'Vendor', 'Reference', 'Age', 'Recommended action', 'Action']}
                className="attention-op-table"
              >
                {data.queue.map((item) => (
                  <OperationalTableRow key={item.id}>
                    <StatusBadge tone={getSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                    <span>
                      <strong>{formatType(item.type)}</strong>
                      <small>{item.title}</small>
                    </span>
                    <span>
                      <strong>{item.vendorName}</strong>
                      <small>{item.vendorId}</small>
                    </span>
                    <span>
                      <strong>{item.objectReference}</strong>
                      <small>{item.status}</small>
                    </span>
                    <strong>{formatAge(item.ageHours)}</strong>
                    <span>{item.recommendedAction}</span>
                    <OperationalActionGroup>
                      {attentionLink(item, 'Open')}
                    </OperationalActionGroup>
                  </OperationalTableRow>
                ))}
              </OperationalTable>
            ) : (
              <EmptyStatePanel title="No active attention items" description="Current operational queues are clear." />
            )}
          </article>

          <div className="attention-sections-grid">
            {data.sections.map((section) => (
              <article key={section.key} className="attention-card">
                <div className="attention-card-heading">
                  <div>
                    <p className="eyebrow">{formatType(section.key)}</p>
                    <h3>{section.title}</h3>
                    <span>
                      {section.count} active · {section.critical} critical · {section.warning} warning
                    </span>
                  </div>
                </div>
                <div className="attention-mini-list">
                  {section.items.length ? (
                    section.items.map((item) => (
                      <div key={item.id} className="attention-mini-row">
                        <span className={`attention-dot attention-${item.severity}`} aria-hidden="true" />
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.vendorName} · {formatAge(item.ageHours)}</small>
                        </div>
                        <StatusBadge tone={getSectionTone(item)}>{item.severity}</StatusBadge>
                      </div>
                    ))
                  ) : (
                    <p className="page-description">No current items.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </main>

        <aside className="attention-side-column">
          <article className="attention-card">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Vendor risk</p>
                <h3>Operational health</h3>
              </div>
            </div>
            <div className="attention-risk-list">
              {data.vendorRisks.length ? (
                data.vendorRisks.map((vendor) => (
                  <div key={vendor.vendorId} className="attention-risk-row">
                    <div>
                      <strong>{vendor.vendorName}</strong>
                      <span>{vendor.drivers.length ? vendor.drivers.join(' · ') : 'No dominant driver'}</span>
                    </div>
                    <StatusBadge tone={getRiskTone(vendor)}>{vendor.riskLevel}</StatusBadge>
                  </div>
                ))
              ) : (
                <p className="page-description">No vendor risk signals.</p>
              )}
            </div>
          </article>

          <article className="attention-card">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Activity</p>
                <h3>Recent operational activity</h3>
              </div>
            </div>
            <div className="attention-activity-feed">
              {data.recentActivity.length ? (
                data.recentActivity.map((item) => (
                  <div key={item.id} className="attention-activity-row">
                    <span className={`attention-dot attention-${item.severity}`} aria-hidden="true" />
                    <div>
                      {item.destinationPath ? <Link to={item.destinationPath}>{item.title}</Link> : <strong>{item.title}</strong>}
                      <small>{item.vendorName} · {formatDate(item.occurredAt)}</small>
                      <span>{item.description}</span>
                    </div>
                    <StatusBadge tone={getActivityTone(item)}>{item.severity}</StatusBadge>
                  </div>
                ))
              ) : (
                <p className="page-description">No recent operational activity.</p>
              )}
            </div>
          </article>
        </aside>
      </div>
    </section>
  );
}
