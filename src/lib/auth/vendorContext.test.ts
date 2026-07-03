import { beforeEach, describe, expect, it } from 'vitest';
import { clearCurrentUser, setCurrentUser } from './session';
import { getAvailableVendors, getCurrentVendorContext, setCurrentVendorId } from './vendorContext';

beforeEach(() => {
  window.localStorage.clear();
  clearCurrentUser();
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
