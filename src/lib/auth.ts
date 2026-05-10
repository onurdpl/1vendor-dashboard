export {
  clearToken,
  clearCurrentUser,
  createMockSession,
  type CurrentUser,
  getCurrentUser,
  getCurrentUserRole,
  getDemoUserByCredentials,
  getDemoUsers,
  getToken,
  isAuthenticated,
  onSessionReset,
  setCurrentUser,
  setToken,
  validateSession,
} from './auth/session';

export {
  canPerformAction,
  getDefaultRole,
  hasPermission,
  type Permission,
  type UserRole,
} from './auth/permissions';

export {
  getAvailableVendors,
  getCurrentVendorContext,
  setCurrentVendorId,
  type VendorContext,
  type VendorId,
} from './auth/vendorContext';
