import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  cleanup();
  vi.doUnmock('../config/runtime');
  vi.doUnmock('../services/runtime-services');
  vi.resetModules();
  window.localStorage.clear();
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
    let resolveMe: (() => void) | null = null;
    const meMock = vi.fn(() => new Promise<void>((resolve) => {
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
      resolveMe?.();
    });

    expect(screen.getByText('Orders workspace')).toBeInTheDocument();
  });

  it('redirects real-mode sessions to login when /auth/me cannot restore the cookie session', async () => {
    vi.resetModules();
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    const meMock = vi.fn().mockRejectedValue(new Error('Unauthorized request.'));
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
});
