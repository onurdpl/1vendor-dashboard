import { useMemo, useState } from 'react';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  MetadataRow,
  OperationalSection,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useActionFeedback } from '../lib/ui';
import { getDashboardOverview } from '../lib/api/dashboard';
import { useAppReadiness } from '../lib/appReadiness';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import { queryKeys } from '../lib/api/queryKeys';
import { runtimeServices } from '../services/runtime-services';
import type { NotificationIntent } from '../lib/api/contracts';

function getPriorityValue(items: { label: string; value: string }[], label: string) {
  return Number.parseInt(items.find((item) => item.label === label)?.value ?? '0', 10) || 0;
}

function getHealthTone(health: string): 'success' | 'warning' | 'danger' | 'attention' {
  if (health === 'healthy') {
    return 'success';
  }
  if (health === 'warning') {
    return 'warning';
  }
  if (health === 'critical') {
    return 'danger';
  }
  return 'attention';
}

function formatRate(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getNotificationTone(severity: string): 'success' | 'warning' | 'danger' | 'attention' | 'info' {
  if (severity === 'critical') {
    return 'danger';
  }
  if (severity === 'high') {
    return 'warning';
  }
  if (severity === 'warning') {
    return 'attention';
  }
  return 'info';
}

function readNotificationMetadata(notification: NotificationIntent, key: string) {
  if (!notification.metadata || typeof notification.metadata !== 'object' || !(key in notification.metadata)) {
    return null;
  }

  const value = Reflect.get(notification.metadata, key);
  return typeof value === 'string' && value.trim() ? value : null;
}

function formatNotificationSource(notification: NotificationIntent) {
  return readNotificationMetadata(notification, 'signalSourceArea')?.toLowerCase().replaceAll('_', ' ') ?? 'signal';
}

function getDashboardKpiTone(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('order') || normalized.includes('vendor')) {
    return 'orders';
  }
  if (normalized.includes('awaiting') || normalized.includes('action') || normalized.includes('payout')) {
    return 'action';
  }
  if (normalized.includes('refund') || normalized.includes('healthy')) {
    return 'healthy';
  }
  if (normalized.includes('blocked')) {
    return 'blocked';
  }
  if (normalized.includes('attention')) {
    return 'attention';
  }
  return 'scope';
}

function getDashboardKpiHelper(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('order') || normalized.includes('vendor')) {
    return 'From vendor scope';
  }
  if (normalized.includes('awaiting') || normalized.includes('action')) {
    return 'Needs attention';
  }
  if (normalized.includes('refund')) {
    return 'Current refund total';
  }
  if (normalized.includes('blocked')) {
    return 'Requires review';
  }
  if (normalized.includes('payout')) {
    return 'Current estimate';
  }
  if (normalized.includes('attention')) {
    return 'Pending review';
  }
  return 'Current scope';
}

function formatPriorityLabel(tone: string) {
  return tone.replace(/^severity-/, '').replaceAll('-', ' ');
}

function getStatusDotTone(tone: 'success' | 'warning' | 'danger' | 'attention' | 'info') {
  if (tone === 'danger') {
    return 'status-danger';
  }
  if (tone === 'warning' || tone === 'attention') {
    return 'status-warning';
  }
  if (tone === 'info') {
    return 'status-info';
  }
  return 'status-success';
}

function formatRecentActivity(item: string) {
  const [title, ...descriptionParts] = item.split(':');
  const description = descriptionParts.join(':').trim();

  return {
    title: title.trim() || 'Unknown',
    description: description || '—',
  };
}

