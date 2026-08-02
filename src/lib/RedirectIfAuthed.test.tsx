import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeConfig } from '../config/runtime';
import { ApiError } from './api/errors';
import {
  clearAuthRestoreState,
  getAuthRestoreSnapshot,
  getCurrentUser,
  setCurrentUser,
  type CurrentUser,
} from './auth';
import { RedirectIfAuthed } from './RedirectIfAuthed';

const meMock = vi.hoisted(() => vi.fn());

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    auth: {
      me: meMock,
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

function makeDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function RouteProbe() {
  const location = useLocation();
  return <span data-testid="current-route">{location.pathname}</span>;
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route element={<RedirectIfAuthed />}>
          <Route path="/login" element={<button type="button">Login form</button>} />
        </Route>
        <Route path="/" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RedirectIfAuthed', () => {
  const originalApiMode = runtimeConfig.apiMode;

  beforeEach(() => {
    window.localStorage.clear();
    clearAuthRestoreState();
    meMock.mockReset();
    Object.assign(runtimeConfig, { apiMode: 'real' });
  });

  afterEach(() => {
    cleanup();
    Object.assign(runtimeConfig, { apiMode: originalApiMode });
    clearAuthRestoreState();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('redirects a cached user immediately without an unnecessary restore', async () => {
    setCurrentUser(testUser);

    renderGuard();

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/');
    expect(meMock).not.toHaveBeenCalled();
  });

  it('restores a cookie-only session before exposing the login form', async () => {
    const restore = makeDeferred<CurrentUser>();
    meMock.mockReturnValueOnce(restore.promise);

    renderGuard();

    expect(document.querySelector('.auth-page')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Checking your session')).not.toBeInTheDocument();
    expect(screen.queryByText('We are confirming your session before showing sign in.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login form' })).not.toBeInTheDocument();
    expect(meMock).toHaveBeenCalledWith(expect.objectContaining({
      authAttemptId: expect.stringMatching(/^restore-/),
      authFlowId: expect.stringMatching(/^restore-/),
      authRequestId: expect.stringMatching(/^req-/),
      signal: expect.any(AbortSignal),
    }));

    await act(async () => {
      restore.resolve(testUser);
    });

    await waitFor(() => expect(screen.getByTestId('current-route')).toHaveTextContent('/'));
    expect(getCurrentUser()).toEqual(testUser);
    expect(getAuthRestoreSnapshot()).toMatchObject({
      phase: 'confirmed',
      authConfirmed: true,
    });
    expect(screen.queryByRole('button', { name: 'Login form' })).not.toBeInTheDocument();
  });

  it.each([
    new ApiError('Unauthorized request.', 'unauthorized', { status: 401 }),
    new ApiError('Forbidden.', 'server', { status: 403 }),
  ])('renders login without a redirect loop after an authoritative rejection', async (error) => {
    meMock.mockRejectedValueOnce(error);

    renderGuard();

    expect(await screen.findByRole('button', { name: 'Login form' })).toBeInTheDocument();
    expect(screen.queryByText('Session restore needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Retry sign in')).not.toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it('falls back silently within two seconds when the restore request times out', async () => {
    vi.useFakeTimers();
    const restore = makeDeferred<CurrentUser>();
    meMock.mockReturnValueOnce(restore.promise);

    renderGuard();

    expect(meMock).toHaveBeenCalledTimes(1);
    const signal = (meMock.mock.calls[0]?.[0] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(screen.getByRole('button', { name: 'Login form' })).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Session restore needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Retry sign in')).not.toBeInTheDocument();
  });

  it('ignores a late restore success after the two-second fallback', async () => {
    vi.useFakeTimers();
    const restore = makeDeferred<CurrentUser>();
    meMock.mockReturnValueOnce(restore.promise);

    renderGuard();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByRole('button', { name: 'Login form' })).toBeInTheDocument();

    await act(async () => {
      restore.resolve(testUser);
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Login form' })).toBeInTheDocument();
    expect(screen.queryByTestId('current-route')).not.toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getAuthRestoreSnapshot().authConfirmed).toBe(false);
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it('aborts its owned request and ignores a result that resolves after unmount', async () => {
    const restore = makeDeferred<CurrentUser>();
    meMock.mockReturnValueOnce(restore.promise);
    const view = renderGuard();

    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    const signal = (meMock.mock.calls[0]?.[0] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(false);

    view.unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      restore.resolve(testUser);
    });

    expect(getCurrentUser()).toBeNull();
    expect(getAuthRestoreSnapshot().authConfirmed).toBe(false);
  });

  it('falls back silently after a transport failure without retrying restore', async () => {
    meMock.mockRejectedValue(new ApiError('Unable to reach backend.', 'network'));

    renderGuard();

    expect(await screen.findByRole('button', { name: 'Login form' })).toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Session restore needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Retry sign in')).not.toBeInTheDocument();
  });
});
