import type { AppReadinessState } from './appReadiness';

export type PageReadinessStatus =
  | 'unauthorized'
  | 'missing_vendor_context'
  | 'waiting_vendor_context'
  | 'ready';

export type PageReadinessState = {
  status: PageReadinessStatus;
  ready: boolean;
};

type PageReadinessOptions = {
  requiresVendorContext: boolean;
  currentVendorId?: string | null;
};

export function getPageReadinessState(
  appReadiness: AppReadinessState,
  options: PageReadinessOptions,
): PageReadinessState {
  if (appReadiness.unauthorized || !appReadiness.currentUser) {
    return { status: 'unauthorized', ready: false };
  }

  const sessionReady = appReadiness.sessionReady || appReadiness.ready;

  if (!sessionReady) {
    return { status: 'waiting_vendor_context', ready: false };
  }

  if (!options.requiresVendorContext) {
    return { status: 'ready', ready: true };
  }

  const vendorId = options.currentVendorId ?? appReadiness.currentVendor.vendorId;
  if (appReadiness.status === 'missing_vendor_context') {
    return { status: 'missing_vendor_context', ready: false };
  }

  if (!vendorId) {
    return { status: 'waiting_vendor_context', ready: false };
  }

  return { status: 'ready', ready: true };
}
