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

  it('U6 maps frozen outbound fields without reading current Vendor configuration', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: 'alloc-1', assignedVendorId: 'sporjinal', originalVendorId: 'sporjinal',
      sourceShopifyOrderId: '1', sourceShopifyOrderNumber: '#1', allocationStatus: 'ACTIVE', operationalActionability: { actionable: true, reason: null },
      fulfillmentStatus: 'Pending', shippingStatus: 'Awaiting Shipment', totalAmount: '0',
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const orders = await listOrders({ vendorId: 'sporjinal' });
    expect(orders[0]).toMatchObject({ outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends bearer auth and selected vendor headers for admin vendor-scoped orders', async () => {
    await listOrders({ vendorId: 'sporjinal' });

    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(headers.get('Authorization')).toBe('Bearer orders-token');
    expect(headers.get('X-Vendor-Id')).toBe('sporjinal');
  });

  it('sends all existing full-history filters with the selected Vendor and pagination', async () => {
    await listOrders({ vendorId: 'sporjinal', workflow: 'awaitingShipment', search: '#1300',
      limit: 101, offset: 100, allocationStatus: 'active', fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment', blocked: true, trackingMissing: true });
    const [rawUrl, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    const url = new URL(rawUrl, 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      workflow: 'awaitingShipment', search: '#1300', limit: '101', offset: '100',
      allocationStatus: 'active', fulfillmentStatus: 'Pending', shippingStatus: 'Awaiting Shipment',
      blocked: 'true', trackingMissing: 'true',
    });
    expect((init.headers as Headers).get('X-Vendor-Id')).toBe('sporjinal');
  });
});
