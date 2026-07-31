import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeConfig } from './config/runtime';
import { setCurrentUser, setCurrentVendorId, setToken } from './lib/auth';
import {
  interpretDualPathTransportDiagnostic,
  login,
  me,
  probeDirectBackendLoginPostTransport,
  probeDualPathLoginPostTransport,
  probePublicLoginPostTransport,
  probePublicLoginReadiness,
} from './services/backend-auth';

describe('backend auth client diagnostics', () => {
  const fetchMock = vi.fn();
  const originalRuntimeConfig = {
    diagnosticBackendOrigin: runtimeConfig.diagnosticBackendOrigin,
  };

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
    Object.assign(runtimeConfig, originalRuntimeConfig);
    vi.useRealTimers();
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

  it('records backend-auth login entry diagnostics without exposing credentials', async () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    await login('vendor@example.com', 'demo123', {
      authAttemptId: 'auth-test123',
      authFlowId: 'auth-flow123',
      authRequestId: 'req-login123',
      authStartedAtMs: Date.now() - 25,
    });

    expect(debugSpy).toHaveBeenCalledWith('[auth-flow]', expect.objectContaining({
      operation: 'AUTH_BACKEND_LOGIN_ENTER',
      flowId: 'auth-flow123',
      requestId: 'req-login123',
      stage: 'backend_auth_login_enter',
      outcome: 'started',
      requestPath: '/auth/login',
      requestMethod: 'POST',
      signalExists: false,
      signalAborted: false,
    }));
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('vendor@example.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('demo123');

    debugSpy.mockRestore();
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

  it('posts the fixed login transport probe payload without credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          status: 'post_transport_ready',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const result = await probePublicLoginPostTransport({
      authAttemptId: 'auth-probe123',
      authFlowId: 'auth-flow123',
      authRequestId: 'req-post123',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({
      result: 'ready',
      status: 200,
    });
    const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
    const headers = new Headers((init as RequestInit).headers);

    expect(url).toBe('/api/auth/diagnostics/public-login-transport');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('same-origin');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Auth-Attempt-Id')).toBe('auth-probe123');
    expect(headers.get('X-Auth-Flow-Id')).toBe('auth-flow123');
    expect(headers.get('X-Auth-Request-Id')).toBe('req-post123');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ probe: 'login-post-transport' });
    expect(JSON.stringify(init)).not.toContain('vendor@example.com');
    expect(JSON.stringify(init)).not.toContain('demo123');
    expect(JSON.stringify(init)).not.toContain('sporgym_session=');
    expect(JSON.stringify(init)).not.toContain('csrf-token');
  });

  it('posts the direct backend login transport probe with credentials omitted', async () => {
    Object.assign(runtimeConfig, {
      diagnosticBackendOrigin: 'https://backend.example.com',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          status: 'post_transport_ready',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const result = await probeDirectBackendLoginPostTransport({
      authAttemptId: 'auth-direct123',
      authFlowId: 'auth-flow123',
      authRequestId: 'req-direct123',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({
      result: 'ready',
      status: 200,
      pathMode: 'direct_backend',
    });
    const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
    const headers = new Headers((init as RequestInit).headers);

    expect(url).toBe('https://backend.example.com/auth/diagnostics/public-login-transport');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('omit');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Auth-Attempt-Id')).toBe('auth-direct123');
    expect(headers.get('X-Auth-Flow-Id')).toBe('auth-flow123');
    expect(headers.get('X-Auth-Request-Id')).toBe('req-direct123');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ probe: 'login-post-transport' });
    expect(JSON.stringify(init)).not.toContain('vendor@example.com');
    expect(JSON.stringify(init)).not.toContain('demo123');
    expect(JSON.stringify(init)).not.toContain('sporgym_session=');
    expect(JSON.stringify(init)).not.toContain('csrf-token');
  });

  it('classifies direct backend login transport probe as not configured when no HTTPS origin exists', async () => {
    Object.assign(runtimeConfig, {
      diagnosticBackendOrigin: null,
    });

    await expect(probeDirectBackendLoginPostTransport({ timeoutMs: 1000 })).resolves.toMatchObject({
      result: 'not_configured',
      status: null,
      elapsedMs: 0,
      pathMode: 'direct_backend',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('interprets dual-path login transport probe outcomes conservatively', () => {
    const sameOriginTimeout = { result: 'timeout' as const, status: null, elapsedMs: 5000, pathMode: 'same_origin_api' as const };
    const sameOriginReady = { result: 'ready' as const, status: 200, elapsedMs: 10, pathMode: 'same_origin_api' as const };
    const directReady = { result: 'ready' as const, status: 200, elapsedMs: 12, pathMode: 'direct_backend' as const };
    const directTimeout = { result: 'timeout' as const, status: null, elapsedMs: 5000, pathMode: 'direct_backend' as const };
    const directNotConfigured = { result: 'not_configured' as const, status: null, elapsedMs: 0, pathMode: 'direct_backend' as const };

    expect(interpretDualPathTransportDiagnostic(sameOriginTimeout, directReady)).toBe('same_origin_path_suspected');
    expect(interpretDualPathTransportDiagnostic(sameOriginTimeout, directTimeout)).toBe('shared_transport_failure');
    expect(interpretDualPathTransportDiagnostic(sameOriginReady, directReady)).toBe('general_post_transport_ready');
    expect(interpretDualPathTransportDiagnostic(sameOriginReady, directTimeout)).toBe('inconclusive');
    expect(interpretDualPathTransportDiagnostic(sameOriginTimeout, directNotConfigured)).toBe('direct_probe_not_configured');
  });

  it('runs same-origin and direct backend transport probes with one flow id and independent abort controllers', async () => {
    Object.assign(runtimeConfig, {
      diagnosticBackendOrigin: 'https://backend.example.com',
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          ok: true,
          status: 'post_transport_ready',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )),
    );

    const result = await probeDualPathLoginPostTransport({
      authAttemptId: 'auth-dual123',
      authFlowId: 'auth-dual123',
      authRequestId: 'req-same123',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({
      interpretation: 'general_post_transport_ready',
      sameOrigin: {
        result: 'ready',
        pathMode: 'same_origin_api',
      },
      directBackend: {
        result: 'ready',
        pathMode: 'direct_backend',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [sameOriginUrl, sameOriginInit] = fetchMock.mock.calls[0];
    const [directUrl, directInit] = fetchMock.mock.calls[1];
    const sameOriginHeaders = new Headers((sameOriginInit as RequestInit).headers);
    const directHeaders = new Headers((directInit as RequestInit).headers);

    expect(sameOriginUrl).toBe('/api/auth/diagnostics/public-login-transport');
    expect(directUrl).toBe('https://backend.example.com/auth/diagnostics/public-login-transport');
    expect((sameOriginInit as RequestInit).credentials).toBe('same-origin');
    expect((directInit as RequestInit).credentials).toBe('omit');
    expect((sameOriginInit as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect((directInit as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect((sameOriginInit as RequestInit).signal).not.toBe((directInit as RequestInit).signal);
    expect(sameOriginHeaders.get('X-Auth-Flow-Id')).toBe('auth-dual123');
    expect(directHeaders.get('X-Auth-Flow-Id')).toBe('auth-dual123');
    expect(JSON.parse((sameOriginInit as RequestInit).body as string)).toEqual({ probe: 'login-post-transport' });
    expect(JSON.parse((directInit as RequestInit).body as string)).toEqual({ probe: 'login-post-transport' });
  });

  it('classifies login transport probe timeout independently', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
    );

    const resultPromise = probePublicLoginPostTransport({ timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toMatchObject({
      result: 'timeout',
      status: null,
    });
    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    vi.useRealTimers();
  });

  it('classifies login transport probe network, HTTP, and invalid response failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(probePublicLoginPostTransport({ timeoutMs: 1000 })).resolves.toMatchObject({
      result: 'network_error',
      status: null,
    });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'bad probe' }), { status: 400 }));
    await expect(probePublicLoginPostTransport({ timeoutMs: 1000 })).resolves.toMatchObject({
      result: 'http_error',
      status: 400,
    });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, status: 'wrong' }), { status: 200 }));
    await expect(probePublicLoginPostTransport({ timeoutMs: 1000 })).resolves.toMatchObject({
      result: 'invalid_response',
      status: 200,
    });
  });
});
