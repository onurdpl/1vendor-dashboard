import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setCurrentVendorId, setToken } from './lib/auth';
import { login, me, probePublicLoginReadiness } from './services/backend-auth';

describe('backend auth client diagnostics', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 'user-1',
            email: 'vendor@example.com',
            name: 'Vendor User',
            role: 'vendor',
            status: 'active',
            vendorAccess: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
          },
          csrfToken: 'csrf-token',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends a safe auth attempt id header without changing the login body', async () => {
    setToken('stale-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['yalispor', 'sporjinal'],
      vendorDetails: [
        { vendorId: 'yalispor', vendorName: 'Yalı Spor' },
        { vendorId: 'sporjinal', vendorName: 'Sporjinal' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'yalispor',
    });
    setCurrentVendorId('sporjinal');

    await login('vendor@example.com', 'demo123', {
      authAttemptId: 'auth-test123',
      authFlowId: 'auth-flow123',
      authRequestId: 'req-login123',
    });

    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    const headers = (init as RequestInit).headers as Headers;

    expect(headers.get('X-Auth-Attempt-Id')).toBe('auth-test123');
    expect(headers.get('X-Auth-Flow-Id')).toBe('auth-flow123');
    expect(headers.get('X-Auth-Request-Id')).toBe('req-login123');
    expect(headers.get('X-Vendor-Id')).toBeNull();
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'vendor@example.com',
      password: 'demo123',
    });
  });

  it('sends auth attempt id on public login readiness probe without exposing cookies or secrets', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          status: 'ready',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const result = await probePublicLoginReadiness({
      authAttemptId: 'auth-probe123',
      authFlowId: 'auth-flow123',
      authRequestId: 'req-ready123',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      response: {
        ok: true,
        status: 'ready',
      },
    });
    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    const headers = new Headers((init as RequestInit).headers);

    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/auth/diagnostics/public-login-readiness');
    expect((init as RequestInit).credentials).toBe('same-origin');
    expect(headers.get('X-Auth-Attempt-Id')).toBe('auth-probe123');
    expect(headers.get('X-Auth-Flow-Id')).toBe('auth-flow123');
    expect(headers.get('X-Auth-Request-Id')).toBe('req-ready123');
    expect(JSON.stringify(init)).not.toContain('sporgym_session=');
    expect(JSON.stringify(init)).not.toContain('csrf-token');
  });

  it('sends restore attempt id on /auth/me without exposing session material', async () => {
    await me({
      authAttemptId: 'restore-test123',
      authFlowId: 'restore-flow123',
      authRequestId: 'req-restore123',
    });

    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    const headers = new Headers((init as RequestInit).headers);

    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/auth/me');
    expect((init as RequestInit).credentials).toBe('same-origin');
    expect(headers.get('X-Auth-Attempt-Id')).toBe('restore-test123');
    expect(headers.get('X-Auth-Flow-Id')).toBe('restore-flow123');
    expect(headers.get('X-Auth-Request-Id')).toBe('req-restore123');
    expect(JSON.stringify(init)).not.toContain('sporgym_session=');
    expect(JSON.stringify(init)).not.toContain('csrf-token');
  });
});
