import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function renderStandaloneLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/" element={<RouteProbe />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillAndSubmitLogin() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'vendor@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'demo123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
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

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
    expect(loginMock).toHaveBeenCalledWith(
      'vendor@example.com',
      'demo123',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('sporjinal');
  });

  it('shows invalid credential errors without changing the login flow', async () => {
    loginMock.mockRejectedValueOnce(new Error('Invalid email or password.'));
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByText('Sign-in is taking longer than expected. Please try again.')).not.toBeInTheDocument();
  });

  it('aborts a hanging login request and shows a retryable timeout error', async () => {
    vi.useFakeTimers();
    loginMock.mockImplementation(
      (_email: string, _password: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('Request aborted'));
            },
            { once: true },
          );
        }),
    );
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Sign-in is taking longer than expected. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect((loginMock.mock.calls[0][2] as { signal?: AbortSignal }).signal?.aborted).toBe(true);
  });
});
