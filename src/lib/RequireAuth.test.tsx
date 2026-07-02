import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';
import { clearAuthRestoreState, clearToken, setCurrentUser, setToken } from './auth';
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

function makeDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.doUnmock('../config/runtime');
  vi.doUnmock('../services/runtime-services');
  vi.resetModules();
  vi.useRealTimers();
  clearAuthRestoreState();
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

  it('renders cached shell immediately in real mode while protected data stays locked until /auth/me confirms', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
      },
    }));
    const deferred = makeDeferred<ReturnType<typeof buildTestUser>>();
    const meMock = vi.fn(() => deferred.promise);
    vi.doMock('../services/runtime-services', () => ({
      runtimeServices: {
        auth: {
          me: meMock,
        },
      },
	    }));
    const [{ RequireAuth: RealModeRequireAuth }, auth, appReadiness] = await Promise.all([
      import('./RequireAuth'),
      import('./auth'),
      import('./appReadiness'),
    ]);
    const protectedLoader = vi.fn();
    function DataGateProbe() {
      const readiness = appReadiness.useAppReadiness();
      useEffect(() => {
        if (readiness.ready) {
          protectedLoader();
        }
      }, [readiness.ready]);
      return (
        <div>
          <span>Shell frame</span>
          <span>{readiness.ready ? 'Protected data unlocked' : 'Protected data locked'}</span>
        </div>
      );
    }
    auth.setCurrentUser(buildTestUser());
    window.history.replaceState({}, '', '/orders');

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders" element={<DataGateProbe />} />
          </Route>
          <Route path="/login" element={<div>Login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Shell frame')).toBeInTheDocument();
    expect(screen.getByText('Protected data locked')).toBeInTheDocument();
    expect(protectedLoader).not.toHaveBeenCalled();
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(meMock).toHaveBeenCalledWith({
      authAttemptId: expect.stringMatching(/^restore-/),
      signal: expect.any(AbortSignal),
    });

    await act(async () => {
      deferred.resolve(buildTestUser());
    });

    await waitFor(() => expect(screen.getByText('Protected data unlocked')).toBeInTheDocument());
    expect(protectedLoader).toHaveBeenCalledTimes(1);
    expect(auth.getCurrentUser()?.email).toBe('vendor@example.com');
  });

  it('restores a real-mode cookie session on a hard refresh normal route without local user state', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
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

    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    await waitFor(() => expect(screen.getByText('Orders workspace')).toBeInTheDocument());
    expect(meMock).toHaveBeenCalledWith({
      authAttemptId: expect.stringMatching(/^restore-/),
      signal: expect.any(AbortSignal),
    });
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
    window.history.replaceState({}, '', '/orders');

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

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(auth.getCurrentUser()).toBeNull();
    expect(screen.queryByText('Orders workspace')).not.toBeInTheDocument();
  });

  it('redirects real-mode sessions to login when /auth/me returns forbidden for a stale local user', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi.fn().mockRejectedValue(new ApiError('Forbidden.', 'server', { status: 403 }));
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
    window.history.replaceState({}, '', '/orders');

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

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(auth.getCurrentUser()).toBeNull();
    expect(screen.queryByText('Orders workspace')).not.toBeInTheDocument();
  });

  it('recovers when the first real-mode session restore has a network failure and retry succeeds', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Unable to reach backend.', 'network'))
      .mockResolvedValueOnce(buildTestUser());
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

    expect(await screen.findByText('Orders workspace')).toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers when the first real-mode session restore has a non-401 server failure and retry succeeds', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Backend request failed.', 'server', { status: 500 }))
      .mockResolvedValueOnce(buildTestUser());
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

    expect(await screen.findByText('Orders workspace')).toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('redirects to login when a transient restore failure is followed by a 401 retry', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Unable to reach backend.', 'network'))
      .mockRejectedValueOnce(new ApiError('Unauthorized request.', 'unauthorized', { status: 401 }));
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
    window.history.replaceState({}, '', '/orders');

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

    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(meMock).toHaveBeenCalledTimes(2);
    expect(auth.peekExpiredSessionNotice()).toMatchObject({
      intendedPath: '/orders',
    });
  });

  it('shows restore attention after one automatic retry fails with another non-401 error', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Unable to reach backend.', 'network'))
      .mockRejectedValueOnce(new ApiError('Backend request failed.', 'server', { status: 500 }));
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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Session restore needs attention'));
    expect(meMock).toHaveBeenCalledTimes(2);
    expect(auth.peekExpiredSessionNotice()).toBeNull();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry sign in' })).toBeEnabled();
  });

  it('clears auth state and navigates to login when retry sign in is selected after restore failure', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
      },
    }));
    const meMock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Unable to reach backend.', 'network'))
      .mockRejectedValueOnce(new ApiError('Backend request failed.', 'server', { status: 500 }));
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

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route element={<RealModeRequireAuth />}>
            <Route path="/orders" element={<div>Orders workspace</div>} />
          </Route>
          <Route path="/login" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Session restore needs attention'));
    expect(meMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Retry sign in' }));

    await waitFor(() => expect(screen.getByTestId('current-route')).toHaveTextContent('/login'));
    expect(auth.getCurrentUser()).toBeNull();
    expect(auth.getToken()).toBeNull();
    expect(meMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Orders workspace')).not.toBeInTheDocument();
  });

  it('does not hang forever or mark the session expired when real-mode session restore and one recovery retry time out', async () => {
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

    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Session restore needs attention'));
    expect(screen.getByRole('button', { name: 'Retry sign in' })).toBeEnabled();
    expect(auth.peekExpiredSessionNotice()).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(2);
  });

  it('automatically retries a timed-out real-mode restore and preserves the deep link hash', async () => {
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

    expect(await screen.findByTestId('current-route')).toHaveTextContent(
      '/orders/alloc-yalispor-7709129507153#provider-response-summary',
    );
    expect(meMock).toHaveBeenCalledTimes(2);
  });

  it('ignores stale restore results after a newer retry succeeds', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
      },
    }));
    const firstRestore = makeDeferred<ReturnType<typeof buildTestUser>>();
    const secondRestore = makeDeferred<ReturnType<typeof buildTestUser>>();
    const meMock = vi
      .fn()
      .mockImplementationOnce(() => firstRestore.promise)
      .mockImplementationOnce(() => secondRestore.promise);
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
    window.history.replaceState({}, '', '/orders');

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

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      auth.requestAuthRestoreRetry();
    });
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondRestore.resolve(buildTestUser());
    });
    await waitFor(() => expect(screen.getByText('Orders workspace')).toBeInTheDocument());
    expect(auth.getAuthRestoreSnapshot().authConfirmed).toBe(true);

    await act(async () => {
      firstRestore.reject(new ApiError('Unauthorized request.', 'unauthorized', { status: 401 }));
    });

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(auth.getAuthRestoreSnapshot().authConfirmed).toBe(true);
  });
});
