import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { clearToken, getToken } from '../lib/auth';
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

  function handleLogout() {
    clearToken();
    showFeedback('Signed out successfully.', 'success');
    globalThis.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 180);
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