export function DashboardPage() {
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const currentVendor = appReadiness.currentVendor;
  const vendorId = currentVendor.vendorId;
  const isAdmin = currentUser?.role === 'admin';
  const notificationQueryKey = isAdmin ? queryKeys.notifications.adminGlobal() : queryKeys.notifications.list(vendorId);
  const notificationScopeVendorId = isAdmin ? null : vendorId;
  const { message, tone, showFeedback } = useActionFeedback();
  const [notificationOverrides, setNotificationOverrides] = useState<Record<string, Partial<NotificationIntent>>>({});
  const [pendingNotificationAction, setPendingNotificationAction] = useState<string | null>(null);
  const { data: dashboard, isLoading, isError, error, diagnostics, refetch: refetchDashboard } = useQueryResource(
    queryKeys.dashboard.overview(vendorId),
    () => getDashboardOverview(vendorId),
    { enabled: appReadiness.ready },
  );
  const {
    data: notifications,
    refetch: refetchNotifications,
  } = useQueryResource(notificationQueryKey, () => runtimeServices.notifications.list(notificationScopeVendorId), {
    enabled: appReadiness.ready,
  });
  const markNotificationReadMutation = useMutationAction(
    (notificationId: string) => runtimeServices.notifications.markRead(notificationId),
    {
      onSuccess: async (updated) => {
        setNotificationOverrides((current) => ({
          ...current,
          [updated.id]: {
            status: updated.status,
            readAt: updated.readAt,
            updatedAt: updated.updatedAt,
          },
        }));
        await Promise.all([refetchNotifications(), refetchDashboard()]);
        showFeedback('Notification marked as read.', 'success');
      },
      onError: () => showFeedback('Notification could not be marked as read.', 'error'),
    },
  );
  const dismissNotificationMutation = useMutationAction(
    (notificationId: string) => runtimeServices.notifications.dismiss(notificationId),
    {
      onSuccess: async (updated) => {
        setNotificationOverrides((current) => ({
          ...current,
          [updated.id]: {
            status: updated.status,
            updatedAt: updated.updatedAt,
          },
        }));
        await Promise.all([refetchNotifications(), refetchDashboard()]);
        showFeedback('Notification dismissed.', 'success');
      },
      onError: () => showFeedback('Notification could not be dismissed.', 'error'),
    },
  );
  const notificationView = useMemo(() => {
    const merged = (notifications?.notifications ?? [])
      .map((notification) => ({
        ...notification,
        ...notificationOverrides[notification.id],
      }))
      .filter((notification) => notification.status !== 'dismissed');
    const unread = merged.filter((notification) => notification.status !== 'read' && notification.status !== 'dismissed').length;

    return {
      summary: {
        total: merged.length,
        unread,
        highPriority: merged.filter((notification) => notification.severity === 'critical' || notification.severity === 'high').length,
      },
      notifications: merged,
    };
  }, [notifications, notificationOverrides]);

  async function handleMarkNotificationRead(notificationId: string) {
    setPendingNotificationAction(`read:${notificationId}`);
    const optimisticReadAt = new Date().toISOString();
    setNotificationOverrides((current) => ({
      ...current,
      [notificationId]: {
        ...current[notificationId],
        status: 'read',
        readAt: optimisticReadAt,
        updatedAt: optimisticReadAt,
      },
    }));
    try {
      const updated = await markNotificationReadMutation.mutateAsync(notificationId);
      setNotificationOverrides((current) => ({
        ...current,
        [notificationId]: {
          status: updated.status,
          readAt: updated.readAt,
          updatedAt: updated.updatedAt,
        },
      }));
    } catch {
      // Error feedback is handled by the shared mutation hook.
      setNotificationOverrides((current) => {
        const next = { ...current };
        delete next[notificationId];
        return next;
      });
    } finally {
      setPendingNotificationAction(null);
    }
  }

  async function handleDismissNotification(notificationId: string) {
    setPendingNotificationAction(`dismiss:${notificationId}`);
    const optimisticUpdatedAt = new Date().toISOString();
    setNotificationOverrides((current) => ({
      ...current,
      [notificationId]: {
        ...current[notificationId],
        status: 'dismissed',
        updatedAt: optimisticUpdatedAt,
      },
    }));
    try {
      const updated = await dismissNotificationMutation.mutateAsync(notificationId);
      setNotificationOverrides((current) => ({
        ...current,
        [notificationId]: {
          status: updated.status,
          updatedAt: updated.updatedAt,
        },
      }));
    } catch {
      // Error feedback is handled by the shared mutation hook.
      setNotificationOverrides((current) => {
        const next = { ...current };
        delete next[notificationId];
        return next;
      });
    } finally {
      setPendingNotificationAction(null);
    }
  }

  if (!appReadiness.ready || isLoading) {
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
        <DataStatePanel
          tone="error"
          eyebrow="Dashboard"
          title="Operational overview unavailable"
          description={error ?? 'The backend-derived dashboard overview could not be loaded.'}
          diagnostics={diagnostics}
        />
        {message ? <ActionFeedback tone={tone} message={message} /> : null}
      </section>
    );
  }

  const blockedAllocations = getPriorityValue(dashboard.priorityWork, 'Blocked allocations');
  const refundAttention = getPriorityValue(dashboard.priorityWork, 'Refund attention');
  const needsAttention = blockedAllocations + refundAttention;
  const attentionItems = dashboard.priorityWork.filter((item) => getPriorityValue([item], item.label) > 0);
  const health = dashboard.observabilitySummary?.health ?? 'Unknown';
  const dashboardKpis = dashboard.stats.slice(0, 5);

  return (
    <section className="op-page dashboard-command-center dashboard-enterprise-shell">
      <header className="dashboard-enterprise-header">
        <div className="dashboard-enterprise-title">
          <h1>{dashboard.title}</h1>
          <p className="page-description">{dashboard.description}</p>
          <div className="dashboard-role-badges" aria-label="Workspace context">
            <StatusBadge tone="info">User {currentUser?.name ?? 'Unknown'}</StatusBadge>
            <StatusBadge tone="attention">Role {currentUser?.role ?? 'Unknown'}</StatusBadge>
            <StatusBadge tone="info">Vendor {dashboard.vendorName ?? 'Unknown'}</StatusBadge>
          </div>
        </div>
        <div className="dashboard-status-strip" aria-label="Dashboard status">
          <StatusBadge tone={health === 'Unknown' ? 'info' : getHealthTone(health)}>API {health}</StatusBadge>
          <div className="dashboard-sync-card">
            <span>Last sync</span>
            <strong>—</strong>
          </div>
          <StatusBadge tone={needsAttention > 0 ? 'warning' : 'success'}>{needsAttention} Attention</StatusBadge>
        </div>
      </header>

      <div className="dashboard-enterprise-kpi-row">
        {dashboardKpis.map((stat) => (
          <article key={stat.label} className={`dashboard-enterprise-kpi dashboard-kpi-${getDashboardKpiTone(stat.label)}`}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small>{getDashboardKpiHelper(stat.label)}</small>
          </article>
        ))}
      </div>

      <div className="dashboard-enterprise-grid">
        <div className="dashboard-enterprise-main">
          <OperationalSection
            title="Operational priority queue"
            description="High priority operational items that require attention."
          >
            {dashboard.priorityWork.length === 0 ? (
              <EmptyStatePanel title="No records available" description="No records available." />
            ) : (
              <div className="dashboard-priority-table">
                <div className="dashboard-priority-head" aria-hidden="true">
                  <span>Priority</span>
                  <span>Type</span>
                  <span>Count</span>
                  <span>Oldest</span>
                  <span>Status</span>
                  <span>Action</span>
                </div>
                {dashboard.priorityWork.map((item) => (
                  <article key={item.label} className="dashboard-priority-row">
                    <div className="dashboard-priority-cell">
                      <span className={`dashboard-priority-dot ${item.tone}`} aria-hidden="true" />
                      <span>{formatPriorityLabel(item.tone)}</span>
                    </div>
                    <div>
                      <strong>{item.label}</strong>
                      {item.description ? <p>{item.description}</p> : null}
                    </div>
                    <strong className="dashboard-count-value">{item.value}</strong>
                    <span className="dashboard-muted-value">—</span>
                    <span className="dashboard-muted-value">—</span>
                    <span className="dashboard-muted-value">—</span>
                  </article>
                ))}
              </div>
            )}
          </OperationalSection>

          <OperationalSection title="Recent operational events" description="Latest events from returns, refunds, and automation.">
            {dashboard.recentActivity.length === 0 ? (
              <EmptyStatePanel title="No records available" description="No records available." />
            ) : (
              <ul className="dashboard-activity-list dashboard-event-list">
                {dashboard.recentActivity.map((item) => {
                  const activity = formatRecentActivity(item);

                  return (
                    <li key={item}>
                      <span className="dashboard-event-dot" aria-hidden="true" />
                      <div className="dashboard-event-copy">
                        <strong>{activity.title}</strong>
                        <span>{activity.description}</span>
                      </div>
                      <div className="dashboard-event-meta">
                        <StatusBadge tone="info">—</StatusBadge>
                        <span>—</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </OperationalSection>

          <OperationalSection
            title={isAdmin ? 'Admin notification center' : 'Notification center'}
            description={isAdmin ? 'Global admin operational alerts.' : 'System notifications and operational alerts.'}
          >
            {notifications ? (
              <div className="notification-center">
                <div className="notification-summary-row">
                  <MetadataRow label="Unread" value={notificationView.summary.unread} />
                  <MetadataRow label="High priority" value={notificationView.summary.highPriority} />
                  <MetadataRow label="Total" value={notificationView.summary.total} />
                </div>
                {notificationView.notifications.length === 0 ? (
                  <EmptyStatePanel title="No active notifications" description="No active notifications." />
                ) : (
                  <div className="notification-list dashboard-notification-list">
                    {notificationView.notifications.slice(0, 6).map((notification) => (
                      <article key={notification.id} className={`notification-card ${notification.status === 'read' ? 'is-read' : ''}`}>
                        <div className="dashboard-notification-severity">
                          <StatusBadge tone={getNotificationTone(notification.severity)}>{notification.severity}</StatusBadge>
                        </div>
                        <div className="dashboard-notification-copy">
                          <strong>{notification.title}</strong>
                          <p>{notification.message}</p>
                          <div className="notification-meta">
                            <span>{formatNotificationSource(notification)}</span>
                            {notification.signalId ? <span>Signal {notification.signalId}</span> : null}
                          </div>
                        </div>
                        <div className="dashboard-notification-state">
                          <span>{new Date(notification.createdAt).toLocaleString()}</span>
                          <span className="notification-status">{notification.status}</span>
                        </div>
                        <div className="notification-actions">
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            disabled={notification.status === 'read' || Boolean(pendingNotificationAction)}
                            onClick={() => {
                              void handleMarkNotificationRead(notification.id);
                            }}
                          >
                            {pendingNotificationAction === `read:${notification.id}` ? 'Marking...' : 'Mark as read'}
                          </button>
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            disabled={Boolean(pendingNotificationAction)}
                            onClick={() => {
                              void handleDismissNotification(notification.id);
                            }}
                          >
                            {pendingNotificationAction === `dismiss:${notification.id}` ? 'Dismissing...' : 'Dismiss'}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : dashboard.notificationSummary ? (
              <div className="op-meta-grid">
                <MetadataRow label="Unread" value={dashboard.notificationSummary.unread} />
                <MetadataRow label="High priority" value={dashboard.notificationSummary.highPriority} />
                <MetadataRow label="Latest" value={dashboard.notificationSummary.latest.map((item) => item.title).join(', ') || 'No notifications'} />
              </div>
            ) : (
              <EmptyStatePanel title="Notifications unavailable" description="Not synced for this scope." />
            )}
          </OperationalSection>
        </div>

        <aside className="dashboard-enterprise-aside">
          <OperationalSection title="Needs attention" description={`${needsAttention} items require your attention.`}>
            {attentionItems.length === 0 ? (
              <EmptyStatePanel title="No attention items" description="No active attention items." />
            ) : (
              <div className="dashboard-attention-list">
                {attentionItems.map((item) => (
                  <article key={item.label} className={`dashboard-attention-row ${item.tone}`}>
                    <span className={`dashboard-status-dot ${getStatusDotTone(item.tone === 'severity-warning' ? 'warning' : item.tone === 'severity-attention' ? 'attention' : 'info')}`} aria-hidden="true" />
                    <div className="dashboard-attention-copy">
                      <strong>{item.label}</strong>
                      {item.description ? <p>{item.description}</p> : null}
                    </div>
                    <span className={`severity-chip ${item.tone}`}>{item.value}</span>
                  </article>
                ))}
              </div>
            )}
          </OperationalSection>

          <OperationalSection title="Finance snapshot" description="Overview of financial performance.">
            <div className="dashboard-status-metric-list dashboard-finance-rows">
              <div className="dashboard-status-metric-row">
                <span>Gross sales</span>
                <strong>{dashboard.financeSnapshot?.grossSales ?? '—'}</strong>
              </div>
              <div className="dashboard-status-metric-row">
                <span>Refunds</span>
                <strong>{dashboard.financeSnapshot?.refunds ?? '—'}</strong>
              </div>
              <div className="dashboard-status-metric-row">
                <span>Net revenue</span>
                <strong>{dashboard.financeSnapshot?.netRevenue ?? '—'}</strong>
              </div>
              <div className="dashboard-status-metric-row">
                <span>Payout estimate</span>
                <strong>{dashboard.financeSnapshot?.payoutEstimate ?? '—'}</strong>
              </div>
            </div>
          </OperationalSection>

          {currentUser?.role === 'admin' ? (
            <OperationalSection title="Diagnostics summary" description="System health and reconciliation overview.">
              {dashboard.diagnosticsSummary ? (
                <div className="dashboard-status-metric-list dashboard-diagnostics-rows">
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(dashboard.diagnosticsSummary.failedWebhooks > 0 ? 'danger' : 'success')}`} aria-hidden="true" />
                      Failed webhooks
                    </span>
                    <strong>{dashboard.diagnosticsSummary.failedWebhooks}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(dashboard.diagnosticsSummary.stuckReceived > 0 ? 'attention' : 'success')}`} aria-hidden="true" />
                      Stuck received
                    </span>
                    <strong>{dashboard.diagnosticsSummary.stuckReceived}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(dashboard.diagnosticsSummary.fulfillmentSyncFailures > 0 ? 'warning' : 'success')}`} aria-hidden="true" />
                      Fulfillment sync failures
                    </span>
                    <strong>{dashboard.diagnosticsSummary.fulfillmentSyncFailures}</strong>
                  </div>
                </div>
              ) : (
                <EmptyStatePanel title="Diagnostics unavailable" description="Not synced for this scope." />
              )}
            </OperationalSection>
          ) : null}

          {currentUser?.role === 'admin' ? (
            <OperationalSection title="Operational health" description="Uptime and operational metrics.">
              {dashboard.observabilitySummary ? (
                <div className="dashboard-status-metric-list dashboard-health-list">
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(getHealthTone(dashboard.observabilitySummary.health))}`} aria-hidden="true" />
                      Health
                    </span>
                    <StatusBadge tone={getHealthTone(dashboard.observabilitySummary.health)}>{dashboard.observabilitySummary.health}</StatusBadge>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Success rate 24h</span>
                    <strong>{formatRate(dashboard.observabilitySummary.successRate24h)}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Failed webhooks 24h</span>
                    <strong>{dashboard.observabilitySummary.failedWebhooks24h}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Retry pressure</span>
                    <strong>{dashboard.observabilitySummary.retryPressureScore}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Dead-letter</span>
                    <strong>{dashboard.observabilitySummary.deadLetterReady}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Reconciliation backlog</span>
                    <strong>{dashboard.observabilitySummary.reconciliationBacklog}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Stale signals</span>
                    <strong>{dashboard.observabilitySummary.staleStateCount}</strong>
                  </div>
                  {dashboard.observabilitySummary.note ? (
                    <p className="dashboard-status-note">{dashboard.observabilitySummary.note}</p>
                  ) : null}
                </div>
              ) : (
                <EmptyStatePanel title="Observability unavailable" description="Not synced for this scope." />
              )}
            </OperationalSection>
          ) : null}
        </aside>
      </div>

      <OperationalSection title="Workspace status" description="Summary of vendor-scoped operations.">
        <div className="dashboard-workspace-status-grid">
          <div>
            <span>Vendor</span>
            <strong>{dashboard.vendorName ?? 'Unknown'}</strong>
          </div>
          <div>
            <span>Scope</span>
            <strong>Vendor-scoped</strong>
          </div>
          <div>
            <span>Operational items</span>
            <strong>{dashboard.priorityWork.reduce((sum, item) => sum + getPriorityValue([item], item.label), 0)}</strong>
          </div>
          <div>
            <span>Pending attention</span>
            <strong>{needsAttention}</strong>
          </div>
          <div>
            <span>Queue items</span>
            <strong>{dashboard.priorityWork.length}</strong>
          </div>
        </div>
        <p className="dashboard-workspace-status-copy">{dashboard.workspaceStatus}</p>
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
