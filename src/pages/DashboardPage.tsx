import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  MetricSkeletonGrid,
  MetadataRow,
  OperationalSection,
  SectionErrorRetry,
  SkeletonText,
  StatusBadge,
  WorkflowActionGuidance,
} from '../components/OperationalPrimitives';
import { useActionFeedback } from '../lib/ui';
import { getDashboardOverview } from '../lib/api/dashboard';
import { useAppReadiness } from '../lib/appReadiness';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import { queryKeys } from '../lib/api/queryKeys';
import { runtimeServices } from '../services/runtime-services';
import type { NotificationIntent } from '../lib/api/contracts';
import { formatDateTime, safeArray } from '../services/real/formatting';
import { getDashboardWorkflowAction, getDashboardWorkflowRoute, workflowRoutes } from '../lib/workflowActionGuidance';

function parseDashboardCount(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || /[$€£₺]/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed.replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeGroupKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatGroupedActivityTitle(title: string, count: number) {
  const normalized = normalizeGroupKey(title);
  if (normalized.includes('fulfillment') && normalized.includes('stale')) {
    return `${count} stale fulfillments`;
  }
  if (normalized.includes('refund')) {
    return `${count} refund events`;
  }
  if (normalized.includes('return')) {
    return `${count} return events`;
  }
  return `${count} similar ${title.toLowerCase()} events`;
}

function groupRecentActivity(items: string[]) {
  const groups = new Map<
    string,
    {
      key: string;
      title: string;
      description: string;
      count: number;
      items: Array<{ raw: string; title: string; description: string }>;
    }
  >();

  items.forEach((item, index) => {
    const activity = formatRecentActivity(item);
    const normalizedTitle = normalizeGroupKey(activity.title);
    const key = normalizedTitle || `activity-${index}`;
    const group = groups.get(key);
    const detail = { raw: item, title: activity.title, description: activity.description };

    if (group) {
      group.count += 1;
      group.items.push(detail);
      return;
    }

    groups.set(key, {
      key,
      title: activity.title,
      description: activity.description,
      count: 1,
      items: [detail],
    });
  });

  return [...groups.values()];
}

function groupStaleFulfillmentSignals(items: string[]) {
  return groupRecentActivity(items).filter((activity) => {
    const normalized = normalizeGroupKey(activity.title);
    return normalized.includes('fulfillment') && normalized.includes('stale');
  });
}

function getNotificationSeverityRank(severity: NotificationIntent['severity']) {
  if (severity === 'critical') {
    return 4;
  }
  if (severity === 'high') {
    return 3;
  }
  if (severity === 'warning') {
    return 2;
  }
  return 1;
}

function getNotificationTime(notification: NotificationIntent) {
  const timestamp = Date.parse(notification.updatedAt || notification.createdAt || notification.deliveredAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatGroupedNotificationTitle(title: string, count: number) {
  const normalized = normalizeGroupKey(title);
  if (normalized.includes('fulfillment') && normalized.includes('stale')) {
    return `${count} stale fulfillment alerts`;
  }
  if (normalized.includes('shipping')) {
    return `${count} shipping alerts`;
  }
  if (normalized.includes('refund')) {
    return `${count} refund alerts`;
  }
  return `${count} related alerts`;
}

function groupNotifications(notifications: NotificationIntent[]) {
  const groups = new Map<
    string,
    {
      key: string;
      representative: NotificationIntent;
      notifications: NotificationIntent[];
      unread: number;
      latestTime: number;
      severityRank: number;
    }
  >();

  notifications.forEach((notification, index) => {
    const source = formatNotificationSource(notification);
    const key = `${normalizeGroupKey(notification.title)}|${source}|${notification.severity}`;
    const time = getNotificationTime(notification);
    const severityRank = getNotificationSeverityRank(notification.severity);
    const unread = notification.status !== 'read' && notification.status !== 'dismissed' ? 1 : 0;
    const group = groups.get(key || `notification-${index}`);

    if (group) {
      group.notifications.push(notification);
      group.unread += unread;
      group.latestTime = Math.max(group.latestTime, time);
      group.severityRank = Math.max(group.severityRank, severityRank);
      const representativeRead = group.representative.status === 'read' || group.representative.status === 'dismissed';
      const notificationIsUnread = notification.status !== 'read' && notification.status !== 'dismissed';
      const sameReadPriority = representativeRead === !notificationIsUnread;
      if ((representativeRead && notificationIsUnread) || (sameReadPriority && time > getNotificationTime(group.representative))) {
        group.representative = notification;
      }
      return;
    }

    groups.set(key, {
      key,
      representative: notification,
      notifications: [notification],
      unread,
      latestTime: time,
      severityRank,
    });
  });

  return [...groups.values()].sort((a, b) => {
    if (a.severityRank !== b.severityRank) {
      return b.severityRank - a.severityRank;
    }
    return b.latestTime - a.latestTime;
  });
}

function isUnreadNotification(notification: NotificationIntent) {
  return notification.status !== 'read' && notification.status !== 'dismissed';
}

function isSupportNotification(notification: NotificationIntent) {
  const source = formatNotificationSource(notification);
  const category = readNotificationMetadata(notification, 'category') ?? '';
  const linkedEntityType = readNotificationMetadata(notification, 'linkedEntityType') ?? '';
  const normalized = normalizeGroupKey(
    [notification.title, notification.message, source, category, linkedEntityType].filter(Boolean).join(' '),
  );

  return (
    normalized.includes('support') ||
    normalized.includes('ticket') ||
    normalized.includes('reply') ||
    normalized.includes('escalat')
  );
}

function getSupportNotificationGroupKey(notification: NotificationIntent, index: number) {
  const linkedEntityId =
    readNotificationMetadata(notification, 'linkedEntityId') ??
    readNotificationMetadata(notification, 'orderId') ??
    readNotificationMetadata(notification, 'returnRequestId') ??
    readNotificationMetadata(notification, 'supportTicketId') ??
    notification.signalId ??
    normalizeGroupKey(notification.title);

  return [
    notification.vendorId ?? 'global',
    readNotificationMetadata(notification, 'linkedEntityType') ?? formatNotificationSource(notification),
    linkedEntityId || `support-notification-${index}`,
  ]
    .map((part) => normalizeGroupKey(part))
    .join('|');
}

function groupSupportActivity(notifications: NotificationIntent[]) {
  const groups = new Map<
    string,
    {
      key: string;
      representative: NotificationIntent;
      notifications: NotificationIntent[];
      latestTime: number;
      unread: number;
    }
  >();

  notifications.forEach((notification, index) => {
    if (!isUnreadNotification(notification) || !isSupportNotification(notification)) {
      return;
    }

    const key = getSupportNotificationGroupKey(notification, index);
    const time = getNotificationTime(notification);
    const group = groups.get(key);

    if (group) {
      group.notifications.push(notification);
      group.unread += 1;
      if (time > group.latestTime) {
        group.latestTime = time;
        group.representative = notification;
      }
      return;
    }

    groups.set(key, {
      key,
      representative: notification,
      notifications: [notification],
      latestTime: time,
      unread: 1,
    });
  });

  return [...groups.values()].sort((a, b) => b.latestTime - a.latestTime);
}

type DashboardActionProjection = {
  id: string;
  label: string;
  value: string;
  count: number | null;
  tone: string;
  description: string;
  sourceLabel: string;
};

function normalizePriorityWork(items: Array<{ label: string; value: string; tone: string; description?: string }>): DashboardActionProjection[] {
  return items.map((item) => {
    const normalized = normalizeGroupKey(item.label);
    const count = parseDashboardCount(item.value);

    if (normalized.includes('automation')) {
      return {
        id: 'automation-issue-groups',
        label: 'Automation issue groups',
        value: count === null ? 'Unknown' : item.value,
        count,
        tone: item.tone,
        description:
          count && count > 0
            ? 'Grouped active automation and rules issues. Raw signals remain in automation history.'
            : 'No grouped automation issues currently need action.',
        sourceLabel: item.label,
      };
    }

    if (normalized.includes('finance') || normalized.includes('payout') || normalized.includes('settlement')) {
      return {
        id: 'finance-review',
        label: 'Finance review',
        value: count === null ? 'Review pending' : item.value,
        count,
        tone: item.tone,
        description: item.description ?? 'Settlement review workload.',
        sourceLabel: item.label,
      };
    }

    if (normalized.includes('support')) {
      return {
        id: 'open-support-issues',
        label: 'Open support issues',
        value: count === null ? item.value : String(count),
        count,
        tone: item.tone,
        description: item.description ?? 'Grouped support issues that need follow-up.',
        sourceLabel: item.label,
      };
    }

    return {
      id: normalized || item.label,
      label: item.label,
      value: item.value,
      count,
      tone: item.tone,
      description: item.description ?? 'Operational workload item.',
      sourceLabel: item.label,
    };
  });
}

function getDashboardActionRoute(label: string) {
  return getDashboardWorkflowRoute(label);
}

function getDashboardActionLabel(label: string) {
  return getDashboardWorkflowAction(label).actionLabel;
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
    ({ signal }) => getDashboardOverview(vendorId, { signal }),
    { enabled: appReadiness.ready },
  );
  const {
    data: notifications,
    refetch: refetchNotifications,
  } = useQueryResource(notificationQueryKey, ({ signal }) => runtimeServices.notifications.list(notificationScopeVendorId, { signal }), {
    enabled: appReadiness.ready && Boolean(dashboard),
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
    const merged = safeArray(notifications?.notifications)
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

  const dashboardView = dashboard ?? {
    vendorId,
    vendorName: currentVendor.vendorName,
    title: 'Operations dashboard',
    description: 'Operational overview is loading.',
    stats: [],
    recentActivity: [],
    workspaceStatus: 'Dashboard data is loading.',
    priorityWork: [],
  };

  const priorityWork = safeArray(dashboardView.priorityWork);
  const recentActivity = safeArray(dashboardView.recentActivity);
  const partialDataWarnings = safeArray(dashboardView.partialDataWarnings);
  const dashboardStats = safeArray(dashboardView.stats);
  const normalizedCounts = dashboardView.normalizedOperationalCounts;
  const groupedRecentActivity = groupRecentActivity(recentActivity);
  const staleFulfillmentGroups = groupStaleFulfillmentSignals(recentActivity);
  const groupedNotifications = groupNotifications(notificationView.notifications);
  const supportActivityGroups = groupSupportActivity(notificationView.notifications);
  const actionProjections = normalizePriorityWork(priorityWork);
  const visibleNotificationGroups = groupedNotifications.slice(0, 3);
  const collapsedNotificationCount = Math.max(0, groupedNotifications.length - visibleNotificationGroups.length);
  const operationalActionTotal = actionProjections.reduce((sum, item) => sum + (item.count ?? 0), 0);
  const health = dashboardView.observabilitySummary?.health ?? 'Unknown';
  const dashboardKpis = dashboardStats.slice(0, 5);
  const isDashboardInitialLoading = !appReadiness.ready || (isLoading && !dashboard);
  const fulfillmentProjection = actionProjections.find((item) => normalizeGroupKey(item.sourceLabel).includes('awaiting shipment'));
  const returnsProjection = actionProjections.find((item) => normalizeGroupKey(item.sourceLabel).includes('refund attention'));
  const automationProjection = actionProjections.find((item) => item.id === 'automation-issue-groups');
  const financeProjection = actionProjections.find((item) => item.id === 'finance-review');
  const normalizedSupportCount = normalizedCounts?.openSupportIssueCount;
  const normalizedAutomationCount = normalizedCounts?.groupedAutomationIssueCount;
  const normalizedFinanceReviewCount = normalizedCounts?.financeReviewItemCount;
  const normalizedStaleFulfillmentCount = normalizedCounts?.staleFulfillmentGroupCount;
  const hasNormalizedSupportCount = typeof normalizedSupportCount === 'number';
  const hasNormalizedAutomationCount = typeof normalizedAutomationCount === 'number';
  const hasNormalizedFinanceReviewCount = typeof normalizedFinanceReviewCount === 'number';
  const hasNormalizedStaleFulfillmentCount = typeof normalizedStaleFulfillmentCount === 'number';
  const supportQueueLabel = hasNormalizedSupportCount
    ? 'Open support issues'
    : supportActivityGroups.length > 0
      ? 'Unread support notifications'
      : 'Open support issues';
  const supportQueueValue = hasNormalizedSupportCount
    ? String(normalizedSupportCount)
    : supportActivityGroups.length > 0
      ? String(supportActivityGroups.length)
      : 'Open';
  const supportQueueDescription = hasNormalizedSupportCount
    ? `${normalizedSupportCount} open support issue group${normalizedSupportCount === 1 ? '' : 's'} from current support tickets.`
    : supportActivityGroups.length > 0
      ? `${supportActivityGroups.length} grouped unread support notification${supportActivityGroups.length === 1 ? '' : 's'}.`
      : 'Support workspace remains available; no unread support notification groups.';
  const financeQueueValue = hasNormalizedFinanceReviewCount
    ? String(normalizedFinanceReviewCount)
    : normalizedCounts
      ? 'Unknown'
      : financeProjection?.value ?? (dashboardView.financeSnapshot ? 'Review pending' : 'Unknown');
  const financeQueueDescription = hasNormalizedFinanceReviewCount
    ? `${normalizedFinanceReviewCount} finance review item${normalizedFinanceReviewCount === 1 ? '' : 's'} from settlement records.`
    : financeProjection
      ? financeProjection.description
      : 'Settlement review count is not modeled yet.';
  const fulfillmentQueueLabel = hasNormalizedStaleFulfillmentCount ? 'Stale fulfillment groups' : 'Fulfillment queue';
  const fulfillmentQueueValue = hasNormalizedStaleFulfillmentCount
    ? String(normalizedStaleFulfillmentCount)
    : fulfillmentProjection?.value ?? (staleFulfillmentGroups.length > 0 ? String(staleFulfillmentGroups.length) : '—');
  const fulfillmentQueueDescription = hasNormalizedStaleFulfillmentCount
    ? `${normalizedStaleFulfillmentCount} stale fulfillment group${normalizedStaleFulfillmentCount === 1 ? '' : 's'} from operational signals.`
    : staleFulfillmentGroups.length > 0
      ? `${staleFulfillmentGroups.length} stale fulfillment group${staleFulfillmentGroups.length === 1 ? '' : 's'} in recent activity.`
      : 'Shipment work waiting for action.';
  const queueCards = [
    {
      label: fulfillmentQueueLabel,
      value: fulfillmentQueueValue,
      description: fulfillmentQueueDescription,
      guidance: getDashboardWorkflowAction(fulfillmentQueueLabel),
      tone: 'fulfillment',
      to: hasNormalizedStaleFulfillmentCount || staleFulfillmentGroups.length > 0
        ? workflowRoutes.staleFulfillment
        : workflowRoutes.awaitingShipment,
      action: 'Open orders',
    },
    {
      label: 'Returns queue',
      value: returnsProjection?.value ?? '—',
      description: 'Return and refund review workload.',
      guidance: getDashboardWorkflowAction('Return pending review'),
      tone: 'returns',
      to: workflowRoutes.pendingReturnReview,
      action: 'Open returns',
    },
    {
      label: 'Finance review queue',
      value: financeQueueValue,
      description: financeQueueDescription,
      guidance: getDashboardWorkflowAction('Settlement pending review'),
      tone: 'finance',
      to: workflowRoutes.settlementReview,
      action: 'Open finance',
    },
    {
      label: supportQueueLabel,
      value: supportQueueValue,
      description: supportQueueDescription,
      guidance: getDashboardWorkflowAction(supportQueueLabel),
      tone: 'support',
      to: workflowRoutes.openSupportIssues,
      action: 'Open support',
    },
    {
      label: 'Automation issue groups',
      value: hasNormalizedAutomationCount ? String(normalizedAutomationCount) : automationProjection?.value ?? '—',
      description: automationProjection?.description ?? 'Grouped automation and rule issues.',
      guidance: getDashboardWorkflowAction('Automation issue groups'),
      tone: 'automation',
      to: workflowRoutes.activeAutomationIssueGroups,
      action: 'Open automation',
    },
  ];

  return (
    <section className="op-page dashboard-command-center dashboard-enterprise-shell">
      <header className="dashboard-enterprise-header">
        <div className="dashboard-enterprise-title">
          <h1>{dashboardView.title}</h1>
          <p className="page-description">{dashboardView.description}</p>
          <div className="dashboard-role-badges" aria-label="Workspace context">
            <StatusBadge tone="info">User {currentUser?.name ?? 'Unknown'}</StatusBadge>
            <StatusBadge tone="attention">Role {currentUser?.role ?? 'Unknown'}</StatusBadge>
            <StatusBadge tone="info">Vendor {dashboardView.vendorName ?? 'Unknown'}</StatusBadge>
          </div>
        </div>
        <div className="dashboard-status-strip" aria-label="Dashboard status">
          <StatusBadge tone={health === 'Unknown' ? 'info' : getHealthTone(health)}>API {health}</StatusBadge>
          <div className="dashboard-sync-card">
            <span>Last sync</span>
            <strong>—</strong>
          </div>
          <StatusBadge tone={operationalActionTotal > 0 ? 'warning' : 'success'}>{operationalActionTotal} Actions</StatusBadge>
        </div>
      </header>

      <OperationalSection title="Needs attention" description={`${operationalActionTotal} grouped actionable issues across fulfillment, returns, refunds, and automation.`}>
        {isError && !dashboard ? (
          <SectionErrorRetry
            title="Operational overview unavailable"
            description={error ?? 'The backend-derived dashboard overview could not be loaded.'}
            onRetry={() => void refetchDashboard()}
          />
        ) : isDashboardInitialLoading ? (
          <div className="dashboard-action-grid" aria-label="Dashboard action skeleton">
            {Array.from({ length: 4 }, (_, index) => (
              <article key={`dashboard-action-skeleton-${index}`} className="dashboard-action-card op-skeleton-row">
                <SkeletonText width="52%" />
                <SkeletonText width="24%" />
                <SkeletonText width="64%" />
              </article>
            ))}
          </div>
        ) : actionProjections.length === 0 ? (
          <EmptyStatePanel title="No attention items" description="No active attention items." />
        ) : (
          <div className="dashboard-action-grid">
            {actionProjections.map((item) => {
              const isActive = (item.count ?? 0) > 0;
              const guidance = getDashboardWorkflowAction(item.label);

              return (
                <article key={item.label} className={`dashboard-action-card ${item.tone} ${isActive ? 'is-active' : 'is-quiet'}`}>
                  <div className="dashboard-action-card-top">
                    <span className={`dashboard-priority-dot ${item.tone}`} aria-hidden="true" />
                    <span>{formatPriorityLabel(item.tone)}</span>
                  </div>
                  <strong>{item.label}</strong>
                  <div className="dashboard-action-card-count">
                    <span>{item.value}</span>
                    <StatusBadge tone={isActive ? 'warning' : 'success'}>{isActive ? 'Action needed' : 'Clear'}</StatusBadge>
                  </div>
                  {item.description ? <p>{item.description}</p> : null}
                  <WorkflowActionGuidance
                    actionLabel={guidance.actionLabel}
                    description={guidance.description}
                    tone={guidance.tone}
                  />
                  <Link className="dashboard-action-link" to={getDashboardActionRoute(item.label)}>
                    {getDashboardActionLabel(item.label)}
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </OperationalSection>

      <OperationalSection title="Operational queues" description="Live work queues before passive reporting.">
        <div className="dashboard-queue-card-grid">
          {queueCards.map((queue) => (
            <article key={queue.label} className={`dashboard-queue-card dashboard-queue-${queue.tone}`}>
              <span>{queue.label}</span>
              <strong>{isDashboardInitialLoading ? <SkeletonText width="3rem" /> : queue.value}</strong>
              <small>{queue.description}</small>
              <small>Next: {queue.guidance.actionLabel}</small>
              <Link className="dashboard-queue-link" to={queue.to}>
                {queue.action}
              </Link>
            </article>
          ))}
        </div>
        {isError && !dashboard ? (
          <SectionErrorRetry
            title="Operational queues unavailable"
            description={error ?? 'The backend-derived dashboard overview could not be loaded.'}
            onRetry={() => void refetchDashboard()}
          />
        ) : isDashboardInitialLoading ? (
          <div className="dashboard-priority-table" aria-label="Dashboard priority skeleton">
            <div className="dashboard-priority-head" aria-hidden="true">
              <span>Priority</span>
              <span>Type</span>
              <span>Count</span>
              <span>Oldest</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {Array.from({ length: 3 }, (_, index) => (
              <article key={`dashboard-priority-skeleton-${index}`} className="dashboard-priority-row op-skeleton-row">
                <SkeletonText width="56%" />
                <SkeletonText width="70%" />
                <SkeletonText width="28%" />
                <SkeletonText width="42%" />
                <SkeletonText width="48%" />
                <SkeletonText width="36%" />
              </article>
            ))}
          </div>
        ) : actionProjections.length === 0 ? (
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
            {actionProjections.map((item) => (
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

      <div className="dashboard-passive-heading">
        <span>Passive insights</span>
        <p>Reporting, history, and notification context sit below immediate action work.</p>
      </div>

      <div className="dashboard-enterprise-kpi-row dashboard-passive-kpis">
        {isDashboardInitialLoading ? (
          <MetricSkeletonGrid labels={['Vendor orders', 'Awaiting shipment', 'Blocked / attention', 'Payout estimate']} />
        ) : dashboardKpis.map((stat) => (
          <article key={stat.label} className={`dashboard-enterprise-kpi dashboard-kpi-${getDashboardKpiTone(stat.label)}`}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small>{getDashboardKpiHelper(stat.label)}</small>
          </article>
        ))}
      </div>

      <div className="dashboard-enterprise-grid dashboard-passive-grid">
        <div className="dashboard-enterprise-main">
          <OperationalSection title="Recent operational events" description="Grouped historical activity for context.">
            {isDashboardInitialLoading ? (
              <ul className="dashboard-activity-list dashboard-event-list" aria-label="Dashboard activity skeleton">
                {Array.from({ length: 3 }, (_, index) => (
                  <li key={`dashboard-activity-skeleton-${index}`} className="op-skeleton-row">
                    <span className="dashboard-event-dot" aria-hidden="true" />
                    <div className="dashboard-event-copy">
                      <SkeletonText width="68%" />
                      <SkeletonText width="52%" />
                    </div>
                    <div className="dashboard-event-meta">
                      <SkeletonText width="42%" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : groupedRecentActivity.length === 0 ? (
              <EmptyStatePanel title="No records available" description="No records available." />
            ) : (
              <ul className="dashboard-activity-list dashboard-event-list">
                {groupedRecentActivity.map((activity) => {
                  const hasGroup = activity.count > 1;

                  return (
                    <li key={activity.key} className={hasGroup ? 'dashboard-event-grouped' : undefined}>
                      <span className="dashboard-event-dot" aria-hidden="true" />
                      <div className="dashboard-event-copy">
                        <strong>{hasGroup ? formatGroupedActivityTitle(activity.title, activity.count) : activity.title}</strong>
                        <span>{hasGroup ? `Latest issue: ${activity.description}` : activity.description}</span>
                        {hasGroup ? (
                          <details className="dashboard-event-details">
                            <summary>Show {activity.count} matching events</summary>
                            <ul>
                              {activity.items.map((detail, index) => (
                                <li key={`${detail.raw}-${index}`}>
                                  <span>{detail.title}</span>
                                  <small>{detail.description}</small>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                      <div className="dashboard-event-meta">
                        <StatusBadge tone={hasGroup ? 'attention' : 'info'}>{hasGroup ? `${activity.count} events` : '—'}</StatusBadge>
                        <span>—</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </OperationalSection>

          <OperationalSection
            title={isAdmin ? 'Admin notification history' : 'Notification history'}
            description={isAdmin ? 'Grouped global admin alert history.' : 'Grouped system notification history.'}
          >
            {notifications ? (
              <div className="notification-center">
                <div className="notification-summary-row">
                  <MetadataRow label="Unread" value={notificationView.summary.unread} />
                  <MetadataRow label="High priority" value={notificationView.summary.highPriority} />
                  <MetadataRow label="Total" value={notificationView.summary.total} />
                </div>
                {groupedNotifications.length === 0 ? (
                  <EmptyStatePanel title="No active notifications" description="No active notifications." />
                ) : (
                  <div className="notification-list dashboard-notification-list">
                    {visibleNotificationGroups.map((group) => {
                      const notification = group.representative;
                      const hasGroup = group.notifications.length > 1;
                      const groupStatus = hasGroup
                        ? group.unread > 0
                          ? `${group.unread} unread`
                          : 'all read'
                        : notification.status;

                      return (
                        <article
                          key={group.key}
                          className={`notification-card ${group.unread === 0 ? 'is-read' : ''} ${hasGroup ? 'is-grouped' : ''}`}
                        >
                          <div className="dashboard-notification-severity">
                            <StatusBadge tone={getNotificationTone(notification.severity)}>{notification.severity}</StatusBadge>
                            {hasGroup ? <span className="dashboard-notification-count">{group.notifications.length}</span> : null}
                          </div>
                          <div className="dashboard-notification-copy">
                            <strong>{hasGroup ? formatGroupedNotificationTitle(notification.title, group.notifications.length) : notification.title}</strong>
                            <p>{hasGroup ? `Latest issue: ${notification.message}` : notification.message}</p>
                            <div className="notification-meta">
                              <span>{formatNotificationSource(notification)}</span>
                              {notification.signalId ? <span>Signal {notification.signalId}</span> : null}
                              {hasGroup ? <span>{group.notifications.length} linked alerts</span> : null}
                            </div>
                            {hasGroup ? (
                              <details className="dashboard-notification-details">
                                <summary>Show matching alerts</summary>
                                <ul>
                                  {group.notifications.map((groupedNotification) => (
                                    <li key={groupedNotification.id}>
                                      <span>{groupedNotification.title}</span>
                                      <small>{formatDateTime(groupedNotification.createdAt)}</small>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            ) : null}
                          </div>
                          <div className="dashboard-notification-state">
                            <span>{formatDateTime(notification.createdAt, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}</span>
                            <span className="notification-status">{groupStatus}</span>
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
                      );
                    })}
                    {collapsedNotificationCount > 0 ? (
                      <div className="dashboard-notification-more">
                        {collapsedNotificationCount} lower-priority notification groups collapsed
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : dashboard ? dashboardView.notificationSummary ? (
              <div className="op-meta-grid">
                <MetadataRow label="Unread" value={dashboardView.notificationSummary.unread} />
                <MetadataRow label="High priority" value={dashboardView.notificationSummary.highPriority} />
                <MetadataRow label="Latest" value={safeArray(dashboardView.notificationSummary.latest).map((item) => item.title).join(', ') || 'No notifications'} />
              </div>
            ) : (
              <EmptyStatePanel title="Notifications unavailable" description="Not synced for this scope." />
            ) : (
              <div className="notification-center">
                <div className="notification-summary-row">
                  <MetadataRow label="Unread" value={<SkeletonText width="2rem" />} />
                  <MetadataRow label="High priority" value={<SkeletonText width="2rem" />} />
                  <MetadataRow label="Total" value={<SkeletonText width="2rem" />} />
                </div>
              </div>
            )}
          </OperationalSection>
        </div>

        <aside className="dashboard-enterprise-aside">
          <OperationalSection title="Finance snapshot" description="Overview of financial performance.">
            <div className="dashboard-status-metric-list dashboard-finance-rows">
              <div className="dashboard-status-metric-row">
                <span>Gross sales</span>
                <strong>{!appReadiness.ready || (isLoading && !dashboard) ? <SkeletonText width="4rem" /> : dashboardView.financeSnapshot?.grossSales ?? '—'}</strong>
              </div>
              <div className="dashboard-status-metric-row">
                <span>Refunds</span>
                <strong>{!appReadiness.ready || (isLoading && !dashboard) ? <SkeletonText width="4rem" /> : dashboardView.financeSnapshot?.refunds ?? '—'}</strong>
              </div>
              <div className="dashboard-status-metric-row">
                <span>Net revenue</span>
                <strong>{!appReadiness.ready || (isLoading && !dashboard) ? <SkeletonText width="4rem" /> : dashboardView.financeSnapshot?.netRevenue ?? '—'}</strong>
              </div>
              <div className="dashboard-status-metric-row">
                <span>Payout estimate</span>
                <strong>{!appReadiness.ready || (isLoading && !dashboard) ? <SkeletonText width="4rem" /> : dashboardView.financeSnapshot?.payoutEstimate ?? '—'}</strong>
              </div>
            </div>
          </OperationalSection>

          {currentUser?.role === 'admin' ? (
            <OperationalSection title="Diagnostics summary" description="System health and reconciliation overview.">
              {dashboardView.diagnosticsSummary ? (
                <div className="dashboard-status-metric-list dashboard-diagnostics-rows">
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(dashboardView.diagnosticsSummary.failedWebhooks > 0 ? 'danger' : 'success')}`} aria-hidden="true" />
                      Failed webhooks
                    </span>
                    <strong>{dashboardView.diagnosticsSummary.failedWebhooks}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(dashboardView.diagnosticsSummary.stuckReceived > 0 ? 'attention' : 'success')}`} aria-hidden="true" />
                      Stuck received
                    </span>
                    <strong>{dashboardView.diagnosticsSummary.stuckReceived}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(dashboardView.diagnosticsSummary.fulfillmentSyncFailures > 0 ? 'warning' : 'success')}`} aria-hidden="true" />
                      Fulfillment sync failures
                    </span>
                    <strong>{dashboardView.diagnosticsSummary.fulfillmentSyncFailures}</strong>
                  </div>
                </div>
              ) : (
                <EmptyStatePanel title="Diagnostics unavailable" description="Not synced for this scope." />
              )}
            </OperationalSection>
          ) : null}

          {currentUser?.role === 'admin' ? (
            <OperationalSection title="Operational health" description="Uptime and operational metrics.">
              {dashboardView.observabilitySummary ? (
                <div className="dashboard-status-metric-list dashboard-health-list">
                  <div className="dashboard-status-metric-row">
                    <span>
                      <i className={`dashboard-status-dot ${getStatusDotTone(getHealthTone(dashboardView.observabilitySummary.health))}`} aria-hidden="true" />
                      Health
                    </span>
                    <StatusBadge tone={getHealthTone(dashboardView.observabilitySummary.health)}>{dashboardView.observabilitySummary.health}</StatusBadge>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Success rate 24h</span>
                    <strong>{formatRate(dashboardView.observabilitySummary.successRate24h)}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Failed webhooks 24h</span>
                    <strong>{dashboardView.observabilitySummary.failedWebhooks24h}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Retry pressure</span>
                    <strong>{dashboardView.observabilitySummary.retryPressureScore}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Dead-letter</span>
                    <strong>{dashboardView.observabilitySummary.deadLetterReady}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Reconciliation backlog</span>
                    <strong>{dashboardView.observabilitySummary.reconciliationBacklog}</strong>
                  </div>
                  <div className="dashboard-status-metric-row">
                    <span>Stale signals</span>
                    <strong>{dashboardView.observabilitySummary.staleStateCount}</strong>
                  </div>
                  {dashboardView.observabilitySummary.note ? (
                    <p className="dashboard-status-note">{dashboardView.observabilitySummary.note}</p>
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
            <strong>{dashboardView.vendorName ?? 'Unknown'}</strong>
          </div>
          <div>
            <span>Scope</span>
            <strong>Vendor-scoped</strong>
          </div>
          <div>
            <span>Operational items</span>
            <strong>{operationalActionTotal}</strong>
          </div>
          <div>
            <span>Pending attention</span>
            <strong>{operationalActionTotal}</strong>
          </div>
          <div>
            <span>Queue items</span>
            <strong>{actionProjections.length}</strong>
          </div>
        </div>
        <p className="dashboard-workspace-status-copy">{dashboardView.workspaceStatus}</p>
        {partialDataWarnings.length ? (
          <ul className="dashboard-activity-list">
            {partialDataWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </OperationalSection>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
