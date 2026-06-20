import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  EmptyStatePanel,
  SectionErrorRetry,
  SkeletonText,
} from '../components/OperationalPrimitives';
import { runtimeConfig } from '../config/runtime';
import {
  createDashboardRequestId,
  getDashboardDeferredOverview,
  getDashboardOverview,
} from '../lib/api/dashboard';
import type { DashboardOverview, DashboardPriorityItem, DashboardStat } from '../lib/api/contracts';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';

type VendorActionCard = {
  title: string;
  icon: string;
  accent: 'blue' | 'green' | 'orange' | 'purple';
  value: string;
  helperText: string;
  actionLabel: string;
  to: string;
};

type RecentOrderRow = {
  orderNumber: string;
  status: string;
  tone: 'blue' | 'green' | 'orange';
  date: string;
};

const demoRecentOrders: RecentOrderRow[] = [
  { orderNumber: '#1088', status: 'Awaiting Shipment', tone: 'orange', date: 'Jun 11, 10:32 AM' },
  { orderNumber: '#1087', status: 'Awaiting Shipment', tone: 'orange', date: 'Jun 11, 09:15 AM' },
  { orderNumber: '#1086', status: 'Processing', tone: 'blue', date: 'Jun 11, 08:47 AM' },
  { orderNumber: '#1085', status: 'Shipped', tone: 'green', date: 'Jun 10, 06:20 PM' },
  { orderNumber: '#1084', status: 'Delivered', tone: 'green', date: 'Jun 10, 02:15 PM' },
];

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

function buildActionCards(dashboard: DashboardOverview): VendorActionCard[] {
  const newOrders = findStatValue(dashboard.stats, ['vendor', 'orders']);
  const readyToShip = findStatValue(dashboard.stats, ['awaiting', 'shipment'])
    ?? findPriorityValue(dashboard.priorityWork, ['awaiting', 'shipment']);
  const returnsWaiting = findPriorityValue(dashboard.priorityWork, ['refund', 'attention'])
    ?? findPriorityValue(dashboard.priorityWork, ['return'])
    ?? findStatValue(dashboard.stats, ['blocked']);
  const upcomingPayment = dashboard.financeSnapshot?.payoutEstimate
    ?? findStatValue(dashboard.stats, ['payout', 'estimate']);

  return [
    {
      title: 'New Orders',
      icon: 'orders',
      accent: 'blue',
      value: asDisplayValue(newOrders),
      helperText: 'Awaiting confirmation',
      actionLabel: 'View Orders',
      to: '/orders',
    },
    {
      title: 'Ready to Ship',
      icon: 'shipping',
      accent: 'green',
      value: asDisplayValue(readyToShip),
      helperText: 'Awaiting shipment',
      actionLabel: 'Ship Orders',
      to: '/orders',
    },
    {
      title: 'Returns Waiting',
      icon: 'returns',
      accent: 'orange',
      value: asDisplayValue(returnsWaiting),
      helperText: 'Require review',
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
    { enabled: appReadiness.ready },
  );

  const initialDashboard = dashboardShell?.vendorId === vendorId ? dashboardShell : null;

  useEffect(() => {
    setShouldLoadDeferredDashboard(false);
  }, [vendorId]);

  useEffect(() => {
    if (!appReadiness.ready || !initialDashboard) {
      return undefined;
    }

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const frameId = window.requestAnimationFrame(() => setShouldLoadDeferredDashboard(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    const timeoutId = window.setTimeout(() => setShouldLoadDeferredDashboard(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, [appReadiness.ready, initialDashboard, vendorId]);

  const {
    data: deferredDashboard,
    refetch: refetchDeferredDashboard,
  } = useQueryResource(
    queryKeys.dashboard.deferredOverview(vendorId),
    ({ signal }) => getDashboardDeferredOverview(vendorId, { signal, requestId: dashboardRequestId }),
    { enabled: appReadiness.ready && shouldLoadDeferredDashboard && Boolean(initialDashboard) },
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
  const actionCards = buildActionCards(dashboardView);
  const isDashboardLoading = !appReadiness.ready || (isLoading && !initialDashboard);
  const upcomingPayment = asDisplayValue(dashboardView.financeSnapshot?.payoutEstimate, 'TRY 0');
  const lastPayment = 'TRY 0';
  const lastPaymentDate = 'Not available';
  const recentOrders = runtimeConfig.apiMode === 'mock' ? demoRecentOrders : [];
  const vendorName = dashboardView.vendorName || currentVendor.vendorName;

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
          <h1>Good morning, {vendorName} 👋</h1>
          <p>Here’s what’s happening with your store today.</p>
        </div>
        <div className="dashboard-vendor-topbar" aria-label="Dashboard shortcuts">
          <button
            type="button"
            className="dashboard-vendor-bell"
            aria-label="Open inbox"
            onClick={() => navigate('/support/inbox')}
          >
            <BellIcon />
            <span aria-hidden="true">3</span>
          </button>
          <button
            type="button"
            className="dashboard-vendor-pill"
            aria-label="Open profile"
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

      <div className="dashboard-vendor-action-grid" aria-label="Vendor dashboard actions">
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

      <section className="dashboard-vendor-panel dashboard-vendor-recent-panel" aria-label="Recent orders">
        <div className="dashboard-vendor-panel-header">
          <div>
            <h2>Recent Orders</h2>
            {runtimeConfig.apiMode === 'mock' ? <span className="dashboard-vendor-demo-badge">Demo preview</span> : null}
          </div>
          <Link className="dashboard-vendor-panel-link" to="/orders">
            View all orders
            <ArrowIcon />
          </Link>
        </div>
        {recentOrders.length > 0 ? (
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
                      <Link className="dashboard-vendor-open-link" to="/orders">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dashboard-vendor-empty-orders">
            <EmptyStatePanel
              title="Recent orders will appear here."
              description="Real order rows are not part of the current dashboard overview data."
            />
          </div>
        )}
      </section>

      <section className="dashboard-vendor-panel dashboard-vendor-payment-panel" aria-label="Payment summary">
        <h2>Payment Summary</h2>
        <div className="dashboard-vendor-payment-summary">
          <div className="dashboard-vendor-payment-metric">
            <span>Upcoming Payment</span>
            <strong>{isDashboardLoading ? <SkeletonText width="5rem" /> : upcomingPayment}</strong>
            <small>
              <CalendarIcon />
              Not available
            </small>
          </div>
          <div className="dashboard-vendor-payment-divider" aria-hidden="true" />
          <div className="dashboard-vendor-payment-metric">
            <span>Last Payment</span>
            <strong>{lastPayment}</strong>
            <small>
              <CalendarIcon />
              {lastPaymentDate}
            </small>
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
