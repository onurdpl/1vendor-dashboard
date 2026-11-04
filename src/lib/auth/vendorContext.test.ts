import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCurrentUser, setCurrentUser, setSession } from './session';
import { getAvailableVendors, getCurrentVendorContext, getAdminVendorSelection, setCurrentVendorId,
  verifyAdminVendorSelection } from './vendorContext';
import { runtimeConfig } from '../../config/runtime';

const initialApiMode = runtimeConfig.apiMode;
const admin = (vendorAccess: string[] = []) => ({
  email: 'admin@example.test', name: 'Admin', role: 'admin' as const,
  vendorAccess, vendorDetails: vendorAccess.map((vendorId) => ({ vendorId, vendorName: vendorId })),
  canSwitchVendors: vendorAccess.length > 1, defaultVendorId: vendorAccess[0] ?? '',
});
const status = (vendorId: string, overrides: Record<string, unknown> = {}) => ({
  vendorId, vendorName: `Verified ${vendorId}`, status: 'active', restricted: false,
  restrictionReason: null, changedByUserId: null, changedByEmail: null, changedAt: null,
  ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  Object.assign(runtimeConfig, { apiMode: initialApiMode });
  window.localStorage.clear();
  clearCurrentUser();
});

describe('real Admin Vendor selection preflight', () => {
  beforeEach(() => { Object.assign(runtimeConfig, { apiMode: 'real' }); });
  it('does not replace an unverified non-member selection with the first membership', () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    setCurrentUser({ email: 'admin@example.test', name: 'Admin', role: 'admin',
      vendorAccess: ['member-a'], vendorDetails: [{ vendorId: 'member-a', vendorName: 'Member A' }],
      canSwitchVendors: false, defaultVendorId: 'member-a' });
    setCurrentVendorId('registered-b');

    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('registered-b');
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it('never activates an arbitrary stored Admin ID before exact backend verification', () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    setCurrentUser({ email: 'admin@example.test', name: 'Admin', role: 'admin',
      vendorAccess: ['member-a'], vendorDetails: [{ vendorId: 'member-a', vendorName: 'Member A' }],
      canSwitchVendors: false, defaultVendorId: 'member-a' });
    window.localStorage.setItem('vendor-dashboard.current-vendor-id', 'unverified-id');

    expect(getCurrentVendorContext().vendorId).toBe('');
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('unverified-id');
  });

  it('verifies an existing Vendor for an Admin with zero memberships and survives repeated reads', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('registered-b');
    const load = vi.fn(async (id: string) => status(id));
    const confirm = vi.fn(async () => undefined);
    expect(getCurrentVendorContext().vendorId).toBe('');
    await verifyAdminVendorSelection(load, confirm);
    expect(load).toHaveBeenCalledWith('registered-b');
    expect(confirm).not.toHaveBeenCalled();
    expect(getCurrentVendorContext()).toMatchObject({ vendorId: 'registered-b', vendorName: 'Verified registered-b' });
    expect(getCurrentVendorContext().vendorId).toBe('registered-b');
    expect(getAvailableVendors().map((item) => item.vendorId)).toEqual(['registered-b']);
  });

  it('validates a non-member Vendor without falling back to an Admin membership', async () => {
    setSession('admin-token', admin(['member-a']));
    setCurrentVendorId('registered-b');
    await verifyAdminVendorSelection(async (id) => status(id), async () => undefined);
    expect(getCurrentVendorContext().vendorId).toBe('registered-b');
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('registered-b');
  });

  it('rejects mismatched status identity and retains the selected ID without an active context', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('requested-a');
    await verifyAdminVendorSelection(async () => status('other-b'), async () => undefined);
    expect(getCurrentVendorContext().vendorId).toBe('');
    expect(getAdminVendorSelection()).toMatchObject({ vendorId: 'requested-a', status: 'error' });
  });

  it('retains selection on ambiguous 400 and network failure, then retries successfully', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('registered-a');
    const confirm = vi.fn(async () => undefined);
    await verifyAdminVendorSelection(async () => { throw { status: 400 }; }, confirm);
    expect(confirm).toHaveBeenCalledWith('registered-a');
    expect(getAdminVendorSelection()).toMatchObject({ vendorId: 'registered-a', status: 'error' });
    expect(getCurrentVendorContext().vendorId).toBe('');
    await verifyAdminVendorSelection(async () => { throw new Error('network'); }, confirm);
    expect(getAdminVendorSelection().vendorId).toBe('registered-a');
    await verifyAdminVendorSelection(async (id) => status(id), confirm);
    expect(getCurrentVendorContext().vendorId).toBe('registered-a');
  });

  it('clears only after the independent exact-ID endpoint confirms 404, with no fallback', async () => {
    setSession('admin-token', admin(['member-a']));
    setCurrentVendorId('deleted-b');
    await verifyAdminVendorSelection(async () => { throw { status: 400 }; }, async () => { throw { status: 404 }; });
    expect(getAdminVendorSelection()).toMatchObject({ vendorId: '', status: 'empty' });
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it('does not clear for forbidden, server or network errors', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('registered-a');
    const confirm = vi.fn(async () => undefined);
    for (const code of [401, 403, 500]) {
      await verifyAdminVendorSelection(async () => { throw { status: code }; }, confirm);
      expect(getAdminVendorSelection().vendorId).toBe('registered-a');
      expect(getCurrentVendorContext().vendorId).toBe('');
    }
    expect(confirm).not.toHaveBeenCalled();
  });

  it('accepts a restricted but existing Vendor as an exact verified context', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('restricted-a');
    await verifyAdminVendorSelection(async (id) => status(id, { status: 'inactive', restricted: true,
      restrictionReason: 'Review' }), async () => undefined);
    expect(getCurrentVendorContext()).toMatchObject({ vendorId: 'restricted-a', status: 'inactive',
      restrictionReason: 'Review' });
  });

  it('rejects the first A result after A → B → A', async () => {
    setSession('admin-token', admin());
    const oldA = deferred<ReturnType<typeof status>>();
    setCurrentVendorId('vendor-a');
    const stale = verifyAdminVendorSelection(() => oldA.promise, async () => undefined);
    setCurrentVendorId('vendor-b');
    await verifyAdminVendorSelection(async (id) => status(id), async () => undefined);
    setCurrentVendorId('vendor-a');
    await verifyAdminVendorSelection(async (id) => status(id, { vendorName: 'Fresh A' }), async () => undefined);
    oldA.resolve(status('vendor-a', { vendorName: 'Stale A' }));
    await stale;
    expect(getCurrentVendorContext().vendorName).toBe('Fresh A');
  });

  it('rejects an older overlapping verification for the same selection', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('vendor-a');
    const old = deferred<ReturnType<typeof status>>();
    const stale = verifyAdminVendorSelection(() => old.promise, async () => undefined);
    await verifyAdminVendorSelection(async (id) => status(id, { vendorName: 'Latest A' }), async () => undefined);
    old.resolve(status('vendor-a', { vendorName: 'Older A' }));
    await stale;
    expect(getCurrentVendorContext().vendorName).toBe('Latest A');
  });

  it('invalidates cross-tab selection and prior session verification', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('vendor-a');
    await verifyAdminVendorSelection(async (id) => status(id), async () => undefined);
    window.localStorage.setItem('vendor-dashboard.current-vendor-id', 'vendor-b');
    window.dispatchEvent(new StorageEvent('storage', { key: 'vendor-dashboard.current-vendor-id', newValue: 'vendor-b' }));
    expect(getCurrentVendorContext().vendorId).toBe('');
    expect(getAdminVendorSelection().vendorId).toBe('vendor-b');
    setSession('other-token', admin());
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it('keeps the stored ID through session restoration and requires fresh verification', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('registered-a');
    await verifyAdminVendorSelection(async (id) => status(id), async () => undefined);
    expect(getCurrentVendorContext().vendorId).toBe('registered-a');
    setCurrentUser(admin());
    expect(getAdminVendorSelection()).toMatchObject({ vendorId: 'registered-a', status: 'pending' });
    expect(getCurrentVendorContext().vendorId).toBe('');
    await verifyAdminVendorSelection(async (id) => status(id), async () => undefined);
    expect(getCurrentVendorContext().vendorId).toBe('registered-a');
  });

  it('rejects an old Admin response after logout and preserves the new Vendor account membership boundary', async () => {
    setSession('admin-token', admin());
    setCurrentVendorId('registered-a');
    const pending = deferred<ReturnType<typeof status>>();
    const stale = verifyAdminVendorSelection(() => pending.promise, async () => undefined);
    clearCurrentUser();
    setSession('vendor-token', { email: 'vendor@example.test', name: 'Vendor', role: 'vendor',
      vendorAccess: ['member-b'], vendorDetails: [{ vendorId: 'member-b', vendorName: 'Member B' }],
      canSwitchVendors: false, defaultVendorId: 'member-b' });
    setCurrentVendorId('registered-a');
    pending.resolve(status('registered-a'));
    await stale;
    expect(getCurrentVendorContext().vendorId).toBe('member-b');
    expect(getAvailableVendors().map((item) => item.vendorId)).toEqual(['member-b']);
  });
});

