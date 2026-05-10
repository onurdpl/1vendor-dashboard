import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RequirePermission } from './RequirePermission';
import { clearCurrentUser, setCurrentUser } from '../lib/auth';

beforeEach(() => {
  window.localStorage.clear();
  clearCurrentUser();
});

describe('RequirePermission', () => {
  it('renders children when the permission is allowed', () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });

    render(
      <MemoryRouter>
        <RequirePermission permission="automation:write">
          <div>Allowed content</div>
        </RequirePermission>
      </MemoryRouter>,
    );

    expect(screen.getByText('Allowed content')).toBeInTheDocument();
  });

  it('renders access denied when the permission is denied', () => {
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });

    render(
      <MemoryRouter>
        <RequirePermission permission="automation:write">
          <div>Blocked content</div>
        </RequirePermission>
      </MemoryRouter>,
    );

    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('Blocked content')).not.toBeInTheDocument();
  });
});
