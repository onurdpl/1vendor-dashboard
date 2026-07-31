import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';
import { EXPIRED_SESSION_MESSAGE, getCurrentUser, getToken, peekExpiredSessionNotice, setCurrentUser, setCurrentVendorId, setToken } from './auth';
import { ApiError } from './api/errors';

describe('apiClient vendor-scoped headers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends the explicit selected vendor header with admin requests', async () => {
    await apiClient.get('/orders', { vendorId: 'demo-vendor-b' });

    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/orders');
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.get('X-Vendor-Id')).toBe('demo-vendor-b');
  });

  it('falls back to the hydrated current vendor when no explicit vendor is provided', async () => {
    setCurrentVendorId('demo-vendor-a');

    await apiClient.get('/finance');

    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(headers.get('X-Vendor-Id')).toBe('demo-vendor-a');
  });

  it('can explicitly skip vendor context for pre-auth requests', async () => {
    setCurrentVendorId('demo-vendor-a');

    await apiClient.post('/auth/login', { email: 'redacted@example.com' }, { skipVendorContext: true });

    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(headers.get('X-Vendor-Id')).toBeNull();
    expect(headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('clears stale session state when the backend rejects the token', async () => {
    window.history.pushState({}, '', '/orders?status=open#row-1029');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-expired-1' },
    }));

    await expect(apiClient.get('/orders', { vendorId: 'demo-vendor-a' })).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
      diagnostics: {
        endpoint: '/orders',
        status: 401,
        requestId: 'req-expired-1',
        hasAuthHeader: true,
        hasVendorHeader: true,
        selectedVendorPresent: true,
        readinessState: 'ready',
      },
    } satisfies Partial<ApiError>);

    expect(getToken()).toBeNull();
    expect(getCurrentUser()).toBeNull();
    expect(peekExpiredSessionNotice()).toEqual({
      message: EXPIRED_SESSION_MESSAGE,
      intendedPath: '/orders?status=open#row-1029',
    });
  });

  it('adds safe diagnostics to permission failures without exposing token values', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Forbidden', requestId: 'body-req' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'header-req' },
    }));

    let caught: unknown;
    try {
      await apiClient.get('/orders?search=customer-name', { vendorId: 'demo-vendor-a' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      message: 'You do not have access to this workspace.',
      kind: 'server',
      status: 403,
      diagnostics: {
        endpoint: '/orders',
        status: 403,
        requestId: 'header-req',
        hasAuthHeader: true,
        hasVendorHeader: true,
        selectedVendorPresent: true,
        readinessState: 'ready',
      },
    } satisfies Partial<ApiError>);
    expect(JSON.stringify((caught as ApiError).diagnostics)).not.toContain('test-token');
    expect(JSON.stringify((caught as ApiError).diagnostics)).not.toContain('demo-vendor-a');
  });
});

