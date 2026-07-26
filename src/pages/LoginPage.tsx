import { FormEvent, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EXPIRED_SESSION_MESSAGE,
  consumeExpiredSessionNotice,
  getDemoUsers,
  isAuthenticated,
  markAuthConfirmed,
  recordAuthDiagnostic,
  sanitizeInternalPath,
  createAuthDiagnosticId,
  setCurrentVendorId,
  setSession,
} from '../lib/auth';
import type { VendorId } from '../lib/auth';
import { runtimeConfig } from '../config/runtime';
import { ApiError } from '../lib/api/errors';
import {
  probeDualPathLoginPostTransport,
  probePublicLoginReadiness,
  type DualPathTransportDiagnosticResult,
  type PublicLoginPostTransportResult,
} from '../services/backend-auth';
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
const LOGIN_POST_TRANSPORT_PROBE_TIMEOUT_MS = 5_000;
const LOGIN_TIMEOUT_MESSAGE = 'Sign-in is taking longer than expected. Please try again.';

function createAuthAttemptId() {
  return createAuthDiagnosticId('auth');
}

function formatLoginTimeoutMessage(authFlowId: string) {
  return `${LOGIN_TIMEOUT_MESSAGE} Reference: ${authFlowId}`;
}

function getLoginRequestDiagnostics(): {
  apiBaseOrigin: string;
  requestPath: string;
  timeoutMs: number;
  credentialsMode: RequestCredentials;
  setCookieReadableFromJs: boolean;
  setCookieReadAttempted: boolean;
} {
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

function getLoginErrorMessage(error: unknown, input: { timeoutTriggered: boolean; responseReceived: boolean; authFlowId: string }) {
  if (input.timeoutTriggered && !input.responseReceived) {
    return formatLoginTimeoutMessage(input.authFlowId);
  }

  if (error instanceof ApiError && error.status === 429) {
    const retryAfterSeconds = readNumberProperty(error.details, 'retryAfterSeconds');
    if (retryAfterSeconds) {
      return `Too many login attempts. Please try again in ${formatRetryWindow(retryAfterSeconds)}.`;
    }
  }

  return error instanceof Error ? error.message : 'Unable to sign in.';
}

function isTransportLevelLoginFailure(error: unknown) {
  if (error instanceof ApiError) {
    return error.kind === 'network' && !error.status;
  }

  return error instanceof DOMException && error.name === 'AbortError';
}

function formatPostTransportProbeResult(result: PublicLoginPostTransportResult) {
  if (result.result === 'ready') {
    return 'Ready';
  }
  if (result.result === 'timeout') {
    return 'Timed out';
  }
  if (result.result === 'http_error') {
    return `HTTP ${result.status ?? 'error'}`;
  }
  if (result.result === 'network_error') {
    return 'Network error';
  }
  if (result.result === 'not_configured') {
    return 'Not configured';
  }

  return 'Invalid response';
}

function getPostTransportDiagnosticInterpretation(result: DualPathTransportDiagnosticResult) {
  if (result.interpretation === 'same_origin_path_suspected') {
    return 'Leading suspect: frontend /api transport path';
  }
  if (result.interpretation === 'shared_transport_failure') {
    return 'Leading suspect: shared browser/network/backend-origin transport';
  }
  if (result.interpretation === 'general_post_transport_ready') {
    return 'Both safe POST paths work; login route or intermittent behavior remains possible';
  }
  if (result.interpretation === 'direct_probe_not_configured') {
    return 'Direct backend probe is not configured';
  }

  return 'Result inconclusive';
}

function getPostTransportDiagnosticMessage(result: DualPathTransportDiagnosticResult) {
  return [
    'POST transport:',
    `Same-origin /api: ${formatPostTransportProbeResult(result.sameOrigin)}`,
    `Direct backend: ${formatPostTransportProbeResult(result.directBackend)}`,
    getPostTransportDiagnosticInterpretation(result),
  ].join(' ');
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
  const [postTransportDiagnosticMessage, setPostTransportDiagnosticMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeLoginAttemptRef = useRef<string | null>(null);
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

    const abortController = new AbortController();
    const authAttemptId = createAuthAttemptId();
    activeLoginAttemptRef.current = authAttemptId;
    setIsSubmitting(true);
    setErrorMessage(null);
    setPostTransportDiagnosticMessage(null);

    const authFlowId = authAttemptId;
    const readinessRequestId = createAuthDiagnosticId('req');
    const loginRequestId = createAuthDiagnosticId('req');
    const startedAt = Date.now();
    let timeoutTriggered = false;
    let responseReceived = false;
    let currentStage: 'readiness' | 'login_post' | 'post_response' = 'readiness';
    let timeoutId: number | null = null;
    const isCurrentLoginAttempt = () => activeLoginAttemptRef.current === authAttemptId;
    const elapsedMs = () => Date.now() - startedAt;
    const startLoginPostTimeout = () => {
      timeoutId = window.setTimeout(() => {
        if (!isCurrentLoginAttempt()) {
          return;
        }

        timeoutTriggered = true;
        recordAuthDiagnostic('REQUEST_ABORT', {
          flowId: authFlowId,
          stage: currentStage,
          outcome: 'timeout',
          requestId: currentStage === 'readiness' ? readinessRequestId : loginRequestId,
          source: 'LoginPage.handleSubmit.timeout',
          resultCategory: 'timeout',
          abortReason: currentStage,
          durationMs: elapsedMs(),
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

    recordAuthDiagnostic('LOGIN_SUBMIT', {
      flowId: authFlowId,
      stage: 'submit',
      outcome: 'started',
      requestId: loginRequestId,
      source: 'LoginPage.handleSubmit',
      resultCategory: 'started',
      cachedUserPresent: isAuthenticated(),
      durationMs: 0,
    });

    try {
      if (runtimeConfig.apiMode === 'real' && runtimeConfig.appEnvironment === 'production') {
        recordAuthDiagnostic('LOGIN_REQUEST_START', {
          flowId: authFlowId,
          stage: 'public_login_readiness',
          outcome: 'started',
          requestId: readinessRequestId,
          source: 'LoginPage.handleSubmit.readiness',
          resultCategory: 'started',
          durationMs: elapsedMs(),
        });
        const readiness = await probePublicLoginReadiness({
          authAttemptId,
          authFlowId,
          authRequestId: readinessRequestId,
          timeoutMs: LOGIN_READINESS_TIMEOUT_MS,
        });
        recordAuthDiagnostic('LOGIN_RESPONSE', {
          flowId: authFlowId,
          stage: 'public_login_readiness',
          outcome: readiness.ok ? 'success' : 'failure',
          requestId: readinessRequestId,
          source: 'LoginPage.handleSubmit.readiness',
          httpStatus: readiness.status,
          resultCategory: readiness.ok ? 'success' : 'failure',
          durationMs: readiness.elapsedMs,
        });
      }

      currentStage = 'login_post';
      startLoginPostTimeout();
      recordAuthDiagnostic('LOGIN_REQUEST_START', {
        flowId: authFlowId,
        stage: 'login_post',
        outcome: 'started',
        requestId: loginRequestId,
        source: 'LoginPage.handleSubmit.login',
        resultCategory: 'started',
        durationMs: elapsedMs(),
        ...getLoginRequestDiagnostics(),
      });
      const loginPromise = runtimeServices.auth.login(email, password, {
        authAttemptId,
        authFlowId,
        authRequestId: loginRequestId,
        signal: abortController.signal,
      });
      const { token, user } = await loginPromise;
      responseReceived = true;
      currentStage = 'post_response';
      clearLoginTimeout();
      if (!isCurrentLoginAttempt()) {
        recordAuthDiagnostic('STALE_RESULT_IGNORED', {
          flowId: authFlowId,
          stage: 'login_post',
          outcome: 'stale',
          requestId: loginRequestId,
          source: 'LoginPage.handleSubmit.staleSuccess',
          resultCategory: 'stale',
          staleResult: true,
          durationMs: elapsedMs(),
        });
        return;
      }

      recordAuthDiagnostic('LOGIN_RESPONSE', {
        flowId: authFlowId,
        stage: 'login_post',
        outcome: 'success',
        requestId: loginRequestId,
        source: 'LoginPage.handleSubmit.login',
        resultCategory: 'success',
        durationMs: elapsedMs(),
      });

      setErrorMessage(null);
      setSession(token, user, {
        flowId: authFlowId,
        requestId: loginRequestId,
        source: 'LoginPage.handleSubmit.setSession',
      });
      markAuthConfirmed();
      setCurrentVendorId(user.defaultVendorId as VendorId);
      navigate(from, { replace: true });
      recordAuthDiagnostic('AUTH_STATE_CHANGE', {
        flowId: authFlowId,
        stage: 'final_success',
        outcome: 'success',
        requestId: loginRequestId,
        source: 'LoginPage.handleSubmit.navigateAfterLogin',
        resultCategory: 'success',
        nextAuthState: 'authenticated',
        durationMs: elapsedMs(),
      });
    } catch (error) {
      if (!isCurrentLoginAttempt()) {
        recordAuthDiagnostic('STALE_RESULT_IGNORED', {
          flowId: authFlowId,
          stage: currentStage,
          outcome: 'stale',
          requestId: currentStage === 'readiness' ? readinessRequestId : loginRequestId,
          source: 'LoginPage.handleSubmit.staleFailure',
          resultCategory: 'stale',
          staleResult: true,
          durationMs: elapsedMs(),
        });
        return;
      }

      const httpStatus = error instanceof ApiError ? error.status ?? null : null;
      const failureOutcome = timeoutTriggered
        ? 'timeout'
        : httpStatus === 401
          ? 'unauthorized'
          : httpStatus === 403
            ? 'forbidden'
            : 'failure';
      if (responseReceived) {
        recordAuthDiagnostic('LOGIN_RESPONSE', {
          flowId: authFlowId,
          stage: 'post_response',
          outcome: failureOutcome,
          requestId: loginRequestId,
          source: 'LoginPage.handleSubmit.postResponse',
          httpStatus,
          resultCategory: failureOutcome,
          durationMs: elapsedMs(),
        });
      }
      if (!responseReceived) {
        recordAuthDiagnostic('LOGIN_RESPONSE', {
          flowId: authFlowId,
          stage: currentStage,
          outcome: failureOutcome,
          requestId: currentStage === 'readiness' ? readinessRequestId : loginRequestId,
          source: 'LoginPage.handleSubmit.login',
          httpStatus,
          resultCategory: failureOutcome,
          durationMs: elapsedMs(),
        });
      }
      if (!responseReceived && currentStage === 'login_post' && (timeoutTriggered || isTransportLevelLoginFailure(error))) {
        const postTransportRequestId = createAuthDiagnosticId('req');
        recordAuthDiagnostic('LOGIN_POST_TRANSPORT_PROBE', {
          flowId: authFlowId,
          stage: 'login_transport_dual_probe_start',
          outcome: 'started',
          requestId: postTransportRequestId,
          source: 'LoginPage.handleSubmit.postTransportProbe',
          resultCategory: 'started',
          timeoutMs: LOGIN_POST_TRANSPORT_PROBE_TIMEOUT_MS,
          durationMs: 0,
        });
        const postTransportResult = await probeDualPathLoginPostTransport({
          authAttemptId,
          authFlowId,
          authRequestId: postTransportRequestId,
          timeoutMs: LOGIN_POST_TRANSPORT_PROBE_TIMEOUT_MS,
        });
        recordAuthDiagnostic('LOGIN_POST_TRANSPORT_PROBE', {
          flowId: authFlowId,
          stage: 'login_transport_dual_probe_complete',
          outcome: postTransportResult.interpretation,
          requestId: postTransportRequestId,
          source: 'LoginPage.handleSubmit.postTransportProbe',
          resultCategory: 'unknown',
          durationMs: Math.max(postTransportResult.sameOrigin.elapsedMs, postTransportResult.directBackend.elapsedMs),
        });
        if (isCurrentLoginAttempt()) {
          setPostTransportDiagnosticMessage(getPostTransportDiagnosticMessage(postTransportResult));
        }
      }
      setErrorMessage(getLoginErrorMessage(error, { timeoutTriggered, responseReceived, authFlowId }));
    } finally {
      clearLoginTimeout();
      if (isCurrentLoginAttempt()) {
        setIsSubmitting(false);
        activeLoginAttemptRef.current = null;
      }
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
                if (postTransportDiagnosticMessage) {
                  setPostTransportDiagnosticMessage(null);
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
                if (postTransportDiagnosticMessage) {
                  setPostTransportDiagnosticMessage(null);
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
        {postTransportDiagnosticMessage ? <ActionFeedback tone="info" message={postTransportDiagnosticMessage} /> : null}

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