describe('vendor context', () => {
  it('exposes the demo vendors', () => {
    expect(getAvailableVendors().map((vendor) => vendor.vendorId)).toEqual([
      'demo-vendor-a',
      'demo-vendor-b',
    ]);
  });

  it('resolves Demo Vendor A for the vendor A demo user', () => {
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    setCurrentVendorId('demo-vendor-b');

    expect(getCurrentVendorContext().vendorId).toBe('demo-vendor-a');
  });

  it('resolves Demo Vendor B for the vendor B demo user', () => {
    setCurrentUser({
      email: 'vendor-b@demo.com',
      name: 'Vendor B User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-b'],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-b',
    });
    setCurrentVendorId('demo-vendor-a');

    expect(getCurrentVendorContext().vendorId).toBe('demo-vendor-b');
  });

  it('falls back to the allowed vendor when stored vendor is invalid', () => {
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    window.localStorage.setItem('vendor-dashboard.current-vendor-id', 'unknown-vendor');

    expect(getCurrentVendorContext().vendorId).toBe('demo-vendor-a');
  });

  it('persists an admin selected vendor across context reads', () => {
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

    expect(getCurrentVendorContext()).toEqual({
      vendorId: 'demo-vendor-b',
      vendorName: 'Demo Vendor B',
      scope: 'runtime-vendor-context',
      status: 'active',
      restrictionReason: null,
      restrictionChangedByUserId: null,
      restrictionChangedByEmail: null,
      restrictionChangedAt: null,
    });
    expect(getCurrentVendorContext().vendorId).toBe('demo-vendor-b');
  });

  it('preserves restricted vendor metadata from the authenticated session', () => {
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [
        {
          vendorId: 'demo-vendor-a',
          vendorName: 'Demo Vendor A',
          status: 'inactive',
          restrictionReason: 'Operational review',
          restrictionChangedByEmail: 'admin@example.com',
          restrictionChangedAt: '2026-06-30T12:00:00Z',
        },
      ],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });

    expect(getCurrentVendorContext()).toEqual({
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
      scope: 'runtime-vendor-context',
      status: 'inactive',
      restrictionReason: 'Operational review',
      restrictionChangedByUserId: null,
      restrictionChangedByEmail: 'admin@example.com',
      restrictionChangedAt: '2026-06-30T12:00:00Z',
    });
  });

  it('does not invent a demo vendor for an authenticated user with no vendor access', () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    });

    expect(getAvailableVendors()).toEqual([]);
    expect(getCurrentVendorContext()).toEqual({
      vendorId: '',
      vendorName: '',
      scope: 'missing-vendor-context',
    });
  });
});