describe('apiClient real-mode cookie auth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses cookies and CSRF without attaching a localStorage bearer token in real mode', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com');
    window.localStorage.clear();
    setToken('stale-local-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-from-cookie-session' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient: realApiClient } = await import('./api-client');
    await realApiClient.post('/returns/return-1/review', { decision: 'approved' });

    const csrfInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const postInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = postInit.headers as Headers;

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://backend.example.com/auth/csrf');
    expect(csrfInit.credentials).toBe('include');
    expect(postInit.credentials).toBe('include');
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-CSRF-Token')).toBe('csrf-from-cookie-session');
    expect(window.localStorage.getItem('vendor-dashboard.session-token')).toBe('stale-local-token');
  });

  it('builds same-origin /api URLs for auth, admin, and returns requests in real mode', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    window.localStorage.clear();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-from-cookie-session' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          email: 'admin@demo.com',
          name: 'Demo Admin',
          role: 'admin',
          vendorAccess: [],
        },
        csrfToken: 'csrf-from-cookie-session',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          email: 'admin@demo.com',
          name: 'Demo Admin',
          role: 'admin',
          vendorAccess: [],
        },
        csrfToken: 'csrf-from-cookie-session',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient: sameOriginApiClient, buildApiUrl } = await import('./api-client');

    expect(buildApiUrl('/auth/me')).toBe('/api/auth/me');
    expect(buildApiUrl('auth/login')).toBe('/api/auth/login');
    expect(buildApiUrl('/admin/operations/summary')).toBe('/api/admin/operations/summary');
    expect(buildApiUrl('/returns?workflow=pending-review')).toBe('/api/returns?workflow=pending-review');

    await sameOriginApiClient.post('/returns/return-1/review', { decision: 'approved' });
    await sameOriginApiClient.post('/auth/login', { email: 'admin@demo.com', password: 'demo123' }, {
      skipVendorContext: true,
    });
    await sameOriginApiClient.get('/auth/me', { vendorId: null });
    await sameOriginApiClient.get('/admin/operations/summary');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/auth/csrf',
      '/api/returns/return-1/review',
      '/api/auth/login',
      '/api/auth/me',
      '/api/admin/operations/summary',
    ]);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).credentials).toBe('include');
  });

  it('sends login to the configured backend origin with credentials included', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com');
    window.localStorage.clear();

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      user: {
        email: 'admin@demo.com',
        name: 'Demo Admin',
        role: 'admin',
        vendorAccess: [],
      },
      csrfToken: 'csrf-from-cookie-session',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient: realApiClient } = await import('./api-client');
    await realApiClient.post('/auth/login', { email: 'admin@demo.com', password: 'demo123' }, {
      skipVendorContext: true,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://backend.example.com/auth/login');
    expect(init.credentials).toBe('include');
    expect(headers.get('Authorization')).toBeNull();
  });

  it('records real login fetch-boundary diagnostics while preserving the login request contract', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    window.localStorage.clear();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      user: {
        email: 'admin@demo.com',
        name: 'Demo Admin',
        role: 'admin',
        vendorAccess: [],
      },
      csrfToken: 'csrf-from-cookie-session',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient: realApiClient } = await import('./api-client');
    await realApiClient.post('/auth/login', { email: 'admin@demo.com', password: 'demo123' }, {
      headers: {
        'X-Auth-Attempt-Id': 'auth-test123',
        'X-Auth-Flow-Id': 'auth-flow123',
        'X-Auth-Request-Id': 'req-login123',
      },
      skipVendorContext: true,
      authStartedAtMs: Date.now() - 50,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Headers;
    expect(url).toBe('/api/auth/login');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'admin@demo.com',
      password: 'demo123',
    });
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Auth-Flow-Id')).toBe('auth-flow123');

    const events = debugSpy.mock.calls
      .map((call) => call[1])
      .filter((entry): entry is { operation?: string; httpStatus?: number; targetOrigin?: string; targetPathname?: string } =>
        Boolean(entry) && typeof entry === 'object');
    expect(events.map((event) => event.operation).filter((operation) =>
      operation?.startsWith('AUTH_LOGIN') || operation === 'AUTH_API_CLIENT_LOGIN_POST_ENTER',
    )).toEqual([
      'AUTH_API_CLIENT_LOGIN_POST_ENTER',
      'AUTH_LOGIN_BUILD_API_URL_COMPLETE',
      'AUTH_LOGIN_FETCH_CALL_ENTER',
      'AUTH_LOGIN_FETCH_PROMISE_CREATED',
      'AUTH_LOGIN_FETCH_RESOLVED',
    ]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'AUTH_LOGIN_FETCH_CALL_ENTER',
        flowId: 'auth-flow123',
        requestId: 'req-login123',
        requestPath: '/auth/login',
        requestMethod: 'POST',
        credentialsMode: 'include',
        signalExists: false,
        signalAborted: false,
        targetOrigin: window.location.origin,
        targetPathname: '/api/auth/login',
      }),
      expect.objectContaining({
        operation: 'AUTH_LOGIN_FETCH_PROMISE_CREATED',
        flowId: 'auth-flow123',
        requestId: 'req-login123',
        targetOrigin: window.location.origin,
        targetPathname: '/api/auth/login',
      }),
      expect.objectContaining({
        operation: 'AUTH_LOGIN_FETCH_RESOLVED',
        flowId: 'auth-flow123',
        requestId: 'req-login123',
        httpStatus: 200,
      }),
    ]));
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('admin@demo.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('demo123');

    debugSpy.mockRestore();
  });

  it('records safe login fetch rejection diagnostics without leaking credentials', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    window.localStorage.clear();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const controller = new AbortController();

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), {
        once: true,
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient: realApiClient } = await import('./api-client');
    const request = realApiClient.post('/auth/login', { email: 'admin@demo.com', password: 'demo123' }, {
      headers: {
        'X-Auth-Flow-Id': 'auth-flow123',
        'X-Auth-Request-Id': 'req-login123',
      },
      skipVendorContext: true,
      authStartedAtMs: Date.now() - 50,
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({
      kind: 'network',
    });
    expect(debugSpy).toHaveBeenCalledWith('[auth-flow]', expect.objectContaining({
      operation: 'AUTH_LOGIN_FETCH_REJECTED',
      flowId: 'auth-flow123',
      requestId: 'req-login123',
      stage: 'fetch_rejected',
      outcome: 'aborted',
      resultCategory: 'aborted',
      errorName: 'AbortError',
      signalExists: true,
      signalAborted: true,
      targetPathname: '/api/auth/login',
    }));
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('admin@demo.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('demo123');

    debugSpy.mockRestore();
  });

  it('redacts email-shaped text from login fetch rejection messages', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    window.localStorage.clear();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch admin@demo.com'));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient: realApiClient } = await import('./api-client');
    await expect(realApiClient.post('/auth/login', { email: 'admin@demo.com', password: 'demo123' }, {
      headers: {
        'X-Auth-Flow-Id': 'auth-flow123',
        'X-Auth-Request-Id': 'req-login123',
      },
      skipVendorContext: true,
      authStartedAtMs: Date.now() - 50,
    })).rejects.toMatchObject({
      kind: 'network',
    });

    expect(debugSpy).toHaveBeenCalledWith('[auth-flow]', expect.objectContaining({
      operation: 'AUTH_LOGIN_FETCH_REJECTED',
      errorName: 'TypeError',
      errorMessage: 'Failed to fetch [redacted-email]',
      signalAborted: false,
    }));
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('admin@demo.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('demo123');

    debugSpy.mockRestore();
  });

  it('sends credentials with /auth/me without attaching a localStorage bearer token in real mode', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com');
    window.localStorage.clear();
    setToken('stale-local-token');

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      user: {
        email: 'admin@demo.com',
        name: 'Demo Admin',
        role: 'admin',
        vendorAccess: [],
      },
      csrfToken: 'csrf-from-cookie-session',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient: realApiClient } = await import('./api-client');
    await realApiClient.get('/auth/me', { vendorId: null });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://backend.example.com/auth/me');
    expect(init.credentials).toBe('include');
    expect(headers.get('Authorization')).toBeNull();
  });
});
