import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RequireAuth } from './RequireAuth';
import { clearToken, setCurrentUser, setToken } from './auth';

function seedSession() {
  setToken('test-token');
  setCurrentUser({
    email: 'vendor@example.com',
    name: 'Vendor User',
    role: 'vendor',
    vendorAccess: ['sporjinal'],
    vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
    canSwitchVendors: false,
    defaultVendorId: 'sporjinal',
  });
}

describe('RequireAuth', () => {
  it('moves back to login when a stale session is cleared after an API 401', async () => {
    window.localStorage.clear();
    seedSession();

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/orders" element={<div>Orders workspace</div>} />
          </Route>
          <Route path="/login" element={<div>Login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();

    await act(async () => {
      clearToken();
    });

    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });
});
