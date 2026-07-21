import { useMemo, useState } from 'react';
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
  OperationsQueueItem,
  OperationsVendorRisk,
} from '../lib/api/contracts';
import { formatDateTime, safeArray, safeStatusLabel } from '../services/real/formatting';

const VENDOR_BLOCKED_QUEUE_PAGE_SIZE = 5;

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

function actionLink(destinationPath: string | null, label: string) {
  return destinationPath ? (
    <Link className="button button-secondary button-link button-compact" to={destinationPath}>
      {label}
    </Link>
  ) : (
    <span className="queue-muted-action">No link</span>
  );
}

function getAttentionDestinationPath(item: OperationsAttentionItem) {
  if (item.type === 'vendor_blocked' && item.sourceShopifyOrderId) {
    return `/admin/orders/${item.sourceShopifyOrderId}`;
  }

  return item.destinationPath;
}

function attentionLink(item: OperationsAttentionItem, label: string) {
  return actionLink(getAttentionDestinationPath(item), label);
}

function getActionLabel(item: OperationsAttentionItem) {
  const destinationPath = getAttentionDestinationPath(item);

  if (item.type === 'vendor_blocked' && destinationPath?.startsWith('/admin/orders/')) {
    return 'Open order';
  }
  if (item.type === 'support' && destinationPath?.startsWith('/admin/support/')) {
    return 'Open ticket';
  }
  if (item.type === 'finance') {
    return 'Review finance';
  }
  if (item.type === 'return') {
    return 'Open return';
  }
  if (item.type === 'shipment' && destinationPath?.includes('/orders/')) {
    return 'Open order';
  }
  if (item.type === 'operational_signal') {
    return destinationPath?.startsWith('/admin/orders/') ? 'Open order' : 'Review signal';
  }
  if (item.type === 'automation') {
    return 'Review action';
  }

  return 'Open';
}

function getPreviewLabel(visibleCount: number, activeCount: number, noun = 'active') {
  if (activeCount <= 0) {
    return `0 ${noun}`;
  }

  return `Showing ${Math.min(visibleCount, activeCount)} of ${activeCount} ${noun}`;
}

function formatQueueType(value: OperationsQueueItem['type']) {
  if (value === 'pending_reassignment') {
    return 'Pending reassignment';
  }
  if (value === 'vendor_blocked') {
    return 'Vendor blocked';
  }
  if (value === 'awaiting_shipment') {
    return 'Awaiting shipment';
  }
  if (value === 'refund_attention') {
    return 'Refund attention';
  }
  if (value === 'finance_integrity_alert') {
    return 'Finance integrity';
  }
  if (value === 'operational_signal') {
    return 'Operational signal';
  }
  return 'Automation action';
}

function getQueueSeverityTone(severity: OperationsQueueItem['severity']) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'high') {
    return 'warning' as const;
  }
  if (severity === 'medium') {
    return 'attention' as const;
  }
  return 'info' as const;
}

function getQueueItemReference(item: OperationsQueueItem) {
  const orderNumber = item.relatedShopifyOrderNumber?.trim();
  if (orderNumber) {
    return orderNumber.startsWith('#') ? `Order ${orderNumber}` : `Order #${orderNumber}`;
  }
  if (item.relatedShopifyOrderId) {
    return `Shopify order ${item.relatedShopifyOrderId}`;
  }
  if (item.relatedOrderId) {
    return `Allocation ${item.relatedOrderId}`;
  }
  return item.id;
}

function getQueueAdminOrderPath(item: OperationsQueueItem) {
  return item.relatedShopifyOrderId ? `/admin/orders/${item.relatedShopifyOrderId}` : null;
}

function matchesVendorBlockedPageSearch(item: OperationsQueueItem, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }

  return [
    item.id,
    item.title,
    item.description,
    item.vendorId,
    item.vendorName,
    item.status,
    item.relatedOrderId,
    item.relatedShopifyOrderId,
    item.relatedShopifyOrderNumber,
    formatQueueType(item.type),
    getQueueItemReference(item),
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalizedFilter));
}

