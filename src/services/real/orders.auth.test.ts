import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setToken } from '../../lib/auth';
import { listOrders } from './orders';

describe('real orders service authorization', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    setToken('orders-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['yalispor', 'sporjinal'],
      vendorDetails: [
        { vendorId: 'yalispor', vendorName: 'Yali Spor' },
        { vendorId: 'sporjinal', vendorName: 'Sporjinal' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'yalispor',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends bearer auth and selected vendor headers for admin vendor-scoped orders', async () => {
    await listOrders({ vendorId: 'sporjinal' });

    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(headers.get('Authorization')).toBe('Bearer orders-token');
    expect(headers.get('X-Vendor-Id')).toBe('sporjinal');
  });
});
