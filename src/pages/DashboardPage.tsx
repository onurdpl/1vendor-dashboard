import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  OperationalSection,
  SectionErrorRetry,
  SkeletonText,
} from '../components/OperationalPrimitives';
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
  value: string;
  helperText: string;
  actionLabel: string;
  to: string;
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
      icon: '🛍️',
      value: asDisplayValue(newOrders),
      helperText: 'Review the latest store orders.',
      actionLabel: 'Open orders',
      to: '/orders',
    },
    {
      title: 'Ready to Ship',
      icon: '📦',
      value: asDisplayValue(readyToShip),
      helperText: 'Prepare orders waiting for fulfillment.',
      actionLabel: 'Ship orders',
      to: '/orders',
    },
    {
      title: 'Returns Waiting',
      icon: '↩️',
      value: asDisplayValue(returnsWaiting),
      helperText: 'Check returns and refund follow-ups.',
      actionLabel: 'Open returns',
      to: '/returns',
    },
    {
      title: 'Upcoming Payment',
      icon: '₺',
      value: asDisplayValue(upcomingPayment, 'TRY 0'),
      helperText: 'See the current payout estimate.',
      actionLabel: 'View finance',
      to: '/finance',
    },
  ];
}

export function DashboardPage() {
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
          <h1>Good morning, {dashboardView.vendorName || currentVendor.vendorName} 👋</h1>
          <p>Here’s what’s happening with your store today.</p>
        </div>
      </header>

      <div className="dashboard-vendor-action-grid" aria-label="Vendor dashboard actions">
        {actionCards.map((card) => (
          <article key={card.title} className="dashboard-vendor-action-card">
            <span className="dashboard-vendor-action-icon" aria-hidden="true">
              {card.icon}
            </span>
            <div className="dashboard-vendor-action-body">
              <span>{card.title}</span>
              <strong>{isDashboardLoading ? <SkeletonText width="4rem" /> : card.value}</strong>
              <p>{card.helperText}</p>
            </div>
            <Link className="dashboard-vendor-action-link" to={card.to}>
              {card.actionLabel}
            </Link>
          </article>
        ))}
      </div>

      <div className="dashboard-vendor-content-grid">
        <OperationalSection title="Recent Orders" description="Latest order activity for this store.">
          <EmptyStatePanel
            title="Recent orders will appear here."
            description="Order rows are not part of the current dashboard overview data."
          />
        </OperationalSection>

        <OperationalSection title="Payment Summary" description="A compact view of the current finance snapshot.">
          <article className="dashboard-vendor-payment-card">
            <div className="dashboard-vendor-payment-row">
              <span>Upcoming Payment</span>
              <strong>{isDashboardLoading ? <SkeletonText width="5rem" /> : upcomingPayment}</strong>
            </div>
            <div className="dashboard-vendor-payment-row">
              <span>Last Payment</span>
              <strong>{lastPayment}</strong>
              <small>{lastPaymentDate}</small>
            </div>
            <Link className="button button-secondary" to="/finance">
              Payment History
            </Link>
          </article>
        </OperationalSection>
      </div>
    </section>
  );
}
