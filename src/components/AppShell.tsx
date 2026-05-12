import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { clearToken, getCurrentUser, getToken } from '../lib/auth';
import { getAvailableVendors, getCurrentVendorContext, setCurrentVendorId } from '../lib/auth';
import { queryClient } from '../lib/api/queryClient';
import { useActionFeedback } from '../lib/ui';
import { ActionFeedback } from './ActionFeedback';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/orders', label: 'Orders' },
  { to: '/returns', label: 'Returns' },
  { to: '/finance', label: 'Finance' },
  { to: '/automation', label: 'Automation' },
  { to: '/admin/operations', label: 'Operations Queue', adminOnly: true },
  { to: '/admin/diagnostics', label: 'Diagnostics', adminOnly: true },
];

export function AppShell() {
  const navigate = useNavigate();
  const token = getToken();
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
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
    <div className="app-shell">
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
            {navItems.slice(0, 1).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="nav-group">
          <div className="nav-group-label">Operations</div>
          <nav className="nav" aria-label="Operations">
            {navItems.slice(1).map((item) => (
              (item.adminOnly && !isAdmin) ? null : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {item.label}
              </NavLink>
              )
            ))}
          </nav>
        </div>
        {isAdmin ? <div className="nav-group-label admin-nav-label">Admin tools</div> : null}

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
        <PageHeader
          title="Operational control center"
          description="Multi-vendor Shopify operations, finance, diagnostics, and recovery workspace."
        />
        <div className="shell-context-bar">
          <span className="severity-chip severity-normal">User {currentUser?.name ?? 'Unknown user'}</span>
          <span className="severity-chip severity-attention">Role {currentUser?.role ?? 'admin'}</span>
          <span className="severity-chip severity-low">Vendor {currentVendor.vendorName}</span>
        </div>
        <main className="page-frame">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
