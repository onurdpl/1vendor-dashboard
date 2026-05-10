const TOKEN_KEY = 'vendor-dashboard.session-token';
const SESSION_RESET_EVENT = 'vendor-dashboard:session-reset';

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
  window.localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(SESSION_RESET_EVENT));
}

export function isAuthenticated() {
  return Boolean(getToken());
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

export async function validateSession(): Promise<boolean> {
  return Boolean(getToken());
}
