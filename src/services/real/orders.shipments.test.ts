import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createShipmentExecution } from './orders';

const apiClientPost = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    post: apiClientPost,
  },
}));

describe('real orders shipment service', () => {
  beforeEach(() => {
    apiClientPost.mockReset();
    apiClientPost.mockResolvedValue({
      id: 'shipment-1',
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'kargonomi',
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'pending',
      desi: '3.00',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      shippingCostLinked: false,
      barcode: null,
      createdAt: '2026-05-20T10:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z',
    });
  });

  it('sends shipment-only district override in the create shipment request body', async () => {
    await createShipmentExecution('alloc-1', {
      vendorId: 'sporjinal',
      customerOverrides: {
        district: 'Kartal',
      },
    });

    expect(apiClientPost).toHaveBeenCalledWith(
      '/shipments/create',
      {
        allocationId: 'alloc-1',
        customerOverrides: {
          district: 'Kartal',
        },
      },
      {
        vendorId: 'sporjinal',
      },
    );
  });
});
