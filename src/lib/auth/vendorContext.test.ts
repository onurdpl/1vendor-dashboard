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
});
