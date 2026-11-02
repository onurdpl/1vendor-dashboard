import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';
import { getCurrentUser, markAuthConfirmed, setSession, type CurrentUser } from './auth';
import { getAuthRestoreSnapshot, isAuthConfirmationCurrent } from './auth/restoreState';
import { publishSessionTransition, readSessionTransition } from './auth/sessionTransition';
import { queryClient } from './api/queryClient';
import { queryKeys } from './api/queryKeys';
import { useAppReadiness } from './appReadiness';

const meMock = vi.hoisted(() => vi.fn());
vi.mock('../config/runtime', () => ({
  runtimeConfig: { apiMode: 'real', appEnvironment: 'production', apiBaseUrl: '/api' },
}));
vi.mock('../services/runtime-services', () => ({
  runtimeServices: { auth: { me: meMock } },
}));

const admin: CurrentUser = {
  email: 'admin@example.com', name: 'Admin', role: 'admin',
  vendorAccess: ['vendor-a'], canSwitchVendors: false, defaultVendorId: 'vendor-a',
};
const vendorB: CurrentUser = {
  email: 'vendor-b@example.com', name: 'Vendor B', role: 'vendor',
  vendorAccess: ['vendor-a'], canSwitchVendors: false, defaultVendorId: 'vendor-a',
};
const vendorC: CurrentUser = {
  email: 'vendor-c@example.com', name: 'Vendor C', role: 'vendor',
  vendorAccess: ['vendor-c'], canSwitchVendors: false, defaultVendorId: 'vendor-c',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function ProtectedPage() {
  const readiness = useAppReadiness();
  return <div data-testid="protected-page">{getCurrentUser()?.email} — {String(readiness.sessionReady)}</div>;
}

function renderGuard() {
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/orders" element={<ProtectedPage />} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function seedAdmin() {
  setSession(null, admin);
  publishSessionTransition('login');
  markAuthConfirmed();
}

function dispatchUser(user: CurrentUser | null) {
  if (user) window.localStorage.setItem('vendor-dashboard.current-user', JSON.stringify(user));
  else window.localStorage.removeItem('vendor-dashboard.current-user');
  window.dispatchEvent(new StorageEvent('storage', { key: 'vendor-dashboard.current-user', newValue: user ? JSON.stringify(user) : null }));
}

function dispatchTransition(kind: 'login' | 'logout') {
  const transition = publishSessionTransition(kind);
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'vendor-dashboard.session-transition', newValue: JSON.stringify(transition),
  }));
  return transition;
}

beforeEach(() => {
  window.localStorage.clear();
  queryClient.clear();
  meMock.mockReset();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('cross-tab authentication confirmation', () => {
  it.each([
    ['same Vendor', vendorB],
    ['different Vendor', vendorC],
  ])('blocks Admin cache and confirms %s account only after /auth/me', async (_label, nextUser) => {
    const restore = deferred<CurrentUser>();
    meMock.mockReturnValueOnce(restore.promise);
    seedAdmin();
    const oldKey = queryKeys.orders.detail('admin-order', 'vendor-a');
    queryClient.setQueryData(oldKey, { allocationFinanceSummary: 'admin-only' });
    renderGuard();
    expect(screen.getByTestId('protected-page')).toHaveTextContent('admin@example.com — true');
    expect(meMock).not.toHaveBeenCalled();

    act(() => { dispatchUser(nextUser); });
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();
    expect(isAuthConfirmationCurrent()).toBe(false);
    expect(queryClient.getQueryData(oldKey)).toBeUndefined();
    act(() => { dispatchTransition('login'); });
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();

    await act(async () => { restore.resolve(nextUser); });
    expect(screen.getByTestId('protected-page')).toHaveTextContent(`${nextUser.email} — true`);
    expect(isAuthConfirmationCurrent()).toBe(true);
    expect(queryClient.getQueryData(oldKey)).toBeUndefined();
  });

  it('fails closed on a cross-tab logout without restoring an absent session', () => {
    seedAdmin();
    renderGuard();
    act(() => { dispatchUser(null); dispatchTransition('logout'); });
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();
    expect(getAuthRestoreSnapshot().authConfirmed).toBe(false);
    expect(meMock).not.toHaveBeenCalled();
  });

  it('also fails closed when a backend 401 removes the cached user in another tab', () => {
    seedAdmin();
    renderGuard();
    act(() => { dispatchUser(null); });
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(getAuthRestoreSnapshot().authConfirmed).toBe(false);
    expect(meMock).not.toHaveBeenCalled();
  });

  it('does not repopulate the new account cache from an old pending query', async () => {
    const restore = deferred<CurrentUser>();
    const oldQuery = deferred<{ owner: string }>();
    meMock.mockReturnValueOnce(restore.promise);
    seedAdmin();
    renderGuard();
    const key = queryKeys.orders.detail('shared-order', 'vendor-a');
    void queryClient.fetchQuery({ queryKey: key, queryFn: () => oldQuery.promise }).catch(() => undefined);

    act(() => { dispatchUser(vendorB); dispatchTransition('login'); });
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    await act(async () => { restore.resolve(vendorB); });
    await act(async () => { oldQuery.resolve({ owner: admin.email }); });

    expect(screen.getByTestId('protected-page')).toHaveTextContent('vendor-b@example.com — true');
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });

  it('requires a new confirmation for the same user with a new session generation', async () => {
    const restore = deferred<CurrentUser>();
    meMock.mockReturnValueOnce(restore.promise);
    seedAdmin();
    const oldId = readSessionTransition()?.id;
    renderGuard();
    act(() => { dispatchTransition('login'); });
    expect(readSessionTransition()?.id).not.toBe(oldId);
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    await act(async () => { restore.resolve(admin); });
    expect(screen.getByTestId('protected-page')).toHaveTextContent('admin@example.com — true');
  });

  it('ignores duplicate signals and an older restore response after a newer transition', async () => {
    const oldRestore = deferred<CurrentUser>();
    const newRestore = deferred<CurrentUser>();
    meMock.mockReturnValueOnce(oldRestore.promise).mockReturnValueOnce(newRestore.promise);
    seedAdmin();
    renderGuard();
    act(() => { dispatchUser(vendorB); });
    const firstSignal = dispatchTransition('login');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'vendor-dashboard.session-transition', newValue: JSON.stringify(firstSignal),
      }));
    });
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));

    act(() => { dispatchUser(vendorC); dispatchTransition('login'); });
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(2));
    await act(async () => { oldRestore.resolve(vendorB); });
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();
    await act(async () => { newRestore.resolve(vendorC); });
    expect(screen.getByTestId('protected-page')).toHaveTextContent('vendor-c@example.com — true');
  });
});
