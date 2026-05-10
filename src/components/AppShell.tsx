import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { clearToken, getToken } from '../lib/auth';
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
];

export function AppShell() {
  const navigate = useNavigate();
  const token = getToken();
  const { message, tone, showFeedback } = useActionFeedback();
  const vendors = getAvailableVendors();
  const [selectedVendorId, setSelectedVendorId] = useState(() => getCurrentVendorContext().vendorId);
  const currentVendor = vendors.find((vendor) => vendor.vendorId === selectedVendorId) ?? vendors[0];

  function handleLogout() {
    clearToken();
    showFeedback('Signed out successfully.', 'success');
    globalThis.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 180);
  }

  function handleVendorChange(nextVendorId: string) {
    if (nextVendorId !== 'demo-vendor-a' && nextVendorId !== 'demo-vendor-b') {
      return;
    }

    setCurrentVendorId(nextVendorId);
    setSelectedVendorId(nextVendorId);
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            VD
          </div>
          <div>
            <div className="brand-name">Vendor Dashboard</div>
            <div className="brand-subtitle">Operations shell</div>
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
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="vendor-card">
          <div>
            <div className="session-label">Vendor</div>
            <div className="session-state">{currentVendor.vendorName}</div>
          </div>
          <label className="vendor-switcher">
            <span className="sr-only">Select vendor</span>
            <select
              className="vendor-select"
              value={selectedVendorId}
              onChange={(event) => handleVendorChange(event.target.value)}
            >
              {vendors.map((vendor) => (
                <option key={vendor.vendorId} value={vendor.vendorId}>
                  {vendor.vendorName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="session-card">
          <div>
            <div className="session-label">Session</div>
            <div className="session-state">{token ? 'Authenticated' : 'Unauthenticated'}</div>
          </div>
          <button type="button" className="button button-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>

        {message ? <ActionFeedback tone={tone} message={message} /> : null}
      </aside>

      <div className="app-content">
        <PageHeader
          title="Operations"
          description="Core workspace for admin, vendor, support, and finance activity."
        />
        <main className="page-frame">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
