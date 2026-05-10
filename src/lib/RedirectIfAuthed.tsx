import { Navigate, Outlet } from 'react-router-dom';
import { isAuthenticated } from './auth';

export function RedirectIfAuthed() {
  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
