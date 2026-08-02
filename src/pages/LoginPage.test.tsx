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
import { runtimeConfig } from '../config/runtime';
import { LoginPage } from './LoginPage';

const loginMock = vi.hoisted(() => vi.fn());
const probePublicLoginReadinessMock = vi.hoisted(() => vi.fn());
const probeDualPathLoginPostTransportMock = vi.hoisted(() => vi.fn());

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    auth: {
      login: loginMock,
    },
  },
}));

vi.mock('../services/backend-auth', () => ({
  probeDualPathLoginPostTransport: probeDualPathLoginPostTransportMock,
  probePublicLoginReadiness: probePublicLoginReadinessMock,
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

function getAuthDiagnosticDebugEvents(debugSpy: ReturnType<typeof vi.spyOn>) {
  return debugSpy.mock.calls
    .map((call) => call[1])
    .filter((entry): entry is {
      operation?: string;
      flowId?: string;
      stage?: string;
      outcome?: string;
      resultCategory?: string;
      httpStatus?: number | null;
      durationMs?: number | null;
      requestPath?: string;
      requestMethod?: string;
      credentialsMode?: RequestCredentials;
      signalExists?: boolean;
      signalAborted?: boolean;
      source?: string;
    } => Boolean(entry) && typeof entry === 'object');
}

describe('LoginPage expired session flow', () => {
  const originalRuntimeConfig = {
    apiMode: runtimeConfig.apiMode,
    apiBaseUrl: runtimeConfig.apiBaseUrl,
    apiBaseOrigin: runtimeConfig.apiBaseOrigin,
    appEnvironment: runtimeConfig.appEnvironment,
  };

  beforeEach(() => {
    Object.assign(runtimeConfig, originalRuntimeConfig);
    window.localStorage.clear();
    loginMock.mockReset();
    probePublicLoginReadinessMock.mockReset();
    probeDualPathLoginPostTransportMock.mockReset();
    loginMock.mockResolvedValue({
      token: null,
      user: testUser,
    });
    probeDualPathLoginPostTransportMock.mockResolvedValue({
      sameOrigin: {
        result: 'ready',
        status: 200,
        elapsedMs: 20,
        pathMode: 'same_origin_api',
      },
      directBackend: {
        result: 'ready',
        status: 200,
        elapsedMs: 18,
        pathMode: 'direct_backend',
      },
      interpretation: 'general_post_transport_ready',
    });
    probePublicLoginReadinessMock.mockResolvedValue({
      ok: true,
      status: 200,
      elapsedMs: 12,
      response: {
        ok: true,
        status: 'ready',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    Object.assign(runtimeConfig, originalRuntimeConfig);
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
    expect(probeDualPathLoginPostTransportMock).not.toHaveBeenCalled();
  });

  it('hides demo credentials and unfinished-product copy in real production mode', () => {
    Object.assign(runtimeConfig, {
      apiMode: 'real',
      appEnvironment: 'production',
    });

    renderStandaloneLogin();

    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeInTheDocument();
    expect(screen.queryByText('Demo credentials')).not.toBeInTheDocument();
    expect(screen.queryByText(/@demo\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText('Built for future auth flow.')).not.toBeInTheDocument();
  });

  it('keeps demo assistance in mock development mode', () => {
    Object.assign(runtimeConfig, {
      apiMode: 'mock',
      appEnvironment: 'development',
    });

    renderStandaloneLogin();

    expect(screen.getByText('Demo credentials')).toBeInTheDocument();
    expect(screen.getByText(/Built for future auth flow\./)).toBeInTheDocument();
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
    expect(probeDualPathLoginPostTransportMock).not.toHaveBeenCalled();
  });

  it('logs safe POST dispatch diagnostics without credentials', async () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/');
    const events = getAuthDiagnosticDebugEvents(debugSpy);
    const flowIds = new Set(events.map((event) => event.flowId).filter(Boolean));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'AUTH_LOGIN_FORM_SUBMIT_ENTER', stage: 'form_submit_enter', outcome: 'started', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ operation: 'AUTH_LOGIN_PREVENT_DEFAULT_COMPLETE', stage: 'prevent_default_complete', outcome: 'complete', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ operation: 'LOGIN_SUBMIT', stage: 'submit', outcome: 'started', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ operation: 'LOGIN_REQUEST_START', stage: 'login_post', outcome: 'started', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ operation: 'LOGIN_RESPONSE', stage: 'login_post', outcome: 'success', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i), resultCategory: 'success', durationMs: expect.any(Number) }),
        expect.objectContaining({ operation: 'CACHE_USER_SET', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ operation: 'AUTH_STATE_CHANGE', stage: 'final_success', outcome: 'success', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
        expect.objectContaining({ operation: 'AUTH_LOGIN_CLEANUP_COMPLETE', stage: 'cleanup_complete', outcome: 'complete', flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i) }),
      ]),
    );
    expect(flowIds.size).toBe(1);
    expect(events.map((event) => event.operation).slice(0, 3)).toEqual([
      'AUTH_LOGIN_FORM_SUBMIT_ENTER',
      'AUTH_LOGIN_PREVENT_DEFAULT_COMPLETE',
      'LOGIN_SUBMIT',
    ]);
    expect(events.find((event) => event.operation === 'AUTH_LOGIN_PREVENT_DEFAULT_COMPLETE')).toMatchObject({
      requestPath: '/api/auth/login',
      requestMethod: 'POST',
      credentialsMode: 'same-origin',
      signalExists: true,
      signalAborted: false,
    });
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('vendor@example.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('demo123');

    debugSpy.mockRestore();
  });

  it('uses one submission flow id across readiness and login requests', async () => {
    Object.assign(runtimeConfig, {
      apiMode: 'real',
      apiBaseUrl: 'https://api.example.com',
      apiBaseOrigin: 'https://api.example.com',
      appEnvironment: 'production',
    });
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/');
    expect(probePublicLoginReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
        authFlowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
        timeoutMs: 3_000,
      }),
    );
    expect(loginMock).toHaveBeenCalledWith(
      'vendor@example.com',
      'demo123',
      expect.objectContaining({
        authAttemptId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
        authFlowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
        signal: expect.any(AbortSignal),
      }),
    );

    const readinessAuthAttemptId = probePublicLoginReadinessMock.mock.calls[0][0].authAttemptId;
    const readinessAuthFlowId = probePublicLoginReadinessMock.mock.calls[0][0].authFlowId;
    const loginAuthAttemptId = (loginMock.mock.calls[0][2] as { authAttemptId?: string }).authAttemptId;
    const loginAuthFlowId = (loginMock.mock.calls[0][2] as { authFlowId?: string }).authFlowId;
    expect(readinessAuthAttemptId).toBe(loginAuthAttemptId);
    expect(readinessAuthFlowId).toBe(loginAuthFlowId);
    expect(readinessAuthFlowId).toBe(loginAuthAttemptId);
  });

  it('clears the login timeout after a successful backend response', async () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/');

    const events = debugSpy.mock.calls.map((call) => (call[1] as { operation?: string })?.operation);
    expect(events).toContain('LOGIN_RESPONSE');
    expect(events).toContain('AUTH_STATE_CHANGE');
    expect(events).not.toContain('REQUEST_ABORT');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(screen.queryByText(/^Sign-in is taking longer than expected/)).not.toBeInTheDocument();
    expect(probeDualPathLoginPostTransportMock).not.toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('keeps a fast successful login authenticated when the delayed timeout window later elapses', async () => {
    vi.useFakeTimers();
    loginMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            resolve({
              token: null,
              user: testUser,
            });
          }, 1_000);
        }),
    );
    renderStandaloneLogin();

    fillAndSubmitLogin();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByTestId('current-route')).toHaveTextContent('/');

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/^Sign-in is taking longer than expected/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('sporjinal');
  });

  it('ignores an older login attempt timeout after a newer attempt succeeds', async () => {
    vi.useFakeTimers();
    loginMock
      .mockImplementationOnce(
        (_email: string, _password: string, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('Old request aborted'));
              },
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce({
        token: null,
        user: testUser,
      });
    renderStandaloneLogin();

    fillAndSubmitLogin();
    const form = screen.getByRole('button', { name: 'Signing in…' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('current-route')).toHaveTextContent('/');

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/^Sign-in is taking longer than expected/)).not.toBeInTheDocument();
    expect((loginMock.mock.calls[0][2] as { signal?: AbortSignal }).signal?.aborted).toBe(false);
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('sporjinal');
  });

  it('clears an existing timeout error when a new login attempt succeeds', async () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    loginMock
      .mockImplementationOnce(
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
      )
      .mockResolvedValueOnce({
        token: null,
        user: testUser,
      });
    renderStandaloneLogin();

    fillAndSubmitLogin();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      screen.getByText(/^Sign-in is taking longer than expected\. Please try again\. Reference: auth-[a-z0-9]{10}$/i),
    ).toBeInTheDocument();
    const firstReference = screen.getByText(/^Sign-in is taking longer than expected/i).textContent?.match(/Reference: (auth-[a-z0-9]{10})/i)?.[1];

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('current-route')).toHaveTextContent('/');
    expect(screen.queryByText(/^Sign-in is taking longer than expected/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('sporjinal');

    const events = getAuthDiagnosticDebugEvents(debugSpy);
    const submittedFlowIds = events
      .filter((event) => event.operation === 'LOGIN_SUBMIT')
      .map((event) => event.flowId);
    expect(submittedFlowIds).toHaveLength(2);
    expect(firstReference).toBe(submittedFlowIds[0]);
    expect(submittedFlowIds[0]).not.toBe(submittedFlowIds[1]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flowId: firstReference, operation: 'LOGIN_RESPONSE', outcome: 'timeout' }),
        expect.objectContaining({ flowId: firstReference, operation: 'LOGIN_POST_TRANSPORT_PROBE', outcome: 'general_post_transport_ready' }),
        expect.objectContaining({ flowId: submittedFlowIds[1], operation: 'AUTH_STATE_CHANGE', outcome: 'success' }),
      ]),
    );
    debugSpy.mockRestore();
  });

  it('does not report a timeout when local session setup fails after backend success', async () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
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

    const events = debugSpy.mock.calls.map((call) => (call[1] as { operation?: string })?.operation);
    expect(events).toContain('LOGIN_RESPONSE');
    expect(events).not.toContain('REQUEST_ABORT');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(screen.queryByText(/^Sign-in is taking longer than expected/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();

    clearTimeoutSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('aborts a hanging login request and shows a retryable timeout error', async () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
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
      await Promise.resolve();
    });

    expect(
      screen.getByText(/^Sign-in is taking longer than expected\. Please try again\. Reference: auth-[a-z0-9]{10}$/i),
    ).toBeInTheDocument();
    expect(screen.getByText(
      'POST transport: Same-origin /api: Ready Direct backend: Ready Both safe POST paths work; login route or intermittent behavior remains possible',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect((loginMock.mock.calls[0][2] as { signal?: AbortSignal }).signal?.aborted).toBe(true);
    expect((loginMock.mock.calls[0][2] as { authAttemptId?: string }).authAttemptId).toEqual(
      expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
    );
    const reference = screen.getByText(/^Sign-in is taking longer than expected/i).textContent?.match(/Reference: (auth-[a-z0-9]{10})/i)?.[1];
    const loginOptions = loginMock.mock.calls[0][2] as { authAttemptId?: string; authFlowId?: string };
    const events = getAuthDiagnosticDebugEvents(debugSpy);
    expect(reference).toBe(loginOptions.authFlowId);
    expect(loginOptions.authAttemptId).toBe(loginOptions.authFlowId);
    expect(debugSpy.mock.calls.map((call) => (call[1] as { operation?: string })?.operation)).toEqual(
      expect.arrayContaining(['REQUEST_ABORT', 'LOGIN_RESPONSE', 'LOGIN_POST_TRANSPORT_PROBE']),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flowId: reference, operation: 'REQUEST_ABORT', stage: 'login_post', outcome: 'timeout' }),
        expect.objectContaining({
          flowId: reference,
          operation: 'AUTH_LOGIN_TIMEOUT_FIRED',
          stage: 'login_post',
          outcome: 'timeout',
          signalAborted: false,
        }),
        expect.objectContaining({ flowId: reference, operation: 'LOGIN_RESPONSE', stage: 'login_post', outcome: 'timeout' }),
        expect.objectContaining({ flowId: reference, operation: 'LOGIN_POST_TRANSPORT_PROBE', stage: 'login_transport_dual_probe_start', outcome: 'started' }),
        expect.objectContaining({ flowId: reference, operation: 'LOGIN_POST_TRANSPORT_PROBE', stage: 'login_transport_dual_probe_complete', outcome: 'general_post_transport_ready', durationMs: 20 }),
        expect.objectContaining({
          flowId: reference,
          operation: 'AUTH_LOGIN_CLEANUP_COMPLETE',
          stage: 'cleanup_complete',
          signalAborted: true,
        }),
      ]),
    );
    expect(probeDualPathLoginPostTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authAttemptId: reference,
        authFlowId: reference,
        timeoutMs: 5_000,
      }),
    );
    debugSpy.mockRestore();
  });

  it('runs the POST transport probe after a network-level login failure without replacing the original error', async () => {
    loginMock.mockRejectedValueOnce(new ApiError('Unable to reach the backend.', 'network'));
    probeDualPathLoginPostTransportMock.mockResolvedValueOnce({
      sameOrigin: {
        result: 'network_error',
        status: null,
        elapsedMs: 5000,
        pathMode: 'same_origin_api',
      },
      directBackend: {
        result: 'ready',
        status: 200,
        elapsedMs: 25,
        pathMode: 'direct_backend',
      },
      interpretation: 'same_origin_path_suspected',
    });
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByText('Unable to reach the backend.')).toBeInTheDocument();
    expect(screen.getByText(
      'POST transport: Same-origin /api: Network error Direct backend: Ready Leading suspect: frontend /api transport path',
    )).toBeInTheDocument();
    expect(probeDualPathLoginPostTransportMock).toHaveBeenCalledTimes(1);
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('does not run the POST transport probe after HTTP 401 or successful login', async () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    loginMock.mockRejectedValueOnce(new ApiError('Invalid email or password.', 'unauthorized', { status: 401 }));
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(probeDualPathLoginPostTransportMock).not.toHaveBeenCalled();
    expect(getAuthDiagnosticDebugEvents(debugSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'LOGIN_RESPONSE',
          stage: 'login_post',
          outcome: 'unauthorized',
          httpStatus: 401,
          flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
        }),
      ]),
    );
    cleanup();

    loginMock.mockResolvedValueOnce({
      token: null,
      user: testUser,
    });
    renderStandaloneLogin();

    fillAndSubmitLogin();

    expect(await screen.findByTestId('current-route')).toHaveTextContent('/');
    expect(probeDualPathLoginPostTransportMock).not.toHaveBeenCalled();
    expect(getAuthDiagnosticDebugEvents(debugSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'AUTH_STATE_CHANGE',
          stage: 'final_success',
          outcome: 'success',
          flowId: expect.stringMatching(/^auth-[a-z0-9]{10}$/i),
        }),
      ]),
    );
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('vendor@example.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('demo123');
    debugSpy.mockRestore();
  });
});
