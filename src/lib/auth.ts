export {
  clearToken,
  createMockSession,
  getToken,
  isAuthenticated,
  onSessionReset,
  setToken,
  validateSession,
} from './auth/session';

export {
  getDefaultRole,
  hasPermission,
  type Permission,
  type UserRole,
} from './auth/permissions';
