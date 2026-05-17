import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../lib/RequireAuth';
import {
  EXPIRED_SESSION_MESSAGE,
  clearToken,
  setCurrentUser,
  setToken,
  type CurrentUser,
} from '../lib/auth';
import { LoginPage } from './LoginPage';

const loginMock = vi.hoisted(() => vi.fn());

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    auth: {
      login: loginMock,
    },
  },
}));

const testUser: CurrentUser = {
  email: 'vendor@example.com',
  name: 'Vendor User',
  role: 'vendor',
  vendorAccess: ['sporjinal'],
  vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
  canSwitchVendors: false,
  defaultVendorId: 'sporjinal',
};

function seedSession() {
  setToken('stale-token');
  setCurrentUser(testUser);
}

function RouteProbe() {
  const location = useLocation();
  return <span data-testid="current-route">{`${location.pathname}${location.search}${location.hash}`}</span>;
}

describe('LoginPage expired session flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    loginMock.mockReset();
    loginMock.mockResolvedValue({
      token: 'fresh-token',
      user: testUser,
    });
  });

  it('shows the expired-session message and returns to the intended route after login', async () => {
    seedSession();

    render(
      <MemoryRouter initialEntries={['/orders?status=open']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route
              path="/orders"
              element={
                <>
                  <div>Orders workspace</div>
                  <RouteProbe />
                </>
              }
            />
          </Route>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();

    await act(async () => {
      clearToken({ reason: 'expired', intendedPath: '/orders?status=open' });
    });

    expect(screen.getByText(EXPIRED_SESSION_MESSAGE)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'vendor@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'demo123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Orders workspace')).toBeInTheDocument();
    expect(screen.getByTestId('current-route')).toHaveTextContent('/orders?status=open');
    expect(loginMock).toHaveBeenCalledWith('vendor@example.com', 'demo123');
  });
});
