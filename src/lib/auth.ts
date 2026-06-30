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
  setSession,
  setToken,
  validateSession,
} from './auth/session';

export {
  clearAuthRestoreState,
  getAuthRestoreSnapshot,
  markAuthConfirmed,
  onAuthRestoreRetryRequest,
  onAuthRestoreStateChange,
  requestAuthRestoreRetry,
  setAuthRestoreSnapshot,
  useAuthRestoreSnapshot,
  type AuthRestorePhase,
  type AuthRestoreSnapshot,
} from './auth/restoreState';

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

export {
  isCurrentVendorRestricted,
  isRestrictedVendorStatus,
  isVendorContextRestricted,
  RESTRICTED_ACCOUNT_BODY,
  RESTRICTED_ACCOUNT_TITLE,
  RESTRICTED_ACTION_MESSAGE,
} from './auth/restrictedMode';
