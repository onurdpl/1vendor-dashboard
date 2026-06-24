import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  KPIStatCard,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { getPageReadinessState } from '../lib/pageReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { runtimeServices } from '../services/runtime-services';
import type {
  OperationsActivity,
  OperationsAttentionItem,
  OperationsAttentionSeverity,
  OperationsAttentionType,
  OperationsVendorRisk,
} from '../lib/api/contracts';
import { formatDateTime, safeArray, safeStatusLabel } from '../services/real/formatting';

function formatDate(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAge(hours: number) {
  if (!Number.isFinite(hours)) {
    return '—';
  }
  if (hours < 1) {
    return '<1h';
  }
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

function formatType(value: OperationsAttentionType) {
  if (value === 'vendor_blocked') {
    return 'Vendor blocked';
  }
  if (value === 'vendor_risk') {
    return 'Vendor risk';
  }
  if (value === 'operational_signal') {
    return 'Operational signal';
  }
  return safeStatusLabel(value);
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

function getActionLabel(item: OperationsAttentionItem) {
  return item.type === 'vendor_blocked' ? 'Review allocation' : 'Open';
}

export function AdminOperationsQueuePage() {
  const appReadiness = useAppReadiness();
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: false,
  });
  const { data, isLoading, isError, error, refetch } = useQueryResource(queryKeys.admin.operations.attention(), ({ signal }) =>
    runtimeServices.operations.attention({ signal }),
    { enabled: pageReadiness.ready },
  );

  const dataView = data ?? {
    generatedAt: new Date().toISOString(),
    summary: {
      total: 0,
      critical: 0,
      warning: 0,
      overdueSupport: 0,
      shipmentIssues: 0,
      returnBacklog: 0,
      financeReview: 0,
      vendorBlocked: 0,
    },
    recommendations: [],
    queue: [],
    sections: [],
    vendorRisks: [],
    recentActivity: [],
  };
  const recommendations = safeArray(dataView.recommendations);
  const queue = safeArray(dataView.queue);
  const sections = safeArray(dataView.sections);
  const vendorRisks = safeArray(dataView.vendorRisks);
  const recentActivity = safeArray(dataView.recentActivity);

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
          <StatusBadge tone="danger">Critical {dataView.summary.critical}</StatusBadge>
          <StatusBadge tone="warning">Warning {dataView.summary.warning}</StatusBadge>
          <StatusBadge tone="info">Generated {formatDate(dataView.generatedAt)}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row attention-kpi-row">
        <KPIStatCard label="Total attention" value={dataView.summary.total} detail="Derived active signals" tone="info" />
        <KPIStatCard label="Critical" value={dataView.summary.critical} detail="Highest priority" tone="danger" />
        <KPIStatCard label="Overdue support" value={dataView.summary.overdueSupport} detail="SLA breached" tone="warning" />
        <KPIStatCard label="Shipment issues" value={dataView.summary.shipmentIssues} detail="Tracking or carrier state" tone="attention" />
        <KPIStatCard label="Vendor blocked" value={dataView.summary.vendorBlocked} detail="Rejected allocations" tone="warning" />
        <KPIStatCard label="Return backlog" value={dataView.summary.returnBacklog} detail="Waiting review" tone="info" />
        <KPIStatCard label="Finance review" value={dataView.summary.financeReview} detail="Payout or invoice attention" tone="warning" />
      </div>
      {isError && !data ? (
        <SectionErrorRetry
          title="Attention center unavailable"
          description={error ?? 'Operational attention signals could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : pageReadiness.status === 'unauthorized' ? (
        <SectionErrorRetry
          title="Sign in required"
          description="An authenticated admin session is required to load the attention center."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <SectionSkeleton
          title="Loading attention center"
          description="Deriving operational signals from orders, returns, finance, shipments, and support."
        />
      ) : null}

      <div className="attention-layout">
        <main className="attention-main-column">
          <OperationalRecommendations
            title="Recommended actions"
            subtitle="Read-only operator suggestions derived from active attention signals."
            recommendations={recommendations}
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
            {queue.length ? (
              <OperationalTable
                columns={['Severity', 'Type', 'Vendor', 'Reference', 'Age', 'Recommended action', 'Action']}
                className="attention-op-table"
              >
	                {queue.map((item) => (
	                  <OperationalTableRow key={item.id}>
	                    <span className="attention-queue-severity">
	                      <StatusBadge tone={getSeverityTone(item.severity)}>{item.severity}</StatusBadge>
	                    </span>
	                    <span className="attention-queue-type" title={`${formatType(item.type)} · ${item.title}`}>
	                      <strong>{formatType(item.type)}</strong>
	                      <small>{item.title}</small>
	                      <small>{item.description}</small>
	                    </span>
	                    <span className="attention-queue-vendor" title={`${item.vendorName} · ${item.vendorId}`}>
	                      <strong>{item.vendorName}</strong>
	                      <small>{item.vendorId}</small>
	                    </span>
	                    <span className="attention-queue-reference" title={`${item.objectReference} · ${item.status}`}>
	                      <strong>{item.objectReference}</strong>
	                      <small>{item.status}</small>
	                    </span>
	                    <strong className="attention-queue-age">{formatAge(item.ageHours)}</strong>
	                    <span className="attention-queue-action-copy" title={item.recommendedAction}>{item.recommendedAction}</span>
	                    <OperationalActionGroup>
	                      {attentionLink(item, getActionLabel(item))}
	                    </OperationalActionGroup>
	                  </OperationalTableRow>
                ))}
              </OperationalTable>
            ) : (
              <EmptyStatePanel title="No active attention items" description="Current operational queues are clear." />
            )}
          </article>

          <div className="attention-sections-grid">
            {sections.map((section) => (
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
                  {safeArray(section.items).length ? (
                    safeArray(section.items).map((item) => (
                      <div key={item.id} className="attention-mini-row">
                        <span className={`attention-dot attention-${item.severity}`} aria-hidden="true" />
                        <div>
                          <strong>{item.title}</strong>
                          {item.type === 'vendor_blocked' ? (
                            <>
                              <small>{item.vendorName} · {item.objectReference}</small>
                              <span>{item.cancellationReason ? `Reason: ${item.cancellationReason}` : item.description}</span>
                              <span>{item.recommendedAction}</span>
                              {attentionLink(item, 'Review allocation')}
                            </>
                          ) : (
                            <small>{item.vendorName} · {formatAge(item.ageHours)}</small>
                          )}
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
              {vendorRisks.length ? (
                vendorRisks.map((vendor) => (
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
              {recentActivity.length ? (
                recentActivity.map((item) => (
                  <div key={item.id} className="attention-activity-row">
                    <span className={`attention-dot attention-${item.severity}`} aria-hidden="true" />
                    <div>
                      {item.destinationPath ? <Link to={item.destinationPath}>{item.title}</Link> : <strong>{item.title}</strong>}
                      <small>{item.vendorName} · {item.description} · {formatDate(item.occurredAt)}</small>
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
