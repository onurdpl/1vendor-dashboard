import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { clearToken, isAuthenticated, onSessionReset, setSession } from './auth';
import { runtimeConfig } from '../config/runtime';
import { runtimeServices } from '../services/runtime-services';
import { ApiError } from './api/errors';

type AuthGateStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'restore-error';
const AUTH_RESTORE_TIMEOUT_MS = 10000;
const AUTH_RESTORE_RECOVERABLE_MESSAGE =
  'Session restore is taking longer than expected. Please retry or sign in again.';
const AUTH_RESTORE_RECOVERY_RETRY_LIMIT = 1;

function getInitialAuthGateStatus(): AuthGateStatus {
  if (runtimeConfig.apiMode === 'real') {
    return 'checking';
  }

  if (!isAuthenticated()) {
    return 'unauthenticated';
  }

  return 'authenticated';
}

function getCurrentRouteForAuthRedirect() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const { pathname, search, hash } = window.location;
  return `${pathname || '/'}${search || ''}${hash || ''}`;
}

function getSafeRouteDiagnostics() {
  if (typeof window === 'undefined') {
    return {
      pathname: '/',
      hash: '',
    };
  }

  return {
    pathname: window.location.pathname || '/',
    hash: window.location.hash || '',
  };
}

function logAuthRestoreInfo(event: string, details: Record<string, unknown> = {}) {
  console.info({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

function logAuthRestoreWarn(event: string, details: Record<string, unknown> = {}) {
  console.warn({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

function isUnauthorizedRestoreFailure(error: unknown) {
  if (error instanceof ApiError) {
    return error.kind === 'unauthorized';
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { kind?: unknown; status?: unknown };
  return candidate.kind === 'unauthorized' || candidate.status === 401;
}

function withRestoreTimeout<T>(action: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(new Error('Session restore timed out.'));
    }, AUTH_RESTORE_TIMEOUT_MS);
  });

  return {
    promise: Promise.race([action(controller.signal), timeout]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    didTimeout: () => didTimeout,
  };
}

async function restoreCurrentSessionWithTimeout() {
  const restore = withRestoreTimeout((signal) => runtimeServices.auth.me({ signal }));
  try {
    return {
      user: await restore.promise,
      didTimeout: restore.didTimeout(),
    };
  } catch (error) {
    if (error && typeof error === 'object') {
      Reflect.set(error, 'restoreDidTimeout', restore.didTimeout());
    }
    throw error;
  }
}

function didRestoreTimeout(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return Reflect.get(error, 'restoreDidTimeout') === true;
}

export function RequireAuth() {
  const location = useLocation();
  const [authGateStatus, setAuthGateStatus] = useState<AuthGateStatus>(getInitialAuthGateStatus);
  const [restoreErrorMessage, setRestoreErrorMessage] = useState<string | null>(null);
  const [restoreRetryCount, setRestoreRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let restoreSequence = 0;
    let suppressNextSessionReset = false;

    async function restoreSession() {
      const restoreId = ++restoreSequence;
      if (runtimeConfig.apiMode !== 'real' && !isAuthenticated()) {
        setAuthGateStatus('unauthenticated');
        return;
      }

      if (runtimeConfig.apiMode !== 'real') {
        setAuthGateStatus('authenticated');
        return;
      }

      setAuthGateStatus('checking');
      setRestoreErrorMessage(null);
      const startedAt = Date.now();
      logAuthRestoreInfo('AUTH_RESTORE_START', { restoreId });
      try {
        const { user } = await restoreCurrentSessionWithTimeout();
        if (!cancelled) {
          if (!user) {
            throw new Error('Session restore did not return a user.');
          }
          suppressNextSessionReset = true;
          setSession(null, user);
          logAuthRestoreInfo('AUTH_RESTORE_SUCCESS', { restoreId, durationMs: Date.now() - startedAt });
          setAuthGateStatus('authenticated');
        }
      } catch (error) {
        if (!cancelled) {
          const isUnauthorized = isUnauthorizedRestoreFailure(error);
          const firstFailureMessage = error instanceof Error ? error.message : 'Session restore failed.';
          logAuthRestoreWarn(didRestoreTimeout(error) ? 'AUTH_RESTORE_TIMEOUT' : 'AUTH_RESTORE_FAILURE', {
            restoreId,
            durationMs: Date.now() - startedAt,
            message: firstFailureMessage,
          });
          suppressNextSessionReset = true;
          if (isUnauthorized) {
            clearToken({ reason: 'expired', intendedPath: getCurrentRouteForAuthRedirect() });
            setAuthGateStatus('unauthenticated');
          } else {
            for (let attempt = 1; attempt <= AUTH_RESTORE_RECOVERY_RETRY_LIMIT; attempt += 1) {
              try {
                logAuthRestoreInfo('AUTH_RESTORE_RECOVERY_RETRY_START', {
                  restoreId,
                  attempt,
                  previousFailureMessage: firstFailureMessage,
                });
                const retryStartedAt = Date.now();
                const { user } = await restoreCurrentSessionWithTimeout();
                if (cancelled) {
                  return;
                }
                if (!user) {
                  throw new Error('Session restore did not return a user.');
                }
                suppressNextSessionReset = true;
                setSession(null, user);
                logAuthRestoreInfo('AUTH_RESTORE_RECOVERY_RETRY_SUCCESS', {
                  restoreId,
                  attempt,
                  durationMs: Date.now() - retryStartedAt,
                  totalDurationMs: Date.now() - startedAt,
                });
                setAuthGateStatus('authenticated');
                return;
              } catch (retryError) {
                if (cancelled) {
                  return;
                }
                const retryIsUnauthorized = isUnauthorizedRestoreFailure(retryError);
                logAuthRestoreWarn('AUTH_RESTORE_RECOVERY_RETRY_FAILURE', {
                  restoreId,
                  attempt,
                  durationMs: Date.now() - startedAt,
                  message: retryError instanceof Error ? retryError.message : 'Session restore retry failed.',
                });
                suppressNextSessionReset = true;
                if (retryIsUnauthorized) {
                  clearToken({ reason: 'expired', intendedPath: getCurrentRouteForAuthRedirect() });
                  setAuthGateStatus('unauthenticated');
                  return;
                }
              }
            }
            clearToken();
            setRestoreErrorMessage(AUTH_RESTORE_RECOVERABLE_MESSAGE);
            setAuthGateStatus('restore-error');
          }
        }
      }
    }

    void restoreSession();
    const unsubscribeSession = onSessionReset(() => {
      if (suppressNextSessionReset) {
        suppressNextSessionReset = false;
        return;
      }
      void restoreSession();
    });

    return () => {
      cancelled = true;
      unsubscribeSession();
    };
  }, [restoreRetryCount]);

  if (authGateStatus === 'checking') {
    return <div role="status">Restoring session...</div>;
  }

  if (authGateStatus === 'restore-error') {
    return (
      <div className="auth-page">
        <section className="auth-panel" role="alert">
          <p className="eyebrow">Secure access</p>
          <h1>Session restore needs attention</h1>
          <p className="page-description">
            {restoreErrorMessage ?? AUTH_RESTORE_RECOVERABLE_MESSAGE}
          </p>
          <div className="state-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => setRestoreRetryCount((count) => count + 1)}
            >
              Retry
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setAuthGateStatus('unauthenticated')}
            >
              Sign in again
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (authGateStatus !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
