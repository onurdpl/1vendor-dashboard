import { useEffect, useState } from 'react';
import { getCurrentUser, getToken, onSessionReset, type CurrentUser } from './auth/session';
import { getCurrentVendorContext, onVendorChange, type VendorContext } from './auth/vendorContext';

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
      sessionReady: false,
      vendorReady: false,
      ready: false,
      unauthorized: false,
    };
  }

  const token = getToken();
  const currentUser = getCurrentUser();

  if (!token || !currentUser) {
    return {
      status: 'unauthorized',
      token,
      currentUser,
      currentVendor,
      sessionReady: false,
      vendorReady: Boolean(currentVendor.vendorId),
      ready: false,
      unauthorized: true,
    };
  }

  if (!currentVendor.vendorId) {
    return {
      status: 'missing_vendor_context',
      token,
      currentUser,
      currentVendor,
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
    const unsubscribeVendor = onVendorChange(refresh);
    window.addEventListener('storage', refresh);

    return () => {
      unsubscribeSession();
      unsubscribeVendor();
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return state;
}
