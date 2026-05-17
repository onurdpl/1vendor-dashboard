import { describe, expect, it, beforeEach } from 'vitest';
import { canPerformAction, getDefaultRole, hasPermission } from './permissions';
import { clearToken, getCurrentUserRole, getCurrentUserRoleOrNull, setCurrentUser, setToken } from './session';

beforeEach(() => {
  clearToken();
});

describe('auth permissions', () => {
  it('denies unauthenticated permission checks without defaulting display helpers to admin', () => {
    expect(getDefaultRole()).toBeNull();
    expect(getCurrentUserRoleOrNull()).toBeNull();
    expect(getCurrentUserRole()).toBe('vendor');
    expect(canPerformAction('orders:read')).toBe(false);
    expect(canPerformAction('orders:write')).toBe(false);
    expect(canPerformAction('returns:write')).toBe(false);
    expect(canPerformAction('finance:write')).toBe(false);
    expect(canPerformAction('automation:write')).toBe(false);
  });

  it('gives admin full read and write access', () => {
    setToken('admin-session');
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
    setToken('vendor-session');
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
