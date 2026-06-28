import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  EmptyStatePanel,
  SectionErrorRetry,
  SkeletonText,
} from '../components/OperationalPrimitives';
import {
  createDashboardRequestId,
  getDashboardDeferredOverview,
  getDashboardOverview,
} from '../lib/api/dashboard';
import { listOrders } from '../features/orders/api';
import type { DashboardOverview, DashboardPriorityItem, DashboardStat, OrderSummary } from '../lib/api/contracts';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { getPageReadinessState } from '../lib/pageReadiness';

type VendorActionCard = {
  title: string;
  icon: string;
  accent: 'blue' | 'green' | 'orange' | 'purple';
  value: string;
  helperText: string;
  actionLabel: string;
  to: string;
};

type DashboardHeroAction = {
  value: string;
  label: string;
  helperText: string;
  actionLabel: string;
  to: string;
  tone: 'attention' | 'calm';
};

type RecentOrderRow = {
  orderNumber: string;
  status: string;
  tone: 'blue' | 'green' | 'orange';
  date: string;
  detailTo: string;
};

type DashboardRecentChange = {
  id: string;
  title: string;
  detail: string;
  meta: string;
};

function asDisplayValue(value: string | number | null | undefined, fallback = '0') {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : fallback;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function labelIncludes(label: string, fragments: string[]) {
  const normalized = label.toLowerCase();
  return fragments.every((fragment) => normalized.includes(fragment));
}

function findStatValue(stats: DashboardStat[] | undefined, fragments: string[]) {
  return stats?.find((stat) => labelIncludes(stat.label, fragments))?.value ?? null;
}

function findPriorityValue(priorityWork: DashboardPriorityItem[] | undefined, fragments: string[]) {
  return priorityWork?.find((item) => labelIncludes(item.label, fragments))?.value ?? null;
}

function findPriorityItem(priorityWork: DashboardPriorityItem[] | undefined, fragments: string[]) {
  return priorityWork?.find((item) => labelIncludes(item.label, fragments)) ?? null;
}

function hasAttentionValue(value: string | null | undefined) {
  const normalized = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(normalized) && normalized > 0;
}

function hasMeaningfulMoneyValue(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === '—' || normalized === 'not available') {
    return false;
  }
  const numericValue = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(numericValue) && numericValue !== 0;
}

function createFallbackDashboard(vendorId: string, vendorName: string): DashboardOverview {
  return {
    vendorId,
    vendorName,
    title: 'Vendor dashboard',
    description: 'Store activity is loading.',
    stats: [],
    recentActivity: [],
    workspaceStatus: 'Dashboard data is loading.',
    priorityWork: [],
  };
}

function getHeroActionTarget(item: DashboardPriorityItem | null): Pick<DashboardHeroAction, 'actionLabel' | 'to'> {
  const label = item?.label.toLowerCase() ?? '';
  if (label.includes('shipment')) {
    return { actionLabel: 'Ship orders', to: '/orders' };
  }
  if (label.includes('refund') || label.includes('return')) {
    return { actionLabel: 'Review returns', to: '/returns' };
  }
  if (label.includes('support')) {
    return { actionLabel: 'Reply to support', to: '/support' };
  }
  if (label.includes('finance')) {
    return { actionLabel: 'Review payments', to: '/finance' };
  }
  return { actionLabel: 'Review orders', to: '/orders' };
}

function buildHeroAction(dashboard: DashboardOverview): DashboardHeroAction {
  const primaryItem = dashboard.priorityWork.find((item) => hasAttentionValue(item.value)) ?? null;
  const target = getHeroActionTarget(primaryItem);
  if (!primaryItem) {
    return {
      value: '0',
      label: 'Needs Attention Today',
      helperText: 'No urgent store work is waiting right now.',
      actionLabel: 'View orders',
      to: '/orders',
      tone: 'calm',
    };
  }

  return {
    value: asDisplayValue(primaryItem.value),
    label: 'Needs Attention Today',
    helperText: primaryItem.description ?? primaryItem.label,
    actionLabel: target.actionLabel,
    to: target.to,
    tone: 'attention',
  };
}

