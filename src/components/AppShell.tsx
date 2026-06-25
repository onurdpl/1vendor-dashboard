import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { clearToken } from '../lib/auth';
import { getAvailableVendors, getCurrentVendorContext, setCurrentVendorId } from '../lib/auth';
import { requestAuthRestoreRetry, useAuthRestoreSnapshot } from '../lib/auth';
import { useAppReadiness } from '../lib/appReadiness';
import { queryClient } from '../lib/api/queryClient';
import { useActionFeedback } from '../lib/ui';
import { runtimeServices } from '../services/runtime-services';
import { ActionFeedback } from './ActionFeedback';
import { runtimeConfig } from '../config/runtime';

type ShellIconName =
  | 'dashboard'
  | 'orders'
  | 'returns'
  | 'payments'
  | 'inbox'
  | 'settings'
  | 'queue'
  | 'settlement'
  | 'schedule'
  | 'support'
  | 'analytics'
  | 'providers'
  | 'diagnostics'
  | 'logout';

const vendorNavItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/orders', label: 'Orders', icon: 'orders' },
  { to: '/returns', label: 'Returns', icon: 'returns' },
  { to: '/finance', label: 'Payments', icon: 'payments' },
  { to: '/support/inbox', label: 'Inbox', icon: 'inbox' },
  { to: '/vendor/profile', label: 'Settings', icon: 'settings' },
] satisfies Array<{ to: string; label: string; icon: ShellIconName; end?: boolean }>;

const adminNavItems = [
  { to: '/admin/operations', label: 'Operations Queue', icon: 'queue' },
  { to: '/admin/finance/settlement-approvals', label: 'Settlement Approvals', icon: 'settlement' },
  { to: '/admin/finance/settlement-schedules', label: 'Scheduled Settlements', icon: 'schedule' },
  { to: '/admin/support', label: 'Support Tickets', icon: 'support' },
  { to: '/admin/support/analytics', label: 'Support Analytics', icon: 'analytics' },
  { to: '/admin/providers', label: 'Providers', icon: 'providers' },
  { to: '/admin/diagnostics', label: 'Diagnostics', icon: 'diagnostics' },
] satisfies Array<{ to: string; label: string; icon: ShellIconName }>;

const missingVendorContext = {
  vendorId: '',
  vendorName: 'No vendor selected',
  scope: 'missing-vendor-context',
};

