import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { runtimeConfig } from '../config/runtime';
import { runtimeServices } from '../services/runtime-services';
import {
  clearAuthRestoreState,
  createAuthDiagnosticId,
  getCurrentUser,
  isAuthenticated,
  markAuthConfirmed,
  recordAuthDiagnostic,
  setAuthRestoreSnapshot,
  setSession,
} from './auth';
import { ApiError } from './api/errors';

type PublicAuthGateStatus = 'restoring' | 'authenticated' | 'unauthenticated';

const AUTH_RESTORE_TIMEOUT_MS = 2_000;

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
  let didTimeout = false;
  let rejectOnAbort: ((error: DOMException) => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectOnAbort = reject;
  });
  const abortRequest = () => {
    rejectOnAbort?.(new DOMException('Session restore aborted.', 'AbortError'));
  };

  input.controller.signal.addEventListener('abort', abortRequest, { once: true });

  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    input.controller.abort();
  }, AUTH_RESTORE_TIMEOUT_MS);

  try {
    return await Promise.race([
      runtimeServices.auth.me({
        authAttemptId: input.restoreAttemptId,
        authFlowId: input.restoreAttemptId,
        authRequestId: input.authRequestId,
        signal: input.controller.signal,
      }),
      abortPromise,
    ]);
  } catch (error) {
    if (error && typeof error === 'object') {
      Reflect.set(error, 'restoreDidTimeout', didTimeout);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    input.controller.signal.removeEventListener('abort', abortRequest);
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
        clearAuthRestoreState();
        setStatus('unauthenticated');
      } finally {
        if (activeRestoreControllerRef.current === controller) {
          activeRestoreControllerRef.current = null;
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
    return <div className="auth-page" aria-busy="true" />;
  }

  return <Outlet />;
}
