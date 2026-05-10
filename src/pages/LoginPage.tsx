import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  createMockSession,
  getDemoUserByCredentials,
  getDemoUsers,
  isAuthenticated,
  setCurrentUser,
  setCurrentVendorId,
  setToken,
  type CurrentUser,
} from '../lib/auth';
import type { VendorId } from '../lib/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';
  const demoUsers = getDemoUsers();

  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const demoUser = getDemoUserByCredentials(email, password);

    if (!demoUser) {
      setErrorMessage('Invalid credentials. Use one of the demo accounts listed below.');
      return;
    }

    setErrorMessage(null);
    setToken(createMockSession());
    const currentUser: CurrentUser = {
      email: demoUser.email,
      name: demoUser.name,
      role: demoUser.role,
      vendorAccess: demoUser.vendorAccess,
      canSwitchVendors: demoUser.canSwitchVendors,
      defaultVendorId: demoUser.defaultVendorId,
    };

    setCurrentUser(currentUser);

    if (!demoUser.canSwitchVendors) {
      setCurrentVendorId(demoUser.defaultVendorId as VendorId);
    }

    navigate(from, { replace: true });
  }

  return (
    <div className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Secure access</p>
        <h1>Sign in to continue</h1>
        <p className="page-description">
          Access the dashboard workspace used by admins, vendors, support teams, and finance.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              autoComplete="current-password"
              required
            />
          </label>

          <button type="submit" className="button button-primary">
            Sign in
          </button>
        </form>

        {errorMessage ? <ActionFeedback tone="error" message={errorMessage} /> : null}

        <div className="demo-credentials">
          <div className="session-label">Demo credentials</div>
          <ul className="demo-credentials-list">
            {demoUsers.map((user) => (
              <li key={user.email}>
                <strong>{user.email}</strong>
                <span> / demo123</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-footnote">
          Built for future auth flow. Return to <Link to="/">dashboard</Link>.
        </p>
      </section>
    </div>
  );
}
