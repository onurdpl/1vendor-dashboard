import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  returnRecord: {
    findUnique: vi.fn(),
  },
  vendorShippingConfig: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { previewKargonomiReturnShipmentForReturn } = await import('../backend/src/modules/returns/returns.service.js');

function baseReturnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    sourceShopifyLineItemId: 'line-1',
    sourceShopifyReturnId: 'return-shopify-1',
    sourceShopifyReturnGid: 'gid://shopify/Return/1',
    returnReferenceId: 'RET-1',
    sourceShopifyOrderNumber: '1071',
    vendorAllocation: {
      assignedVendorId: 'yalispor',
      order: {
        customerName: 'Customer Name',
        billingFullName: null,
        customerPhone: '+905551112233',
        billingPhone: null,
        shippingAddress: 'Customer full address',
        shippingDistrict: 'Kadikoy',
      },
      lineItems: [
        {
          id: 'allocation-line-1',
          shopifyOrderLineItem: {
            sku: 'SKU-1',
          },
        },
      ],
    },
    ...overrides,
  };
}

function baseShippingConfig(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: 'yalispor',
    shippingEnabled: true,
    preferredProvider: 'KARGONOMI',
    defaultDesi: '3.00',
    defaultWarehouseId: '112668',
    providerMetadata: {
      fallbackBuyerStateId: '34',
      fallbackBuyerCityId: '828',
    },
    warehouses: [
      {
        warehouseId: '112668',
        provider: 'KARGONOMI',
        isDefault: true,
        name: 'Yalispor Warehouse',
        address: 'Vendor full address',
        metadata: {
          phone: '+902121112233',
        },
      },
    ],
    ...overrides,
  };
}

describe('Kargonomi return preview', () => {
  beforeEach(() => {
    prismaMock.returnRecord.findUnique.mockReset();
    prismaMock.vendorShippingConfig.findUnique.mockReset();
  });

  it('marks preview not ready when customer phone is missing', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(
      baseReturnRecord({
        vendorAllocation: {
          assignedVendorId: 'yalispor',
          order: {
            customerName: 'Customer Name',
            billingFullName: null,
            customerPhone: null,
            billingPhone: null,
            shippingAddress: 'Customer full address',
            shippingDistrict: 'Kadikoy',
          },
          lineItems: [{ id: 'allocation-line-1', shopifyOrderLineItem: { sku: 'SKU-1' } }],
        },
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(baseShippingConfig());

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    });

    expect(preview.ready).toBe(false);
    expect(preview.missingFields).toContain('sender.phone');
    expect(JSON.stringify(preview.previewPayload)).not.toContain('+905551112233');
  });

  it('marks preview not ready when no Kargonomi warehouse is configured', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(
      baseShippingConfig({
        defaultWarehouseId: null,
        warehouses: [],
      }),
    );

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'admin',
      vendorId: null,
    });

    expect(preview.ready).toBe(false);
    expect(preview.missingFields).toContain('receiver.warehouseId');
  });

  it('returns a ready sanitized preview when local return shipment inputs are present', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(baseShippingConfig());

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    });

    expect(preview).toMatchObject({
      ok: true,
      provider: 'KARGONOMI',
      mode: 'return_preview',
      ready: true,
      direction: 'CUSTOMER_TO_VENDOR',
      senderSource: 'CUSTOMER_ORDER_ADDRESS',
      receiverSource: 'VENDOR_KARGONOMI_WAREHOUSE',
    });
    expect(preview.missingFields).toEqual([]);
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        sender: {
          namePresent: true,
          phonePresent: true,
          addressPresent: true,
          cityId: '828',
          stateId: '34',
        },
        receiver: {
          warehouseId: '112668',
          namePresent: true,
          phonePresent: true,
          addressPresent: true,
        },
      },
    });
    const serializedPreview = JSON.stringify(preview.previewPayload);
    expect(serializedPreview).not.toContain('Customer full address');
    expect(serializedPreview).not.toContain('Vendor full address');
    expect(serializedPreview).not.toContain('+905551112233');
    expect(serializedPreview).not.toContain('+902121112233');
  });
});
