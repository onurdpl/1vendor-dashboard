import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  clearToken,
  createAuthDiagnosticId,
  getCurrentUser,
  getAuthRestoreSnapshot,
  isAuthDiagnosticsEnabled,
  isAuthenticated,
  markAuthConfirmed,
  onAuthRestoreRetryRequest,
  recordAuthDiagnostic,
  onSessionReset,
  setAuthRestoreSnapshot,
  setSession,
} from './auth';
import { runtimeConfig } from '../config/runtime';
import { runtimeServices } from '../services/runtime-services';
import { ApiError } from './api/errors';

type AuthGateStatus =
  | 'restoring'
  | 'authenticated_unconfirmed'
  | 'authenticated'
  | 'unauthenticated'
  | 'restore-error';
const AUTH_RESTORE_TIMEOUT_MS = 10000;
const AUTH_RESTORE_DELAYED_UI_MS = 4000;
const AUTH_RESTORE_RECOVERABLE_MESSAGE =
  'Session restore is taking longer than expected. Please retry or sign in again.';
const AUTH_RESTORE_RECOVERY_RETRY_LIMIT = 1;

function getInitialAuthGateStatus(): AuthGateStatus {
  if (runtimeConfig.apiMode === 'real') {
    if (getCurrentUser() && getAuthRestoreSnapshot().authConfirmed) {
      return 'authenticated';
    }
    return getCurrentUser() ? 'authenticated_unconfirmed' : 'restoring';
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
  if (!isAuthDiagnosticsEnabled()) {
    return;
  }

  console.info({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

function logAuthRestoreWarn(event: string, details: Record<string, unknown> = {}) {
  if (!isAuthDiagnosticsEnabled()) {
    return;
  }

  console.warn({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

function isUnauthorizedRestoreFailure(error: unknown) {
  if (error instanceof ApiError) {
    return error.kind === 'unauthorized' || error.status === 401 || error.status === 403;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { kind?: unknown; status?: unknown };
  return candidate.kind === 'unauthorized' || candidate.status === 401 || candidate.status === 403;
}

function createRestoreAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `restore-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }

  return `restore-${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
}

function getFrontendBuildLabel() {
  return [
    runtimeConfig.gitCommit ? `commit ${runtimeConfig.gitCommit}` : null,
    runtimeConfig.buildTimestamp ? `built ${runtimeConfig.buildTimestamp}` : null,
    `version ${runtimeConfig.appVersion}`,
  ].filter(Boolean).join(' · ');
}

function withRestoreTimeout<T>(action: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

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
      parentSignal?.removeEventListener('abort', abortFromParent);
    }),
    didTimeout: () => didTimeout,
  };
}

async function restoreCurrentSessionWithTimeout(input: {
  parentSignal?: AbortSignal;
  restoreAttemptId: string;
  authRequestId: string;
}) {
  const restore = withRestoreTimeout(
    (signal) => runtimeServices.auth.me({
      authAttemptId: input.restoreAttemptId,
      authFlowId: input.restoreAttemptId,
      authRequestId: input.authRequestId,
      signal,
    }),
    input.parentSignal,
  );
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
  const navigate = useNavigate();
  const [authGateStatus, setAuthGateStatus] = useState<AuthGateStatus>(getInitialAuthGateStatus);
  const [restoreErrorMessage, setRestoreErrorMessage] = useState<string | null>(null);
  const [restoreRetryCount, setRestoreRetryCount] = useState(0);
  const latestRestoreAttemptIdRef = useRef<string | null>(null);
  const activeRestoreControllerRef = useRef<AbortController | null>(null);

  function clearSessionAndNavigateToLogin() {
    recordAuthDiagnostic('LOGOUT_TRIGGER', {
      flowId: latestRestoreAttemptIdRef.current,
      requestId: null,
      source: 'RequireAuth.clearSessionAndNavigateToLogin',
      resultCategory: 'started',
    });
    activeRestoreControllerRef.current?.abort();
    activeRestoreControllerRef.current = null;
    setRestoreErrorMessage(null);
    clearToken({
      flowId: latestRestoreAttemptIdRef.current,
      requestId: null,
      source: 'RequireAuth.clearSessionAndNavigateToLogin',
    });
    setAuthGateStatus('unauthenticated');
    recordAuthDiagnostic('REDIRECT_LOGIN', {
      flowId: latestRestoreAttemptIdRef.current,
      requestId: null,
      source: 'RequireAuth.clearSessionAndNavigateToLogin',
      nextAuthState: 'unauthenticated',
    });
    navigate('/login', { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    let suppressNextSessionReset = false;
    let delayedUiTimer: ReturnType<typeof setTimeout> | null = null;

    const isLatestRestore = (restoreAttemptId: string) =>
      !cancelled && latestRestoreAttemptIdRef.current === restoreAttemptId;

    function clearDelayedUiTimer() {
      if (delayedUiTimer) {
        clearTimeout(delayedUiTimer);
        delayedUiTimer = null;
      }
    }

    function abortActiveRestore() {
      if (activeRestoreControllerRef.current) {
        recordAuthDiagnostic('REQUEST_ABORT', {
          flowId: latestRestoreAttemptIdRef.current,
          requestId: null,
          source: 'RequireAuth.abortActiveRestore',
          resultCategory: 'aborted',
        });
      }
      activeRestoreControllerRef.current?.abort();
      activeRestoreControllerRef.current = null;
    }

    async function runRestoreRequest(restoreAttemptId: string) {
      const controller = new AbortController();
      const authRequestId = createAuthDiagnosticId('req');
      activeRestoreControllerRef.current = controller;
      recordAuthDiagnostic('SESSION_RESTORE_START', {
        flowId: restoreAttemptId,
        requestId: authRequestId,
        source: 'RequireAuth.runRestoreRequest',
        resultCategory: 'started',
        cachedUserPresent: Boolean(getCurrentUser()),
        authConfirmed: getAuthRestoreSnapshot().authConfirmed,
      });
      try {
        const result = await restoreCurrentSessionWithTimeout({
          parentSignal: controller.signal,
          restoreAttemptId,
          authRequestId,
        });
        recordAuthDiagnostic('SESSION_RESTORE_RESPONSE', {
          flowId: restoreAttemptId,
          requestId: authRequestId,
          source: 'RequireAuth.runRestoreRequest',
          resultCategory: 'success',
          cachedUserPresent: Boolean(getCurrentUser()),
        });
        return result;
      } catch (error) {
        recordAuthDiagnostic('SESSION_RESTORE_RESPONSE', {
          flowId: restoreAttemptId,
          requestId: authRequestId,
          source: 'RequireAuth.runRestoreRequest',
          resultCategory: controller.signal.aborted
            ? 'aborted'
            : isUnauthorizedRestoreFailure(error)
              ? 'unauthorized'
              : didRestoreTimeout(error)
                ? 'timeout'
                : 'failure',
        });
        throw error;
      } finally {
        if (activeRestoreControllerRef.current === controller) {
          activeRestoreControllerRef.current = null;
        }
      }
    }

    async function restoreSession() {
      if (runtimeConfig.apiMode !== 'real' && !isAuthenticated()) {
        setAuthGateStatus('unauthenticated');
        recordAuthDiagnostic('REDIRECT_LOGIN', {
          flowId: null,
          requestId: null,
          source: 'RequireAuth.restoreSession.mockUnauthenticated',
          nextAuthState: 'unauthenticated',
        });
        return;
      }

      if (runtimeConfig.apiMode !== 'real') {
        markAuthConfirmed();
        setAuthGateStatus('authenticated');
        return;
      }

      if (getCurrentUser() && getAuthRestoreSnapshot().authConfirmed) {
        setAuthGateStatus('authenticated');
        return;
      }

      abortActiveRestore();
      clearDelayedUiTimer();
      const cachedUser = getCurrentUser();
      const restoreAttemptId = createRestoreAttemptId();
      latestRestoreAttemptIdRef.current = restoreAttemptId;
      recordAuthDiagnostic('SESSION_RESTORE_START', {
        flowId: restoreAttemptId,
        requestId: null,
        source: 'RequireAuth.restoreSession',
        resultCategory: 'started',
        cachedUserPresent: Boolean(cachedUser),
        authConfirmed: getAuthRestoreSnapshot().authConfirmed,
      });
      setAuthGateStatus(cachedUser ? 'authenticated_unconfirmed' : 'restoring');
      setRestoreErrorMessage(null);
      const startedAt = Date.now();
      setAuthRestoreSnapshot({
        phase: 'restoring',
        authConfirmed: false,
        restoreAttemptId,
        startedAt,
        delayed: false,
        errorMessage: null,
      });
      delayedUiTimer = setTimeout(() => {
        if (!isLatestRestore(restoreAttemptId)) {
          return;
        }
        setAuthRestoreSnapshot({ delayed: true });
      }, AUTH_RESTORE_DELAYED_UI_MS);
      logAuthRestoreInfo('AUTH_RESTORE_START', { restoreAttemptId, cachedUserPresent: Boolean(cachedUser) });
      try {
        const { user } = await runRestoreRequest(restoreAttemptId);
        if (isLatestRestore(restoreAttemptId)) {
          if (!user) {
            throw new Error('Session restore did not return a user.');
          }
          suppressNextSessionReset = true;
          setSession(null, user, {
            flowId: restoreAttemptId,
            requestId: null,
            source: 'RequireAuth.restoreSession.success',
          });
          markAuthConfirmed({ restoreAttemptId });
          clearDelayedUiTimer();
          logAuthRestoreInfo('AUTH_RESTORE_SUCCESS', { restoreAttemptId, durationMs: Date.now() - startedAt });
          setAuthGateStatus('authenticated');
        } else {
          recordAuthDiagnostic('STALE_RESULT_IGNORED', {
            flowId: restoreAttemptId,
            requestId: null,
            source: 'RequireAuth.restoreSession.success',
            resultCategory: 'stale',
            staleResult: true,
          });
        }
      } catch (error) {
        if (isLatestRestore(restoreAttemptId)) {
          const isUnauthorized = isUnauthorizedRestoreFailure(error);
          const firstFailureMessage = error instanceof Error ? error.message : 'Session restore failed.';
          logAuthRestoreWarn(didRestoreTimeout(error) ? 'AUTH_RESTORE_TIMEOUT' : 'AUTH_RESTORE_FAILURE', {
            restoreAttemptId,
            durationMs: Date.now() - startedAt,
            message: firstFailureMessage,
          });
          suppressNextSessionReset = true;
          if (isUnauthorized) {
            clearToken({
              reason: 'expired',
              intendedPath: getCurrentRouteForAuthRedirect(),
              flowId: restoreAttemptId,
              requestId: null,
              source: 'RequireAuth.restoreSession.unauthorized',
            });
            setAuthGateStatus('unauthenticated');
            recordAuthDiagnostic('REDIRECT_LOGIN', {
              flowId: restoreAttemptId,
              requestId: null,
              source: 'RequireAuth.restoreSession.unauthorized',
              resultCategory: 'unauthorized',
              nextAuthState: 'unauthenticated',
            });
            navigate('/login', { replace: true });
          } else {
            for (let attempt = 1; attempt <= AUTH_RESTORE_RECOVERY_RETRY_LIMIT; attempt += 1) {
              try {
                logAuthRestoreInfo('AUTH_RESTORE_RECOVERY_RETRY_START', {
                  restoreAttemptId,
                  attempt,
                  previousFailureMessage: firstFailureMessage,
                });
                const retryStartedAt = Date.now();
                const { user } = await runRestoreRequest(restoreAttemptId);
                if (!isLatestRestore(restoreAttemptId)) {
                  return;
                }
                if (!user) {
                  throw new Error('Session restore did not return a user.');
                }
                suppressNextSessionReset = true;
                setSession(null, user, {
                  flowId: restoreAttemptId,
                  requestId: null,
                  source: 'RequireAuth.restoreSession.recoverySuccess',
                });
                markAuthConfirmed({ restoreAttemptId });
                clearDelayedUiTimer();
                logAuthRestoreInfo('AUTH_RESTORE_RECOVERY_RETRY_SUCCESS', {
                  restoreAttemptId,
                  attempt,
                  durationMs: Date.now() - retryStartedAt,
                  totalDurationMs: Date.now() - startedAt,
                });
                setAuthGateStatus('authenticated');
                return;
              } catch (retryError) {
                if (!isLatestRestore(restoreAttemptId)) {
                  return;
                }
                const retryIsUnauthorized = isUnauthorizedRestoreFailure(retryError);
                logAuthRestoreWarn('AUTH_RESTORE_RECOVERY_RETRY_FAILURE', {
                  restoreAttemptId,
                  attempt,
                  durationMs: Date.now() - startedAt,
                  message: retryError instanceof Error ? retryError.message : 'Session restore retry failed.',
                });
                suppressNextSessionReset = true;
                if (retryIsUnauthorized) {
                  clearToken({
                    reason: 'expired',
                    intendedPath: getCurrentRouteForAuthRedirect(),
                    flowId: restoreAttemptId,
                    requestId: null,
                    source: 'RequireAuth.restoreSession.recoveryUnauthorized',
                  });
                  setAuthGateStatus('unauthenticated');
                  recordAuthDiagnostic('REDIRECT_LOGIN', {
                    flowId: restoreAttemptId,
                    requestId: null,
                    source: 'RequireAuth.restoreSession.recoveryUnauthorized',
                    resultCategory: 'unauthorized',
                    nextAuthState: 'unauthenticated',
                  });
                  navigate('/login', { replace: true });
                  return;
                }
              }
            }
            clearDelayedUiTimer();
            if (!getCurrentUser()) {
              clearToken({
                flowId: restoreAttemptId,
                requestId: null,
                source: 'RequireAuth.restoreSession.nonUnauthorizedFailure',
              });
            }
            setRestoreErrorMessage(AUTH_RESTORE_RECOVERABLE_MESSAGE);
            setAuthRestoreSnapshot({
              phase: 'restore_error',
              authConfirmed: false,
              restoreAttemptId,
              delayed: true,
              errorMessage: AUTH_RESTORE_RECOVERABLE_MESSAGE,
            });
            setAuthGateStatus('restore-error');
          }
        } else {
          recordAuthDiagnostic('STALE_RESULT_IGNORED', {
            flowId: restoreAttemptId,
            requestId: null,
            source: 'RequireAuth.restoreSession.failure',
            resultCategory: 'stale',
            staleResult: true,
          });
        }
      }
    }

    void restoreSession();
    const unsubscribeRetry = onAuthRestoreRetryRequest(() => {
      setRestoreRetryCount((count) => count + 1);
    });
    const handleVisibilityChange = () => {
      const snapshot = getAuthRestoreSnapshot();
      if (document.visibilityState === 'visible' && snapshot.phase === 'restoring' && !snapshot.authConfirmed) {
        setRestoreRetryCount((count) => count + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const unsubscribeSession = onSessionReset(() => {
      if (suppressNextSessionReset) {
        suppressNextSessionReset = false;
        return;
      }
      if (!getCurrentUser()) {
        abortActiveRestore();
        clearDelayedUiTimer();
        setRestoreErrorMessage(null);
        setAuthGateStatus('unauthenticated');
        recordAuthDiagnostic('AUTH_STATE_CHANGE', {
          flowId: latestRestoreAttemptIdRef.current,
          requestId: null,
          source: 'RequireAuth.onSessionReset.noCachedUser',
          nextAuthState: 'unauthenticated',
          cachedUserPresent: false,
        });
        return;
      }
      void restoreSession();
    });

    return () => {
      cancelled = true;
      clearDelayedUiTimer();
      abortActiveRestore();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeSession();
      unsubscribeRetry();
    };
  }, [navigate, restoreRetryCount]);

  if (authGateStatus === 'authenticated_unconfirmed') {
    return <Outlet />;
  }

  if (authGateStatus === 'restoring') {
    return (
      <div className="auth-page">
        <section className="auth-panel" role="status">
          <p className="eyebrow">Secure access</p>
          <h1>Checking your session</h1>
          <p className="page-description">We are confirming your session before opening protected data.</p>
        </section>
      </div>
    );
  }

  if (authGateStatus === 'restore-error') {
    if (getCurrentUser()) {
      return <Outlet />;
    }

    return (
      <div className="auth-page">
        <section className="auth-panel" role="alert">
          <p className="eyebrow">Secure access</p>
          <h1>Session restore needs attention</h1>
          <p className="page-description">
            {restoreErrorMessage ?? AUTH_RESTORE_RECOVERABLE_MESSAGE}
          </p>
          <p className="session-meta">{getFrontendBuildLabel()}</p>
          <div className="state-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={clearSessionAndNavigateToLogin}
            >
              Retry sign in
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
