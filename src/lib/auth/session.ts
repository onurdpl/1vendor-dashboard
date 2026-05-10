import type { UserRole } from './permissions';

const TOKEN_KEY = 'vendor-dashboard.session-token';
const CURRENT_USER_KEY = 'vendor-dashboard.current-user';
const SESSION_RESET_EVENT = 'vendor-dashboard:session-reset';

export type DemoUser = {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  vendorAccess: readonly string[];
  canSwitchVendors: boolean;
  defaultVendorId: string;
};

export type CurrentUser = Omit<DemoUser, 'password'>;

const demoUsers: readonly DemoUser[] = [
  {
    email: 'admin@demo.com',
    password: 'demo123',
    name: 'Demo Admin',
    role: 'admin',
    vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
    canSwitchVendors: true,
    defaultVendorId: 'demo-vendor-a',
  },
  {
    email: 'vendor-a@demo.com',
    password: 'demo123',
    name: 'Vendor A User',
    role: 'vendor',
    vendorAccess: ['demo-vendor-a'],
    canSwitchVendors: false,
    defaultVendorId: 'demo-vendor-a',
  },
  {
    email: 'vendor-b@demo.com',
    password: 'demo123',
    name: 'Vendor B User',
    role: 'vendor',
    vendorAccess: ['demo-vendor-b'],
    canSwitchVendors: false,
    defaultVendorId: 'demo-vendor-b',
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
    Array.isArray(candidate.vendorAccess)
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
}

export function clearToken() {
  if (typeof window === 'undefined') {
    return;
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
}

export function clearCurrentUser() {
  window.localStorage.removeItem(CURRENT_USER_KEY);
  dispatchSessionReset();
}

export function isAuthenticated() {
  return Boolean(getToken() && getCurrentUser());
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
  return getCurrentUser()?.role ?? 'admin';
}

export async function validateSession(): Promise<boolean> {
  return Boolean(getToken() && getCurrentUser());
}
