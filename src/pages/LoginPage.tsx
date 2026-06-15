import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EXPIRED_SESSION_MESSAGE,
  consumeExpiredSessionNotice,
  getDemoUsers,
  isAuthenticated,
  sanitizeInternalPath,
  setCurrentVendorId,
  setSession,
} from '../lib/auth';
import type { VendorId } from '../lib/auth';
import { runtimeConfig } from '../config/runtime';
import { ApiError } from '../lib/api/errors';
import { probePublicLoginReadiness } from '../services/backend-auth';
import { runtimeServices } from '../services/runtime-services';

type LoginRedirectState = {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  } | string;
  sessionExpired?: boolean;
  message?: string;
};

type LoginLocationState = LoginRedirectState | null;

const LOGIN_TIMEOUT_MS = 15_000;
const LOGIN_READINESS_TIMEOUT_MS = 3_000;
const LOGIN_TIMEOUT_MESSAGE = 'Sign-in is taking longer than expected. Please try again.';

// Temporary diagnostic for correlating intermittent production login timeouts with backend logs.
function createAuthAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `auth-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }

  return `auth-${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
}

function formatLoginTimeoutMessage(authAttemptId: string) {
  return `${LOGIN_TIMEOUT_MESSAGE} Reference: ${authAttemptId}`;
}

function getLoginRequestDiagnostics() {
  let path = '/auth/login';
  try {
    path = new URL('/auth/login', runtimeConfig.apiBaseUrl).pathname;
  } catch {
    path = '/auth/login';
  }

  return {
    apiBaseOrigin: runtimeConfig.apiBaseOrigin,
    requestPath: path,
    timeoutMs: LOGIN_TIMEOUT_MS,
    credentialsMode: runtimeConfig.apiMode === 'real' ? 'include' : 'same-origin',
    setCookieReadableFromJs: false,
    setCookieReadAttempted: false,
  };
}

function readNumberProperty(value: unknown, propertyName: string) {
  if (!value || typeof value !== 'object' || !(propertyName in value)) {
    return null;
  }

  const property = Reflect.get(value, propertyName);
  return typeof property === 'number' && Number.isFinite(property) ? property : null;
}

