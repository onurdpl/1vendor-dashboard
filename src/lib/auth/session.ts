import type { UserRole } from './permissions';
import type { VendorId } from './vendorContext';

const TOKEN_KEY = 'vendor-dashboard.session-token';
const CURRENT_USER_KEY = 'vendor-dashboard.current-user';
const SESSION_RESET_EVENT = 'vendor-dashboard:session-reset';
const EXPIRED_SESSION_NOTICE_KEY = 'vendor-dashboard.expired-session';
export const EXPIRED_SESSION_MESSAGE = 'Your session expired. Please sign in again.';

export type ExpiredSessionNotice = {
  message: string;
  intendedPath: string;
};

export type UserVendorAccess = {
  vendorId: VendorId;
  vendorName: string;
};

export type DemoUser = {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  status?: string;
  vendorAccess: readonly string[];
  canSwitchVendors: boolean;
  defaultVendorId: string;
  vendorDetails?: readonly UserVendorAccess[];
};

export type CurrentUser = Omit<DemoUser, 'password'>;

const defaultVendorDirectory: readonly UserVendorAccess[] = [
  {
    vendorId: 'demo-vendor-a',
    vendorName: 'Demo Vendor A',
  },
  {
    vendorId: 'demo-vendor-b',
    vendorName: 'Demo Vendor B',
  },
] as const;

const demoUsers: readonly DemoUser[] = [
  {
    email: 'admin@demo.com',
    password: 'demo123',
    name: 'Demo Admin',
    role: 'admin',
    vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
    canSwitchVendors: true,
    defaultVendorId: 'demo-vendor-a',
    vendorDetails: defaultVendorDirectory,
  },
  {
    email: 'vendor-a@demo.com',
    password: 'demo123',
    name: 'Vendor A User',
    role: 'vendor',
    vendorAccess: ['demo-vendor-a'],
    canSwitchVendors: false,
    defaultVendorId: 'demo-vendor-a',
    vendorDetails: [defaultVendorDirectory[0]],
  },
  {
    email: 'vendor-b@demo.com',
    password: 'demo123',
    name: 'Vendor B User',
    role: 'vendor',
    vendorAccess: ['demo-vendor-b'],
    canSwitchVendors: false,
    defaultVendorId: 'demo-vendor-b',
    vendorDetails: [defaultVendorDirectory[1]],
  },
] as const;

function dispatchSessionReset() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(SESSION_RESET_EVENT));
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CurrentUser>;
  return (
    typeof candidate.email === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.role === 'admin' || candidate.role === 'vendor' || candidate.role === 'support' || candidate.role === 'finance') &&
    typeof candidate.canSwitchVendors === 'boolean' &&
    typeof candidate.defaultVendorId === 'string' &&
    Array.isArray(candidate.vendorAccess) &&
    (candidate.vendorDetails === undefined ||
      (Array.isArray(candidate.vendorDetails) &&
        candidate.vendorDetails.every(
          (vendor) =>
            Boolean(vendor) &&
            typeof vendor === 'object' &&
            typeof vendor.vendorId === 'string' &&
            typeof vendor.vendorName === 'string',
        )))
  );
}

export function getDemoUsers() {
  return demoUsers;
}

export function getDemoUserByCredentials(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return demoUsers.find(
    (user) => user.email.toLowerCase() === normalizedEmail && user.password === password,
  ) ?? null;
}

export function getToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
  dispatchSessionReset();
}

export function setSession(token: string | null | undefined, user: CurrentUser) {
  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
  window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  dispatchSessionReset();
}

function getCurrentBrowserPath() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const { pathname, search, hash } = window.location;
  return `${pathname || '/'}${search || ''}${hash || ''}`;
}

export function sanitizeInternalPath(path: string | null | undefined) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    return '/';
  }

  return path;
}

export function rememberExpiredSession(intendedPath = getCurrentBrowserPath()) {
  if (typeof window === 'undefined') {
    return;
  }

  const notice: ExpiredSessionNotice = {
    message: EXPIRED_SESSION_MESSAGE,
    intendedPath: sanitizeInternalPath(intendedPath),
  };

  window.localStorage.setItem(EXPIRED_SESSION_NOTICE_KEY, JSON.stringify(notice));
}

export function peekExpiredSessionNotice() {
  if (typeof window === 'undefined') {
    return null;
  }

  const serialized = window.localStorage.getItem(EXPIRED_SESSION_NOTICE_KEY);

  if (!serialized) {
    return null;
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<ExpiredSessionNotice>;

    if (typeof parsed.message !== 'string' || typeof parsed.intendedPath !== 'string') {
      return null;
    }

    return {
      message: parsed.message,
      intendedPath: sanitizeInternalPath(parsed.intendedPath),
    } satisfies ExpiredSessionNotice;
  } catch {
    return null;
  }
}

export function consumeExpiredSessionNotice() {
  if (typeof window === 'undefined') {
    return null;
  }

  const notice = peekExpiredSessionNotice();
  window.localStorage.removeItem(EXPIRED_SESSION_NOTICE_KEY);
  return notice;
}

export function clearExpiredSessionNotice() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(EXPIRED_SESSION_NOTICE_KEY);
}

export function clearToken(options: { reason?: 'expired'; intendedPath?: string } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  if (options.reason === 'expired') {
    rememberExpiredSession(options.intendedPath);
  } else {
    clearExpiredSessionNotice();
  }

  window.localStorage.removeItem(TOKEN_KEY);
  clearCurrentUser();
}

export function getCurrentUser() {
  if (typeof window === 'undefined') {
    return null;
  }

  const serialized = window.localStorage.getItem(CURRENT_USER_KEY);

  if (!serialized) {
    return null;
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;

    return isCurrentUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: CurrentUser) {
  window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  dispatchSessionReset();
}

export function getCurrentUserVendorDetails(): readonly UserVendorAccess[] {
  const currentUser = getCurrentUser();

  if (currentUser?.vendorDetails?.length) {
    return currentUser.vendorDetails;
  }

  return currentUser?.vendorAccess.map((vendorId) => ({
    vendorId,
    vendorName: vendorId,
  })) ?? defaultVendorDirectory;
}

export function createCurrentUserFromVendorAccess(input: {
  email: string;
  name: string;
  role: UserRole;
  status?: string;
  vendorAccess: readonly UserVendorAccess[];
}) {
  const vendorDetails = [...input.vendorAccess];
  const vendorIds = vendorDetails.map((vendor) => vendor.vendorId);
  const defaultVendorId = vendorIds[0] ?? '';

  return {
    email: input.email,
    name: input.name,
    role: input.role,
    status: input.status ?? 'active',
    vendorAccess: vendorIds,
    vendorDetails,
    canSwitchVendors: input.role === 'admin' && vendorIds.length > 1,
    defaultVendorId,
  } satisfies CurrentUser;
}

export function clearCurrentUser() {
  window.localStorage.removeItem(CURRENT_USER_KEY);
  dispatchSessionReset();
}

export function isAuthenticated() {
  return Boolean(getCurrentUser());
}

export function createMockSession() {
  return `mock-session-${Date.now()}`;
}

export function onSessionReset(handler: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener(SESSION_RESET_EVENT, handler);

  return () => {
    window.removeEventListener(SESSION_RESET_EVENT, handler);
  };
}

export function getCurrentUserRole(): UserRole {
  return getCurrentUserRoleOrNull() ?? 'vendor';
}

export function getCurrentUserRoleOrNull(): UserRole | null {
  return getCurrentUser()?.role ?? null;
}

export async function validateSession(): Promise<boolean> {
  return Boolean(getCurrentUser());
}
