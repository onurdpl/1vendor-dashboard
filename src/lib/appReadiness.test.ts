import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppReadinessSnapshot } from './appReadiness';
import { createCurrentUserFromVendorAccess, setCurrentUser, setCurrentVendorId, setSession, setToken } from './auth';

describe('app readiness', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
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

  it('becomes ready for a vendor user with a fixed vendor context', () => {
    setToken('vendor-token');
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });

    const readiness = getAppReadinessSnapshot();

    expect(readiness.status).toBe('ready');
    expect(readiness.ready).toBe(true);
    expect(readiness.currentVendor.vendorId).toBe('demo-vendor-a');
  });

  it('does not become ready when an authenticated user has no vendor context', () => {
    setToken('admin-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    });

    const readiness = getAppReadinessSnapshot();

    expect(readiness.status).toBe('missing_vendor_context');
    expect(readiness.sessionReady).toBe(true);
    expect(readiness.vendorReady).toBe(false);
    expect(readiness.ready).toBe(false);
  });

  it('does not invent demo vendor access for real authenticated users with no backend vendor links', () => {
    const user = createCurrentUserFromVendorAccess({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      status: 'active',
      vendorAccess: [],
    });

    setSession('admin-token', user);

    const readiness = getAppReadinessSnapshot();

    expect(user.vendorAccess).toEqual([]);
    expect(user.defaultVendorId).toBe('');
    expect(readiness.status).toBe('missing_vendor_context');
    expect(readiness.ready).toBe(false);
  });

  it('keeps real-mode cached users unconfirmed until backend session restore succeeds', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_APP_ENV', 'production');
    window.localStorage.clear();

    const auth = await import('./auth');
    const readinessModule = await import('./appReadiness');
    auth.setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    auth.setCurrentVendorId('demo-vendor-a');

    expect(readinessModule.getAppReadinessSnapshot()).toMatchObject({
      status: 'loading_session',
      authConfirmed: false,
      sessionReady: false,
      ready: false,
      currentUser: expect.objectContaining({ email: 'admin@demo.com' }),
    });

    auth.markAuthConfirmed();

    expect(readinessModule.getAppReadinessSnapshot()).toMatchObject({
      status: 'ready',
      authConfirmed: true,
      sessionReady: true,
      ready: true,
    });
  });
});
