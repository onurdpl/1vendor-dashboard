import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { clearToken, getCurrentUser, getToken } from '../lib/auth';
import { getAvailableVendors, getCurrentVendorContext, setCurrentVendorId } from '../lib/auth';
import { queryClient } from '../lib/api/queryClient';
import { useActionFeedback } from '../lib/ui';
import { ActionFeedback } from './ActionFeedback';

const workspaceNavItems = [
  { to: '/', label: 'Dashboard', icon: 'D' },
];

const operationsNavItems = [
  { to: '/orders', label: 'Orders', icon: 'O' },
  { to: '/returns', label: 'Returns', icon: 'R' },
  { to: '/finance', label: 'Finance', icon: 'F' },
  { to: '/automation', label: 'Automation', icon: 'A' },
];

const adminNavItems = [
  { to: '/admin/operations', label: 'Operations Queue', icon: 'Q' },
  { to: '/admin/diagnostics', label: 'Diagnostics', icon: 'X' },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = getToken();
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
  const isDashboardRoute = location.pathname === '/';
  const isOrdersRoute = location.pathname === '/orders';
  const isOrderDetailRoute = location.pathname.startsWith('/orders/');
  const usesModernWorkspaceFrame = isDashboardRoute || isOrdersRoute || isOrderDetailRoute;
  const { message, tone, showFeedback } = useActionFeedback();
  const vendors = getAvailableVendors();
  const [selectedVendorId, setSelectedVendorId] = useState(() => getCurrentVendorContext().vendorId);
  const visibleVendors = currentUser
    ? currentUser.canSwitchVendors
      ? vendors
      : vendors.filter((vendor) => currentUser.vendorAccess.includes(vendor.vendorId))
    : vendors;
  const currentVendor =
    visibleVendors.find((vendor) => vendor.vendorId === selectedVendorId) ?? visibleVendors[0] ?? vendors[0];

  function handleLogout() {
    clearToken();
    showFeedback('Signed out successfully.', 'success');
    globalThis.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 180);
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
    void queryClient.invalidateQueries({ queryKey: ['admin', 'diagnostics'] });
  }

  return (
    <div className={`app-shell ${isDashboardRoute ? 'dashboard-shell-active' : ''} ${isOrdersRoute ? 'orders-shell-active' : ''} ${isOrderDetailRoute ? 'order-detail-shell-active' : ''}`}>
      <aside className="sidebar">
        <div className="brand shell-brand">
          <div className="brand-mark" aria-hidden="true">
            VD
          </div>
          <div>
            <div className="brand-name">VendorOps</div>
            <div className="brand-subtitle">Shopify control center</div>
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-group-label">Workspace</div>
          <nav className="nav" aria-label="Primary">
            {workspaceNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="nav-group">
          <div className="nav-group-label">Operations</div>
          <nav className="nav" aria-label="Operations">
            {operationsNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
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
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        ) : null}

        <div className="vendor-card shell-card">
          <div>
            <div className="session-label">Operational vendor</div>
            <div className="session-state">{currentVendor.vendorName}</div>
            <div className="session-meta">
              {currentUser?.name ?? 'Unknown user'} · {currentUser?.role ?? 'admin'}
            </div>
            {!currentUser?.canSwitchVendors ? (
              <div className="session-meta">Vendor scope is fixed for your account.</div>
            ) : (
              <div className="session-meta">Switch vendor context for orders, returns, finance, and automation.</div>
            )}
          </div>
          {currentUser?.canSwitchVendors ? (
            <label className="vendor-switcher">
              <span className="sr-only">Select vendor</span>
              <select
                className="vendor-select"
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
          ) : (
            <div className="vendor-fixed-chip">{currentVendor.vendorName}</div>
          )}
        </div>

        <div className="session-card shell-card">
          <div>
            <div className="session-label">Session</div>
            <div className="session-state">{token ? 'Authenticated' : 'Unauthenticated'}</div>
            <div className="session-meta">Signed in as {currentUser?.email ?? 'unknown'}</div>
          </div>
          <button type="button" className="button button-secondary" onClick={handleLogout}>
            Logout
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
              <span className="severity-chip severity-attention">Role {currentUser?.role ?? 'admin'}</span>
              <span className="severity-chip severity-low">Vendor {currentVendor.vendorName}</span>
            </div>
          </>
        )}
        <main className="page-frame">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
