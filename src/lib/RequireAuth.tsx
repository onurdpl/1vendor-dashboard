import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { isAuthenticated, onSessionReset } from './auth';

export function RequireAuth() {
  const location = useLocation();
  const [authenticated, setAuthenticated] = useState(() => isAuthenticated());

  useEffect(() => {
    setAuthenticated(isAuthenticated());
    return onSessionReset(() => {
      setAuthenticated(isAuthenticated());
    });
  }, []);

  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
