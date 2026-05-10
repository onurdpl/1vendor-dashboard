import { describe, expect, it, beforeEach } from 'vitest';
import { canPerformAction, getDefaultRole, hasPermission } from './permissions';
import { clearCurrentUser, setCurrentUser } from './session';

beforeEach(() => {
  clearCurrentUser();
});

describe('auth permissions', () => {
  it('gives admin full read and write access', () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });

    expect(hasPermission('admin', 'orders:read')).toBe(true);
    expect(hasPermission('admin', 'returns:write')).toBe(true);
    expect(hasPermission('admin', 'finance:write')).toBe(true);
    expect(hasPermission('admin', 'automation:write')).toBe(true);
    expect(canPerformAction('automation:write')).toBe(true);
    expect(getDefaultRole()).toBe('admin');
  });

  it('gives vendor read access to shared dashboard resources only', () => {
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });

    expect(hasPermission('vendor', 'orders:read')).toBe(true);
    expect(hasPermission('vendor', 'returns:read')).toBe(true);
    expect(hasPermission('vendor', 'finance:read')).toBe(true);
    expect(hasPermission('vendor', 'automation:read')).toBe(true);
    expect(hasPermission('vendor', 'automation:write')).toBe(false);
    expect(canPerformAction('automation:write')).toBe(false);
    expect(getDefaultRole()).toBe('vendor');
  });
});
