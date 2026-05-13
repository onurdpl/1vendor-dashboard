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

export function DashboardPage() {
  const [vendorId, setVendorId] = useState(() => getCurrentVendorContext().vendorId);
  const currentUser = getCurrentUser();
  const { message, tone, showFeedback } = useActionFeedback();
  const { data: dashboard, isLoading, isError, error, refetch: refetchDashboard } = useQueryResource(
    queryKeys.dashboard.overview(),
    () => getDashboardOverview(vendorId),
  );
  const {
    data: notifications,
    refetch: refetchNotifications,
  } = useQueryResource(queryKeys.notifications.list(), () => runtimeServices.notifications.list());
  const markNotificationReadMutation = useMutationAction(
    (notificationId: string) => runtimeServices.notifications.markRead(notificationId),
    {
      onSuccess: async () => {
        await Promise.all([refetchNotifications(), refetchDashboard()]);
        showFeedback('Notification marked as read.', 'success');
      },
      onError: () => showFeedback('Notification could not be marked as read.', 'error'),
    },
  );
  const dismissNotificationMutation = useMutationAction(
    (notificationId: string) => runtimeServices.notifications.dismiss(notificationId),
    {
      onSuccess: async () => {
        await Promise.all([refetchNotifications(), refetchDashboard()]);
        showFeedback('Notification dismissed.', 'success');
      },
      onError: () => showFeedback('Notification could not be dismissed.', 'error'),
    },
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

        <OperationalSection title="Notification center" description="In-app signal notifications for this role.">
          {notifications ? (
            <div className="notification-center">
              <div className="notification-summary-row">
                <MetadataRow label="Unread" value={notifications.summary.unread} />
                <MetadataRow label="High priority" value={notifications.summary.critical + notifications.summary.high} />
                <MetadataRow label="Total" value={notifications.summary.total} />
              </div>
              {notifications.notifications.length === 0 ? (
                <EmptyStatePanel title="No active notifications" description="No active notifications." />
              ) : (
                <div className="notification-list">
                  {notifications.notifications.slice(0, 6).map((notification) => (
                    <article key={notification.id} className={`notification-card ${notification.status === 'read' ? 'is-read' : ''}`}>
                      <header>
                        <div>
                          <div className="notification-title-row">
                            <StatusBadge tone={getNotificationTone(notification.severity)}>{notification.severity}</StatusBadge>
                            <strong>{notification.title}</strong>
                          </div>
                          <p>{notification.message}</p>
                        </div>
                        <span className="notification-status">{notification.status}</span>
                      </header>
                      <div className="notification-meta">
                        <span>{formatNotificationSource(notification)}</span>
                        <span>{new Date(notification.createdAt).toLocaleString()}</span>
                        {notification.signalId ? <span>Signal {notification.signalId}</span> : null}
                      </div>
                      <div className="notification-actions">
                        <button
                          type="button"
                          className="button button-secondary button-compact"
                          disabled={notification.status === 'read' || markNotificationReadMutation.isPending}
                          onClick={() => markNotificationReadMutation.mutate(notification.id)}
                        >
                          Mark as read
                        </button>
                        <button
                          type="button"
                          className="button button-secondary button-compact"
                          disabled={notification.status === 'dismissed' || dismissNotificationMutation.isPending}
                          onClick={() => dismissNotificationMutation.mutate(notification.id)}
                        >
                          Dismiss
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

        {currentUser?.role === 'admin' ? (
          <OperationalSection title="Operational health" description="Lightweight observability from webhook, retry, and reconciliation metrics.">
            {dashboard.observabilitySummary ? (
              <div className="op-meta-grid dashboard-observability-grid">
                <MetadataRow label="Health" value={<StatusBadge tone={getHealthTone(dashboard.observabilitySummary.health)}>{dashboard.observabilitySummary.health}</StatusBadge>} />
                <MetadataRow label="Success rate 24h" value={formatRate(dashboard.observabilitySummary.successRate24h)} />
                <MetadataRow label="Failed webhooks 24h" value={dashboard.observabilitySummary.failedWebhooks24h} />
                <MetadataRow label="Retry pressure" value={dashboard.observabilitySummary.retryPressureScore} />
                <MetadataRow label="Dead-letter" value={dashboard.observabilitySummary.deadLetterReady} />
                <MetadataRow label="Reconciliation backlog" value={dashboard.observabilitySummary.reconciliationBacklog} />
                <MetadataRow label="Stale signals" value={dashboard.observabilitySummary.staleStateCount} />
                <MetadataRow label="Note" value={dashboard.observabilitySummary.note} />
              </div>
            ) : (
              <EmptyStatePanel title="Observability unavailable" description="Not synced for this scope." />
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
