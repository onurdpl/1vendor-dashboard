export type AuthDiagnosticOperation =
  | 'LOGIN_SUBMIT'
  | 'LOGIN_REQUEST_START'
  | 'LOGIN_POST_TRANSPORT_PROBE'
  | 'LOGIN_RESPONSE'
  | 'SESSION_RESTORE_START'
  | 'SESSION_RESTORE_RESPONSE'
  | 'AUTH_STATE_CHANGE'
  | 'CACHE_USER_SET'
  | 'CACHE_USER_CLEAR'
  | 'REDIRECT_LOGIN'
  | 'LOGOUT_TRIGGER'
  | 'REQUEST_ABORT'
  | 'STALE_RESULT_IGNORED';

export type AuthDiagnosticResultCategory =
  | 'success'
  | 'failure'
  | 'timeout'
  | 'network_error'
  | 'unauthorized'
  | 'forbidden'
  | 'aborted'
  | 'stale'
  | 'skipped'
  | 'started'
  | 'not_configured'
  | 'unknown';

export type AuthDiagnosticEvent = {
  timestamp: string;
  browserSessionId: string;
  route: string;
  operation: AuthDiagnosticOperation;
  flowId: string | null;
  stage?: string;
  outcome?: string;
  pathMode?: 'same_origin_api' | 'direct_backend' | null;
  method?: string;
  requestId: string | null;
  source: string;
  httpStatus?: number | null;
  durationMs?: number | null;
  resultCategory?: AuthDiagnosticResultCategory;
  previousAuthState?: string | null;
  nextAuthState?: string | null;
  abortReason?: string | null;
  staleResult?: boolean;
  cachedUserPresent?: boolean;
  authConfirmed?: boolean;
  requestPath?: string;
  apiBaseOrigin?: string;
  timeoutMs?: number;
  credentialsMode?: RequestCredentials;
  setCookieReadableFromJs?: boolean;
  setCookieReadAttempted?: boolean;
};

const AUTH_DIAGNOSTIC_BUFFER_LIMIT = 200;
const authDiagnosticEvents: AuthDiagnosticEvent[] = [];

function isBrowserRuntime() {
  return typeof window !== 'undefined';
}

function randomId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12).padEnd(10, '0');

  return `${prefix}-${suffix}`;
}

const browserSessionId = randomId('browser');

export function isAuthDiagnosticsEnabled() {
  return import.meta.env.VITE_AUTH_DIAGNOSTICS === 'true';
}

export function createAuthDiagnosticId(prefix: 'auth' | 'restore' | 'req' = 'req') {
  return randomId(prefix);
}

export function getAuthDiagnosticBrowserSessionId() {
  return browserSessionId;
}

function getCurrentRoute() {
  if (!isBrowserRuntime()) {
    return '/';
  }

  return window.location.pathname || '/';
}

function pushAuthDiagnosticEvent(event: AuthDiagnosticEvent) {
  authDiagnosticEvents.push(event);
  if (authDiagnosticEvents.length > AUTH_DIAGNOSTIC_BUFFER_LIMIT) {
    authDiagnosticEvents.splice(0, authDiagnosticEvents.length - AUTH_DIAGNOSTIC_BUFFER_LIMIT);
  }
}

function installDebugExport() {
  if (!isBrowserRuntime() || !isAuthDiagnosticsEnabled()) {
    return;
  }

  Object.defineProperty(window, '__vendorAuthDiagnostics', {
    value: {
      events: getAuthDiagnosticEvents,
      clear: clearAuthDiagnosticEvents,
      print: printAuthDiagnosticTimeline,
    },
    configurable: true,
  });
}

export function recordAuthDiagnostic(
  operation: AuthDiagnosticOperation,
  details: Omit<AuthDiagnosticEvent, 'timestamp' | 'browserSessionId' | 'route' | 'operation'> & { route?: string },
) {
  if (!isAuthDiagnosticsEnabled()) {
    return null;
  }

  const { route, ...safeDetails } = details;
  const event: AuthDiagnosticEvent = {
    timestamp: new Date().toISOString(),
    browserSessionId,
    route: route ?? getCurrentRoute(),
    operation,
    ...safeDetails,
  };
  pushAuthDiagnosticEvent(event);
  installDebugExport();
  console.debug('[auth-flow]', event);
  return event;
}

export function getAuthDiagnosticEvents() {
  return [...authDiagnosticEvents];
}

export function clearAuthDiagnosticEvents() {
  authDiagnosticEvents.splice(0, authDiagnosticEvents.length);
}

export function printAuthDiagnosticTimeline() {
  return authDiagnosticEvents
    .map((event) => [
      event.timestamp,
      event.operation,
      event.flowId ? `flow=${event.flowId}` : null,
      event.stage ? `stage=${event.stage}` : null,
      event.pathMode ? `path=${event.pathMode}` : null,
      event.method ? `method=${event.method}` : null,
      event.requestId ? `req=${event.requestId}` : null,
      event.httpStatus ? `status=${event.httpStatus}` : null,
      typeof event.durationMs === 'number' ? `duration=${event.durationMs}ms` : null,
      event.outcome ? `outcome=${event.outcome}` : null,
      event.resultCategory ? `result=${event.resultCategory}` : null,
      `source=${event.source}`,
    ].filter(Boolean).join(' '))
    .join('\n');
}

declare global {
  interface Window {
    __vendorAuthDiagnostics?: {
      events: typeof getAuthDiagnosticEvents;
      clear: typeof clearAuthDiagnosticEvents;
      print: typeof printAuthDiagnosticTimeline;
    };
  }
}