function ShellIcon({ name }: { name: ShellIconName }) {
  const commonProps = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'dashboard') {
    return (
      <svg {...commonProps}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13v-9.5" />
        <path d="M9.5 20v-5h5v5" />
      </svg>
    );
  }

  if (name === 'orders') {
    return (
      <svg {...commonProps}>
        <path d="M6 7h12l-1 13H7L6 7Z" />
        <path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
    );
  }

  if (name === 'returns') {
    return (
      <svg {...commonProps}>
        <path d="M9 7 4 12l5 5" />
        <path d="M4 12h11a5 5 0 0 1 0 10h-2" />
      </svg>
    );
  }

  if (name === 'payments') {
    return (
      <svg {...commonProps}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
      </svg>
    );
  }

  if (name === 'inbox') {
    return (
      <svg {...commonProps}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }

  if (name === 'settings') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.04.04-2 3.46-.06-.02a1.8 1.8 0 0 0-2.02.46l-.02.04h-4l-.02-.04a1.8 1.8 0 0 0-2.02-.46l-.06.02-2-3.46.04-.04a1.8 1.8 0 0 0 .36-2l-.02-.06L5.6 12l2.38-2.94.02-.06a1.8 1.8 0 0 0-.36-2l-.04-.04 2-3.46.06.02a1.8 1.8 0 0 0 2.02-.46l.02-.04h4l.02.04a1.8 1.8 0 0 0 2.02.46l.06-.02 2 3.46-.04.04a1.8 1.8 0 0 0-.36 2l.02.06L21.8 12l-2.38 2.94-.02.06Z" />
      </svg>
    );
  }

  if (name === 'logout') {
    return (
      <svg {...commonProps}>
        <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
        <path d="M15 7l5 5-5 5" />
        <path d="M20 12H9" />
      </svg>
    );
  }

  if (name === 'analytics') {
    return (
      <svg {...commonProps}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M8 15v-4" />
        <path d="M12 15V8" />
        <path d="M16 15v-2" />
      </svg>
    );
  }

  if (name === 'diagnostics') {
    return (
      <svg {...commonProps}>
        <path d="M12 3v18" />
        <path d="M3 12h18" />
        <path d="m5 5 14 14" />
        <path d="m19 5-14 14" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 9h8" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function getVendorInitial(vendorName: string) {
  return vendorName.trim().charAt(0).toUpperCase() || 'V';
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const appReadiness = useAppReadiness();
  const authRestore = useAuthRestoreSnapshot();
  const currentUser = appReadiness.currentUser;
  const isAdmin = currentUser?.role === 'admin';
  const isDashboardRoute = location.pathname === '/';
  const isOrdersRoute = location.pathname === '/orders';
  const isOrderDetailRoute = location.pathname.startsWith('/orders/');
  const isFinanceRoute = location.pathname === '/finance';
  const isVendorProfileRoute = location.pathname === '/vendor/profile';
  const usesModernWorkspaceFrame = isDashboardRoute || isOrdersRoute || isOrderDetailRoute || isFinanceRoute || isVendorProfileRoute;
  const { message, tone, showFeedback } = useActionFeedback();
  const vendors = getAvailableVendors();
  const [selectedVendorId, setSelectedVendorId] = useState(() => getCurrentVendorContext().vendorId);
  const visibleVendors = currentUser
    ? currentUser.canSwitchVendors
      ? vendors
      : vendors.filter((vendor) => currentUser.vendorAccess.includes(vendor.vendorId))
    : vendors;
  const currentVendor =
    visibleVendors.find((vendor) => vendor.vendorId === selectedVendorId) ?? visibleVendors[0] ?? vendors[0] ?? missingVendorContext;
  const showSessionRestoreBanner = runtimeConfig.apiMode === 'real' && Boolean(currentUser) && !appReadiness.authConfirmed;
  const sessionRestoreNeedsAttention = authRestore.phase === 'restore_error' || authRestore.delayed;
  const frontendBuildLabel = [
    runtimeConfig.gitCommit ? `commit ${runtimeConfig.gitCommit}` : null,
    runtimeConfig.buildTimestamp ? `built ${runtimeConfig.buildTimestamp}` : null,
    `version ${runtimeConfig.appVersion}`,
  ].filter(Boolean).join(' · ');

  useEffect(() => {
    setSelectedVendorId(appReadiness.currentVendor.vendorId);
  }, [appReadiness.currentVendor.vendorId]);

  function handleLogout() {
    void runtimeServices.auth.logout().catch(() => undefined);
    clearToken();
    showFeedback('Signed out successfully.', 'success');
    globalThis.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 180);
  }

  function handleSignInAgain() {
    clearToken();
    navigate('/login', { replace: true });
  }

  function handleVendorChange(nextVendorId: string) {
    if (!visibleVendors.some((vendor) => vendor.vendorId === nextVendorId)) {
      return;
    }

    setCurrentVendorId(nextVendorId);
    setSelectedVendorId(nextVendorId);
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['returns'] });
    void queryClient.invalidateQueries({ queryKey: ['finance'] });
    void queryClient.invalidateQueries({ queryKey: ['automation'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['support'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'support'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'diagnostics'] });
  }

  return (
    <div className={`app-shell ${isDashboardRoute ? 'dashboard-shell-active' : ''} ${isOrdersRoute ? 'orders-shell-active' : ''} ${isOrderDetailRoute ? 'order-detail-shell-active' : ''} ${isFinanceRoute ? 'finance-shell-active' : ''}`}>
      <aside className="sidebar">
        <div className="brand shell-brand">
          <div className="brand-mark" aria-hidden="true">
            VD
          </div>
          <div>
            <div className="brand-name">VendorOps</div>
            <div className="brand-subtitle">Vendor Dashboard</div>
          </div>
        </div>

        <div className="nav-group vendor-nav-group">
          <nav className="nav" aria-label="Primary">
            {vendorNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                <span className="nav-icon" aria-hidden="true">
                  <ShellIcon name={item.icon} />
                </span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {isAdmin ? (
          <div className="nav-group">
            <div className="nav-group-label admin-nav-label">Admin tools</div>
            <nav className="nav" aria-label="Admin tools">
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <ShellIcon name={item.icon} />
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        ) : null}

        <div className="vendor-account-card shell-card">
          <div className="vendor-account-main">
            <span className="vendor-account-avatar" aria-hidden="true">
              {getVendorInitial(currentVendor.vendorName)}
            </span>
            <div className="vendor-account-copy">
              <strong>{currentVendor.vendorName}</strong>
              <span>{currentUser?.role === 'admin' ? 'Admin' : 'Vendor'}</span>
            </div>
            {currentUser?.canSwitchVendors && visibleVendors.length > 0 ? (
              <label className="vendor-account-switcher">
                <span className="sr-only">Select vendor</span>
                <select
                  className="vendor-account-select"
                  value={selectedVendorId}
                  onChange={(event) => handleVendorChange(event.target.value)}
                >
                  {visibleVendors.map((vendor) => (
                    <option key={vendor.vendorId} value={vendor.vendorId}>
                      {vendor.vendorName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <button type="button" className="vendor-logout-button" onClick={handleLogout}>
            <ShellIcon name="logout" />
            Log out
          </button>
        </div>

        {message ? <ActionFeedback tone={tone} message={message} /> : null}
      </aside>

      <div className="app-content">
        {usesModernWorkspaceFrame ? null : (
          <>
            <PageHeader title="Operational control center" description="Shopify operations, finance, diagnostics, and recovery." />
            <div className="shell-context-bar">
              <span className="severity-chip severity-normal">User {currentUser?.name ?? 'Unknown user'}</span>
              <span className="severity-chip severity-attention">Role {currentUser?.role ?? 'Unauthenticated'}</span>
              <span className="severity-chip severity-low">Vendor {currentVendor.vendorName}</span>
            </div>
          </>
        )}
        {showSessionRestoreBanner ? (
          <section
            className={`auth-restore-banner ${sessionRestoreNeedsAttention ? 'auth-restore-banner-attention' : ''}`}
            role={sessionRestoreNeedsAttention ? 'alert' : 'status'}
          >
            <div>
              <p className="eyebrow">Session</p>
              <h2>
                {sessionRestoreNeedsAttention
                  ? 'Session check is taking longer than expected'
                  : 'Checking your session'}
              </h2>
              <p>
                {sessionRestoreNeedsAttention
                  ? 'The workspace shell is available, but protected data remains locked until the backend confirms your session.'
                  : 'Protected data will load after the backend confirms your session.'}
              </p>
              <div className="auth-restore-meta">
                {authRestore.restoreAttemptId ? <span>Reference {authRestore.restoreAttemptId}</span> : null}
                <span>{frontendBuildLabel}</span>
              </div>
            </div>
            <div className="auth-restore-actions">
              <button type="button" className="button button-secondary" onClick={requestAuthRestoreRetry}>
                Retry
              </button>
              <button type="button" className="button button-ghost" onClick={handleSignInAgain}>
                Sign in again
              </button>
            </div>
          </section>
        ) : null}
        <main className="page-frame">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