function buildSupportingCards(dashboard: DashboardOverview): VendorActionCard[] {
  const readyToShip = findStatValue(dashboard.stats, ['awaiting', 'shipment'])
    ?? findPriorityValue(dashboard.priorityWork, ['awaiting', 'shipment']);
  const returnsItem = findPriorityItem(dashboard.priorityWork, ['refund', 'attention'])
    ?? findPriorityItem(dashboard.priorityWork, ['return']);
  const returnsWaiting = returnsItem?.value
    ?? findStatValue(dashboard.stats, ['blocked']);
  const upcomingPayment = dashboard.financeSnapshot?.payoutEstimate
    ?? findStatValue(dashboard.stats, ['payout', 'estimate']);

  return [
    {
      title: 'Orders to Ship',
      icon: 'shipping',
      accent: 'green',
      value: asDisplayValue(readyToShip),
      helperText: 'Awaiting shipment',
      actionLabel: 'Ship Orders',
      to: '/orders',
    },
    {
      title: 'Returns to Review',
      icon: 'returns',
      accent: 'orange',
      value: asDisplayValue(returnsWaiting),
      helperText: returnsItem?.description ?? 'Require review',
      actionLabel: 'Review Returns',
      to: '/returns',
    },
    {
      title: 'Upcoming Payment',
      icon: '₺',
      accent: 'purple',
      value: asDisplayValue(upcomingPayment, 'TRY 0'),
      helperText: 'Expected payment',
      actionLabel: 'View Payment',
      to: '/finance',
    },
  ];
}

function getVendorInitial(vendorName: string) {
  return vendorName.trim().charAt(0).toUpperCase() || 'V';
}

function formatOrderNumber(order: OrderSummary) {
  const orderNumber = String(order.sourceShopifyOrderNumber || order.id).trim();
  if (!orderNumber) {
    return order.id;
  }
  return orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;
}

