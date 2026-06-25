import { useEffect, useState } from 'react';
import { getCurrentUser, getToken, onSessionReset, type CurrentUser } from './auth/session';
import { getAuthRestoreSnapshot, onAuthRestoreStateChange, type AuthRestorePhase } from './auth/restoreState';
import { getCurrentVendorContext, onVendorChange, type VendorContext } from './auth/vendorContext';
import { runtimeConfig } from '../config/runtime';

export type AppReadinessStatus =
  | 'loading_session'
  | 'loading_vendor_context'
  | 'missing_vendor_context'
  | 'ready'
  | 'unauthorized';

export type AppReadinessState = {
  status: AppReadinessStatus;
  token: string | null;
  currentUser: CurrentUser | null;
  currentVendor: VendorContext;
  authConfirmed: boolean;
  authRestorePhase: AuthRestorePhase;
  sessionReady: boolean;
  vendorReady: boolean;
  ready: boolean;
  unauthorized: boolean;
};

export function getAppReadinessSnapshot(): AppReadinessState {
  const currentVendor = getCurrentVendorContext();

  if (typeof window === 'undefined') {
    return {
      status: 'loading_session',
      token: null,
      currentUser: null,
      currentVendor,
      authConfirmed: false,
      authRestorePhase: 'unconfirmed',
      sessionReady: false,
      vendorReady: false,
      ready: false,
      unauthorized: false,
    };
  }

  const token = getToken();
  const currentUser = getCurrentUser();
  const authRestore = getAuthRestoreSnapshot();
  const authConfirmed =
    runtimeConfig.apiMode !== 'real' ||
    runtimeConfig.appEnvironment === 'test' ||
    authRestore.authConfirmed;

  if (!currentUser) {
    return {
      status: 'unauthorized',
      token,
      currentUser,
      currentVendor,
      authConfirmed: false,
      authRestorePhase: authRestore.phase,
      sessionReady: false,
      vendorReady: Boolean(currentVendor.vendorId),
      ready: false,
      unauthorized: true,
    };
  }

  if (!authConfirmed) {
    return {
      status: 'loading_session',
      token,
      currentUser,
      currentVendor,
      authConfirmed,
      authRestorePhase: authRestore.phase,
      sessionReady: false,
      vendorReady: Boolean(currentVendor.vendorId),
      ready: false,
      unauthorized: false,
    };
  }

  if (!currentVendor.vendorId) {
    return {
      status: 'missing_vendor_context',
      token,
      currentUser,
      currentVendor,
      authConfirmed,
      authRestorePhase: authRestore.phase,
      sessionReady: true,
      vendorReady: false,
      ready: false,
      unauthorized: false,
    };
  }

  return {
    status: 'ready',
    token,
    currentUser,
    currentVendor,
    authConfirmed,
    authRestorePhase: authRestore.phase,
    sessionReady: true,
    vendorReady: true,
    ready: true,
    unauthorized: false,
  };
}

export function useAppReadiness() {
  const [state, setState] = useState(getAppReadinessSnapshot);

  useEffect(() => {
    const refresh = () => setState(getAppReadinessSnapshot());
    refresh();

    const unsubscribeSession = onSessionReset(refresh);
    const unsubscribeAuthRestore = onAuthRestoreStateChange(refresh);
    const unsubscribeVendor = onVendorChange(refresh);
    window.addEventListener('storage', refresh);

    return () => {
      unsubscribeSession();
      unsubscribeAuthRestore();
      unsubscribeVendor();
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return state;
}
