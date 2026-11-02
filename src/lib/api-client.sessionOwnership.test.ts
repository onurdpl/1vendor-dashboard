import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeConfig } from '../config/runtime';
import { apiClient, clearCsrfToken, setCsrfToken } from './api-client';
import { clearToken, getCurrentUser, getToken, markAuthConfirmed, peekExpiredSessionNotice, setSession, type CurrentUser } from './auth';
import { publishSessionTransition } from './auth/sessionTransition';

const admin: CurrentUser = {
  email: 'admin@example.com', name: 'Admin A', role: 'admin', vendorAccess: ['vendor-a'],
  vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }], canSwitchVendors: true, defaultVendorId: 'vendor-a',
};
const vendor: CurrentUser = {
  email: 'vendor@example.com', name: 'Vendor B', role: 'vendor', vendorAccess: ['vendor-b'],
  vendorDetails: [{ vendorId: 'vendor-b', vendorName: 'Vendor B' }], canSwitchVendors: false, defaultVendorId: 'vendor-b',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function startSession(user: CurrentUser) {
  setSession(`token-${user.email}`, user);
  publishSessionTransition('login');
  markAuthConfirmed();
}

function switchSession(user: CurrentUser) {
  clearToken();
  publishSessionTransition('logout');
  startSession(user);
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('real API request session ownership', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const priorMode = runtimeConfig.apiMode;
  const priorBaseUrl = runtimeConfig.apiBaseUrl;

  beforeEach(() => {
    window.localStorage.clear();
    clearCsrfToken();
    Object.assign(runtimeConfig, { apiMode: 'real', apiBaseUrl: '/api' });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    startSession(admin);
  });

  afterEach(() => {
    clearCsrfToken();
    Object.assign(runtimeConfig, { apiMode: priorMode, apiBaseUrl: priorBaseUrl });
    vi.unstubAllGlobals();
  });

  it('rejects an old 401 without clearing the newly confirmed Vendor session or CSRF', async () => {
    const old = deferred<Response>();
    fetchMock.mockImplementationOnce(() => old.promise);
    const request = apiClient.get('/orders');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    switchSession(vendor);
    setCsrfToken('csrf-vendor-b');
    old.resolve(jsonResponse({ message: 'Unauthorized' }, 401));
    await expect(request).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(getCurrentUser()?.email).toBe(vendor.email);
    expect(getToken()).toBe(`token-${vendor.email}`);
    expect(peekExpiredSessionNotice()).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiClient.post('/vendor-action', {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get('X-CSRF-Token')).toBe('csrf-vendor-b');
  });

  it('still invalidates the current session on its own 401', async () => {
    setCsrfToken('csrf-admin-a');
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401));
    await expect(apiClient.get('/orders')).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(peekExpiredSessionNotice()).not.toBeNull();
    startSession(vendor);
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-vendor-b' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiClient.post('/vendor-action', {});
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/csrf');
    expect(new Headers((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).get('X-CSRF-Token')).toBe('csrf-vendor-b');
  });

  it('still invalidates a current 401 when its body is malformed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{', {
      status: 401, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(apiClient.get('/orders')).rejects.toMatchObject({ status: 401 });
    expect(getCurrentUser()).toBeNull();
    expect(peekExpiredSessionNotice()).not.toBeNull();
  });

  it('does not let later simultaneous 401 responses clear a replacement session', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const request1 = apiClient.get('/orders/one');
    const request2 = apiClient.get('/orders/two');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    first.resolve(jsonResponse({}, 401));
    await expect(request1).rejects.toMatchObject({ kind: 'unauthorized' });
    startSession(vendor);
    setCsrfToken('csrf-vendor-b');
    second.resolve(jsonResponse({}, 401));
    await expect(request2).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(getCurrentUser()?.email).toBe(vendor.email);
  });

  it('rejects a successful old GET after the account changes', async () => {
    const old = deferred<Response>();
    fetchMock.mockImplementationOnce(() => old.promise);
    const request = apiClient.get('/orders');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    switchSession(vendor);
    old.resolve(jsonResponse({ vendorId: 'vendor-a' }));
    await expect(request).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('treats a new login generation of the same user as a different session', async () => {
    const old = deferred<Response>();
    fetchMock.mockImplementationOnce(() => old.promise);
    const request = apiClient.get('/orders');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    startSession(admin);
    old.resolve(jsonResponse({ vendorId: 'vendor-a' }));
    await expect(request).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it.each([['success', jsonResponse({ csrfToken: 'csrf-admin-a' })], ['failure', jsonResponse({}, 401)]])(
    'does not apply stale CSRF %s or dispatch its protected POST', async (_name, response) => {
      const oldCsrf = deferred<Response>();
      fetchMock.mockImplementationOnce(() => oldCsrf.promise);
      const request = apiClient.post('/protected-action', {});
      switchSession(vendor);
      setCsrfToken('csrf-vendor-b');
      oldCsrf.resolve(response);
      await expect(request).rejects.toMatchObject({ kind: 'invalid-response' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getCurrentUser()?.email).toBe(vendor.email);

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await apiClient.post('/vendor-action', {});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get('X-CSRF-Token')).toBe('csrf-vendor-b');
    },
  );

  it('does not clear a newer CSRF token when an old CSRF fetch rejects', async () => {
    const oldCsrf = deferred<Response>();
    fetchMock.mockImplementationOnce(() => oldCsrf.promise);
    const request = apiClient.post('/protected-action', {});
    switchSession(vendor);
    setCsrfToken('csrf-vendor-b');
    oldCsrf.reject(new Error('old connection failed'));
    await expect(request).rejects.toMatchObject({ kind: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiClient.post('/vendor-action', {});
    expect(new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get('X-CSRF-Token')).toBe('csrf-vendor-b');
  });
});
