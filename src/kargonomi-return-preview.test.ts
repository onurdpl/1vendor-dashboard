import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  returnRecord: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  vendorShippingConfig: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { createKargonomiReturnShipmentForReturn, previewKargonomiReturnShipmentForReturn } = await import(
  '../backend/src/modules/returns/returns.service.js'
);

function baseReturnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    vendorAllocationId: 'alloc-yalispor-1',
    sourceShopifyOrderId: 'gid://shopify/Order/1071',
    sourceShopifyLineItemId: 'line-1',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: 'return-shopify-1',
    sourceShopifyReturnGid: 'gid://shopify/Return/1',
    returnReferenceId: 'RET-1',
    sourceShopifyOrderNumber: '1071',
    returnLifecycleStatus: 'approved',
    returnRequestSource: 'shopify_return_request',
    status: 'approved',
    reason: 'Return requested',
    returnReasonNote: null,
    returnProvider: null,
    returnProviderShipmentId: null,
    returnLabel: null,
    navlungoReturnCreatedAt: null,
    returnProviderSnapshot: null,
    returnCarrierName: null,
    returnTrackingNumber: null,
    returnTrackingUrl: null,
    vendorReceivedAt: null,
    vendorReviewedAt: null,
    vendorDecision: null,
    vendorDecisionReason: null,
    requestCreatedAt: null,
    requestUpdatedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    vendorAllocation: {
      id: 'alloc-yalispor-1',
      sourceShopifyOrderId: 'gid://shopify/Order/1071',
      originalVendorId: 'yalispor',
      assignedVendorId: 'yalispor',
      order: {
        sourceShopifyOrderId: 'gid://shopify/Order/1071',
        customerName: 'Customer Name',
        customerEmail: 'customer@example.test',
        billingFullName: null,
        customerPhone: '+905551112233',
        billingPhone: null,
        shippingAddress: 'Customer full address',
        shippingDistrict: 'Kadikoy',
      },
      lineItems: [
        {
          id: 'allocation-line-1',
          quantity: 1,
          lineAmount: '100.00',
          shopifyOrderLineItem: {
            id: 'line-1',
            sourceLineItemId: 'line-1',
            sourceVariantId: null,
            sku: 'SKU-1',
            title: 'Return product',
            variantTitle: null,
            imageUrl: null,
          },
        },
      ],
      refundRecords: [],
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
          stateId: '34',
          cityId: '828',
        },
      },
    ],
    ...overrides,
  };
}

describe('Kargonomi return preview', () => {
  beforeEach(() => {
    prismaMock.returnRecord.findUnique.mockReset();
    prismaMock.returnRecord.findFirst.mockReset();
    prismaMock.returnRecord.update.mockReset();
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

  it('uses Kargonomi return receiver metadata for receiver phone and address readiness', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(
      baseShippingConfig({
        providerMetadata: {
          fallbackBuyerStateId: '34',
          fallbackBuyerCityId: '828',
          kargonomiReturnReceiverName: 'Metadata warehouse',
          kargonomiReturnReceiverPhone: '+902122223344',
          kargonomiReturnReceiverAddress: 'Metadata return address',
          kargonomiReturnReceiverStateId: '34',
          kargonomiReturnReceiverCityId: '828',
        },
        warehouses: [
          {
            warehouseId: '112668',
            provider: 'KARGONOMI',
            isDefault: true,
            name: null,
            address: null,
            metadata: null,
          },
        ],
      }),
    );

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    });

    expect(preview.ready).toBe(true);
    expect(preview.missingFields).not.toContain('receiver.phone');
    expect(preview.missingFields).not.toContain('receiver.address');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        receiver: {
          warehouseId: '112668',
          namePresent: true,
          phonePresent: true,
          addressPresent: true,
        },
      },
    });
    const serializedPreview = JSON.stringify(preview.previewPayload);
    expect(serializedPreview).not.toContain('+902122223344');
    expect(serializedPreview).not.toContain('Metadata return address');
  });

  it('blocks create when preview readiness fails', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValue(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(
      baseShippingConfig({
        warehouses: [],
        defaultWarehouseId: null,
      }),
    );

    await expect(
      createKargonomiReturnShipmentForReturn(
        'return-1',
        {
          role: 'admin',
          vendorId: null,
        },
        {} as never,
        {
          adapter: {
            provider: 'KARGONOMI',
            createShipment: vi.fn(),
          } as never,
        },
      ),
    ).rejects.toThrow('Kargonomi return shipment is not ready.');
  });

  it('persists successful Kargonomi return shipment fields', async () => {
    const adapterCreateShipment = vi.fn().mockResolvedValue({
      providerShipmentId: '2654001',
      trackingNumber: 'KSUR2654001RET',
      trackingUrl: null,
      labelUrl: 'data:application/pdf;base64,JVBER',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        shippingProviderName: 'Sürat Kargo',
        labelUrlPresent: true,
      },
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(baseShippingConfig());
    prismaMock.returnRecord.update.mockResolvedValue({});
    prismaMock.returnRecord.findFirst.mockResolvedValue(
      baseReturnRecord({
        returnProvider: 'kargonomi',
        returnProviderShipmentId: '2654001',
        returnCarrierName: 'Sürat Kargo',
        returnTrackingNumber: 'KSUR2654001RET',
        returnLabel: 'data:application/pdf;base64,JVBER',
      }),
    );

    const result = await createKargonomiReturnShipmentForReturn(
      'return-1',
      {
        role: 'admin',
        vendorId: null,
      },
      {} as never,
      {
        adapter: {
          provider: 'KARGONOMI',
          createShipment: adapterCreateShipment,
        } as never,
      },
    );

    expect(adapterCreateShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        allocationId: expect.any(String),
        vendorId: 'yalispor',
        provider: 'kargonomi',
        requestSnapshot: expect.objectContaining({
          sender: expect.objectContaining({
            sender_name: 'Customer Name',
            sender_phone: '+905551112233',
            sender_address: 'Customer full address',
            sender_state_id: '34',
            sender_city_id: '828',
          }),
          buyer: expect.objectContaining({
            buyer_name: 'Yalispor Warehouse',
            buyer_phone: '+902121112233',
            buyer_address: 'Vendor full address',
            buyer_state_id: '34',
            buyer_city_id: '828',
          }),
        }),
      }),
    );
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'return-1' },
        data: expect.objectContaining({
          returnProvider: 'kargonomi',
          returnProviderShipmentId: '2654001',
          returnCarrierName: 'Sürat Kargo',
          returnTrackingNumber: 'KSUR2654001RET',
          returnLabel: 'data:application/pdf;base64,JVBER',
        }),
      }),
    );
    expect(result.returnProviderShipmentId).toBe('2654001');
  });

  it('blocks duplicate Kargonomi return shipment creation', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValue(
      baseReturnRecord({
        returnProviderShipmentId: 'existing-return-shipment',
      }),
    );

    await expect(
      createKargonomiReturnShipmentForReturn(
        'return-1',
        {
          role: 'admin',
          vendorId: null,
        },
        {} as never,
      ),
    ).rejects.toThrow('Return shipment already exists');
  });
});