function formatOrderDate(value: string | null | undefined) {
  if (!value) {
    return 'Not available';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getOrderTimestamp(order: OrderSummary) {
  const timestamp = Date.parse(order.date);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function humanizeOrderStatus(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getOrderStatusTone(order: OrderSummary): RecentOrderRow['tone'] {
  const statusText = `${order.status} ${order.fulfillmentStatus} ${order.shippingStatus}`.toLowerCase();
  if (statusText.includes('deliver') || statusText.includes('ship')) {
    return 'green';
  }
  if (statusText.includes('await') || statusText.includes('pending') || statusText.includes('review')) {
    return 'orange';
  }
  return 'blue';
}

function buildRecentOrderRows(orders: OrderSummary[] | undefined): RecentOrderRow[] {
  if (!orders?.length) {
    return [];
  }

  const indexedOrders = orders.map((order, index) => ({ order, index, timestamp: getOrderTimestamp(order) }));
  const hasReliableDates = indexedOrders.some((entry) => entry.timestamp !== null);
  const sortedOrders = hasReliableDates
    ? [...indexedOrders].sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity) || a.index - b.index)
    : indexedOrders;

  return sortedOrders.slice(0, 5).map(({ order }) => ({
    orderNumber: formatOrderNumber(order),
    status: humanizeOrderStatus(order.shippingStatus || order.fulfillmentStatus || order.status),
    tone: getOrderStatusTone(order),
    date: formatOrderDate(order.date),
    detailTo: `/orders/${encodeURIComponent(order.id)}`,
  }));
}

function extractOrderNumberFromActivity(activity: string) {
  const orderMatch = activity.match(/(?:Shopify order|order)\s+#*([A-Za-z0-9-]+)/i);
  return orderMatch ? `#${orderMatch[1]}` : null;
}

function extractHourCount(activity: string) {
  const hourMatch = activity.match(/(\d+(?:\.\d+)?)\s*hours?/i);
  if (!hourMatch) {
    return null;
  }
  const hours = Number(hourMatch[1]);
  return Number.isFinite(hours) ? hours : null;
}

function formatDurationFromHours(hours: number) {
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    return `over ${days} day${days === 1 ? '' : 's'}`;
  }
  return `over ${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'}`;
}

function formatDashboardActivity(activity: string, index: number): DashboardRecentChange {
  const normalized = activity.trim();
  const lower = normalized.toLowerCase();
  const orderNumber = extractOrderNumberFromActivity(normalized);
  const hours = extractHourCount(normalized);
  const generic: DashboardRecentChange = {
    id: `activity-${index}-${normalized}`,
    title: 'Store activity updated',
    detail: 'A store update was recorded.',
    meta: '',
  };

  if (!normalized) {
    return generic;
  }

  if (lower.includes('fulfillment is stale') || lower.includes('stale fulfillment')) {
    return {
      ...generic,
      title: 'Shipment needs attention',
      detail: hours ? `An order has been waiting for shipment for ${formatDurationFromHours(hours)}.` : 'An order has been waiting for shipment longer than expected.',
    };
  }

  if (lower.includes('delivered')) {
    return {
      ...generic,
      title: 'Order delivered',
      detail: orderNumber ? `Order ${orderNumber} was marked as delivered.` : 'An order was marked as delivered.',
    };
  }

  if (lower.includes('return') || lower.includes('refund')) {
    return {
      ...generic,
      title: lower.includes('processed') ? 'Return processed' : 'Return updated',
      detail: 'A return/refund was updated.',
    };
  }

  if (lower.includes('shipment watcher') || lower.includes('shipment') && lower.includes('automation')) {
    return {
      ...generic,
      title: 'Shipment review created',
      detail: 'A shipment issue was added for review.',
    };
  }

  if (lower.includes('payment') || lower.includes('payout')) {
    return {
      ...generic,
      title: 'Payment estimate updated',
      detail: 'Your payment information was updated.',
    };
  }

  if (orderNumber) {
    return {
      ...generic,
      title: 'Order updated',
      detail: `Order ${orderNumber} was updated.`,
    };
  }

  return generic;
}

function buildRecentChanges(dashboard: DashboardOverview, recentOrders: RecentOrderRow[]): DashboardRecentChange[] {
  const activityChanges = dashboard.recentActivity
    .map((activity, index) => activity.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map(formatDashboardActivity);

  if (activityChanges.length > 0) {
    return activityChanges;
  }

  return recentOrders.slice(0, 4).map((order) => ({
    id: `order-${order.orderNumber}`,
    title: `${order.orderNumber} is ${order.status}`,
    detail: 'Order activity',
    meta: order.date,
  }));
}

function DashboardCardIcon({ name }: { name: string }) {
  const commonProps = {
    width: 30,
    height: 30,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'shipping') {
    return (
      <svg {...commonProps}>
        <path d="M3 7h10v10H3z" />
        <path d="M13 10h4l4 4v3h-8z" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
      </svg>
    );
  }

  if (name === 'returns') {
    return (
      <svg {...commonProps}>
        <path d="M9 7 4 12l5 5" />
        <path d="M4 12h12a4 4 0 0 1 0 8h-3" />
      </svg>
    );
  }

  if (name === '₺') {
    return (
      <svg {...commonProps}>
        <rect x="3" y="6" width="18" height="13" rx="3" />
        <path d="M7 10h10" />
        <path d="M15 15h2" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M6 7h12l-1 13H7L6 7Z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a3 3 0 0 0 0 6v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a3 3 0 0 0 0-6V6Z" />
      <path d="M13 5v14" />
      <path d="M8 9h2" />
      <path d="M8 15h2" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const vendorId = currentVendor.vendorId;
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: true,
    currentVendorId: vendorId,
  });
  const [shouldLoadDeferredDashboard, setShouldLoadDeferredDashboard] = useState(false);
  const dashboardRequestId = useMemo(() => createDashboardRequestId(), [vendorId]);

  const {
    data: dashboardShell,
    isLoading,
    isError,
    error,
    refetch: refetchDashboardShell,
  } = useQueryResource(
    queryKeys.dashboard.overview(vendorId),
    ({ signal }) => getDashboardOverview(vendorId, { signal, requestId: dashboardRequestId }),
    { enabled: pageReadiness.ready },
  );

  const initialDashboard = dashboardShell?.vendorId === vendorId ? dashboardShell : null;

  useEffect(() => {
    setShouldLoadDeferredDashboard(false);
  }, [vendorId]);

  useEffect(() => {
    if (!pageReadiness.ready || !initialDashboard) {
      return undefined;
    }

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const frameId = window.requestAnimationFrame(() => setShouldLoadDeferredDashboard(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    const timeoutId = window.setTimeout(() => setShouldLoadDeferredDashboard(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, [pageReadiness.ready, initialDashboard, vendorId]);

  const {
    data: deferredDashboard,
    refetch: refetchDeferredDashboard,
  } = useQueryResource(
    queryKeys.dashboard.deferredOverview(vendorId),
    ({ signal }) => getDashboardDeferredOverview(vendorId, { signal, requestId: dashboardRequestId }),
    { enabled: pageReadiness.ready && shouldLoadDeferredDashboard && Boolean(initialDashboard) },
  );

  const {
    data: vendorOrders,
    isLoading: isOrdersLoading,
    isError: isOrdersError,
  } = useQueryResource(
    queryKeys.orders.list(vendorId),
    ({ signal }) => listOrders({ vendorId, signal }),
    { enabled: pageReadiness.ready && Boolean(vendorId) },
  );

  async function refetchDashboard() {
    const shellRefresh = refetchDashboardShell();
    if (shouldLoadDeferredDashboard) {
      void refetchDeferredDashboard();
    }
    await shellRefresh;
  }

  const dashboardView = deferredDashboard?.vendorId === vendorId
    ? deferredDashboard
    : initialDashboard ?? createFallbackDashboard(vendorId, currentVendor.vendorName);
  const heroAction = buildHeroAction(dashboardView);
  const actionCards = buildSupportingCards(dashboardView);
  const isDashboardLoading = pageReadiness.ready && isLoading && !initialDashboard;
  const upcomingPayment = hasMeaningfulMoneyValue(dashboardView.financeSnapshot?.payoutEstimate)
    ? dashboardView.financeSnapshot?.payoutEstimate
    : null;
  const recentOrders = buildRecentOrderRows(vendorOrders ?? undefined);
  const recentChanges = buildRecentChanges(dashboardView, recentOrders);
  const vendorName = dashboardView.vendorName || currentVendor.vendorName;

  if (pageReadiness.status === 'missing_vendor_context') {
    return (
      <section className="op-page dashboard-vendor-launchpad">
        <EmptyStatePanel
          title="Select vendor"
          description="No vendor context available. Choose a vendor context before loading the vendor dashboard."
        />
      </section>
    );
  }

  if (pageReadiness.status === 'waiting_vendor_context') {
    return (
      <section className="op-page dashboard-vendor-launchpad">
        <EmptyStatePanel
          title="Waiting for vendor context"
          description="Dashboard activity will load after the authenticated vendor scope is ready."
        />
      </section>
    );
  }

  if (pageReadiness.status === 'unauthorized') {
    return (
      <section className="op-page dashboard-vendor-launchpad">
        <EmptyStatePanel title="Sign in required" description="Sign in before loading the vendor dashboard." />
      </section>
    );
  }

  if (isError && !initialDashboard) {
    return (
      <section className="op-page dashboard-vendor-launchpad">
        <SectionErrorRetry
          title="Dashboard unavailable"
          description={error ?? 'The dashboard overview could not be loaded.'}
          onRetry={() => void refetchDashboard()}
        />
      </section>
    );
  }

  return (
    <section className="op-page dashboard-vendor-launchpad">
      <header className="dashboard-vendor-header">
        <div>
          <h1>Today, {vendorName}</h1>
          <p>Start with the work that needs attention, then check orders, returns, and payment timing.</p>
        </div>
        <div className="dashboard-vendor-topbar" aria-label="Dashboard shortcuts">
          <button
            type="button"
            className="dashboard-vendor-icon-button dashboard-vendor-support"
            aria-label="Open support tickets"
            onClick={() => navigate('/support')}
          >
            <TicketIcon />
          </button>
          <button
            type="button"
            className="dashboard-vendor-icon-button dashboard-vendor-bell"
            aria-label="Open inbox"
            onClick={() => navigate('/support/inbox')}
          >
            <BellIcon />
            <span aria-hidden="true">3</span>
          </button>
          <button
            type="button"
            className="dashboard-vendor-pill"
            aria-label="Open vendor profile"
            onClick={() => navigate('/vendor/profile')}
          >
            <span className="dashboard-vendor-pill-avatar" aria-hidden="true">
              {getVendorInitial(vendorName)}
            </span>
            <strong>{vendorName}</strong>
            <span className="dashboard-vendor-pill-chevron" aria-hidden="true">⌄</span>
          </button>
        </div>
      </header>

      <section className="dashboard-vendor-hero-grid" aria-label="Today dashboard summary">
        <article className={`dashboard-vendor-attention-hero dashboard-vendor-attention-${heroAction.tone}`}>
          <div>
            <span className="dashboard-vendor-hero-kicker">Most important today</span>
            <h2>{heroAction.label}</h2>
            <strong>{isDashboardLoading ? <SkeletonText width="5rem" /> : heroAction.value}</strong>
            <p>{heroAction.helperText}</p>
          </div>
          <Link className="dashboard-vendor-hero-link" to={heroAction.to}>
            {heroAction.actionLabel}
            <ArrowIcon />
          </Link>
        </article>

        <div className="dashboard-vendor-supporting-grid" aria-label="Dashboard supporting metrics">
          {actionCards.map((card) => (
            <article key={card.title} className={`dashboard-vendor-action-card dashboard-vendor-accent-${card.accent}`}>
              <div className="dashboard-vendor-action-main">
                <span className="dashboard-vendor-action-icon" aria-hidden="true">
                  <DashboardCardIcon name={card.icon} />
                </span>
                <div className="dashboard-vendor-action-body">
                  <span>{card.title}</span>
                  <strong>{isDashboardLoading ? <SkeletonText width="4rem" /> : card.value}</strong>
                </div>
              </div>
              <p>{card.helperText}</p>
              <Link className="dashboard-vendor-action-link" to={card.to}>
                {card.actionLabel}
                <ArrowIcon />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-vendor-panel dashboard-vendor-recent-panel" aria-label="Recent changes">
        <div className="dashboard-vendor-panel-header">
          <div>
            <h2>Recent Changes</h2>
            <p>Latest store updates from orders, returns, payments, and support.</p>
          </div>
          <Link className="dashboard-vendor-panel-link" to="/orders">
            Open orders
            <ArrowIcon />
          </Link>
        </div>
        {isDashboardLoading || (isOrdersLoading && recentChanges.length === 0) ? (
          <div className="dashboard-vendor-change-list">
            <div className="dashboard-vendor-change-row">
              <span className="dashboard-vendor-change-dot" aria-hidden="true" />
              <div>
                <SkeletonText width="16rem" />
                <SkeletonText width="10rem" />
              </div>
            </div>
          </div>
        ) : recentChanges.length > 0 ? (
          <div className="dashboard-vendor-change-list">
            {recentChanges.map((change) => (
              <div className="dashboard-vendor-change-row" key={change.id}>
                <span className="dashboard-vendor-change-dot" aria-hidden="true" />
                <div>
                  <strong>{change.title}</strong>
                  <small>{change.detail}</small>
                </div>
                {change.meta ? <span>{change.meta}</span> : null}
              </div>
            ))}
          </div>
        ) : isOrdersError ? (
          <div className="dashboard-vendor-empty-orders">
            <EmptyStatePanel
              title="Recent changes could not be loaded."
              description="Open Orders to review the vendor order list."
            />
          </div>
        ) : (
          <div className="dashboard-vendor-empty-orders">
            <EmptyStatePanel
              title="No recent changes yet."
              description="Order, return, payment, and support updates will appear here when they happen."
            />
          </div>
        )}

        {recentOrders.length > 0 ? (
          <details className="dashboard-vendor-orders-details">
            <summary>
              <span>Recent orders</span>
              <small>{recentOrders.length} latest</small>
            </summary>
            <div className="dashboard-vendor-table-wrap">
              <table className="dashboard-vendor-orders-table">
                <thead>
                  <tr>
                    <th>Order Number</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.orderNumber}>
                      <td>
                        <strong>{order.orderNumber}</strong>
                      </td>
                      <td>
                        <span className={`dashboard-vendor-status dashboard-vendor-status-${order.tone}`}>
                          {order.status}
                        </span>
                      </td>
                      <td>{order.date}</td>
                      <td>
                        <Link className="dashboard-vendor-open-link" to={order.detailTo}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      <section className="dashboard-vendor-panel dashboard-vendor-payment-panel" aria-label="Payment summary">
        <h2>Payment Summary</h2>
        <div className="dashboard-vendor-payment-summary">
          {isDashboardLoading ? (
            <div className="dashboard-vendor-payment-metric">
              <span>Upcoming Payment</span>
              <strong><SkeletonText width="5rem" /></strong>
            </div>
          ) : upcomingPayment ? (
            <div className="dashboard-vendor-payment-metric">
              <span>Upcoming Payment</span>
              <strong>{upcomingPayment}</strong>
              <small>Estimated from current payment preparation.</small>
            </div>
          ) : (
            <div className="dashboard-vendor-payment-note">
              <strong>No upcoming payment estimate yet.</strong>
              <span>Payment timing will appear here when orders become eligible.</span>
            </div>
          )}
          <div className="dashboard-vendor-payment-note">
            <strong>No payment history available yet.</strong>
            <span>Completed payments will appear in Finance after payment records exist.</span>
          </div>
          <Link className="dashboard-vendor-payment-link" to="/finance">
            Payment History
            <ArrowIcon />
          </Link>
        </div>
      </section>
    </section>
  );
}
