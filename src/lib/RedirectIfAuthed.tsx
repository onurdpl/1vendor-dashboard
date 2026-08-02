import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { runtimeConfig } from '../config/runtime';
import { runtimeServices } from '../services/runtime-services';
import {
  clearToken,
  createAuthDiagnosticId,
  getCurrentUser,
  isAuthenticated,
  markAuthConfirmed,
  recordAuthDiagnostic,
  setAuthRestoreSnapshot,
  setSession,
} from './auth';
import { ApiError } from './api/errors';

type PublicAuthGateStatus = 'restoring' | 'authenticated' | 'unauthenticated' | 'restore-error';

const AUTH_RESTORE_TIMEOUT_MS = 10_000;
const AUTH_RESTORE_RECOVERY_RETRY_LIMIT = 1;
const AUTH_RESTORE_RECOVERABLE_MESSAGE =
  'Session restore is taking longer than expected. Please retry or sign in again.';

function getInitialStatus(): PublicAuthGateStatus {
  if (isAuthenticated()) {
    return 'authenticated';
  }

  return runtimeConfig.apiMode === 'real' ? 'restoring' : 'unauthenticated';
}

function createRestoreAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `restore-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }

  return `restore-${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
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

async function restoreCurrentSession(input: {
  controller: AbortController;
  restoreAttemptId: string;
  authRequestId: string;
}) {
  const timeoutController = new AbortController();
  let didTimeout = false;
  const abortFromOwner = () => timeoutController.abort(input.controller.signal.reason);

  if (input.controller.signal.aborted) {
    abortFromOwner();
  } else {
    input.controller.signal.addEventListener('abort', abortFromOwner, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    timeoutController.abort();
  }, AUTH_RESTORE_TIMEOUT_MS);

  try {
    return await runtimeServices.auth.me({
      authAttemptId: input.restoreAttemptId,
      authFlowId: input.restoreAttemptId,
      authRequestId: input.authRequestId,
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (error && typeof error === 'object') {
      Reflect.set(error, 'restoreDidTimeout', didTimeout);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    input.controller.signal.removeEventListener('abort', abortFromOwner);
  }
}

export function RedirectIfAuthed() {
  const [status, setStatus] = useState<PublicAuthGateStatus>(getInitialStatus);
  const activeRestoreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (status !== 'restoring' || runtimeConfig.apiMode !== 'real') {
      return undefined;
    }

    let cancelled = false;
    const restoreAttemptId = createRestoreAttemptId();
    const startedAt = Date.now();

    async function restoreCookieSession() {
      setAuthRestoreSnapshot({
        phase: 'restoring',
        authConfirmed: false,
        restoreAttemptId,
        startedAt,
        delayed: false,
        errorMessage: null,
      });

      for (let attempt = 0; attempt <= AUTH_RESTORE_RECOVERY_RETRY_LIMIT; attempt += 1) {
        const controller = new AbortController();
        const authRequestId = createAuthDiagnosticId('req');
        activeRestoreControllerRef.current = controller;
        recordAuthDiagnostic('SESSION_RESTORE_START', {
          flowId: restoreAttemptId,
          requestId: authRequestId,
          source: 'RedirectIfAuthed.restoreCookieSession',
          resultCategory: 'started',
          cachedUserPresent: Boolean(getCurrentUser()),
        });

        try {
          const user = await restoreCurrentSession({ controller, restoreAttemptId, authRequestId });
          if (cancelled || activeRestoreControllerRef.current !== controller) {
            recordAuthDiagnostic('STALE_RESULT_IGNORED', {
              flowId: restoreAttemptId,
              requestId: authRequestId,
              source: 'RedirectIfAuthed.restoreCookieSession.success',
              resultCategory: 'stale',
              staleResult: true,
            });
            return;
          }
          if (!user) {
            throw new Error('Session restore did not return a user.');
          }

          setSession(null, user, {
            flowId: restoreAttemptId,
            requestId: authRequestId,
            source: 'RedirectIfAuthed.restoreCookieSession.success',
          });
          markAuthConfirmed({ restoreAttemptId });
          recordAuthDiagnostic('SESSION_RESTORE_RESPONSE', {
            flowId: restoreAttemptId,
            requestId: authRequestId,
            source: 'RedirectIfAuthed.restoreCookieSession',
            resultCategory: 'success',
            durationMs: Date.now() - startedAt,
          });
          setStatus('authenticated');
          return;
        } catch (error) {
          if (cancelled || activeRestoreControllerRef.current !== controller) {
            recordAuthDiagnostic('STALE_RESULT_IGNORED', {
              flowId: restoreAttemptId,
              requestId: authRequestId,
              source: 'RedirectIfAuthed.restoreCookieSession.failure',
              resultCategory: 'stale',
              staleResult: true,
            });
            return;
          }

          const unauthorized = isUnauthorizedRestoreFailure(error);
          const didTimeout = Boolean(error && typeof error === 'object' && Reflect.get(error, 'restoreDidTimeout'));
          recordAuthDiagnostic('SESSION_RESTORE_RESPONSE', {
            flowId: restoreAttemptId,
            requestId: authRequestId,
            source: 'RedirectIfAuthed.restoreCookieSession',
            resultCategory: unauthorized ? 'unauthorized' : didTimeout ? 'timeout' : 'failure',
            durationMs: Date.now() - startedAt,
          });

          if (unauthorized) {
            clearToken({
              reason: 'expired',
              intendedPath: '/login',
              flowId: restoreAttemptId,
              requestId: authRequestId,
              source: 'RedirectIfAuthed.restoreCookieSession.unauthorized',
            });
            setStatus('unauthenticated');
            return;
          }

          if (attempt === AUTH_RESTORE_RECOVERY_RETRY_LIMIT) {
            setAuthRestoreSnapshot({
              phase: 'restore_error',
              authConfirmed: false,
              restoreAttemptId,
              delayed: true,
              errorMessage: AUTH_RESTORE_RECOVERABLE_MESSAGE,
            });
            setStatus('restore-error');
            return;
          }
        } finally {
          if (activeRestoreControllerRef.current === controller) {
            activeRestoreControllerRef.current = null;
          }
        }
      }
    }

    void restoreCookieSession();

    return () => {
      cancelled = true;
      if (activeRestoreControllerRef.current) {
        recordAuthDiagnostic('REQUEST_ABORT', {
          flowId: restoreAttemptId,
          requestId: null,
          source: 'RedirectIfAuthed.cleanup',
          resultCategory: 'aborted',
        });
        activeRestoreControllerRef.current.abort();
        activeRestoreControllerRef.current = null;
      }
    };
  }, [status]);

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  if (status === 'restoring') {
    return (
      <div className="auth-page">
        <section className="auth-panel" role="status">
          <p className="eyebrow">Secure access</p>
          <h1>Checking your session</h1>
          <p className="page-description">We are confirming your session before showing sign in.</p>
        </section>
      </div>
    );
  }

  if (status === 'restore-error') {
    return (
      <div className="auth-page">
        <section className="auth-panel" role="alert">
          <p className="eyebrow">Secure access</p>
          <h1>Session restore needs attention</h1>
          <p className="page-description">{AUTH_RESTORE_RECOVERABLE_MESSAGE}</p>
          <div className="state-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                clearToken({ source: 'RedirectIfAuthed.continueToLogin' });
                setStatus('unauthenticated');
              }}
            >
              Retry sign in
            </button>
          </div>
        </section>
      </div>
    );
  }

  return <Outlet />;
}
