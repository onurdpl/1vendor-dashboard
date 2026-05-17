export {
  clearToken,
  clearCurrentUser,
  clearExpiredSessionNotice,
  consumeExpiredSessionNotice,
  createCurrentUserFromVendorAccess,
  createMockSession,
  EXPIRED_SESSION_MESSAGE,
  type CurrentUser,
  type ExpiredSessionNotice,
  type UserVendorAccess,
  getCurrentUser,
  getCurrentUserVendorDetails,
  getCurrentUserRole,
  getCurrentUserRoleOrNull,
  getDemoUserByCredentials,
  getDemoUsers,
  getToken,
  isAuthenticated,
  onSessionReset,
  peekExpiredSessionNotice,
  rememberExpiredSession,
  sanitizeInternalPath,
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
  onVendorChange,
  setCurrentVendorId,
  type VendorContext,
  type VendorId,
} from './auth/vendorContext';
