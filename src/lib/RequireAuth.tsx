import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { clearToken, isAuthenticated, onSessionReset } from './auth';
import { runtimeConfig } from '../config/runtime';
import { runtimeServices } from '../services/runtime-services';

type AuthGateStatus = 'checking' | 'authenticated' | 'unauthenticated';

function getInitialAuthGateStatus(): AuthGateStatus {
  if (!isAuthenticated()) {
    return 'unauthenticated';
  }

  return runtimeConfig.apiMode === 'real' ? 'checking' : 'authenticated';
}

function getCurrentRouteForAuthRedirect() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const { pathname, search, hash } = window.location;
  return `${pathname || '/'}${search || ''}${hash || ''}`;
}

export function RequireAuth() {
  const location = useLocation();
  const [authGateStatus, setAuthGateStatus] = useState<AuthGateStatus>(getInitialAuthGateStatus);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!isAuthenticated()) {
        setAuthGateStatus('unauthenticated');
        return;
      }

      if (runtimeConfig.apiMode !== 'real') {
        setAuthGateStatus('authenticated');
        return;
      }

      setAuthGateStatus('checking');
      try {
        await runtimeServices.auth.me();
        if (!cancelled) {
          setAuthGateStatus('authenticated');
        }
      } catch {
        if (!cancelled) {
          clearToken({ reason: 'expired', intendedPath: getCurrentRouteForAuthRedirect() });
          setAuthGateStatus('unauthenticated');
        }
      }
    }

    void restoreSession();
    const unsubscribeSession = onSessionReset(() => {
      void restoreSession();
    });

    return () => {
      cancelled = true;
      unsubscribeSession();
    };
  }, []);

  if (authGateStatus === 'checking') {
    return <div role="status">Restoring session...</div>;
  }

  if (authGateStatus !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
