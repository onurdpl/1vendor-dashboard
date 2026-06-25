import { useEffect, useState } from 'react';

const AUTH_RESTORE_STATE_EVENT = 'vendor-dashboard:auth-restore-state';
const AUTH_RESTORE_RETRY_EVENT = 'vendor-dashboard:auth-restore-retry';

export type AuthRestorePhase = 'unconfirmed' | 'restoring' | 'confirmed' | 'restore_error';

export type AuthRestoreSnapshot = {
  phase: AuthRestorePhase;
  authConfirmed: boolean;
  restoreAttemptId: string | null;
  startedAt: number | null;
  delayed: boolean;
  errorMessage: string | null;
};

let authRestoreSnapshot: AuthRestoreSnapshot = {
  phase: 'unconfirmed',
  authConfirmed: false,
  restoreAttemptId: null,
  startedAt: null,
  delayed: false,
  errorMessage: null,
};

function emitAuthRestoreStateChange() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_RESTORE_STATE_EVENT));
}

export function getAuthRestoreSnapshot() {
  return authRestoreSnapshot;
}

export function setAuthRestoreSnapshot(next: Partial<AuthRestoreSnapshot>) {
  authRestoreSnapshot = {
    ...authRestoreSnapshot,
    ...next,
  };
  emitAuthRestoreStateChange();
}

export function markAuthConfirmed(input: { restoreAttemptId?: string | null } = {}) {
  setAuthRestoreSnapshot({
    phase: 'confirmed',
    authConfirmed: true,
    restoreAttemptId: input.restoreAttemptId ?? authRestoreSnapshot.restoreAttemptId,
    delayed: false,
    errorMessage: null,
  });
}

export function clearAuthRestoreState() {
  authRestoreSnapshot = {
    phase: 'unconfirmed',
    authConfirmed: false,
    restoreAttemptId: null,
    startedAt: null,
    delayed: false,
    errorMessage: null,
  };
  emitAuthRestoreStateChange();
}

export function onAuthRestoreStateChange(handler: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener(AUTH_RESTORE_STATE_EVENT, handler);

  return () => {
    window.removeEventListener(AUTH_RESTORE_STATE_EVENT, handler);
  };
}

export function requestAuthRestoreRetry() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_RESTORE_RETRY_EVENT));
}

export function onAuthRestoreRetryRequest(handler: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener(AUTH_RESTORE_RETRY_EVENT, handler);

  return () => {
    window.removeEventListener(AUTH_RESTORE_RETRY_EVENT, handler);
  };
}

export function useAuthRestoreSnapshot() {
  const [snapshot, setSnapshot] = useState(getAuthRestoreSnapshot);

  useEffect(() => {
    const refresh = () => setSnapshot(getAuthRestoreSnapshot());
    refresh();
    return onAuthRestoreStateChange(refresh);
  }, []);

  return snapshot;
}
