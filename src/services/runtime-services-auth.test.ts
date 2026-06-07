import { afterEach, describe, expect, it, vi } from 'vitest';

const backendLoginMock = vi.hoisted(() => vi.fn());
const backendMeMock = vi.hoisted(() => vi.fn());

describe('runtimeServices real-mode auth', () => {
  afterEach(() => {
    vi.doUnmock('../config/runtime');
    vi.doUnmock('./backend-auth');
    vi.resetModules();
  });

  it('uses the cookie-session login response without requiring a JSON token or duplicate /auth/me call', async () => {
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    vi.doMock('./backend-auth', () => ({
      login: backendLoginMock,
      me: backendMeMock,
      logout: vi.fn(),
    }));
    backendLoginMock.mockResolvedValueOnce({
      user: {
        email: 'login-response@example.com',
        name: 'Login Response',
        role: 'vendor',
        status: 'active',
        vendorAccess: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      },
    });
    backendMeMock.mockResolvedValueOnce({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      status: 'active',
      vendorAccess: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
    });

    const { runtimeServices } = await import('./runtime-services');
    const result = await runtimeServices.auth.login('vendor@example.com', 'demo123', {
      authAttemptId: 'auth-test123',
    });

    expect(backendLoginMock).toHaveBeenCalledWith('vendor@example.com', 'demo123', {
      authAttemptId: 'auth-test123',
      signal: undefined,
    });
    expect(backendMeMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      token: null,
      user: expect.objectContaining({
        email: 'login-response@example.com',
        name: 'Login Response',
        role: 'vendor',
        vendorAccess: ['sporjinal'],
        defaultVendorId: 'sporjinal',
      }),
    });
  });
});