export function AdminOperationsQueuePage() {
  const [vendorBlockedListOpen, setVendorBlockedListOpen] = useState(false);
  const [vendorBlockedQueueOffset, setVendorBlockedQueueOffset] = useState(0);
  const [vendorBlockedFilter, setVendorBlockedFilter] = useState('');
  const appReadiness = useAppReadiness();
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: false,
  });
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    hasBackgroundError,
    isFetching,
  } = useQueryResource(
    queryKeys.admin.operations.attention(),
    ({ signal }) => runtimeServices.operations.attention({ signal }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations/attention',
    },
  );
  const {
    data: vendorBlockedQueueDashboard,
    isLoading: isVendorBlockedQueueLoading,
    isFetching: isVendorBlockedQueueFetching,
    isError: isVendorBlockedQueueError,
    error: vendorBlockedQueueError,
    refetch: refetchVendorBlockedQueue,
  } = useQueryResource(
    queryKeys.admin.operations.queuePage(VENDOR_BLOCKED_QUEUE_PAGE_SIZE, vendorBlockedQueueOffset, 'vendor_blocked'),
    ({ signal }) =>
      runtimeServices.operations.dashboard({
        signal,
        limit: VENDOR_BLOCKED_QUEUE_PAGE_SIZE,
        offset: vendorBlockedQueueOffset,
        type: 'vendor_blocked',
      }),
    {
      enabled: pageReadiness.ready && vendorBlockedListOpen,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations',
    },
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
  const paginatedQueueItems = safeArray(vendorBlockedQueueDashboard?.items);
  const displayedVendorBlockedQueueItems = useMemo(
    () => paginatedQueueItems.filter((item) => matchesVendorBlockedPageSearch(item, vendorBlockedFilter)),
    [vendorBlockedFilter, paginatedQueueItems],
  );
  const totalPaginatedQueueRows = vendorBlockedQueueDashboard?.summary.total ?? 0;
  const queuePageStart = totalPaginatedQueueRows > 0 ? vendorBlockedQueueOffset + 1 : 0;
  const queuePageEnd = Math.min(vendorBlockedQueueOffset + VENDOR_BLOCKED_QUEUE_PAGE_SIZE, totalPaginatedQueueRows);
  const canPageVendorBlockedBack = vendorBlockedQueueOffset > 0;
  const canPageVendorBlockedForward = vendorBlockedQueueOffset + VENDOR_BLOCKED_QUEUE_PAGE_SIZE < totalPaginatedQueueRows;

  return (
    <section className="op-page operations-control-center attention-center-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin operations</p>
          <h2>Operational attention center</h2>
          <p className="page-description">
            Unified cockpit for generated shipment, support, return, finance, and vendor attention rows.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="danger">Critical {dataView.summary.critical}</StatusBadge>
          <StatusBadge tone="warning">Warning {dataView.summary.warning}</StatusBadge>
          <StatusBadge tone="info">Generated {formatDate(dataView.generatedAt)}</StatusBadge>
          <button
            type="button"
            className="button button-secondary button-link button-compact"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="op-kpi-row attention-kpi-row">
        <KPIStatCard label="Total attention" value={dataView.summary.total} detail="Generated rows" tone="info" />
        <KPIStatCard label="Critical" value={dataView.summary.critical} detail="Highest priority" tone="danger" />
        <KPIStatCard label="Critical support" value={dataView.summary.overdueSupport} detail="SLA or priority" tone="warning" />
        <KPIStatCard label="Shipment issues" value={dataView.summary.shipmentIssues} detail="Tracking or carrier state" tone="attention" />
        <KPIStatCard label="Vendor blocked" value={dataView.summary.vendorBlocked} detail="Rejected allocations" tone="warning" />
        <KPIStatCard label="Return backlog" value={dataView.summary.returnBacklog} detail="Waiting review" tone="info" />
        <KPIStatCard label="Finance review" value={dataView.summary.financeReview} detail="Payout or invoice attention" tone="warning" />
      </div>
      {hasBackgroundError && data ? (
        <div className="attention-stale-warning" role="status">
          <span>Could not refresh. Showing latest available data generated {formatDate(dataView.generatedAt)}.</span>
          <button type="button" className="button button-secondary button-link button-compact" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : null}
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
            subtitle={`Preview of ${recommendations.length} generated recommendations.`}
            recommendations={recommendations}
            audience="admin"
            emptyMessage="No operational recommendations right now."
          />

          <article className="attention-card" id="operations-unified-queue">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Critical queue</p>
                <h3>Unified attention queue</h3>
                <span>Preview of generated attention rows sorted by severity and unresolved age.</span>
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
            {sections.map((section) => {
              const sectionItems = safeArray(section.items);
              const isVendorBlockedSection = section.key === 'vendor_blocked';
              const visibleCount = sectionItems.length;
              const hasHiddenPreviewItems = visibleCount < section.count;
              const canOpenVendorBlockedWorkflow = isVendorBlockedSection && hasHiddenPreviewItems;

              return (
                <article key={section.key} className="attention-card">
                  <div className="attention-card-heading">
                    <div>
                      <p className="eyebrow">{formatType(section.key)}</p>
                      <h3>{isVendorBlockedSection ? 'Vendor Blocked Allocations' : section.title}</h3>
                      <span>
                        {getPreviewLabel(visibleCount, section.count)} · {section.critical} critical · {section.warning} warning
                      </span>
                    </div>
                  </div>
                  {hasHiddenPreviewItems ? (
                    <div className="attention-preview-note">
                      <span>
                        Showing {visibleCount} of {section.count}. This section is a preview.
                      </span>
                      {canOpenVendorBlockedWorkflow ? (
                        <button
                          type="button"
                          className="button button-secondary button-link button-compact"
                          onClick={() => {
                            setVendorBlockedListOpen(true);
                            setVendorBlockedQueueOffset(0);
                          }}
                        >
                          View all vendor-blocked allocations
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div
                    className="attention-mini-list"
                    aria-label={isVendorBlockedSection ? 'Vendor Blocked Allocations preview' : undefined}
                  >
                    {sectionItems.length ? (
                      sectionItems.map((item) => (
                        <div
                          key={item.id}
                          className={`attention-mini-row${item.type === 'vendor_blocked' ? ' vendor-blocked-mini-row' : ''}`}
                        >
                          <span className={`attention-dot attention-${item.severity}`} aria-hidden="true" />
                          <div>
                            <strong>{item.title}</strong>
                            {item.type === 'vendor_blocked' ? (
                              <>
                                <small>
                                  {item.objectReference} · {item.vendorName} · {formatAge(item.ageHours)}
                                </small>
                                <span className="vendor-blocked-detail-list">
                                  <span className="vendor-blocked-detail-chip">Status: {safeStatusLabel(item.status)}</span>
                                  {item.cancellationReason ? (
                                    <span className="vendor-blocked-detail-chip">Reason: {item.cancellationReason}</span>
                                  ) : null}
                                  {item.reassignmentRequired ? (
                                    <span className="vendor-blocked-detail-chip">Reassignment required</span>
                                  ) : null}
                                  {item.splitChildAllocation ? (
                                    <span className="vendor-blocked-detail-chip">Split allocation</span>
                                  ) : null}
                                </span>
                                {!item.cancellationReason ? <span>{item.description}</span> : null}
                                <span>{item.recommendedAction}</span>
                                {attentionLink(item, getActionLabel(item))}
                              </>
                            ) : (
                              <>
                                <small>
                                  {item.objectReference} · {item.vendorName} · {formatAge(item.ageHours)}
                                </small>
                                <span>Status: {safeStatusLabel(item.status)}</span>
                                {attentionLink(item, getActionLabel(item))}
                              </>
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
              );
            })}
          </div>

          {vendorBlockedListOpen ? (
            <article className="attention-card vendor-blocked-full-list" id="vendor-blocked-full-list">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Vendor blocked</p>
                  <h3>Vendor-blocked allocations in queue pages</h3>
                  <span>
                    Read-only paginated Vendor Blocked results from the Operations queue.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-link button-compact"
                  onClick={() => setVendorBlockedListOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="vendor-blocked-list-controls">
                <label>
                  <span>Search this Vendor Blocked page</span>
                  <input
                    type="search"
                    value={vendorBlockedFilter}
                    onChange={(event) => setVendorBlockedFilter(event.target.value)}
                    placeholder="Order, vendor, status, or type"
                  />
                </label>
                <div className="vendor-blocked-page-controls">
                  <span>
                    Vendor Blocked rows {queuePageStart}-{queuePageEnd} of {totalPaginatedQueueRows}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setVendorBlockedQueueOffset(Math.max(0, vendorBlockedQueueOffset - VENDOR_BLOCKED_QUEUE_PAGE_SIZE))}
                    disabled={!canPageVendorBlockedBack}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setVendorBlockedQueueOffset(vendorBlockedQueueOffset + VENDOR_BLOCKED_QUEUE_PAGE_SIZE)}
                    disabled={!canPageVendorBlockedForward}
                  >
                    Next
                  </button>
                </div>
              </div>

              {isVendorBlockedQueueError ? (
                <SectionErrorRetry
                  title="Vendor-blocked queue page unavailable"
                  description={vendorBlockedQueueError ?? 'The paginated operations queue could not be loaded.'}
                  onRetry={() => void refetchVendorBlockedQueue()}
                />
              ) : isVendorBlockedQueueLoading || isVendorBlockedQueueFetching ? (
                <SectionSkeleton
                  title="Loading vendor-blocked queue page"
                  description="Fetching the next paginated operations queue page."
                />
              ) : displayedVendorBlockedQueueItems.length ? (
                <OperationalTable
                  columns={['Severity', 'Reference', 'Vendor', 'Status', 'Age', 'Action']}
                  className="vendor-blocked-full-table"
                >
                  {displayedVendorBlockedQueueItems.map((item) => {
                    const adminOrderPath = getQueueAdminOrderPath(item);

                    return (
                      <OperationalTableRow key={item.id}>
                        <span>
                          <StatusBadge tone={getQueueSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                        </span>
                        <span title={`${getQueueItemReference(item)} · ${item.title}`}>
                          <strong>{getQueueItemReference(item)}</strong>
                          <small>{item.title}</small>
                        </span>
                        <span title={`${item.vendorName ?? item.vendorId} · ${item.vendorId}`}>
                          <strong>{item.vendorName ?? item.vendorId}</strong>
                          <small>{item.vendorId}</small>
                        </span>
                        <span>
                          <strong>{safeStatusLabel(item.status)}</strong>
                          <small>{formatQueueType(item.type)}</small>
                        </span>
                        <strong>{formatAge((Date.now() - new Date(item.createdAt).getTime()) / 36e5)}</strong>
                        <OperationalActionGroup>
                          {adminOrderPath ? actionLink(adminOrderPath, 'Open order') : <span className="queue-muted-action">No admin order</span>}
                        </OperationalActionGroup>
                      </OperationalTableRow>
                    );
                  })}
                </OperationalTable>
              ) : (
                <EmptyStatePanel
                  title="No vendor-blocked allocations match this page"
                  description="Use pagination to continue through Vendor Blocked results, or clear this page search."
                />
              )}
            </article>
          ) : null}
        </main>

        <aside className="attention-side-column">
          <article className="attention-card">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Vendor risk</p>
                <h3>Operational health</h3>
                <span>Showing {vendorRisks.length} vendor risk preview rows.</span>
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
                <h3>Recent projected activity</h3>
                <span>Latest projected activity rows, not a full audit history.</span>
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
