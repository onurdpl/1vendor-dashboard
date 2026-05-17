import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';
import { getCurrentUser, getToken, setCurrentUser, setCurrentVendorId, setToken } from './auth';
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
  });

  it('sends the explicit selected vendor header with admin requests', async () => {
    await apiClient.get('/orders', { vendorId: 'demo-vendor-b' });

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

  it('clears stale session state when the backend rejects the token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(apiClient.get('/orders', { vendorId: 'demo-vendor-a' })).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
    } satisfies Partial<ApiError>);

    expect(getToken()).toBeNull();
    expect(getCurrentUser()).toBeNull();
  });
});
