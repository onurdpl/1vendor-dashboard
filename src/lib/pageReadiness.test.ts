import { describe, expect, it } from 'vitest';
import type { AppReadinessState } from './appReadiness';
import { getPageReadinessState } from './pageReadiness';

function makeReadiness(overrides: Partial<AppReadinessState> = {}): AppReadinessState {
  return {
    status: 'ready',
    token: 'token',
    currentUser: {
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    },
    currentVendor: {
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
    },
    sessionReady: true,
    vendorReady: true,
    ready: true,
    unauthorized: false,
    ...overrides,
  };
}

describe('page readiness', () => {
  it('returns missing_vendor_context for a vendor page without a vendor', () => {
    const readiness = getPageReadinessState(
      makeReadiness({
        status: 'missing_vendor_context',
        currentVendor: { vendorId: '', vendorName: 'All vendors' },
        vendorReady: false,
        ready: false,
      }),
      { requiresVendorContext: true },
    );

    expect(readiness).toEqual({ status: 'missing_vendor_context', ready: false });
  });

  it('returns ready for an admin page when the user exists but vendor context is missing', () => {
    const readiness = getPageReadinessState(
      makeReadiness({
        status: 'missing_vendor_context',
        currentVendor: { vendorId: '', vendorName: 'All vendors' },
        vendorReady: false,
        ready: false,
      }),
      { requiresVendorContext: false },
    );

    expect(readiness).toEqual({ status: 'ready', ready: true });
  });

  it('returns waiting_vendor_context while a vendor page is waiting for a vendor id', () => {
    const readiness = getPageReadinessState(
      makeReadiness({
        status: 'loading_vendor_context',
        currentVendor: { vendorId: '', vendorName: 'All vendors' },
        vendorReady: false,
        ready: false,
      }),
      { requiresVendorContext: true },
    );

    expect(readiness).toEqual({ status: 'waiting_vendor_context', ready: false });
  });

  it('returns unauthorized without a current user', () => {
    const readiness = getPageReadinessState(
      makeReadiness({
        status: 'unauthorized',
        currentUser: null,
        sessionReady: false,
        ready: false,
        unauthorized: true,
      }),
      { requiresVendorContext: false },
    );

    expect(readiness).toEqual({ status: 'unauthorized', ready: false });
  });
});
