import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../lib/RequireAuth';
import { ApiError } from '../lib/api/errors';
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
      token: null,
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
    expect(window.localStorage.getItem('vendor-dashboard.session-token')).toBeNull();
    expect(loginMock).toHaveBeenCalledWith(
      'vendor@example.com',
      'demo123',
      expect.objectContaining({
        authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('sporjinal');
  });

  it('returns to the intended deep route with hash after login', async () => {
    seedSession();

    render(
      <MemoryRouter initialEntries={['/orders/alloc-yalispor-7709129507153#provider-response-summary']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route
              path="/orders/:orderId"
              element={
                <>
                  <div>Order detail</div>
                  <RouteProbe />
                </>
              }
            />
          </Route>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Order detail')).toBeInTheDocument();

    await act(async () => {
      clearToken({
        reason: 'expired',
        intendedPath: '/orders/alloc-yalispor-7709129507153#provider-response-summary',
      });
    });

    expect(screen.getByText(EXPIRED_SESSION_MESSAGE)).toBeInTheDocument();

    fillAndSubmitLogin();

    expect(await screen.findByText('Order detail')).toBeInTheDocument();
    expect(screen.getByTestId('current-route')).toHaveTextContent(
      '/orders/alloc-yalispor-7709129507153#provider-response-summary',
    );
  });

  it('shows invalid credential errors without changing the login flow', async () => {
    loginMock.mockRejectedValueOnce(new Error('Invalid email or password.'));
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByText('Sign-in is taking longer than expected. Please try again.')).not.toBeInTheDocument();
  });

  it('shows the retry window when login is temporarily rate limited', async () => {
    loginMock.mockRejectedValueOnce(new ApiError('Too many login attempts. Please try again later.', 'server', {
      status: 429,
      details: {
        message: 'Too many login attempts. Please try again later.',
        retryAfterSeconds: 600,
        retryAt: '2026-06-12T10:10:00.000Z',
      },
    }));
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByText('Too many login attempts. Please try again in 10 minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('logs safe POST dispatch diagnostics without credentials', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/');
    const events = debugSpy.mock.calls
      .map((call) => call[1])
      .filter((entry): entry is { event?: string; authAttemptId?: string } => Boolean(entry) && typeof entry === 'object');

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'auth request start', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'fetch dispatch started', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'fetch promise created', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'fetch resolved', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'response parsed', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'auth request completed', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'setSession completed', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'vendor selected', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ event: 'navigate called', authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
      ]),
    );
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('vendor@example.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('demo123');

    debugSpy.mockRestore();
  });

  it('clears the login timeout after a successful backend response', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/');

    const events = debugSpy.mock.calls.map((call) => (call[1] as { event?: string })?.event);
    expect(events).toContain('fetch resolved');
    expect(events).toContain('response parsed');
    expect(events).toContain('navigate called');
    expect(events).not.toContain('auth timeout triggered');
    expect(events).not.toContain('abort fired');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(screen.queryByText(/^Sign-in is taking longer than expected/)).not.toBeInTheDocument();

    clearTimeoutSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('does not report a timeout when local session setup fails after backend success', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    loginMock.mockResolvedValueOnce({
      token: null,
      user: {
        ...testUser,
        name: BigInt(1) as unknown as string,
      },
    });
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByText(/serialize a BigInt/i)).toBeInTheDocument();

    const events = debugSpy.mock.calls.map((call) => (call[1] as { event?: string })?.event);
    expect(events).toContain('fetch resolved');
    expect(events).toContain('response parsed');
    expect(events).toContain('post-response failed');
    expect(events).not.toContain('auth timeout triggered');
    expect(events).not.toContain('abort fired');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(screen.queryByText(/^Sign-in is taking longer than expected/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();

    clearTimeoutSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('aborts a hanging login request and shows a retryable timeout error', async () => {
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
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

    expect(
      screen.getByText(/^Sign-in is taking longer than expected\. Please try again\. Reference: auth-[a-z0-9]{10}$/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect((loginMock.mock.calls[0][2] as { signal?: AbortSignal }).signal?.aborted).toBe(true);
    expect((loginMock.mock.calls[0][2] as { authAttemptId?: string }).authAttemptId).toEqual(
      expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
    );
    expect(debugSpy.mock.calls.map((call) => (call[1] as { event?: string })?.event)).toEqual(
      expect.arrayContaining(['auth timeout triggered', 'abort fired', 'fetch rejected', 'auth request completed']),
    );
    debugSpy.mockRestore();
  });
});
