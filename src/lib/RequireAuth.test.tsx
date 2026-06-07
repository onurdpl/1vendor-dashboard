import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';
import { clearToken, setCurrentUser, setToken } from './auth';
import { ApiError } from './api/errors';

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

function buildTestUser() {
  return {
    email: 'vendor@example.com',
    name: 'Vendor User',
    role: 'vendor' as const,
    vendorAccess: ['sporjinal'],
    vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
    canSwitchVendors: false,
    defaultVendorId: 'sporjinal',
  };
}

function RouteProbe() {
  const location = useLocation();
  const params = useParams();
  return (
    <div>
      <span data-testid="current-route">{`${location.pathname}${location.search}${location.hash}`}</span>
      {params.orderId ? <span data-testid="order-id">{params.orderId}</span> : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.doUnmock('../config/runtime');
  vi.doUnmock('../services/runtime-services');
  vi.resetModules();
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

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

  it('does not render protected routes in real mode until /auth/me restores the cookie session', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    let resolveMe: ((user: ReturnType<typeof buildTestUser>) => void) | null = null;
    const meMock = vi.fn(() => new Promise<ReturnType<typeof buildTestUser>>((resolve) => {
      resolveMe = resolve;
    }));
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
    }));
    const [{ RequireAuth: RealModeRequireAuth }, auth] = await Promise.all([
      import('./RequireAuth'),
      import('./auth'),
    ]);
    auth.setCurrentUser(buildTestUser());

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders" element={<div>Orders workspace</div>} />
          </Route>
          <Route path="/login" element={<div>Login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Restoring session...');
    expect(screen.queryByText('Orders workspace')).not.toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMe?.(buildTestUser());
    });

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();
    expect(auth.getCurrentUser()?.email).toBe('vendor@example.com');
  });

  it('restores a real-mode cookie session on a hard refresh normal route without local user state', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi.fn().mockResolvedValue(buildTestUser());
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
    }));
    const { RequireAuth: RealModeRequireAuth } = await import('./RequireAuth');

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders" element={<div>Orders workspace</div>} />
          </Route>
          <Route path="/login" element={<div>Login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Restoring session...');
    await waitFor(() => expect(screen.getByText('Orders workspace')).toBeInTheDocument());
    expect(meMock).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
  });

  it('preserves a deep order URL after real-mode session restore', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi.fn().mockResolvedValue(buildTestUser());
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
    }));
    const { RequireAuth: RealModeRequireAuth } = await import('./RequireAuth');

    render(
      <MemoryRouter initialEntries={['/orders/alloc-yalispor-7709129507153']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders/:orderId" element={<RouteProbe />} />
          </Route>
          <Route path="/login" element={<div>Login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/orders/alloc-yalispor-7709129507153');
    expect(screen.getByTestId('order-id')).toHaveTextContent('alloc-yalispor-7709129507153');
  });

  it('preserves a hash fragment after real-mode session restore', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi.fn().mockResolvedValue(buildTestUser());
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
    }));
    const { RequireAuth: RealModeRequireAuth } = await import('./RequireAuth');

    render(
      <MemoryRouter initialEntries={['/orders/alloc-yalispor-7709129507153#provider-response-summary']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders/:orderId" element={<RouteProbe />} />
          </Route>
          <Route path="/login" element={<div>Login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('current-route')).toHaveTextContent(
      '/orders/alloc-yalispor-7709129507153#provider-response-summary',
    );
  });

  it('redirects real-mode sessions to login when /auth/me cannot restore the cookie session', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi.fn().mockRejectedValue(new ApiError('Unauthorized request.', 'unauthorized', { status: 401 }));
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
    }));
    const [{ RequireAuth: RealModeRequireAuth }, auth] = await Promise.all([
      import('./RequireAuth'),
      import('./auth'),
    ]);
    auth.setCurrentUser(buildTestUser());

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders" element={<div>Orders workspace</div>} />
          </Route>
          <Route path="/login" element={<div>Login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Orders workspace')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it('does not hang forever or mark the session expired when real-mode session restore times out', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi.fn(() => new Promise<never>(() => undefined));
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
    }));
    const [{ RequireAuth: RealModeRequireAuth }, auth] = await Promise.all([
      import('./RequireAuth'),
      import('./auth'),
    ]);
    window.history.replaceState({}, '', '/orders/alloc-yalispor-7709129507153#provider-response-summary');

    render(
      <MemoryRouter initialEntries={['/orders/alloc-yalispor-7709129507153#provider-response-summary']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders/:orderId" element={<div>Order detail</div>} />
          </Route>
          <Route path="/login" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Restoring session...');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Session restore needs attention'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeEnabled();
    expect(auth.peekExpiredSessionNotice()).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retries a timed-out real-mode restore and preserves the deep link hash', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
      .mockResolvedValueOnce(buildTestUser());
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
    }));
    const { RequireAuth: RealModeRequireAuth } = await import('./RequireAuth');
    window.history.replaceState({}, '', '/orders/alloc-yalispor-7709129507153#provider-response-summary');

    render(
      <MemoryRouter initialEntries={['/orders/alloc-yalispor-7709129507153#provider-response-summary']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders/:orderId" element={<RouteProbe />} />
          </Route>
          <Route path="/login" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Session restore needs attention'));

    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });

    expect(await screen.findByTestId('current-route')).toHaveTextContent(
      '/orders/alloc-yalispor-7709129507153#provider-response-summary',
    );
    expect(meMock).toHaveBeenCalledTimes(2);
  });
});