function formatRetryWindow(seconds: number) {
  const roundedSeconds = Math.max(1, Math.ceil(seconds));
  if (roundedSeconds < 60) {
    return `${roundedSeconds} second${roundedSeconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.ceil(roundedSeconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function getLoginErrorMessage(error: unknown, input: { timeoutTriggered: boolean; responseReceived: boolean; authAttemptId: string }) {
  if (input.timeoutTriggered && !input.responseReceived) {
    return formatLoginTimeoutMessage(input.authAttemptId);
  }

  if (error instanceof ApiError && error.status === 429) {
    const retryAfterSeconds = readNumberProperty(error.details, 'retryAfterSeconds');
    if (retryAfterSeconds) {
      return `Too many login attempts. Please try again in ${formatRetryWindow(retryAfterSeconds)}.`;
    }
  }

  return error instanceof Error ? error.message : 'Unable to sign in.';
}

function shouldLogAuthDiagnostics() {
  return true;
}

function logAuthDiagnostic(
  event:
    | 'auth request start'
    | 'fetch dispatch started'
    | 'fetch promise created'
    | 'abort fired'
    | 'auth timeout triggered'
    | 'fetch resolved'
    | 'fetch rejected'
    | 'response parsed'
    | 'setSession completed'
    | 'vendor selected'
    | 'navigate called'
    | 'post-response failed'
    | 'auth request completed',
  details: Record<string, unknown> = {},
) {
  if (!shouldLogAuthDiagnostics()) {
    return;
  }

  console.debug('[auth-login]', {
    event,
    ...details,
  });
}

function buildRouteFromLocationState(from: LoginRedirectState['from']) {
  if (typeof from === 'string') {
    return from;
  }

  if (!from?.pathname) {
    return '/';
  }

  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

function normalizeLoginDestination(path: string | null | undefined) {
  const sanitized = sanitizeInternalPath(path);

  if (sanitized === '/login' || sanitized.startsWith('/login?') || sanitized.startsWith('/login#')) {
    return '/';
  }

  return sanitized;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LoginLocationState;
  const [expiredSessionNotice] = useState(() => consumeExpiredSessionNotice());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const from = normalizeLoginDestination(
    expiredSessionNotice?.intendedPath ?? buildRouteFromLocationState(locationState?.from),
  );
  const sessionMessage =
    expiredSessionNotice?.message ??
    (locationState?.sessionExpired ? locationState.message ?? EXPIRED_SESSION_MESSAGE : null);
  const demoUsers = getDemoUsers();
  const realModeDemoUsers = [
    'admin@demo.com / demo123',
    'yalispor@demo.com / demo123',
    'sporjinal@demo.com / demo123',
    'sporvol@demo.com / demo123',
  ];

  if (isAuthenticated()) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const abortController = new AbortController();
    const authAttemptId = createAuthAttemptId();
    const startedAt = Date.now();
    let timeoutTriggered = false;
    let responseReceived = false;
    let currentStage: 'readiness' | 'login_post' | 'post_response' = 'readiness';
    let timeoutId: number | null = null;
    const startLoginPostTimeout = () => {
      timeoutId = window.setTimeout(() => {
        timeoutTriggered = true;
        logAuthDiagnostic('auth timeout triggered', {
          authAttemptId,
          stage: currentStage,
          elapsedMs: Date.now() - startedAt,
        });
        logAuthDiagnostic('abort fired', {
          authAttemptId,
          stage: currentStage,
          elapsedMs: Date.now() - startedAt,
        });
        abortController.abort();
      }, LOGIN_TIMEOUT_MS);
    };
    const clearLoginTimeout = () => {
      if (timeoutId === null) {
        return;
      }

      window.clearTimeout(timeoutId);
      timeoutId = null;
    };

    logAuthDiagnostic('auth request start', {
      authAttemptId,
      startedAt: new Date(startedAt).toISOString(),
      ...getLoginRequestDiagnostics(),
    });

    try {
      if (runtimeConfig.apiMode === 'real' && runtimeConfig.appEnvironment === 'production') {
        logAuthDiagnostic('fetch dispatch started', {
          authAttemptId,
          stage: 'readiness',
          requestPath: '/auth/diagnostics/public-login-readiness',
          timeoutMs: LOGIN_READINESS_TIMEOUT_MS,
          credentialsMode: 'include',
          elapsedMs: Date.now() - startedAt,
        });
        const readiness = await probePublicLoginReadiness({
          authAttemptId,
          timeoutMs: LOGIN_READINESS_TIMEOUT_MS,
        });
        logAuthDiagnostic(readiness.ok ? 'fetch resolved' : 'fetch rejected', {
          authAttemptId,
          stage: readiness.ok ? 'readiness_completed' : readiness.failureStage,
          responseStatus: readiness.status,
          responseElapsedMs: readiness.elapsedMs,
          elapsedMs: Date.now() - startedAt,
        });
      }

      currentStage = 'login_post';
      startLoginPostTimeout();
      logAuthDiagnostic('fetch dispatch started', {
        authAttemptId,
        stage: 'login_post',
        ...getLoginRequestDiagnostics(),
        elapsedMs: Date.now() - startedAt,
      });
      const loginPromise = runtimeServices.auth.login(email, password, {
        authAttemptId,
        signal: abortController.signal,
      });
      logAuthDiagnostic('fetch promise created', {
        authAttemptId,
        elapsedMs: Date.now() - startedAt,
      });
      const { token, user } = await loginPromise;
      responseReceived = true;
      currentStage = 'post_response';
      clearLoginTimeout();

      logAuthDiagnostic('fetch resolved', {
        authAttemptId,
        stage: 'login_post',
        elapsedMs: Date.now() - startedAt,
      });
      logAuthDiagnostic('response parsed', {
        authAttemptId,
        stage: 'post_response',
        elapsedMs: Date.now() - startedAt,
      });

      logAuthDiagnostic('auth request completed', {
        authAttemptId,
        elapsedMs: Date.now() - startedAt,
        timedOut: false,
      });

      setErrorMessage(null);
      setSession(token, user);
      logAuthDiagnostic('setSession completed', {
        authAttemptId,
        elapsedMs: Date.now() - startedAt,
      });
      setCurrentVendorId(user.defaultVendorId as VendorId);
      logAuthDiagnostic('vendor selected', {
        authAttemptId,
        vendorIdPresent: Boolean(user.defaultVendorId),
        elapsedMs: Date.now() - startedAt,
      });
      navigate(from, { replace: true });
      logAuthDiagnostic('navigate called', {
        authAttemptId,
        destination: from,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (responseReceived) {
        logAuthDiagnostic('post-response failed', {
          authAttemptId,
          stage: 'post_response',
          elapsedMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : 'unknown',
        });
      }
      if (!responseReceived) {
        logAuthDiagnostic('fetch rejected', {
          authAttemptId,
          stage: timeoutTriggered ? currentStage : 'login_post',
          elapsedMs: Date.now() - startedAt,
          timedOut: timeoutTriggered,
          networkError: !timeoutTriggered,
        });
      }
      logAuthDiagnostic('auth request completed', {
        authAttemptId,
        stage: currentStage,
        elapsedMs: Date.now() - startedAt,
        timedOut: timeoutTriggered,
      });
      setErrorMessage(getLoginErrorMessage(error, { timeoutTriggered, responseReceived, authAttemptId }));
    } finally {
      clearLoginTimeout();
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Secure access</p>
        <h1>Sign in to continue</h1>
        <p className="page-description">
          Access the dashboard workspace used by admins, vendors, support teams, and finance.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              autoComplete="current-password"
              required
            />
          </label>

          <button type="submit" className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {sessionMessage ? <ActionFeedback tone="info" message={sessionMessage} /> : null}
        {errorMessage ? <ActionFeedback tone="error" message={errorMessage} /> : null}

        <div className="demo-credentials">
          <div className="session-label">Demo credentials</div>
          <ul className="demo-credentials-list">
            {runtimeConfig.apiMode === 'real'
              ? realModeDemoUsers.map((user) => <li key={user}>{user}</li>)
              : demoUsers.map((user) => (
                  <li key={user.email}>
                    <strong>{user.email}</strong>
                    <span> / demo123</span>
                  </li>
                ))}
          </ul>
        </div>

        <p className="auth-footnote">
          Built for future auth flow. Return to <Link to="/">dashboard</Link>.
        </p>
      </section>
    </div>
  );
}
