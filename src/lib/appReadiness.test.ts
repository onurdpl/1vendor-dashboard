import { beforeEach, describe, expect, it } from 'vitest';
import { getAppReadinessSnapshot } from './appReadiness';
import { setCurrentUser, setCurrentVendorId, setToken } from './auth';

describe('app readiness', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does not become ready without a hydrated session', () => {
    const readiness = getAppReadinessSnapshot();

    expect(readiness.status).toBe('unauthorized');
    expect(readiness.ready).toBe(false);
    expect(readiness.sessionReady).toBe(false);
  });

  it('becomes ready after auth and selected vendor context are hydrated', () => {
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    setCurrentVendorId('demo-vendor-b');

    const readiness = getAppReadinessSnapshot();

    expect(readiness.status).toBe('ready');
    expect(readiness.ready).toBe(true);
    expect(readiness.currentVendor.vendorId).toBe('demo-vendor-b');
  });
});
