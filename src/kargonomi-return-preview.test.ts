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
const { clearKargonomiLocationLookupCache } = await import(
  '../backend/src/modules/shipping/kargonomi-provider.adapter.js'
);

const kargonomiReturnSenderTaxInput = {
  senderTaxNumber: '11111111111',
};

function buildKargonomiDestinationClient() {
  return {
    listStates: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'application/json',
      body: {
        data: [
          {
            id: '34',
            name: 'Istanbul',
          },
        ],
      },
    }),
    listCities: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'application/json',
      body: {
        data: [
          {
            id: '828',
            name: 'Kadikoy',
          },
        ],
      },
    }),
  };
}

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
        shippingCity: 'Istanbul',
        shippingAddress: 'Customer full address',
        shippingDistrict: 'Kadikoy',
        webhookEvents: [],
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
    clearKargonomiLocationLookupCache();
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
    }, kargonomiReturnSenderTaxInput);

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
    }, kargonomiReturnSenderTaxInput);

    expect(preview.ready).toBe(false);
    expect(preview.missingFields).toContain('receiver.warehouseId');
  });

  it('marks preview not ready when sender tax number is missing', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(baseShippingConfig());

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    });

    expect(preview.ready).toBe(false);
    expect(preview.missingFields).toContain('sender.taxNumber');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        sender: {
          phoneValid: true,
          taxNumberPresent: false,
          taxNumberSource: 'missing',
        },
      },
    });
    expect(JSON.stringify(preview.previewPayload)).not.toContain('11111111111');
  });

  it('uses Kargonomi account tax number fallback for return preview readiness without exposing it', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(baseShippingConfig());

    const preview = await previewKargonomiReturnShipmentForReturn(
      'return-1',
      {
        role: 'vendor',
        vendorId: 'yalispor',
      },
      {
        env: {
          KARGONOMI_ACCOUNT_TAX_NUMBER: 'test-account-tax-number',
        } as never,
      },
    );

    expect(preview.ready).toBe(true);
    expect(preview.missingFields).not.toContain('sender.taxNumber');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        sender: {
          taxNumberPresent: true,
          taxNumberSource: 'kargonomi_account_fallback',
        },
      },
    });
    const serializedPreview = JSON.stringify(preview.previewPayload);
    expect(serializedPreview).not.toContain('test-account-tax-number');
    expect(serializedPreview).not.toContain('11111111111');
  });

  it('marks preview not ready when Kargonomi buyer name has one word', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(
      baseShippingConfig({
        warehouses: [
          {
            warehouseId: '112668',
            provider: 'KARGONOMI',
            isDefault: true,
            name: 'Sporjinal',
            address: 'Vendor full address',
            metadata: {
              phone: '+902121112233',
              stateId: '34',
              cityId: '828',
            },
          },
        ],
      }),
    );

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    }, kargonomiReturnSenderTaxInput);

    expect(preview.ready).toBe(false);
    expect(preview.missingFields).toContain('receiver.name');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        receiver: {
          namePresent: true,
          nameValid: false,
        },
      },
    });
  });

  it('returns a ready sanitized preview when local return shipment inputs are present', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(baseShippingConfig());

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    }, kargonomiReturnSenderTaxInput);

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
          phoneValid: true,
          taxNumberPresent: true,
          taxNumberSource: 'kargonomi_account_fallback',
          addressPresent: true,
          cityId: '828',
          stateId: '34',
        },
        senderDestinationResolution: {
          source: 'metadata_or_order_ids',
          lookupAttempted: false,
          senderCityIdPresent: true,
          senderStateIdPresent: true,
          senderDistrictPresent: true,
        },
        receiver: {
          warehouseId: '112668',
          namePresent: true,
          nameValid: true,
          phonePresent: true,
          phoneValid: true,
          addressPresent: true,
        },
      },
    });
    const serializedPreview = JSON.stringify(preview.previewPayload);
    expect(serializedPreview).not.toContain('Customer full address');
    expect(serializedPreview).not.toContain('Vendor full address');
    expect(serializedPreview).not.toContain('+905551112233');
    expect(serializedPreview).not.toContain('+902121112233');
    expect(serializedPreview).not.toContain('11111111111');
  });

  it('treats address2-derived shippingDistrict as ready for Kargonomi return sender district', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(
      baseReturnRecord({
        vendorAllocation: {
          assignedVendorId: 'yalispor',
          order: {
            customerName: 'Customer Name',
            customerEmail: 'customer@example.test',
            billingFullName: null,
            customerPhone: '+905551112233',
            billingPhone: null,
            shippingCity: 'Istanbul',
            shippingAddress: 'Customer full address',
            shippingDistrict: 'Kartal',
            webhookEvents: [
              {
                rawPayload: JSON.stringify({
                  shipping_address: {
                    country_code: 'TR',
                    city: 'Istanbul',
                    address2: 'Kartal',
                  },
                }),
              },
            ],
          },
          lineItems: [{ id: 'allocation-line-1', shopifyOrderLineItem: { sku: 'SKU-1' } }],
        },
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(baseShippingConfig());

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    }, kargonomiReturnSenderTaxInput);

    expect(preview.missingFields).not.toContain('sender.district');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        sender: {
          districtPresent: true,
        },
        senderDestinationResolution: {
          senderDistrictPresent: true,
        },
      },
    });
  });

  it('resolves sender city and state from order shipping text when metadata is missing', async () => {
    const destinationClient = buildKargonomiDestinationClient();
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(
      baseShippingConfig({
        providerMetadata: {},
      }),
    );

    const preview = await previewKargonomiReturnShipmentForReturn(
      'return-1',
      {
        role: 'vendor',
        vendorId: 'yalispor',
      },
      {
        kargonomiDestinationClient: destinationClient,
        ...kargonomiReturnSenderTaxInput,
      },
    );

    expect(preview.missingFields).not.toContain('sender.cityId');
    expect(preview.missingFields).not.toContain('sender.stateId');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        sender: {
          cityId: '828',
          stateId: '34',
          districtPresent: true,
        },
        senderDestinationResolution: {
          source: 'order_shipping_address_lookup',
          lookupAttempted: true,
          senderCityIdPresent: true,
          senderStateIdPresent: true,
          senderDistrictPresent: true,
        },
      },
    });
    expect(destinationClient.listStates).toHaveBeenCalled();
    expect(destinationClient.listCities).toHaveBeenCalledWith('34');
  });

  it('uses stored webhook district fallback for sender destination lookup', async () => {
    const destinationClient = buildKargonomiDestinationClient();
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(
      baseReturnRecord({
        vendorAllocation: {
          assignedVendorId: 'yalispor',
          order: {
            customerName: 'Customer Name',
            customerEmail: 'customer@example.test',
            billingFullName: null,
            customerPhone: '+905551112233',
            billingPhone: null,
            shippingCity: 'Istanbul',
            shippingAddress: 'Customer full address',
            shippingDistrict: null,
            webhookEvents: [
              {
                rawPayload: JSON.stringify({
                  shipping_address: {
                    province: 'Istanbul',
                    city: 'Istanbul',
                    county: 'Kadikoy',
                  },
                }),
              },
            ],
          },
          lineItems: [{ id: 'allocation-line-1', shopifyOrderLineItem: { sku: 'SKU-1' } }],
        },
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(
      baseShippingConfig({
        providerMetadata: {},
      }),
    );

    const preview = await previewKargonomiReturnShipmentForReturn(
      'return-1',
      {
        role: 'vendor',
        vendorId: 'yalispor',
      },
      {
        kargonomiDestinationClient: destinationClient,
        ...kargonomiReturnSenderTaxInput,
      },
    );

    expect(preview.missingFields).not.toContain('sender.district');
    expect(preview.missingFields).not.toContain('sender.cityId');
    expect(preview.missingFields).not.toContain('sender.stateId');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        senderDestinationResolution: {
          source: 'order_shipping_address_lookup',
          senderDistrictPresent: true,
        },
      },
    });
    expect(JSON.stringify(preview.previewPayload)).not.toContain('Customer full address');
  });

  it('keeps provider metadata sender id overrides without destination lookup', async () => {
    const destinationClient = buildKargonomiDestinationClient();
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(
      baseShippingConfig({
        providerMetadata: {
          kargonomiReturnSenderStateId: '34',
          kargonomiReturnSenderCityId: '828',
        },
      }),
    );

    const preview = await previewKargonomiReturnShipmentForReturn(
      'return-1',
      {
        role: 'vendor',
        vendorId: 'yalispor',
      },
      {
        kargonomiDestinationClient: destinationClient,
        ...kargonomiReturnSenderTaxInput,
      },
    );

    expect(preview.missingFields).not.toContain('sender.cityId');
    expect(preview.missingFields).not.toContain('sender.stateId');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        senderDestinationResolution: {
          source: 'metadata_or_order_ids',
          lookupAttempted: false,
        },
      },
    });
    expect(destinationClient.listStates).not.toHaveBeenCalled();
    expect(destinationClient.listCities).not.toHaveBeenCalled();
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
    }, kargonomiReturnSenderTaxInput);

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

  it('uses synced Kargonomi warehouse metadata for return receiver readiness', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(
      baseShippingConfig({
        providerMetadata: {
          fallbackBuyerStateId: '34',
          fallbackBuyerCityId: '828',
          kargonomiReturnReceiverName: 'Manual fallback warehouse',
          kargonomiReturnReceiverPhone: '+902129990000',
          kargonomiReturnReceiverAddress: 'Manual fallback address',
        },
        warehouses: [
          {
            warehouseId: '112666',
            provider: 'KARGONOMI',
            isDefault: true,
            name: 'Stored warehouse name',
            address: 'Synced warehouse address',
            metadata: {
              contactName: 'Synced Kargonomi contact',
              phone: '+902121112233',
              stateId: '34',
              cityId: '828',
              stateName: 'İstanbul',
              cityName: 'Kadıköy',
            },
          },
        ],
      }),
    );

    const preview = await previewKargonomiReturnShipmentForReturn('return-1', {
      role: 'vendor',
      vendorId: 'yalispor',
    }, kargonomiReturnSenderTaxInput);

    expect(preview.ready).toBe(true);
    expect(preview.missingFields).not.toContain('receiver.phone');
    expect(preview.missingFields).not.toContain('receiver.address');
    expect(preview.missingFields).not.toContain('receiver.stateId');
    expect(preview.missingFields).not.toContain('receiver.cityId');
    expect(preview.previewPayload).toMatchObject({
      shipment: {
        receiver: {
          warehouseId: '112666',
          namePresent: true,
          phonePresent: true,
          addressPresent: true,
          stateId: '34',
          cityId: '828',
        },
      },
    });
    const serializedPreview = JSON.stringify(preview.previewPayload);
    expect(serializedPreview).not.toContain('+902121112233');
    expect(serializedPreview).not.toContain('Synced warehouse address');
    expect(serializedPreview).not.toContain('Manual fallback address');
  });

  it('blocks create when preview readiness fails', async () => {
    const adapterCreateShipment = vi.fn();
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
          senderTaxNumber: kargonomiReturnSenderTaxInput.senderTaxNumber,
          adapter: {
            provider: 'KARGONOMI',
            createShipment: adapterCreateShipment,
          } as never,
        },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Kargonomi return shipment is not ready.'),
      details: expect.objectContaining({
        senderCityIdPresent: true,
        senderStateIdPresent: true,
        senderPhoneValid: true,
        senderTaxNumberPresent: true,
        buyerNameValid: false,
        receiverCityIdPresent: false,
        receiverStateIdPresent: false,
      }),
    });
    expect(adapterCreateShipment).not.toHaveBeenCalled();
  });

  it('blocks create before Kargonomi when sender tax number is missing', async () => {
    const adapterCreateShipment = vi.fn();
    prismaMock.returnRecord.findUnique.mockResolvedValue(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(baseShippingConfig());

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
            createShipment: adapterCreateShipment,
          } as never,
        },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('- sender.taxNumber'),
      details: expect.objectContaining({
        senderPhoneValid: true,
        senderTaxNumberPresent: false,
        senderTaxNumberSource: 'missing',
        buyerNameValid: true,
      }),
    });
    expect(adapterCreateShipment).not.toHaveBeenCalled();
  });

  it('blocks create before Kargonomi when buyer name has one word', async () => {
    const adapterCreateShipment = vi.fn();
    prismaMock.returnRecord.findUnique.mockResolvedValue(baseReturnRecord());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(
      baseShippingConfig({
        warehouses: [
          {
            warehouseId: '112668',
            provider: 'KARGONOMI',
            isDefault: true,
            name: 'Sporjinal',
            address: 'Vendor full address',
            metadata: {
              phone: '+902121112233',
              stateId: '34',
              cityId: '828',
            },
          },
        ],
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
          senderTaxNumber: kargonomiReturnSenderTaxInput.senderTaxNumber,
          adapter: {
            provider: 'KARGONOMI',
            createShipment: adapterCreateShipment,
          } as never,
        },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('- receiver.name'),
      details: expect.objectContaining({
        senderPhoneValid: true,
        senderTaxNumberPresent: true,
        buyerNameValid: false,
      }),
    });
    expect(adapterCreateShipment).not.toHaveBeenCalled();
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
        senderTaxNumber: kargonomiReturnSenderTaxInput.senderTaxNumber,
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
            sender_phone: '5551112233',
            sender_tax_number: '11111111111',
            sender_address: 'Customer full address',
            sender_state_id: '34',
            sender_city_id: '828',
          }),
          buyer: expect.objectContaining({
            buyer_name: 'Yalispor Warehouse',
            buyer_phone: '2121112233',
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

  it('uses Kargonomi account tax number fallback internally when creating return shipment', async () => {
    const adapterCreateShipment = vi.fn().mockResolvedValue({
      providerShipmentId: '2654003',
      trackingNumber: 'KSUR2654003RET',
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
        returnProviderShipmentId: '2654003',
        returnCarrierName: 'Sürat Kargo',
        returnTrackingNumber: 'KSUR2654003RET',
        returnLabel: 'data:application/pdf;base64,JVBER',
      }),
    );

    await createKargonomiReturnShipmentForReturn(
      'return-1',
      {
        role: 'admin',
        vendorId: null,
      },
      {
        KARGONOMI_ACCOUNT_TAX_NUMBER: 'test-account-tax-number',
      } as never,
      {
        adapter: {
          provider: 'KARGONOMI',
          createShipment: adapterCreateShipment,
        } as never,
      },
    );

    expect(adapterCreateShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          sender: expect.objectContaining({
            sender_tax_number: 'test-account-tax-number',
          }),
        }),
      }),
    );
    const persistedSnapshots = prismaMock.returnRecord.update.mock.calls.map((call) => JSON.stringify(call[0])).join('\n');
    expect(persistedSnapshots).not.toContain('test-account-tax-number');
    expect(persistedSnapshots).toContain('kargonomi_account_fallback');
  });

  it('reuses preview-resolved sender IDs when creating Kargonomi return shipment', async () => {
    const destinationClient = buildKargonomiDestinationClient();
    const adapterCreateShipment = vi.fn().mockResolvedValue({
      providerShipmentId: '2654002',
      trackingNumber: 'KSUR2654002RET',
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
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(
      baseShippingConfig({
        providerMetadata: {},
        warehouses: [
          {
            warehouseId: '112668',
            provider: 'KARGONOMI',
            isDefault: true,
            name: 'Yalispor Warehouse',
            address: 'Vendor full address',
            metadata: {
              phone: '+902121112233',
              stateId: '42',
              cityId: '796',
            },
          },
        ],
      }),
    );
    prismaMock.returnRecord.update.mockResolvedValue({});
    prismaMock.returnRecord.findFirst.mockResolvedValue(
      baseReturnRecord({
        returnProvider: 'kargonomi',
        returnProviderShipmentId: '2654002',
        returnCarrierName: 'Sürat Kargo',
        returnTrackingNumber: 'KSUR2654002RET',
        returnLabel: 'data:application/pdf;base64,JVBER',
      }),
    );

    await createKargonomiReturnShipmentForReturn(
      'return-1',
      {
        role: 'admin',
        vendorId: null,
      },
      {} as never,
      {
        kargonomiDestinationClient: destinationClient,
        senderTaxNumber: kargonomiReturnSenderTaxInput.senderTaxNumber,
        adapter: {
          provider: 'KARGONOMI',
          createShipment: adapterCreateShipment,
        } as never,
      },
    );

    expect(destinationClient.listStates).toHaveBeenCalled();
    expect(destinationClient.listCities).toHaveBeenCalledWith('34');
    expect(adapterCreateShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          sender: expect.objectContaining({
            sender_state_id: '34',
            sender_city_id: '828',
          }),
          buyer: expect.objectContaining({
            buyer_state_id: '42',
            buyer_city_id: '796',
          }),
        }),
      }),
    );
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
