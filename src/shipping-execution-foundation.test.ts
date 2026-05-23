import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorShippingConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  shipmentExecution: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  shipmentShippingCost: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  fulfillment: {
    upsert: vi.fn(),
  },
  returnRecord: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const shopifyAdminMock = vi.hoisted(() => ({
  fetchFulfillmentOrders: vi.fn(),
  createFulfillmentTracking: vi.fn(),
  probeReturnLabelUpload: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: () => shopifyAdminMock,
}));

const {
  cancelNavlungoShipmentExecution,
  createShipmentExecution,
  createTryOtoReturnShipmentLabel,
  getShippingProviderGateDiagnostics,
  getShipmentExecutionById,
  getShippingProviderReadinessDiagnostics,
  ingestKargoEntegratorWebhook,
  ingestTryOtoWebhook,
  inferShipmentDesi,
  probeShopifyReturnLabelUpload,
  probeTryOtoReturnAwbPrint,
  probeTryOtoReturnDetails,
  probeTryOtoReturnLink,
  previewShipmentExecution,
  refreshShipmentExecutionStatus,
  refreshTryOtoShipmentStatus,
  retryDryRunShipmentExecution,
  retryFailedShipmentExecution,
  syncNavlungoShipmentStatus,
  updateNavlungoShipmentExecution,
} = await import(
  '../backend/src/modules/shipping/shipping-execution.service.js'
);
const { KargoEntegratorAdapter, ShippingProviderExecutionError, TryOtoAdapter } = await import('../backend/src/modules/shipping/shipping-provider.adapter.js');
const { registerShippingExecutionRoutes } = await import('../backend/src/modules/shipping/shipping-execution.routes.js');
const { clearKargonomiLocationLookupCache } = await import('../backend/src/modules/shipping/kargonomi-provider.adapter.js');
const {
  autoCreateNavlungoReturnPickupForApprovedReturn,
  createNavlungoReturnPickupForReturn,
  saveNavlungoReturnPickupAddressCompletion,
  syncNavlungoReturnPickupStatusForReturn,
} = await import('../backend/src/modules/returns/returns.service.js');

const env = {
  NODE_ENV: 'test' as const,
  PORT: 4000,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
  CORS_ORIGIN: ['http://localhost:5173'],
  JWT_SECRET: 'test',
  JWT_EXPIRES_IN: '12h',
  SHOPIFY_WEBHOOK_SECRET: 'test',
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
  SCHEDULED_RECONCILIATION_ENABLED: false,
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
  SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
  SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
  SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
  EMAIL_NOTIFICATIONS_ENABLED: false,
  EMAIL_PROVIDER: 'noop' as const,
  EMAIL_ADMIN_RECIPIENTS: [],
  INVOICE_EXECUTION_ENABLED: false,
  INVOICE_PROVIDER: 'bizimhesap' as const,
  BIZIMHESAP_ENABLED: false,
  SHIPPING_EXECUTION_ENABLED: true,
  SHIPPING_SANDBOX_MODE: false,
  SHIPPING_PROVIDER: 'hepsijet' as const,
  KARGO_ENTEGRATOR_ENABLED: true,
  KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
  KARGO_ENTEGRATOR_BASE_URL: 'https://kargo.example',
  KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
  TRY_OTO_ENABLED: false,
  TRY_OTO_BASE_URL: undefined,
  TRY_OTO_REFRESH_TOKEN: undefined,
  TRY_OTO_SANDBOX_MODE: false,
  TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
  NAVLUNGO_BASE_URL: undefined,
  NAVLUNGO_API_USERNAME: undefined,
  NAVLUNGO_API_PASSWORD: undefined,
  NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: undefined,
  NAVLUNGO_DEFAULT_BARCODE_FORMAT: undefined,
  NAVLUNGO_DEFAULT_CARRIER_ID: undefined,
};

function buildNavlungoProviderMetadata(overrides: Record<string, unknown> = {}) {
  return {
    navlungoSenderAddressId: '55574',
    navlungoSenderName: 'Sporjinal Warehouse',
    navlungoSenderPhone: '+90 532 123 45 67',
    navlungoSenderEmail: 'warehouse@example.test',
    navlungoSenderAddress: 'Sporjinal Depo Sokak No: 1',
    navlungoSenderCountry: 'tr',
    navlungoSenderCity: 'Istanbul',
    navlungoSenderDistrict: 'Kadikoy',
    navlungoSenderPostCode: '',
    navlungoBarcodeFormat: 'pdf-A6',
    navlungoCarrierId: '9',
    ...overrides,
  };
}

function buildNavlungoReturnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-request-1',
    vendorAllocationId: 'alloc-1',
    sourceShopifyOrderId: 'order-1',
    sourceShopifyOrderNumber: '1054',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: '23165600081',
    sourceShopifyReturnGid: 'gid://shopify/Return/23165600081',
    sourceShopifyLineItemId: 'line-1',
    returnLifecycleStatus: 'approved',
    returnRequestSource: 'shopify_return_request',
    requestCreatedAt: new Date('2026-05-22T08:00:00.000Z'),
    requestUpdatedAt: null,
    status: 'approved',
    reason: 'Size issue',
    returnReasonNote: null,
    returnProvider: null,
    returnProviderShipmentId: null,
    returnLabel: null,
    returnReferenceId: null,
    navlungoReturnCreatedAt: null,
    returnProviderSnapshot: null,
    returnCarrierName: null,
    returnTrackingNumber: null,
    returnTrackingUrl: null,
    vendorReceivedAt: null,
    vendorReviewedAt: null,
    vendorDecision: null,
    vendorDecisionReason: null,
    createdAt: new Date('2026-05-22T08:00:00.000Z'),
    updatedAt: new Date('2026-05-22T08:00:00.000Z'),
    vendorAllocation: {
      id: 'alloc-1',
      assignedVendorId: 'sporjinal',
      originalVendorId: 'sporjinal',
      sourceShopifyOrderId: 'order-1',
      sourceShopifyOrderNumber: '1054',
      order: {
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 532 123 45 67',
        shippingAddress: 'Test Mah. No: 1',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingCountry: 'tr',
        shippingPostcode: '',
      },
      lineItems: [
        {
          id: 'alloc-line-1',
          quantity: 1,
          lineAmount: 0,
          shopifyOrderLineItem: {
            sourceLineItemId: 'line-1',
            sourceVariantId: null,
            sku: 'SKU-1',
            title: 'Return item',
          },
        },
      ],
      refundRecords: [],
    },
    ...overrides,
  };
}

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1',
    assignedVendorId: 'sporjinal',
    sourceShopifyOrderId: '7616544244049',
    sourceShopifyOrderNumber: '1027',
    allocationStatus: 'ACTIVE',
    cancellationReason: null,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    fulfillment: null,
    order: {
      id: 'order-1',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
    },
    lineItems: [
      {
        quantity: 1,
        lineAmount: 4999,
        shopifyOrderLineItem: {
          title: 'Nike Air Max Alpha Trainer 6',
          sku: 'FQ1833-200-41',
        },
      },
    ],
    ...overrides,
  };
}

function buildAllocationWithShopifyFulfillmentData(overrides: Record<string, unknown> = {}) {
  return buildAllocation({
    sourceShopifyOrderId: 'gid://shopify/Order/1055',
    order: {
      id: 'order-1',
      sourceShopifyOrderId: 'gid://shopify/Order/1055',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
      customerPhone: '+90 555 111 22 33',
      shippingCountry: 'tr',
      shippingCity: 'Istanbul',
      shippingDistrict: 'Kartal',
      shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
    },
    lineItems: [
      {
        quantity: 1,
        lineAmount: 4999,
        shopifyOrderLineItem: {
          title: 'Nike Air Max Alpha Trainer 6',
          sku: 'FQ1833-200-41',
          sourceLineItemId: 'gid://shopify/LineItem/line-1055',
        },
      },
    ],
    ...overrides,
  });
}

function buildShipmentExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shipment-hepsijet-alloc-1',
    allocationId: 'alloc-1',
    vendorId: 'sporjinal',
    sourceShopifyOrderId: '7616544244049',
    sourceShopifyOrderNumber: '1027',
    sourceShopifyFulfillmentId: null,
    provider: 'HEPSIJET',
    providerShipmentId: null,
    trackingNumber: null,
    trackingUrl: null,
    labelUrl: null,
    shipmentStatus: 'PENDING',
    desi: 3,
    cargoIntegrationId: null,
    warehouseId: null,
    shippingCost: null,
    shippingVat: null,
    currency: 'TRY',
    requestSnapshot: {},
    responseSnapshot: null,
    createdAt: new Date('2026-05-15T10:00:00.000Z'),
    updatedAt: new Date('2026-05-15T10:00:00.000Z'),
    ...overrides,
  };
}

function buildAdapter(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'HEPSIJET' as const,
    createShipment: vi.fn(),
    getShipmentStatus: vi.fn(),
    getTrackingInfo: vi.fn(),
    cancelShipment: vi.fn(),
    ...overrides,
  };
}

function mockProviderResponse(body: string, options: { status?: number; contentType?: string } = {}) {
  const status = options.status ?? 200;
  const contentType = options.contentType ?? 'application/json';
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => body,
  } as Response;
}

describe('shipping execution foundation', () => {
  let storedExecution: ReturnType<typeof buildShipmentExecution>;

  beforeEach(() => {
    clearKargonomiLocationLookupCache();
    prismaMock.vendorAllocation.findUnique.mockReset();
    prismaMock.vendorAllocation.update.mockReset();
    prismaMock.vendorShippingConfig.findUnique.mockReset();
    prismaMock.vendorShippingConfig.upsert.mockReset();
    prismaMock.shipmentExecution.findUnique.mockReset();
    prismaMock.shipmentExecution.findFirst.mockReset();
    prismaMock.shipmentExecution.findMany.mockReset();
    prismaMock.shipmentExecution.create.mockReset();
    prismaMock.shipmentExecution.update.mockReset();
    prismaMock.shipmentShippingCost.findFirst.mockReset();
    prismaMock.shipmentShippingCost.upsert.mockReset();
    prismaMock.fulfillment.upsert.mockReset();
    prismaMock.returnRecord.findFirst.mockReset();
    prismaMock.returnRecord.findUnique.mockReset();
    prismaMock.returnRecord.update.mockReset();
    prismaMock.$transaction.mockReset();
    shopifyAdminMock.fetchFulfillmentOrders.mockReset();
    shopifyAdminMock.createFulfillmentTracking.mockReset();
    shopifyAdminMock.probeReturnLabelUpload.mockReset();

    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(null);
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(null);
    storedExecution = buildShipmentExecution();
    prismaMock.shipmentExecution.create.mockImplementation(async ({ data }) => {
      storedExecution = buildShipmentExecution({
        ...data,
        allocationId: data.allocationId ?? data.allocation?.connect?.id,
        vendorId: data.vendorId ?? data.vendor?.connect?.id,
        createdAt: new Date('2026-05-15T10:00:00.000Z'),
        updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      });
      return storedExecution;
    });
    prismaMock.shipmentExecution.update.mockImplementation(async ({ data }) => {
      storedExecution = buildShipmentExecution({
        ...storedExecution,
        ...data,
        updatedAt: new Date('2026-05-15T10:05:00.000Z'),
      });
      return storedExecution;
    });
    prismaMock.shipmentShippingCost.findFirst.mockResolvedValue(null);
    prismaMock.shipmentShippingCost.upsert.mockImplementation(async ({ create, update }) => ({
      ...create,
      ...update,
    }));
    prismaMock.returnRecord.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    shopifyAdminMock.fetchFulfillmentOrders.mockResolvedValue({
      fulfillmentOrders: [
        {
          id: 'gid://shopify/FulfillmentOrder/fo-1055',
          status: 'OPEN',
          lineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/foli-1055',
              lineItemId: 'gid://shopify/LineItem/line-1055',
              quantity: 1,
            },
          ],
        },
      ],
    });
    shopifyAdminMock.createFulfillmentTracking.mockResolvedValue({
      fulfillmentId: 'gid://shopify/Fulfillment/fulfillment-1055',
      status: 'submitted',
      source: 'shopify_admin',
      fulfillmentCreated: true,
      skippedReason: null,
      fulfillmentOrderIdPresent: true,
      fulfillmentIdPresent: true,
    });
  });

  it('creates a shipment execution and links confirmed provider cost to finance shipping cost input', async () => {
    const adapter = buildAdapter();
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'hpj-1027',
      trackingNumber: 'TRK1027',
      trackingUrl: 'https://tracking.example/TRK1027',
      labelUrl: 'https://labels.example/TRK1027.pdf',
      shipmentStatus: 'created',
      shippingCost: 120,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['shipmentId', 'trackingNumber'] },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'hepsijet',
      providerShipmentId: 'hpj-1027',
      trackingNumber: 'TRK1027',
      shipmentStatus: 'created',
      desi: '3.00',
      shippingCost: '120.00',
      shippingVat: '21.60',
      shippingCostLinked: true,
    });
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          carrier: 'hepsijet',
          shippingStatus: 'label_created',
          trackingNumber: 'TRK1027',
        }),
      }),
    );
    expect(prismaMock.shipmentShippingCost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          allocationId: 'alloc-1',
          providerName: 'hepsijet',
          providerReference: 'hpj-1027',
          shippingCost: 120,
          shippingVatAmount: 21.6,
          status: 'CONFIRMED',
          sourceType: 'EXTERNAL_PROVIDER',
        }),
      }),
    );
  });

  it('uses vendor-specific shipping config and default desi when product heuristics do not match', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'HEPSIJET',
      shippingEnabled: true,
      defaultDesi: 5,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        lineItems: [
          {
            quantity: 1,
            lineAmount: 999,
            shopifyOrderLineItem: {
              title: 'Gift card',
              sku: 'GIFT-1',
            },
          },
        ],
      }),
    );
    const adapter = buildAdapter();
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'pending',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, dryRun: true },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      provider: 'hepsijet',
      shipmentStatus: 'pending',
      desi: '5.00',
    });
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'hepsijet',
        requestSnapshot: expect.objectContaining({
          desi: 5,
        }),
      }),
    );
  });

  it('builds Kargonomi payload with configured warehouse 112668 and automatic provider selection', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-112668',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGONOMI',
          warehouseId: '112668',
          name: 'Sporjinal Kargonomi warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
          shippingCity: 'Istanbul',
          shippingStateId: '34',
          shippingCityId: '828',
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'kg-1027',
      trackingNumber: 'KG-TRACK-1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'kargonomi',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargonomi',
          SHIPPING_EXECUTION_ENABLED: true,
          KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
          KARGONOMI_API_TOKEN: 'test-token',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargonomi',
        requestSnapshot: expect.objectContaining({
          warehouseId: '112668',
          shippingProviderId: '-1',
          buyer: expect.objectContaining({
            buyer_name: 'Test Customer',
            buyer_phone: '5551112233',
            buyer_address: 'Test Mah. Test Sok. No:1',
            buyer_state_id: '34',
            buyer_city_id: '828',
          }),
          packages: [
            expect.objectContaining({
              desi: 3,
            }),
          ],
        }),
      }),
    );
  });

  it('resolves Kargonomi destination IDs from order shipping address before shipment create', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
          shippingCity: 'İstanbul',
          shippingDistrict: 'Kadıköy',
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'kg-1027',
      trackingNumber: 'KG-TRACK-1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });
    const kargonomiDestinationClient = {
      listStates: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 34, name: 'İstanbul' }] },
      }),
      listCities: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 828, name: 'Kadıköy' }] },
      }),
    };

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'kargonomi',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargonomi',
          SHIPPING_EXECUTION_ENABLED: true,
          KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
          KARGONOMI_API_TOKEN: 'test-token',
        },
        vendorId: 'sporjinal',
        adapter,
        kargonomiDestinationClient,
      },
    );

    expect(kargonomiDestinationClient.listStates).toHaveBeenCalled();
    expect(kargonomiDestinationClient.listCities).toHaveBeenCalledWith('34');
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargonomi',
        requestSnapshot: expect.objectContaining({
          buyer: expect.objectContaining({
            buyer_state_id: '34',
            buyer_city_id: '828',
          }),
          destinationResolution: expect.objectContaining({
            source: 'order_shipping_address_lookup',
            resolved: true,
          }),
        }),
      }),
    );
  });

  it('uses shipment-only district override for Kargonomi destination resolution', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
          shippingCity: 'İstanbul',
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'kg-1027',
      trackingNumber: 'KG-TRACK-1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });
    const kargonomiDestinationClient = {
      listStates: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 34, name: 'İstanbul' }] },
      }),
      listCities: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 828, name: 'Kadıköy' }] },
      }),
    };

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'kargonomi',
        customerOverrides: {
          district: 'Kadikoy',
        },
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargonomi',
          SHIPPING_EXECUTION_ENABLED: true,
          KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
          KARGONOMI_API_TOKEN: 'test-token',
        },
        vendorId: 'sporjinal',
        adapter,
        kargonomiDestinationClient,
      },
    );

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          buyer: expect.objectContaining({
            buyer_city_id: '828',
          }),
        }),
      }),
    );
  });

  it('passes shipment-only district override from the create route into Kargonomi resolution', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
          shippingCity: 'İstanbul',
        },
      }),
    );
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body;
      calls.push({ url: String(url), body });
      const responseBody = String(url).includes('/states')
        ? { data: [{ id: 34, name: 'İstanbul' }] }
        : String(url).includes('/cities/34')
          ? { data: [{ id: 829, name: 'Kartal' }] }
          : String(url).endsWith('/shipments')
            ? { shipment: { id: 123, status: 'draft' } }
            : String(url).includes('/shipment-price-comparison/')
              ? { shipping_provider_with_price: [{ id: '-1', name: 'Otomatik', slug: 'otomatik', price: null }] }
              : String(url).includes('/confirm-shipping-price')
                ? { ok: true }
                : String(url).includes('/barcode')
                  ? { barcode_pdf_base64: 'JVBERi0xLjQ=' }
                  : {
                      shipment: {
                        id: 123,
                        status: 'webservice_order_created',
                        shipping_provider_name: 'Yurtiçi Kargo',
                      },
                    };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    const posts = new Map<string, (request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, ...args: unknown[]) => {
        const handler = args.at(-1) as (request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown;
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    try {
      registerShippingExecutionRoutes(app as never, {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        SHIPPING_EXECUTION_ENABLED: true,
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
        KARGONOMI_API_TOKEN: 'test-token',
      });
      await posts.get('/shipments/create')?.(
        {
          body: {
            allocationId: 'alloc-1',
            provider: 'kargonomi',
            customerOverrides: {
              district: 'Kartal',
            },
          },
          vendorContext: { vendorId: 'sporjinal' },
          headers: {},
          protocol: 'https',
          hostname: 'example.test',
        },
        reply,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenCalled();
    expect(calls.some((call) => call.url.endsWith('/cities/34'))).toBe(true);
    const createCall = calls.find((call) => call.url.endsWith('/shipments'));
    expect(createCall?.body).toMatchObject({
      shipment: expect.objectContaining({
        buyer_state_id: '34',
        buyer_city_id: '829',
      }),
    });
  });

  it('blocks Kargonomi before provider call when district override cannot be matched', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
          shippingCity: 'İstanbul',
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          provider: 'kargonomi',
          customerOverrides: {
            district: 'Beşiktaş',
          },
        },
        {
          env: {
            ...env,
            SHIPPING_PROVIDER: 'kargonomi',
            SHIPPING_EXECUTION_ENABLED: true,
            KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
            KARGONOMI_API_TOKEN: 'test-token',
          },
          vendorId: 'sporjinal',
          adapter,
          kargonomiDestinationClient: {
            listStates: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'application/json',
              body: { data: [{ id: 34, name: 'İstanbul' }] },
            }),
            listCities: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'application/json',
              body: { data: [{ id: 828, name: 'Kadıköy' }] },
            }),
          },
        },
      ),
    ).rejects.toThrow('Kargonomi destination district could not be matched: Beşiktaş');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks Kargonomi before provider call when warehouse ID is missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
          shippingStateId: '34',
          shippingCityId: '828',
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          provider: 'kargonomi',
        },
        {
          env: {
            ...env,
            SHIPPING_PROVIDER: 'kargonomi',
            SHIPPING_EXECUTION_ENABLED: true,
            KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
            KARGONOMI_API_TOKEN: 'test-token',
            KARGONOMI_DEFAULT_WAREHOUSE_ID: undefined,
          },
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Kargonomi warehouse ID is not configured for this vendor.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks Kargonomi before provider call when destination cannot resolve', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          provider: 'kargonomi',
        },
        {
          env: {
            ...env,
            SHIPPING_PROVIDER: 'kargonomi',
            SHIPPING_EXECUTION_ENABLED: true,
            KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
            KARGONOMI_API_TOKEN: 'test-token',
          },
          vendorId: 'sporjinal',
          adapter,
          kargonomiDestinationClient: {
            listStates: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'application/json',
              body: { data: [] },
            }),
            listCities: vi.fn(),
          },
        },
      ),
    ).rejects.toThrow('Kargonomi destination could not be resolved from the order shipping address.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('uses Kargonomi fallback buyer IDs only when address lookup cannot resolve', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: {
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress1: 'Test Mah. Test Sok. No:1',
          shippingCity: 'Unknown',
          shippingDistrict: 'Unknown',
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'kg-1027',
      trackingNumber: 'KG-TRACK-1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'kargonomi',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargonomi',
          SHIPPING_EXECUTION_ENABLED: true,
          KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
          KARGONOMI_API_TOKEN: 'test-token',
        },
        vendorId: 'sporjinal',
        adapter,
        kargonomiDestinationClient: {
          listStates: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            contentType: 'application/json',
            body: { data: [] },
          }),
          listCities: vi.fn(),
        },
      },
    );

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          buyer: expect.objectContaining({
            buyer_state_id: '34',
            buyer_city_id: '828',
          }),
          destinationResolution: expect.objectContaining({
            source: 'fallback_metadata_after_lookup_failure',
            resolved: false,
          }),
        }),
      }),
    );
  });

  it('uses Sporjinal Kargo Entegratör warehouse 1774 and cargo integration 2547', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-1027',
      trackingNumber: 'KE1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['id'] },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      provider: 'kargo_entegrator',
      cargoIntegrationId: '2547',
      warehouseId: '1774',
      providerShipmentId: 'ke-1027',
    });
    expect(prismaMock.shipmentExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'KARGO_ENTEGRATOR',
          cargoIntegrationId: '2547',
          warehouseId: '1774',
          desi: 3,
          allocation: {
            connect: {
              id: 'alloc-1',
            },
          },
        }),
      }),
    );
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargo_entegrator',
        requestSnapshot: expect.objectContaining({
          cargo_integration_id: 2547,
          warehouse_id: 1774,
          platform_id: '7616544244049',
          platform_d_id: '1027',
          payment_type: 'cash_money',
          payor_type: 'sender',
          kg: 3,
        }),
      }),
    );
  });

  it('uses Kargo cargo integration env fallback only when vendor config has no cargo integration id', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['id'] },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env: {
          ...env,
          KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: '2547',
          KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE: 'primary',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      provider: 'kargo_entegrator',
      cargoIntegrationId: '2547',
      warehouseId: '1774',
    });
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          cargo_integration_id: 2547,
          platform_id: '7616544244049',
          platform_d_id: '1027',
          payment_type: 'cash_money',
          payor_type: 'sender',
          warehouse_id: 1774,
        }),
      }),
    );
  });

  it('blocks Kargo Entegratör shipment creation when warehouse config is missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
        },
        {
          env,
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Vendor shipping warehouse is not configured.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('applies deterministic initial desi heuristics for shoes, bags, and apparel', () => {
    expect(inferShipmentDesi([{ title: 'Running shoes', sku: null }], 8)).toBe(3);
    expect(inferShipmentDesi([{ title: 'Leather bag', sku: null }], 8)).toBe(3);
    expect(inferShipmentDesi([{ title: 'Cotton apparel set', sku: null }], 8)).toBe(3);
    expect(inferShipmentDesi([{ title: 'Gift card', sku: 'GIFT-1' }], 8)).toBe(8);
  });

  it('returns the existing shipment execution without creating a duplicate', async () => {
    const existing = buildShipmentExecution({
      providerShipmentId: 'hpj-existing',
      trackingNumber: 'TRK-EXISTING',
      shipmentStatus: 'CREATED',
    });
    prismaMock.shipmentExecution.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    prismaMock.shipmentShippingCost.findFirst.mockResolvedValueOnce({
      id: 'shipcost-existing',
    });
    const adapter = buildAdapter();

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      id: 'shipment-hepsijet-alloc-1',
      trackingNumber: 'TRK-EXISTING',
      shippingCostLinked: true,
    });
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('lifts nested Navlungo 422 validation diagnostics into the shipment DTO summary', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-validation-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        provider: 'navlungo',
        createPostHttpStatus: 422,
        providerMessage: 'Validation Errors',
        createPost: {
          validationErrorKeys: ['posts.0.sender.phone', 'posts.0.recipient.email'],
          failedFieldNames: ['posts.0.sender.phone', 'posts.0.recipient.email'],
          validationErrorMessages: [
            'posts.0.sender.phone contains +90 532 123 45 67',
            'posts.0.recipient.email contains buyer@example.test',
          ],
          providerErrorCode: 'VALIDATION_ERROR',
          validationErrorKeysCount: 2,
          failedFieldNamesCount: 2,
          validationErrorMessagesCount: 2,
          providerValidationErrorsShape: 'array:2',
          topLevelErrorShape: 'missing',
          nestedCreatePostErrorShape: 'object:2',
          validationResponseShape: {
            kind: 'json:object',
            topLevelKeys: ['message', 'status', 'error'],
          },
        },
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);
    prismaMock.shipmentShippingCost.findFirst.mockResolvedValueOnce(null);

    const result = await getShipmentExecutionById(existing.id, 'sporjinal');

    expect(result?.providerResponseSummary).toMatchObject({
      httpStatus: 422,
      validationErrorKeys: ['posts.0.sender.phone', 'posts.0.recipient.email'],
      failedFieldNames: ['posts.0.sender.phone', 'posts.0.recipient.email'],
      validationErrorMessages: [
        'posts.0.sender.phone contains [redacted-phone]',
        'posts.0.recipient.email contains [redacted-email]',
      ],
      providerValidationErrors: [
        'posts.0.sender.phone contains [redacted-phone]',
        'posts.0.recipient.email contains [redacted-email]',
      ],
      validationErrorKeysCount: 2,
      failedFieldNamesCount: 2,
      validationErrorMessagesCount: 2,
      providerValidationErrorsShape: 'array:2',
      topLevelErrorShape: 'missing',
      nestedCreatePostErrorShape: 'object:2',
      providerErrorCode: 'VALIDATION_ERROR',
      validationResponseShape: {
        kind: 'json:object',
        topLevelKeys: ['message', 'status', 'error'],
      },
    });
  });

  it('cancels an existing Navlungo shipment without deleting Shopify fulfillment', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-1001',
      trackingNumber: 'NV-1001',
      trackingUrl: 'https://tracking.test/NV-1001',
      labelUrl: 'barcode-pdf',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'navlungo',
        barcode: 'barcode-pdf',
      },
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO',
      cancelShipment: vi.fn().mockResolvedValue({
        providerShipmentId: 'NV-1001',
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'cancelled',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          provider: 'navlungo',
          navlungoCancelAttempted: true,
          navlungoCancelHttpStatus: 200,
          navlungoCancelSucceeded: true,
          navlungoCancelledAt: '2026-05-22T10:00:00.000Z',
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);
    prismaMock.shipmentExecution.update
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          provider: 'navlungo',
          navlungoCancelAttempted: true,
        },
      })
      .mockResolvedValueOnce({
        ...existing,
        shipmentStatus: 'CANCELLED',
        responseSnapshot: {
          provider: 'navlungo',
          barcode: 'barcode-pdf',
          navlungoCancelAttempted: true,
          navlungoCancelHttpStatus: 200,
          navlungoCancelSucceeded: true,
          navlungoCancelledAt: '2026-05-22T10:00:00.000Z',
          shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
        },
      });

    const result = await cancelNavlungoShipmentExecution(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.cancelShipment).toHaveBeenCalledWith('NV-1001');
    expect(result.shipmentStatus).toBe('cancelled');
    expect(result.providerShipmentId).toBe('NV-1001');
    expect(result.trackingNumber).toBe('NV-1001');
    expect(result.labelUrl).toBe('barcode-pdf');
    expect(result.providerResponseSummary).toMatchObject({
      navlungoCancelAttempted: true,
      navlungoCancelHttpStatus: 200,
      navlungoCancelSucceeded: true,
      shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
    });
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
  });

  it('blocks Navlungo cancel when the provider post number is missing', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: null,
      shipmentStatus: 'CREATED',
    });
    const adapter = buildAdapter({ provider: 'NAVLUNGO' });
    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);

    await expect(cancelNavlungoShipmentExecution(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    })).rejects.toThrow('stored provider post number');

    expect(adapter.cancelShipment).not.toHaveBeenCalled();
  });

  it('blocks Navlungo cancel when locally delivered or already cancelled', async () => {
    const delivered = buildShipmentExecution({
      id: 'shipment-navlungo-delivered',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-1002',
      shipmentStatus: 'DELIVERED',
    });
    const cancelled = buildShipmentExecution({
      id: 'shipment-navlungo-cancelled',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-1003',
      shipmentStatus: 'CANCELLED',
    });
    const adapter = buildAdapter({ provider: 'NAVLUNGO' });

    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(delivered);
    await expect(cancelNavlungoShipmentExecution(delivered.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    })).rejects.toThrow('Delivered Navlungo shipments cannot be cancelled');

    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(cancelled);
    await expect(cancelNavlungoShipmentExecution(cancelled.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    })).rejects.toThrow('already locally cancelled');

    expect(adapter.cancelShipment).not.toHaveBeenCalled();
  });

  it('persists Navlungo cancel validation diagnostics without cancelling locally', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-1004',
      shipmentStatus: 'CREATED',
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO',
      cancelShipment: vi.fn().mockRejectedValue(new ShippingProviderExecutionError('Navlungo Cancel Post failed with HTTP 422.', {
        provider: 'navlungo',
        navlungoCancelAttempted: true,
        navlungoCancelHttpStatus: 422,
        navlungoCancelSucceeded: false,
        navlungoCancelProviderMessage: 'Validation Errors',
        navlungoCancelValidationFields: ['post_number'],
        navlungoCancelValidationMessages: ['post_number validation failed'],
        validationErrorMessages: ['post_number validation failed'],
        failedFieldNames: ['post_number'],
      })),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);
    prismaMock.shipmentExecution.update
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          navlungoCancelAttempted: true,
        },
      })
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          navlungoCancelAttempted: true,
          navlungoCancelHttpStatus: 422,
          navlungoCancelSucceeded: false,
          navlungoCancelProviderMessage: 'Validation Errors',
          navlungoCancelValidationFields: ['post_number'],
          navlungoCancelValidationMessages: ['post_number validation failed'],
          failedFieldNames: ['post_number'],
          validationErrorMessages: ['post_number validation failed'],
          shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
        },
      });

    const result = await cancelNavlungoShipmentExecution(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(result.shipmentStatus).toBe('created');
    expect(result.providerResponseSummary).toMatchObject({
      navlungoCancelHttpStatus: 422,
      navlungoCancelSucceeded: false,
      navlungoCancelValidationFields: ['post_number'],
      navlungoCancelValidationMessages: ['post_number validation failed'],
    });
  });

  it('persists Navlungo cancel provider tracking ids for 500 responses', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-1005',
      shipmentStatus: 'CREATED',
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO',
      cancelShipment: vi.fn().mockRejectedValue(new ShippingProviderExecutionError('Navlungo Cancel Post failed with HTTP 500.', {
        provider: 'navlungo',
        navlungoCancelAttempted: true,
        navlungoCancelHttpStatus: 500,
        navlungoCancelSucceeded: false,
        navlungoCancelProviderMessage: 'Execution of ServiceCallout failed. Tracking ID: #abc123',
        navlungoCancelProviderTrackingId: '#abc123',
        providerTrackingId: '#abc123',
      })),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);
    prismaMock.shipmentExecution.update
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          navlungoCancelAttempted: true,
        },
      })
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          navlungoCancelAttempted: true,
          navlungoCancelHttpStatus: 500,
          navlungoCancelSucceeded: false,
          navlungoCancelProviderMessage: 'Execution of ServiceCallout failed. Tracking ID: #abc123',
          navlungoCancelProviderTrackingId: '#abc123',
          providerTrackingId: '#abc123',
          shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
        },
      });

    const result = await cancelNavlungoShipmentExecution(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(result.shipmentStatus).toBe('created');
    expect(result.providerResponseSummary).toMatchObject({
      navlungoCancelHttpStatus: 500,
      navlungoCancelSucceeded: false,
      navlungoCancelProviderTrackingId: '#abc123',
      providerTrackingId: '#abc123',
    });
  });

  it('updates an existing Navlungo shipment with full sender fields', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-update-1',
      allocationId: 'alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-2001',
      trackingNumber: 'NV-2001',
      trackingUrl: 'https://tracking.test/NV-2001',
      labelUrl: 'old-barcode',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'navlungo',
        flow: 'forward',
      },
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO',
      updateShipment: vi.fn().mockResolvedValue({
        providerShipmentId: 'NV-2001',
        trackingNumber: 'TRK-2001',
        trackingUrl: 'https://tracking.test/TRK-2001',
        labelUrl: 'new-barcode',
        shipmentStatus: 'created',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          provider: 'navlungo',
          navlungoUpdateAttempted: true,
          navlungoUpdateHttpStatus: 200,
          navlungoUpdateSucceeded: true,
          navlungoUpdateSenderMode: 'fullSender',
          navlungoUpdateSenderFieldKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
          navlungoUpdateMissingSenderFields: [],
          navlungoUpdatedAt: '2026-05-22T10:00:00.000Z',
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocationWithShopifyFulfillmentData());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });
    prismaMock.shipmentExecution.update
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          navlungoUpdateAttempted: true,
        },
      })
      .mockResolvedValueOnce({
        ...existing,
        trackingNumber: 'TRK-2001',
        trackingUrl: 'https://tracking.test/TRK-2001',
        labelUrl: 'new-barcode',
        responseSnapshot: {
          provider: 'navlungo',
          navlungoUpdateAttempted: true,
          navlungoUpdateHttpStatus: 200,
          navlungoUpdateSucceeded: true,
          navlungoUpdateSenderMode: 'fullSender',
          navlungoUpdateSenderFieldKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
          navlungoUpdateMissingSenderFields: [],
          navlungoUpdatedAt: '2026-05-22T10:00:00.000Z',
          shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
        },
      });

    const result = await updateNavlungoShipmentExecution(existing.id, {
      recipient: {
        district: 'Kartal',
      },
      postNote: 'Leave at reception',
      barcodeFormat: 'pdf-A6',
    }, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.updateShipment).toHaveBeenCalledWith({
      providerShipmentId: 'NV-2001',
      requestSnapshot: expect.objectContaining({
        post_number: 'NV-2001',
        sender: expect.objectContaining({
          name: 'Sporjinal Warehouse',
          phone: '+90 532 123 45 67',
          email: 'warehouse@example.test',
          address: 'Sporjinal Depo Sokak No: 1',
          country: 'tr',
          city: 'Istanbul',
          district: 'Kadikoy',
          post_code: '',
        }),
        recipient: expect.objectContaining({
          district: 'Kartal',
          city: 'Istanbul',
          address: 'Test Mahallesi 1. Sokak No: 1',
        }),
        post: {
          note: 'Leave at reception',
        },
        barcode_format: 'pdf-A6',
      }),
    });
    expect(adapter.updateShipment.mock.calls[0][0].requestSnapshot.sender).not.toHaveProperty('addressId');
    expect(result.trackingNumber).toBe('TRK-2001');
    expect(result.labelUrl).toBe('new-barcode');
    expect(result.providerResponseSummary).toMatchObject({
      navlungoUpdateAttempted: true,
      navlungoUpdateHttpStatus: 200,
      navlungoUpdateSucceeded: true,
      navlungoUpdateSenderMode: 'fullSender',
      navlungoUpdateMissingSenderFields: [],
      shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
    });
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
  });

  it('blocks Navlungo update before provider call when full sender fields are missing', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-update-missing-sender',
      allocationId: 'alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-2001',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'navlungo',
        flow: 'forward',
      },
    });
    const adapter = buildAdapter({ provider: 'NAVLUNGO', updateShipment: vi.fn() });

    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocationWithShopifyFulfillmentData());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({
        navlungoSenderName: '',
        navlungoSenderPhone: '',
        navlungoSenderAddress: '',
        navlungoSenderCity: '',
        navlungoSenderDistrict: '',
      }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    await expect(updateNavlungoShipmentExecution(existing.id, { recipient: { district: 'Kartal' } }, {
      env,
      vendorId: 'sporjinal',
      adapter,
    })).rejects.toThrow(/Missing required Navlungo update sender fields/);

    expect(adapter.updateShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('blocks Navlungo update without post number or for delivered/cancelled shipments', async () => {
    const missingPost = buildShipmentExecution({
      id: 'shipment-navlungo-missing-post',
      provider: 'NAVLUNGO',
      providerShipmentId: null,
      shipmentStatus: 'CREATED',
    });
    const delivered = buildShipmentExecution({
      id: 'shipment-navlungo-delivered-update',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-2002',
      shipmentStatus: 'DELIVERED',
    });
    const cancelled = buildShipmentExecution({
      id: 'shipment-navlungo-cancelled-update',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-2003',
      shipmentStatus: 'CANCELLED',
    });
    const adapter = buildAdapter({ provider: 'NAVLUNGO', updateShipment: vi.fn() });

    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(missingPost);
    await expect(updateNavlungoShipmentExecution(missingPost.id, {}, { env, vendorId: 'sporjinal', adapter }))
      .rejects.toThrow('stored provider post number');

    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(delivered);
    await expect(updateNavlungoShipmentExecution(delivered.id, {}, { env, vendorId: 'sporjinal', adapter }))
      .rejects.toThrow('Delivered Navlungo shipments cannot be updated');

    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(cancelled);
    await expect(updateNavlungoShipmentExecution(cancelled.id, {}, { env, vendorId: 'sporjinal', adapter }))
      .rejects.toThrow('Cancelled Navlungo shipments cannot be updated');

    expect(adapter.updateShipment).not.toHaveBeenCalled();
  });

  it('persists Navlungo update validation and provider tracking diagnostics', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-update-422',
      allocationId: 'alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NV-2004',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'navlungo',
        flow: 'forward',
      },
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO',
      updateShipment: vi.fn().mockRejectedValue(new ShippingProviderExecutionError('Navlungo Update Post failed with HTTP 422.', {
        provider: 'navlungo',
        navlungoUpdateAttempted: true,
        navlungoUpdateHttpStatus: 422,
        navlungoUpdateSucceeded: false,
        navlungoUpdateProviderMessage: 'Validation Errors',
        navlungoUpdateValidationFields: ['posts.0.recipient.district'],
        navlungoUpdateValidationMessages: ['posts.0.recipient.district validation failed'],
        navlungoUpdateProviderTrackingId: '#update123',
        navlungoUpdateResponseShape: {
          kind: 'json:object',
          topLevelKeys: ['message', 'status', 'error'],
        },
        providerTrackingId: '#update123',
      })),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValueOnce(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocationWithShopifyFulfillmentData());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata(),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });
    prismaMock.shipmentExecution.update
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          navlungoUpdateAttempted: true,
        },
      })
      .mockResolvedValueOnce({
        ...existing,
        responseSnapshot: {
          provider: 'navlungo',
          navlungoUpdateAttempted: true,
          navlungoUpdateHttpStatus: 422,
          navlungoUpdateSucceeded: false,
          navlungoUpdateProviderMessage: 'Validation Errors',
          navlungoUpdateValidationFields: ['posts.0.recipient.district'],
          navlungoUpdateValidationMessages: ['posts.0.recipient.district validation failed'],
          navlungoUpdateProviderTrackingId: '#update123',
          navlungoUpdateResponseShape: {
            kind: 'json:object',
            topLevelKeys: ['message', 'status', 'error'],
          },
          providerTrackingId: '#update123',
          shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
        },
      });

    const result = await updateNavlungoShipmentExecution(existing.id, { recipient: { district: 'Kartal' } }, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(result.providerResponseSummary).toMatchObject({
      navlungoUpdateHttpStatus: 422,
      navlungoUpdateSucceeded: false,
      navlungoUpdateValidationFields: ['posts.0.recipient.district'],
      navlungoUpdateValidationMessages: ['posts.0.recipient.district validation failed'],
      navlungoUpdateProviderTrackingId: '#update123',
      navlungoUpdateResponseShape: {
        kind: 'json:object',
        topLevelKeys: ['message', 'status', 'error'],
      },
      providerTrackingId: '#update123',
    });
  });

  it('reuses stale Navlungo execution row and persists successful provider fields on vendor create', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        provider: 'navlungo',
        error: 'Provider did not return a shipment id or tracking yet.',
      },
    });
    storedExecution = existing;
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-navlungo-55578',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'NAVLUNGO',
          warehouseId: '55578',
          name: 'Navlungo sender address',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-POST-1048',
      trackingNumber: 'NAV-TRACK-1048',
      trackingUrl: 'https://track.navlungo.test/NAV-POST-1048',
      labelUrl: 'barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        providerShipmentId: 'NAV-POST-1048',
        trackingNumberPresent: true,
        trackingUrlPresent: true,
        barcode: 'barcode-string',
        carrierName: 'Sürat Kargo',
      },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
        customerOverrides: {
          district: 'Kartal',
        },
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'navlungo',
          SHIPPING_EXECUTION_ENABLED: true,
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      id: 'shipment-navlungo-alloc-1',
      provider: 'navlungo',
      shipmentStatus: 'created',
      providerShipmentId: 'NAV-POST-1048',
      trackingNumber: 'NAV-TRACK-1048',
      trackingUrl: 'https://track.navlungo.test/NAV-POST-1048',
      labelUrl: 'barcode-string',
      barcode: 'barcode-string',
    });
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-navlungo-alloc-1' },
        data: expect.objectContaining({
          providerShipmentId: 'NAV-POST-1048',
          trackingNumber: 'NAV-TRACK-1048',
          trackingUrl: 'https://track.navlungo.test/NAV-POST-1048',
          labelUrl: 'barcode-string',
          shipmentStatus: 'CREATED',
        }),
      }),
    );
  });

  it('lets vendor retry reach Navlungo stale recovery for pending rows without provider evidence', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        provider: 'navlungo',
        ok: false,
        providerError: 'Provider did not return a shipment id or tracking yet.',
      },
    });
    storedExecution = existing;
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-navlungo-55578',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'NAVLUNGO',
          warehouseId: '55578',
          name: 'Navlungo sender address',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-RETRY-1048',
      trackingNumber: 'NAV-RETRY-TRACK-1048',
      trackingUrl: 'https://track.navlungo.test/NAV-RETRY-1048',
      labelUrl: 'retry-barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        providerShipmentId: 'NAV-RETRY-1048',
        trackingNumberPresent: true,
        trackingUrlPresent: true,
        barcode: 'retry-barcode-string',
        carrierName: 'Sürat Kargo',
      },
    });

    const result = await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      vendorId: 'sporjinal',
      adapter,
      customerOverrides: {
        district: 'Kartal',
      },
    });

    expect(result).toMatchObject({
      id: 'shipment-navlungo-alloc-1',
      provider: 'navlungo',
      shipmentStatus: 'created',
      providerShipmentId: 'NAV-RETRY-1048',
      trackingNumber: 'NAV-RETRY-TRACK-1048',
      trackingUrl: 'https://track.navlungo.test/NAV-RETRY-1048',
      labelUrl: 'retry-barcode-string',
      barcode: 'retry-barcode-string',
      providerResponseSummary: expect.objectContaining({
        endpointUsed: '/shipments/:id/retry',
        executionId: 'shipment-navlungo-alloc-1',
        providerAtExecution: 'navlungo',
        existingStatus: 'pending',
        hasProviderEvidenceBefore: false,
        staleRecoveryAttempted: true,
        providerCallAttempted: true,
        providerCallHttpStatus: null,
        normalizedProviderShipmentIdPresent: true,
        normalizedTrackingUrlPresent: true,
        normalizedBarcodePresent: true,
        persistedProviderShipmentIdPresent: true,
        persistedTrackingUrlPresent: true,
        persistedBarcodePresent: true,
        dtoProviderShipmentIdPresent: true,
        dtoTrackingUrlPresent: true,
        dtoBarcodePresent: true,
        skipReason: null,
      }),
    });
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(adapter.createShipment.mock.calls[0][0].requestSnapshot).toMatchObject({
      posts: [
        expect.objectContaining({
          sender: { addressId: 55578 },
        }),
      ],
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-navlungo-alloc-1' },
        data: expect.objectContaining({
          responseSnapshot: expect.objectContaining({
            retryEndpointUsed: '/shipments/:id/retry',
            existingExecutionId: 'shipment-navlungo-alloc-1',
            existingProvider: 'navlungo',
            existingStatus: 'pending',
            existingHasProviderEvidence: false,
            staleRecoveryAttempted: true,
            providerCallAttempted: true,
            fullSenderRetryRequested: false,
            senderMode: 'addressId',
            persistedProviderShipmentIdPresent: true,
            persistedTrackingUrlPresent: true,
            persistedBarcodePresent: true,
          }),
        }),
      }),
    );
  });

  it('uses full Navlungo sender details only for an admin flagged retry', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'FAILED',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-navlungo-55578',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'NAVLUNGO',
          warehouseId: '55578',
          name: 'Navlungo sender address',
          address: 'Fallback warehouse address',
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: buildNavlungoProviderMetadata({
        navlungoSenderAddressId: '55578',
        navlungoSenderDistrict: 'Kadikoy',
      }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-FULL-1054',
      trackingNumber: 'NAV-FULL-1054',
      trackingUrl: 'https://track.navlungo.test/NAV-FULL-1054',
      labelUrl: 'full-sender-barcode',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        barcode: 'full-sender-barcode',
      },
    });

    await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      vendorId: 'sporjinal',
      actorRole: 'admin',
      useFullSenderDetailsForThisRetry: true,
      adapter,
      customerOverrides: {
        district: 'Kartal',
      },
    });

    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    const requestSnapshot = adapter.createShipment.mock.calls[0][0].requestSnapshot as {
      posts: Array<{ sender: Record<string, unknown> }>;
    };
    expect(requestSnapshot.posts[0].sender).toMatchObject({
      name: 'Sporjinal Warehouse',
      phone: '+90 532 123 45 67',
      email: 'warehouse@example.test',
      address: 'Sporjinal Depo Sokak No: 1',
      country: 'tr',
      city: 'Istanbul',
      district: 'Kadikoy',
    });
    expect(requestSnapshot.posts[0].sender).not.toHaveProperty('addressId');
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: expect.objectContaining({
          responseSnapshot: expect.objectContaining({
            fullSenderRetryRequested: true,
            senderMode: 'fullSender',
          }),
        }),
      }),
    );
  });

  it('blocks admin flagged Navlungo full sender retry when sender details are incomplete', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'FAILED',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({
        navlungoSenderAddressId: '55578',
        navlungoSenderDistrict: '',
      }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });

    await expect(
      retryFailedShipmentExecution(existing.id, {
        env: {
          ...env,
          SHIPPING_EXECUTION_ENABLED: true,
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
        actorRole: 'admin',
        useFullSenderDetailsForThisRetry: true,
        adapter,
        customerOverrides: {
          district: 'Kartal',
        },
      }),
    ).rejects.toThrow('sender.district');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('uses full Navlungo sender details for a vendor flagged retry', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'FAILED',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({
        navlungoSenderAddressId: '55578',
        navlungoSenderDistrict: 'Kadikoy',
      }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-VENDOR-FULL-1055',
      trackingNumber: 'NAV-VENDOR-FULL-1055',
      trackingUrl: 'https://track.navlungo.test/NAV-VENDOR-FULL-1055',
      labelUrl: 'vendor-full-sender-barcode',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        barcode: 'vendor-full-sender-barcode',
      },
    });

    await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      vendorId: 'sporjinal',
      actorRole: 'vendor',
      useFullSenderDetailsForThisRetry: true,
      adapter,
      customerOverrides: {
        district: 'Kartal',
      },
    });

    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(adapter.createShipment.mock.calls[0][0].requestSnapshot).toMatchObject({
      posts: [
        expect.objectContaining({
          sender: expect.objectContaining({
            name: 'Sporjinal Warehouse',
            district: 'Kadikoy',
          }),
        }),
      ],
    });
  });

  it('syncs successful Navlungo create tracking to Shopify fulfillment automatically', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    const adapter = buildAdapter({ provider: 'NAVLUNGO' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-1055',
      trackingNumber: 'NAV-TRACK-1055',
      trackingUrl: 'https://track.navlungo.test/NAV-1055',
      labelUrl: 'barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        carrierName: 'Sürat Kargo',
        barcode: 'barcode-string',
      },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
      },
      {
        env: {
          ...env,
          SHIPPING_EXECUTION_ENABLED: true,
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(shopifyAdminMock.createFulfillmentTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        allocationId: 'alloc-1',
        shopifyOrderId: 'gid://shopify/Order/1055',
        trackingNumber: 'NAV-TRACK-1055',
        carrier: 'Sürat Kargo',
        trackingUrl: 'https://track.navlungo.test/NAV-1055',
        notifyCustomer: false,
      }),
    );
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSynced: true,
      fulfillmentTrackingNumberPresent: true,
      fulfillmentTrackingUrlPresent: true,
    });
  });

  it('syncs successful Navlungo retry tracking to Shopify fulfillment automatically', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'FAILED',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData({
      shippingStatus: 'Awaiting Shipment',
    }));
    const adapter = buildAdapter({ provider: 'NAVLUNGO' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-RETRY-1055',
      trackingNumber: 'NAV-RETRY-TRACK-1055',
      trackingUrl: 'https://track.navlungo.test/NAV-RETRY-1055',
      labelUrl: 'retry-barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        carrierName: 'Sürat Kargo',
        barcode: 'retry-barcode-string',
      },
    });

    const result = await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      vendorId: 'sporjinal',
      adapter,
    });

    expect(shopifyAdminMock.createFulfillmentTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        trackingNumber: 'NAV-RETRY-TRACK-1055',
        carrier: 'Sürat Kargo',
        trackingUrl: 'https://track.navlungo.test/NAV-RETRY-1055',
      }),
    );
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSynced: true,
      fulfillmentTrackingNumberPresent: true,
    });
  });

  it('does not duplicate Shopify fulfillment for an already synced Navlungo shipment', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData({
      fulfillment: {
        shopifyFulfillmentId: 'gid://shopify/Fulfillment/existing-1055',
        shopifyFulfillmentOrderId: 'gid://shopify/FulfillmentOrder/fo-1055',
        fulfillmentStatus: 'fulfillment_submitted',
        trackingNumber: 'NAV-TRACK-1055',
        carrier: 'Sürat Kargo',
        trackingUrl: 'https://track.navlungo.test/NAV-1055',
        notifyCustomer: false,
        fulfilledAt: new Date('2026-05-18T10:00:00.000Z'),
        shipmentCreatedAt: new Date('2026-05-18T09:55:00.000Z'),
        shipmentUpdatedAt: new Date('2026-05-18T10:00:00.000Z'),
      },
    }));
    const adapter = buildAdapter({ provider: 'NAVLUNGO' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-1055',
      trackingNumber: 'NAV-TRACK-1055',
      trackingUrl: 'https://track.navlungo.test/NAV-1055',
      labelUrl: 'barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        carrierName: 'Sürat Kargo',
        barcode: 'barcode-string',
      },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
      },
      {
        env: {
          ...env,
          SHIPPING_EXECUTION_ENABLED: true,
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(shopifyAdminMock.fetchFulfillmentOrders).not.toHaveBeenCalled();
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSynced: true,
      shopifyFulfillmentSyncSkippedReason: 'already_synced',
    });
  });

  it('skips Shopify fulfillment sync when successful Navlungo response has no tracking number', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    const adapter = buildAdapter({ provider: 'NAVLUNGO' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: 'barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        barcode: 'barcode-string',
      },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
      },
      {
        env: {
          ...env,
          SHIPPING_EXECUTION_ENABLED: true,
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: false,
      shopifyFulfillmentSynced: false,
      shopifyFulfillmentSyncSkippedReason: 'missing_tracking_number',
    });
  });

  it('copies the latest successful Navlungo request summary into a failed vendor retry snapshot', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        ok: false,
        provider: 'navlungo',
        providerError: 'Previous provider failure.',
      },
    });
    const lastSuccessfulSummary = {
      baseUrlHost: 'domestic-api.navlungo.com',
      baseUrlPath: '/v2',
      endpointPath: '/post/create',
      method: 'POST',
      headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
      topLevelBodyKeys: ['platform', 'posts'],
      postKeys: ['barcode_format', 'carrier_id', 'post', 'post_type', 'recipient', 'reference_id', 'sender'],
      senderKeys: ['addressId'],
      recipientKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
      postPayloadKeys: ['desi', 'note', 'package_count', 'price'],
      barcodeFormatPresent: true,
      barcodeFormatType: 'string',
      codPaymentTypePresent: true,
      codPaymentType: 'string-empty',
      postPricePresent: true,
      postPriceType: 'string-empty',
      requestedCarrierId: 9,
      requestedPostType: 2,
      senderUsesAddressId: true,
      senderFullObjectKeysPresent: false,
      customData1Present: true,
      customData2Present: true,
      customData3Present: true,
      customData4Present: true,
      recipientDistrictPresent: true,
      recipientCityPresent: true,
      recipientCountryPresent: true,
      recipientPostCodePresent: false,
      recipientPhonePresent: true,
      recipientPhoneFormatValid: true,
      recipientEmailPresent: true,
      recipientEmailFormatValid: true,
      recipientAddressPresent: true,
      recipientAddressLength: 38,
      packageCountPresent: true,
      packageCountType: 'number',
      requestedPackageCount: 1,
      desiPresent: true,
      desiType: 'number',
      requestedDesi: 3,
      postNotePresent: true,
      postNoteType: 'string-empty',
      postNoteLength: 0,
    };
    const successfulExecution = buildShipmentExecution({
      id: 'shipment-navlungo-success-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NAV-SUCCESS-1',
      trackingNumber: 'NAV-SUCCESS-1',
      trackingUrl: 'https://track.navlungo.test/NAV-SUCCESS-1',
      labelUrl: 'barcode-string',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        ok: true,
        provider: 'navlungo',
        navlungoRequestSummary: lastSuccessfulSummary,
      },
      updatedAt: new Date('2026-05-15T11:00:00.000Z'),
    });
    storedExecution = existing;
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.shipmentExecution.findMany.mockResolvedValue([successfulExecution]);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.createShipment.mockRejectedValue(new ShippingProviderExecutionError('Navlungo Create Post failed with HTTP 500.', {
      provider: 'navlungo',
      createPostHttpStatus: 500,
      providerError: 'Execution of ServiceCallout failed.',
      navlungoRequestSummary: {
        ...lastSuccessfulSummary,
        recipientAddressLength: 42,
      },
    }));

    const result = await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'navlungo',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      vendorId: 'sporjinal',
      adapter,
      customerOverrides: {
        district: 'Kartal',
      },
    });

    expect(result).toMatchObject({
      provider: 'navlungo',
      shipmentStatus: 'failed',
      providerResponseSummary: expect.objectContaining({
        navlungoRequestSummary: expect.objectContaining({
          recipientAddressLength: 42,
        }),
        lastSuccessfulNavlungoRequestSummary: expect.objectContaining({
          recipientAddressLength: 38,
          senderUsesAddressId: true,
          recipientDistrictPresent: true,
        }),
      }),
    });
    expect(storedExecution.responseSnapshot).toMatchObject({
      lastSuccessfulNavlungoRequestSummary: expect.objectContaining({
        recipientAddressLength: 38,
      }),
      lastSuccessfulNavlungoRequestSummarySource: 'latest_successful_vendor_execution',
    });
    expect(JSON.stringify(storedExecution.responseSnapshot)).not.toContain('customer@example.com');
    expect(JSON.stringify(storedExecution.responseSnapshot)).not.toContain('Test Mahallesi');
  });

  it('ignores incomplete Navlungo successful-looking summaries when building failed retry diagnostics', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        ok: false,
        provider: 'navlungo',
        providerError: 'Previous provider failure.',
      },
    });
    const incompleteSummary = {
      endpointPath: '/post/create',
      method: 'POST',
      headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
      topLevelBodyKeys: ['platform', 'posts'],
      postKeys: ['barcode_format', 'carrier_id', 'post_type', 'reference_id', 'sender'],
      senderKeys: ['addressId'],
      recipientKeys: [],
      postPayloadKeys: [],
      requestedCarrierId: 9,
      requestedPostType: 2,
      senderUsesAddressId: true,
      recipientDistrictPresent: false,
      recipientCityPresent: false,
      recipientAddressPresent: false,
      packageCountPresent: false,
      desiPresent: false,
    };
    const incompleteSuccessfulExecution = buildShipmentExecution({
      id: 'shipment-navlungo-success-incomplete',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NAV-SUCCESS-INCOMPLETE',
      trackingUrl: 'https://track.navlungo.test/NAV-SUCCESS-INCOMPLETE',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        ok: true,
        provider: 'navlungo',
        navlungoRequestSummary: incompleteSummary,
      },
      updatedAt: new Date('2026-05-15T11:00:00.000Z'),
    });
    storedExecution = existing;
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.shipmentExecution.findMany.mockResolvedValue([incompleteSuccessfulExecution]);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.createShipment.mockRejectedValue(new ShippingProviderExecutionError('Navlungo Create Post failed with HTTP 500.', {
      provider: 'navlungo',
      createPostHttpStatus: 500,
      providerError: 'Execution of ServiceCallout failed.',
      navlungoRequestSummary: {
        ...incompleteSummary,
        recipientDistrictPresent: true,
        recipientCityPresent: true,
        recipientAddressPresent: true,
        recipientKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
        postKeys: ['barcode_format', 'carrier_id', 'post', 'post_type', 'recipient', 'reference_id', 'sender'],
        postPayloadKeys: ['desi', 'note', 'package_count', 'price'],
        packageCountPresent: true,
        desiPresent: true,
      },
      lastSuccessfulNavlungoRequestSummary: incompleteSummary,
    }));

    const result = await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'navlungo',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      vendorId: 'sporjinal',
      adapter,
      customerOverrides: {
        district: 'Kartal',
      },
    });

    expect(result.providerResponseSummary).toMatchObject({
      lastSuccessfulNavlungoRequestSummary: null,
      lastSuccessfulNavlungoRequestSummarySource: null,
      lastSuccessfulNavlungoRequestSummaryReason: 'no_valid_successful_real_navlungo_summary',
    });
    expect(storedExecution.responseSnapshot).toMatchObject({
      lastSuccessfulNavlungoRequestSummary: null,
      lastSuccessfulNavlungoRequestSummarySource: null,
      lastSuccessfulNavlungoRequestSummaryReason: 'no_valid_successful_real_navlungo_summary',
    });
    expect(JSON.stringify(storedExecution.responseSnapshot)).not.toContain('customer@example.com');
    expect(JSON.stringify(storedExecution.responseSnapshot)).not.toContain('Test Mahallesi');
  });

  it('does not call the provider again when an existing pending dry-run shipment is present', async () => {
    const existing = buildShipmentExecution({
      provider: 'KARGO_ENTEGRATOR',
      id: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        ok: true,
        dryRun: true,
        provider: 'kargo_entegrator',
        reason: 'Kargo Entegratör shipment execution is disabled.',
        disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      },
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-kargo-1774',
          vendorId: 'sporjinal',
          configId: 'config-sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    prismaMock.shipmentExecution.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
          SHIPPING_EXECUTION_ENABLED: true,
          KARGO_ENTEGRATOR_ENABLED: true,
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      id: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'pending',
      providerShipmentId: null,
    });
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('retries an existing pending dry-run shipment once when current Kargo gates are enabled', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        ok: true,
        dryRun: true,
        provider: 'kargo_entegrator',
        reason: 'Kargo Entegratör shipment execution is disabled.',
        disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      },
    });
    storedExecution = existing;
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-retry-1027',
      trackingNumber: 'KE-RETRY-1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['id', 'trackingNumber'] },
    });

    const result = await retryDryRunShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_EXECUTION_ENABLED: true,
        KARGO_ENTEGRATOR_ENABLED: true,
      },
      actorRole: 'admin',
      notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      adapter,
    });

    expect(result).toMatchObject({
      provider: 'kargo_entegrator',
      shipmentStatus: 'created',
      providerShipmentId: 'ke-retry-1027',
      trackingNumber: 'KE-RETRY-1027',
    });
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargo_entegrator',
        requestSnapshot: expect.objectContaining({
          cargo_integration_id: 2547,
          warehouse_id: 1774,
          notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
        }),
      }),
    );
  });

  it('retries an existing pending Navlungo dry-run shipment through vendor-aware real path config', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        ok: true,
        dryRun: true,
        provider: 'navlungo',
        reason: 'Navlungo shipment execution is disabled.',
        disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      },
    });
    storedExecution = existing;
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55578',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-navlungo-55578',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'NAVLUNGO',
          warehouseId: '55578',
          name: 'Navlungo sender address',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55578' }),
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-DRYRUN-1051',
      trackingNumber: 'NAV-DRYRUN-1051',
      trackingUrl: 'https://track.navlungo.test/NAV-DRYRUN-1051',
      labelUrl: 'barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        realPathProviderCallAttempted: true,
        realPathCreatePostHttpStatus: 201,
        realPathRequestedCarrierId: 9,
        realPathRequestedPostType: 2,
        realPathRequestedBarcodeFormat: 'pdf-A6',
        realPathCodPaymentIncluded: true,
        realPathPriceIncluded: true,
        realPathPostNumberPresent: true,
        realPathTrackingUrlPresent: true,
        realPathBarcodePresent: true,
        providerShipmentId: 'NAV-DRYRUN-1051',
        trackingUrlPresent: true,
        barcode: 'barcode-string',
      },
    });

    const result = await retryDryRunShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      actorRole: 'admin',
      adapter,
      customerOverrides: {
        district: 'Kartal',
      },
    });

    expect(result).toMatchObject({
      provider: 'navlungo',
      shipmentStatus: 'created',
      providerShipmentId: 'NAV-DRYRUN-1051',
      trackingNumber: 'NAV-DRYRUN-1051',
      trackingUrl: 'https://track.navlungo.test/NAV-DRYRUN-1051',
      labelUrl: 'barcode-string',
      barcode: 'barcode-string',
      providerResponseSummary: expect.objectContaining({
        realPathProviderCallAttempted: true,
        realPathCreatePostHttpStatus: 201,
        realPathRequestedCarrierId: 9,
        realPathRequestedPostType: 2,
        realPathRequestedBarcodeFormat: 'pdf-A6',
        realPathCodPaymentIncluded: true,
        realPathPriceIncluded: true,
        realPathPostNumberPresent: true,
        realPathTrackingUrlPresent: true,
        realPathBarcodePresent: true,
        realPathPersistedProviderShipmentIdPresent: true,
        realPathPersistedTrackingUrlPresent: true,
        realPathPersistedBarcodePresent: true,
      }),
    });
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'navlungo',
        requestSnapshot: expect.objectContaining({
          posts: [
            expect.objectContaining({
              carrier_id: 9,
              post_type: 2,
              cod_payment_type: '',
              barcode_format: 'pdf-A6',
              post: expect.objectContaining({
                price: '',
              }),
            }),
          ],
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('blocks dry-run retry when current Kargo gates are disabled', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        dryRun: true,
        disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryDryRunShipmentExecution(existing.id, {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
          SHIPPING_EXECUTION_ENABLED: false,
          KARGO_ENTEGRATOR_ENABLED: true,
        },
        actorRole: 'admin',
        adapter,
      }),
    ).rejects.toThrow('Shipping provider execution is not ready. Missing: SHIPPING_EXECUTION_ENABLED.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('does not retry shipment executions that already have provider identifiers', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      providerShipmentId: 'ke-existing',
      responseSnapshot: {
        dryRun: true,
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryDryRunShipmentExecution(existing.id, {
        env,
        actorRole: 'admin',
        adapter,
      }),
    ).rejects.toThrow('provider shipment id');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('does not retry shipment executions that already have tracking', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      trackingNumber: 'KE-TRACKING',
      responseSnapshot: {
        dryRun: true,
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryDryRunShipmentExecution(existing.id, {
        env,
        actorRole: 'admin',
        adapter,
      }),
    ).rejects.toThrow('tracking');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks vendor users from dry-run shipment retry', async () => {
    await expect(
      retryDryRunShipmentExecution('shipment-kargo_entegrator-alloc-1', {
        env,
        actorRole: 'vendor',
      }),
    ).rejects.toThrow('Admin access required.');
    expect(prismaMock.shipmentExecution.findUnique).not.toHaveBeenCalled();
  });

  it('retries failed shipment executions without creating duplicates', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        timeline: [{ label: 'Provider validation failed', at: '2026-05-15T10:00:00.000Z', status: '422' }],
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-recovered-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['data'] },
    });

    const result = await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_SANDBOX_MODE: true,
      },
      vendorId: 'sporjinal',
      notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      adapter,
    });

    expect(result).toMatchObject({
      shipmentStatus: 'created',
      providerShipmentId: 'ke-recovered-1027',
    });
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(adapter.createShipment.mock.calls[0][0]).not.toHaveProperty('retryContext');
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: expect.objectContaining({
          shipmentStatus: 'PENDING',
          responseSnapshot: expect.objectContaining({
            timeline: expect.arrayContaining([
              expect.objectContaining({
                label: 'Retry attempted',
                status: 'pending',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('blocks failed shipment recovery when provider identifiers already exist', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'FAILED',
      providerShipmentId: 'ke-existing',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryFailedShipmentExecution(existing.id, {
        env,
        vendorId: 'sporjinal',
        adapter,
      }),
    ).rejects.toThrow('provider shipment id');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('retries failed shipment executions in sandbox without forcing Dummy Kargo payloads', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'FAILED',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-recovered-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });

    await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_SANDBOX_MODE: true,
      },
      vendorId: 'sporjinal',
      customerOverrides: {
        district: 'Kadikoy',
      },
      adapter,
    });

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          customer: expect.objectContaining({
            name: 'Test',
            surname: 'Customer',
            email: 'customer@example.com',
            phone: '905551112233',
          }),
          package_type: 'box',
          payment_type: 'cash_money',
          payor_type: 'sender',
          kg: 3,
        }),
      }),
    );
    const requestSnapshot = adapter.createShipment.mock.calls[0][0].requestSnapshot;
    expect(requestSnapshot).not.toHaveProperty('cargo_company');
    expect(adapter.createShipment.mock.calls[0][0]).not.toHaveProperty('retryContext');
  });

  it('retries Try OTO shipments with the existing OTO order context', async () => {
    const existingOrderId = 'SPORJINAL-1027';
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'FAILED',
      requestSnapshot: {
        orderId: existingOrderId,
        externalOrderReference: existingOrderId,
        internalOrderReference: 'shopify-7616544244049-allocation-alloc-1',
      },
      responseSnapshot: {
        orderId: existingOrderId,
        providerOrderId: '540790',
        timeline: [{ label: 'Try OTO shipment create requested', status: 'failed' }],
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'TRY_OTO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
        tryOtoOriginCity: 'Istanbul',
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'OTO-SHIP-1001',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, provider: 'try_oto', orderId: existingOrderId },
    });

    await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
        TRY_OTO_SANDBOX_MODE: true,
        TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
        TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
      },
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          orderId: existingOrderId,
          externalOrderReference: existingOrderId,
          internalOrderReference: 'shopify-7616544244049-allocation-alloc-1',
          legacyInternalReferenceUsed: false,
        }),
        retryContext: {
          isRetry: true,
          existingOrderId,
          existingProviderOrderId: '540790',
          existingOrderAlreadyExists: false,
        },
      }),
    );
  });

  it('preserves vendor isolation when creating shipments', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(
      buildAllocation({
        assignedVendorId: 'other-vendor',
      }),
    );
    const adapter = buildAdapter();

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
        },
        {
          env,
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Allocation could not be found for the selected vendor.');
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('marks provider failures safely without leaking provider internals', async () => {
    const adapter = buildAdapter();
    adapter.createShipment.mockRejectedValue(new Error('Hepsijet shipment execution failed with HTTP 500.'));

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result.shipmentStatus).toBe('failed');
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'FAILED',
          responseSnapshot: expect.objectContaining({
            error: 'Hepsijet shipment execution failed with HTTP 500.',
          }),
        }),
      }),
    );
  });

  it('records safe provider validation diagnostics and timeline events for shipment failures', async () => {
    const adapter = buildAdapter();
    adapter.createShipment.mockRejectedValue(
      new ShippingProviderExecutionError('Kargo Entegratör shipment execution failed with HTTP 422.', {
        status: 422,
        ok: false,
        contentType: 'application/json',
        parsedBodyType: 'object',
        bodyKeys: ['errors', 'message'],
        provider: 'kargo_entegrator',
        providerError: 'Validation failed.',
        providerValidationErrors: ['customer.district is required', 'warehouse_id is invalid'],
        requestId: 'ke-req-1',
        providerShipmentIdPresent: false,
        barcode: null,
        notificationUrlIncluded: true,
      }),
    );

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'FAILED',
          responseSnapshot: expect.objectContaining({
            status: 422,
            providerError: 'Validation failed.',
            providerValidationErrors: ['customer.district is required', 'warehouse_id is invalid'],
            requestId: 'ke-req-1',
            notificationUrlIncluded: true,
            error: 'Kargo Entegratör shipment execution failed with HTTP 422.',
            timeline: expect.arrayContaining([
              expect.objectContaining({
                label: 'Provider validation failed',
                status: '422',
              }),
            ]),
          }),
        }),
      }),
    );
    expect(JSON.stringify(prismaMock.shipmentExecution.update.mock.calls)).not.toContain('test-kargo-key');
    expect(JSON.stringify(prismaMock.shipmentExecution.update.mock.calls)).not.toContain('Authorization');
  });

  it('diagnoses the global shipping execution gate separately from the Kargo provider gate', () => {
    const diagnostics = getShippingProviderGateDiagnostics({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: false,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
    });

    expect(diagnostics).toMatchObject({
      provider: 'kargo_entegrator',
      executionReady: false,
      shippingExecutionEnabled: false,
      providerSelected: true,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      webhookRouteImplemented: true,
      packageTypeUsed: 'box',
      receiverAddressAvailability: 'confirmed_required',
      dummyKargoSupport: 'not_implemented',
      statusSyncSupport: 'not_implemented',
      missing: ['SHIPPING_EXECUTION_ENABLED'],
      deprecatedEnvFallbacks: [],
    });
  });

  it('passes Kargonomi provider override through the admin provider diagnostics route', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: Record<string, string> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, ...args: unknown[]) => {
        const handler = args.at(-1) as (
          request: { authUser?: { role?: string }; query?: Record<string, string> },
          reply: { code: (status: number) => { send: (body: unknown) => unknown } },
        ) => unknown;
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerShippingExecutionRoutes(
      app as never,
      {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
        KARGONOMI_API_TOKEN: 'configured-token',
        KARGONOMI_DEFAULT_WAREHOUSE_ID: '112668',
      },
    );
    const result = await gets.get('/admin/shipments/provider-config')?.(
      { authUser: { role: 'admin' }, query: { provider: 'kargonomi' } },
      reply,
    );

    expect(result).toMatchObject({
      provider: 'kargonomi',
      providerSelected: true,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      supportedProviders: expect.arrayContaining(['kargonomi']),
    });
  });

  it('reports vendor Kargo readiness booleans without exposing secrets or raw config values', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_EXECUTION_ENABLED: true,
        KARGO_ENTEGRATOR_ENABLED: true,
        KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
        KARGO_ENTEGRATOR_API_KEY: 'configured-secret',
      },
      'kargo_entegrator',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'kargo_entegrator',
      executionReady: true,
      sandboxModeEnabled: false,
      shippingExecutionEnabled: true,
      providerSelected: true,
      providerEnabled: true,
      webhookIngestEnabled: false,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      cargoIntegrationIdConfigured: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      packageTypeUsed: 'box',
      notificationUrlConfigured: false,
      webhookRouteImplemented: true,
      receiverAddressAvailability: 'confirmed_required',
      dummyKargoSupport: 'not_implemented',
      statusSyncSupport: 'not_implemented',
      missing: [],
    });
    expect(diagnostics.warnings).toEqual(
      expect.arrayContaining([
        'Kargo Entegratör webhook/status sync is not implemented.',
        'Live carrier execution is not enabled or verified.',
      ]),
    );
    expect(diagnostics.warnings).not.toEqual(expect.arrayContaining([
      'Kargo Entegratör create contract is not verified.',
      'Receiver address and phone requirements are unknown.',
    ]));
    expect(JSON.stringify(diagnostics)).not.toContain('configured-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('2547');
    expect(JSON.stringify(diagnostics)).not.toContain('1774');
  });

  it('marks Try OTO selected and ready from vendor shipping config even when the global provider differs', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-try-oto',
      vendorId: 'sporjinal',
      preferredProvider: 'TRY_OTO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
        tryOtoOriginCity: 'Istanbul',
      },
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_EXECUTION_ENABLED: true,
        TRY_OTO_ENABLED: true,
        TRY_OTO_SANDBOX_MODE: true,
        TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
        TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
      },
      'try_oto',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'try_oto',
      supportedProviders: expect.arrayContaining(['try_oto']),
      executionReady: true,
      sandboxModeEnabled: true,
      shippingExecutionEnabled: true,
      providerSelected: true,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      missing: [],
    });
    expect(JSON.stringify(diagnostics)).not.toContain('refresh-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('tr-test-store-001');
  });

  it('does not require Kargonomi fallback buyer IDs for provider readiness', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-kargonomi',
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      providerMetadata: null,
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [
        {
          id: 'warehouse-sporjinal-112668',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGONOMI',
          warehouseId: '112668',
          name: 'Sporjinal Kargonomi warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        SHIPPING_EXECUTION_ENABLED: true,
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
        KARGONOMI_API_TOKEN: 'configured-token',
      },
      'kargonomi',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'kargonomi',
      executionReady: true,
      providerSelected: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      missing: [],
    });
  });

  it('reports Navlungo ready when selected with sender address and defaults', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-navlungo',
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata(),
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [
        {
          id: 'warehouse-sporjinal-55574',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'NAVLUNGO',
          warehouseId: '55574',
          name: 'Navlungo sender address',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'navlungo',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      'navlungo',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'navlungo',
      executionReady: true,
      providerSelected: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      missing: [],
      navlungo: {
        usernameConfigured: true,
        passwordConfigured: true,
        defaultSenderAddressIdConfigured: true,
        defaultBarcodeFormat: 'pdf-A6',
        defaultCarrierId: '9',
        runtimeShipmentExecutionEnabled: true,
        returnReverseImplementation: 'not_implemented',
      },
    });
    expect(JSON.stringify(diagnostics)).not.toContain('secret-password');
  });

  it('warns when Navlungo base URL still uses deprecated v2 path', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-navlungo',
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata(),
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'navlungo',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2/',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      'navlungo',
      'sporjinal',
    );

    expect(diagnostics.warnings).toEqual(expect.arrayContaining([
      'NAVLUNGO_BASE_URL uses deprecated /v2 path. Configure the documented v2.1 base URL.',
    ]));
  });

  it('reports Navlungo ready from vendor config even when the global provider differs', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-navlungo',
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata(),
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      'navlungo',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'navlungo',
      executionReady: true,
      providerSelected: true,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      missing: [],
    });
    expect(JSON.stringify(diagnostics)).not.toContain('secret-password');
    expect(JSON.stringify(diagnostics)).not.toContain('55574');
  });

  it('requires a numeric Navlungo sender address id for readiness', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-navlungo',
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: 'sender-address' }),
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'navlungo',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      'navlungo',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'navlungo',
      executionReady: false,
      missing: expect.arrayContaining(['VENDOR_NAVLUNGO_SENDER_ADDRESS_ID']),
      navlungo: {
        defaultSenderAddressIdConfigured: true,
        defaultSenderAddressIdValid: false,
        senderFieldsConfigured: false,
      },
    });
    expect(JSON.stringify(diagnostics)).not.toContain('sender-address');
  });

  it('reports a precise Navlungo readiness reason when vendor config selects another provider', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-kargo',
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      providerMetadata: null,
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        SHIPPING_EXECUTION_ENABLED: true,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
        NAVLUNGO_API_USERNAME: 'api-user',
        NAVLUNGO_API_PASSWORD: 'secret-password',
      },
      'navlungo',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'navlungo',
      executionReady: false,
      providerSelected: false,
      missing: expect.arrayContaining(['VENDOR_PROVIDER_SELECTION']),
    });
    expect(JSON.stringify(diagnostics)).not.toContain('secret-password');
    expect(JSON.stringify(diagnostics)).not.toContain('2547');
    expect(JSON.stringify(diagnostics)).not.toContain('1774');
  });

  it('builds a Navlungo Create Post payload and blocks missing recipient fields before provider call', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-navlungo',
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata(),
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingPostcode: '',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kartal',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'navlungo',
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
      },
    );

    expect(preview).toMatchObject({
      provider: 'navlungo',
      warehouseId: '55574',
      customerFieldsValid: true,
      payload: {
        platform: 'shopify',
        posts: [
          expect.objectContaining({
            carrier_id: 9,
            post_type: 2,
            barcode_format: 'pdf-A6',
            sender: expect.objectContaining({
              addressId: 55574,
            }),
            recipient: expect.objectContaining({
              name: 'Test Customer',
              phone: '+90 555 111 22 33',
              city: 'Istanbul',
              district: 'Kartal',
            }),
            post: expect.objectContaining({
              desi: 3,
              package_count: 1,
            }),
          }),
        ],
      },
    });
    expect(preview.payload.posts[0]).toHaveProperty('cod_payment_type', '');
    expect(preview.payload.posts[0].cod_payment_type).not.toBe(1);
    expect(preview.payload.posts[0].cod_payment_type).not.toBe(2);
    expect(preview.payload.posts[0].post).toHaveProperty('price', '');
    expect(preview.payload.posts[0].post).toHaveProperty('note', '');
    expect(preview.payload.posts[0].sender).toEqual({ addressId: 55574 });
    const referenceId = preview.payload.posts[0].reference_id;
    expect(referenceId).toMatch(/^[A-Z0-9]{2}-1027-[A-Z0-9]{6}$/);
    expect(referenceId.length).toBeLessThanOrEqual(32);
    expect(referenceId.startsWith('SP-1027-')).toBe(true);
    expect(referenceId.toLowerCase()).not.toContain('alloc');
    expect(referenceId.toLowerCase()).not.toContain('sporjinal');
    expect(referenceId).not.toContain('alloc-1');

    const secondPreview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'navlungo',
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
      },
    );
    expect(secondPreview.payload.posts[0].reference_id).toMatch(/^[A-Z0-9]{2}-1027-[A-Z0-9]{6}$/);
    expect(secondPreview.payload.posts[0].reference_id).not.toBe(referenceId);

    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const navlungoAdapter = buildAdapter({ provider: 'NAVLUNGO' as const });
    navlungoAdapter.createShipment.mockResolvedValue({
      providerShipmentId: 'NAV-1028',
      trackingNumber: 'NAV-1028',
      trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
      labelUrl: 'barcode-string',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, postNumberPresent: true },
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          provider: 'navlungo',
        },
        {
          env: {
            ...env,
            SHIPPING_PROVIDER: 'navlungo',
            NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
            NAVLUNGO_API_USERNAME: 'api-user',
            NAVLUNGO_API_PASSWORD: 'secret-password',
          },
          vendorId: 'sporjinal',
          adapter: navlungoAdapter,
        },
      ),
    ).rejects.toThrow('Missing required shipment fields:\n- recipient.district');
    expect(navlungoAdapter.createShipment).not.toHaveBeenCalled();

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
        customerOverrides: {
          district: 'Kartal',
        },
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'navlungo',
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
        adapter: navlungoAdapter,
      },
    );

    expect(navlungoAdapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          posts: [
            expect.objectContaining({
              sender: expect.objectContaining({
                addressId: 55574,
              }),
              recipient: expect.objectContaining({
                city: 'Istanbul',
                district: 'Kartal',
              }),
            }),
          ],
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'navlungo',
      providerShipmentId: 'NAV-1028',
      shipmentStatus: 'created',
    });
  });

  it('blocks Navlungo shipment execution when sender address id is missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-navlungo',
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '' }),
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'tr',
        shippingPostcode: '',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kartal',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    const navlungoAdapter = buildAdapter({ provider: 'NAVLUNGO' as const });

    await expect(createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'navlungo',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'navlungo',
          SHIPPING_EXECUTION_ENABLED: true,
          NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
          NAVLUNGO_API_USERNAME: 'api-user',
          NAVLUNGO_API_PASSWORD: 'secret-password',
        },
        vendorId: 'sporjinal',
        adapter: navlungoAdapter,
      },
    )).rejects.toThrow('Navlungo sender address ID must be numeric.');

    expect(navlungoAdapter.createShipment).not.toHaveBeenCalled();
  });

  it('keeps Kargonomi ready when PoC fallback buyer location ids are configured', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-kargonomi',
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: 18,
      providerMetadata: {
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [
        {
          id: 'warehouse-sporjinal-112668',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGONOMI',
          warehouseId: '112668',
          name: 'Sporjinal Kargonomi warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        SHIPPING_EXECUTION_ENABLED: true,
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
        KARGONOMI_API_TOKEN: 'configured-token',
      },
      'kargonomi',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'kargonomi',
      executionReady: true,
      providerSelected: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      missing: [],
    });
    expect(JSON.stringify(diagnostics)).not.toContain('configured-token');
    expect(JSON.stringify(diagnostics)).not.toContain('112668');
    expect(JSON.stringify(diagnostics)).not.toContain('828');
  });

  it('adds current Kargo readiness warnings to shipment previews without changing the payload', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      cargo_integration_id: 2547,
      warehouse_id: 1774,
      package_type: 'box',
      notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        'Kargo Entegratör webhook/status sync is not implemented.',
        'Live carrier execution is not enabled or verified.',
      ]),
    );
    expect(preview.warnings).not.toEqual(expect.arrayContaining([
      'Kargo Entegratör create contract is not verified.',
      'Receiver address and phone requirements are unknown.',
    ]));
  });

  it('builds documented Dummy Kargo sandbox payload when required customer address fields exist', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: ' +90 555 111 22 33 ',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
        notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      cargo_integration_id: 2547,
      warehouse_id: 1774,
      cargo_company: { id: 'dummy' },
      customer: {
        name: 'Test',
        surname: 'Customer',
        phone: '905551112233',
        email: 'customer@example.com',
        country: 'TR',
        postcode: '34000',
        city: 'Istanbul',
        district: 'Kadikoy',
        address: 'Test Mahallesi 1. Sokak No: 1',
      },
      payment_type: 'cash_money',
      package_type: 'box',
      payor_type: 'sender',
      desi: 3,
      kg: 3,
      note: '',
      platform_id: '7616544244049',
      platform_d_id: '1027',
      notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('keeps real Kargo provider payload when sandbox mode is enabled without explicit dummy carrier', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-live-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'kargo_entegrator',
      },
      {
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargo_entegrator',
        requestSnapshot: expect.objectContaining({
          package_type: 'box',
          customer: expect.objectContaining({
            name: 'Test',
            surname: 'Customer',
            email: 'customer@example.com',
            phone: '905551112233',
          }),
          payment_type: 'cash_money',
          payor_type: 'sender',
          kg: 3,
          platform_id: '7616544244049',
          platform_d_id: '1027',
        }),
      }),
    );
    const requestSnapshot = adapter.createShipment.mock.calls[0]?.[0]?.requestSnapshot;
    expect(requestSnapshot).not.toHaveProperty('cargo_company');
  });

  it('blocks invalid Kargo package_type before calling the provider', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: {
        packageType: 'package',
      },
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          env: {
            ...env,
            SHIPPING_PROVIDER: 'kargo_entegrator',
            SHIPPING_SANDBOX_MODE: true,
          },
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Invalid Kargo package_type. Allowed values: box, document.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
  });

  it('uses province as Kargo district when Shopify district is unavailable', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+905551112233',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        province: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        district: 'Kadikoy',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('maps available county metadata to Kargo customer.district', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+905551112233',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingCounty: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        district: 'Kadikoy',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('uses stored Shopify billing address district when shipping district is unavailable', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+905551112233',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
        webhookEvents: [
          {
            rawPayload: JSON.stringify({
              id: 1028,
              shipping_address: {
                country_code: 'TR',
                zip: '34000',
                city: 'Istanbul',
                address1: 'Test Mahallesi 1. Sokak No: 1',
              },
              billing_address: {
                county: 'Kadikoy',
              },
            }),
          },
        ],
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        district: 'Kadikoy',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('uses stored Shopify order webhook shipping address when order columns are still empty', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        webhookEvents: [
          {
            rawPayload: JSON.stringify({
              id: 1028,
              shipping_address: {
                phone: '+90 555 111 22 33',
                country_code: 'TR',
                zip: '34000',
                city: 'Istanbul',
                district: 'Kadikoy',
                address1: 'Test Mahallesi 1. Sokak No: 1',
              },
            }),
          },
        ],
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        phone: '905551112233',
        country: 'TR',
        postcode: '34000',
        city: 'Istanbul',
        district: 'Kadikoy',
        address: 'Test Mahallesi 1. Sokak No: 1',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('falls back to stored Shopify billing phone when shipping phone is unavailable', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
        webhookEvents: [
          {
            rawPayload: JSON.stringify({
              id: 1028,
              shipping_address: {
                country_code: 'TR',
                zip: '34000',
                city: 'Istanbul',
                district: 'Kadikoy',
                address1: 'Test Mahallesi 1. Sokak No: 1',
              },
              billing_address: {
                phone: '0555 111 22 33',
              },
            }),
          },
        ],
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        phone: '905551112233',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('logs missing Kargo required payload fields before provider execution', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(warnSpy).toHaveBeenCalledWith(
      '[shipping:kargo:missing-required-payload-fields]',
      expect.objectContaining({
        provider: 'kargo_entegrator',
        missingFields: expect.arrayContaining(['customer.phone', 'customer.district']),
        requestBlocked: false,
      }),
    );
    warnSpy.mockRestore();
  });

  it('blocks Dummy Kargo creation outside sandbox mode', async () => {
    await expect(
      previewShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          vendorId: 'sporjinal',
          env,
        },
      ),
    ).rejects.toThrow('Dummy Kargo shipment creation is available only when shipping sandbox mode is enabled.');
  });

  it('blocks Dummy Kargo shipment create when required receiver fields are missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          vendorId: 'sporjinal',
          env: {
            ...env,
            SHIPPING_SANDBOX_MODE: true,
            SHIPPING_PROVIDER: 'kargo_entegrator',
          },
        },
      ),
    ).rejects.toThrow(/Missing required shipment fields:[\s\S]*customer\.phone[\s\S]*Provider request blocked before create call/);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('blocks Dummy Kargo shipment create when only district is missing', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+905551112233',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          vendorId: 'sporjinal',
          env: {
            ...env,
            SHIPPING_SANDBOX_MODE: true,
            SHIPPING_PROVIDER: 'kargo_entegrator',
          },
        },
      ),
    ).rejects.toThrow(/Missing required shipment fields:[\s\S]*customer\.district/);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('applies shipment-only customer overrides without mutating Shopify order data', async () => {
    const order = {
      id: 'order-1',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
      customerPhone: '+905551112233',
      shippingCountry: 'TR',
      shippingPostcode: '34000',
      shippingCity: 'Istanbul',
      shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
    };
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({ order }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
        customerOverrides: {
          district: 'Kadikoy',
        },
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        district: 'Kadikoy',
      },
    });
    expect(order).not.toHaveProperty('shippingDistrict');
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('registers a Kargo webhook placeholder that returns 501 without mutating shipment data', async () => {
    const posts = new Map<string, (request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, ...args: unknown[]) => {
        const handler = args.at(-1) as (request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown;
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerShippingExecutionRoutes(app as never, env);
    const result = await posts.get('/webhooks/shipping/kargo-entegrator')?.({}, reply);

    expect(result).toEqual({
      status: 501,
      body: {
        message: 'Kargo Entegratör webhook ingestion is not implemented yet.',
      },
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('ingests Dummy Kargo sandbox webhook updates into shipment execution only', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      providerShipmentId: 'ke-dummy-1',
      responseSnapshot: {
        ok: true,
        dummyCarrierDetected: true,
        timeline: [{ label: 'Shipment created', at: '2026-05-15T10:00:00.000Z', status: 'created' }],
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await ingestKargoEntegratorWebhook(
      {
        data: {
          id: 'ke-dummy-1',
          status: 'created',
          tracking_number: 'DUMMY-TRACK-1',
          barcode: 'DUMMY-BARCODE-1',
        },
      },
      {
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toEqual({
      ok: true,
      shipmentExecutionId: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'created',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-kargo_entegrator-alloc-1' },
        data: expect.objectContaining({
          trackingNumber: 'DUMMY-TRACK-1',
          shipmentStatus: 'CREATED',
          responseSnapshot: expect.objectContaining({
            webhookReceived: true,
            dummyCarrierDetected: true,
            providerStatus: 'created',
            barcode: 'DUMMY-BARCODE-1',
            timeline: expect.arrayContaining([
              expect.objectContaining({ label: 'Tracking assigned', status: 'created' }),
            ]),
          }),
        }),
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
  });

  it('blocks return label creation for non-Try OTO shipments', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'ke-1',
      trackingNumber: 'KE-TRACK-1',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);

    await expect(
      createTryOtoReturnShipmentLabel(existing.id, {
        env,
        vendorId: 'sporjinal',
      }),
    ).rejects.toThrow('Return label creation is only available for Try OTO shipments.');
  });

  it('blocks detached Navlungo return pickup creation from the shipment path', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'NAV-1001',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);

    await expect(
      createTryOtoReturnShipmentLabel(existing.id, {
        env,
        vendorId: 'sporjinal',
      }),
    ).rejects.toThrow('Navlungo return pickup creation must be started from the internal return request.');
  });

  it('previews Navlungo return pickup from return request context without provider calls', async () => {
    const returnRecord = {
      id: 'return-request-1',
      vendorAllocationId: 'alloc-1',
      sourceShopifyOrderId: 'order-1',
      sourceShopifyOrderNumber: '1054',
      sourceShopifyRefundId: null,
      sourceShopifyReturnId: '23165600081',
      sourceShopifyReturnGid: 'gid://shopify/Return/23165600081',
      sourceShopifyLineItemId: 'line-1',
      returnLifecycleStatus: 'requested',
      returnRequestSource: 'shopify_return_request',
      requestCreatedAt: new Date('2026-05-22T08:00:00.000Z'),
      requestUpdatedAt: null,
      status: 'requested',
      reason: 'Size issue',
      returnReasonNote: null,
      returnProvider: null,
      returnProviderShipmentId: null,
      returnLabel: null,
      returnReferenceId: null,
      navlungoReturnCreatedAt: null,
      returnProviderSnapshot: null,
      returnCarrierName: null,
      returnTrackingNumber: null,
      returnTrackingUrl: null,
      vendorReceivedAt: null,
      vendorReviewedAt: null,
      vendorDecision: null,
      vendorDecisionReason: null,
      createdAt: new Date('2026-05-22T08:00:00.000Z'),
      updatedAt: new Date('2026-05-22T08:00:00.000Z'),
      vendorAllocation: {
        id: 'alloc-1',
        assignedVendorId: 'sporjinal',
        originalVendorId: 'sporjinal',
        sourceShopifyOrderId: 'order-1',
        sourceShopifyOrderNumber: '1054',
        order: {
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 532 123 45 67',
          shippingAddress: 'Test Mah. No: 1',
          shippingCity: 'Istanbul',
          shippingDistrict: 'Kadikoy',
          shippingCountry: 'tr',
          shippingPostcode: '',
        },
        lineItems: [
          {
            id: 'alloc-line-1',
            quantity: 1,
            lineAmount: 0,
            shopifyOrderLineItem: {
              sourceLineItemId: 'line-1',
              sourceVariantId: null,
              sku: 'SKU-1',
              title: 'Return item',
            },
          },
        ],
        refundRecords: [],
      },
    };
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue(returnRecord);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn(),
    });

    const result = await createNavlungoReturnPickupForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      {
        ...env,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2.1',
        NAVLUNGO_API_USERNAME: 'user',
        NAVLUNGO_API_PASSWORD: 'pass',
      },
      {
        adapter,
        dryRun: true,
      },
    );

    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
    expect(result.returnProviderSnapshot).toMatchObject({
      navlungoReturnPickupDryRun: true,
      navlungoReturnPickupAttempted: false,
      navlungoReturnPickupSucceeded: false,
      navlungoReturnPickupMissingFields: [],
      navlungoReturnPickupPayloadSummary: expect.objectContaining({
        endpointPath: '/post/create',
        requestedPostType: 3,
        requestedCarrierId: 9,
        requestedBarcodeFormat: 'pdf-A5',
        senderFullObjectKeysPresent: true,
        recipientKeys: ['addressId'],
        desiPresent: true,
        packageCountPresent: true,
      }),
    });
  });

  it('persists live Navlungo return pickup evidence on the return request', async () => {
    const returnRecord = {
      id: 'return-request-1',
      vendorAllocationId: 'alloc-1',
      sourceShopifyOrderId: 'order-1',
      sourceShopifyOrderNumber: '1054',
      sourceShopifyRefundId: null,
      sourceShopifyReturnId: '23165600081',
      sourceShopifyReturnGid: 'gid://shopify/Return/23165600081',
      sourceShopifyLineItemId: 'line-1',
      returnLifecycleStatus: 'requested',
      returnRequestSource: 'shopify_return_request',
      requestCreatedAt: new Date('2026-05-22T08:00:00.000Z'),
      requestUpdatedAt: null,
      status: 'requested',
      reason: 'Size issue',
      returnReasonNote: null,
      returnProvider: null,
      returnProviderShipmentId: null,
      returnLabel: null,
      returnReferenceId: null,
      navlungoReturnCreatedAt: null,
      returnProviderSnapshot: null,
      returnCarrierName: null,
      returnTrackingNumber: null,
      returnTrackingUrl: null,
      vendorReceivedAt: null,
      vendorReviewedAt: null,
      vendorDecision: null,
      vendorDecisionReason: null,
      createdAt: new Date('2026-05-22T08:00:00.000Z'),
      updatedAt: new Date('2026-05-22T08:00:00.000Z'),
      vendorAllocation: {
        id: 'alloc-1',
        assignedVendorId: 'sporjinal',
        originalVendorId: 'sporjinal',
        sourceShopifyOrderId: 'order-1',
        sourceShopifyOrderNumber: '1054',
        order: {
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 532 123 45 67',
          shippingAddress: 'Test Mah. No: 1',
          shippingCity: 'Istanbul',
          shippingDistrict: 'Kadikoy',
          shippingCountry: 'tr',
          shippingPostcode: '',
        },
        lineItems: [
          {
            id: 'alloc-line-1',
            quantity: 1,
            lineAmount: 0,
            shopifyOrderLineItem: {
              sourceLineItemId: 'line-1',
              sourceVariantId: null,
              sku: 'SKU-1',
              title: 'Return item',
            },
          },
        ],
        refundRecords: [],
      },
    };
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'NAV-RETURN-1',
        returnTrackingNumber: 'RET-TRACK-1',
        returnTrackingUrl: 'https://tracking.example/RET-TRACK-1',
        returnLabelUrl: 'barcode-string',
        returnBarcode: 'barcode-string',
        returnCarrierName: 'Sürat Kargo',
        returnStatus: 'created',
        responseSnapshot: {
          createPostHttpStatus: 201,
          providerMessage: 'Created',
        },
      }),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      ...returnRecord,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RETURN-1',
      returnTrackingNumber: 'RET-TRACK-1',
      returnTrackingUrl: 'https://tracking.example/RET-TRACK-1',
      returnLabel: 'barcode-string',
      returnCarrierName: 'Sürat Kargo',
      returnReferenceId: 'SP-RET-1054-ABC123',
      navlungoReturnCreatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    const result = await createNavlungoReturnPickupForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      env,
      { adapter },
    );

    expect(adapter.createReturnShipment).toHaveBeenCalledWith(expect.objectContaining({
      requestSnapshot: expect.objectContaining({
        posts: [
          expect.objectContaining({
            post_type: 3,
            recipient: { addressId: 55574 },
            barcode_format: 'pdf-A5',
          }),
        ],
      }),
    }));
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnProvider: 'navlungo',
        returnProviderShipmentId: 'NAV-RETURN-1',
        returnTrackingNumber: 'RET-TRACK-1',
        returnLabel: 'barcode-string',
        returnReferenceId: expect.stringMatching(/^SP-RET-1054-[A-Z0-9]{6}$/),
      }),
    }));
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RETURN-1',
      returnTrackingNumber: 'RET-TRACK-1',
    });
  });

  it('applies admin Navlungo return pickup diagnostic API version and carrier overrides', async () => {
    const returnRecord = buildNavlungoReturnRecord();
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'NAV-DIAG-1',
        returnTrackingNumber: 'NAV-DIAG-1',
        returnTrackingUrl: 'https://tracking.example/NAV-DIAG-1',
        returnBarcode: 'barcode-string',
        returnCarrierName: 'HepsiJet',
        returnStatus: 'created',
        responseSnapshot: {
          createPostHttpStatus: 201,
          providerMessage: 'Created',
        },
      }),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      ...returnRecord,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-DIAG-1',
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    await createNavlungoReturnPickupForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      {
        ...env,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      },
      {
        adapter,
        endpointVersionOverride: 'v2.1',
        carrierIdOverride: '10',
        diagnosticConfirm: 'YES',
      },
    );

    const requestSnapshot = (adapter.createReturnShipment as ReturnType<typeof vi.fn>).mock.calls[0][0].requestSnapshot;
    expect(requestSnapshot.posts[0].carrier_id).toBe(10);
    expect(requestSnapshot.posts[0].barcode_format).toBe('pdf-A5');
    expect((adapter.createReturnShipment as ReturnType<typeof vi.fn>).mock.calls[0][0].endpointPath).toBe('/post/create');
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnEndpointVersionTried: 'v2.1',
          navlungoReturnRequestedCarrierId: 10,
          navlungoReturnResolvedProviderPath: '/v2.1/post/create',
        }),
      }),
    }));
  });

  it('can probe Navlungo return pickup against the post return endpoint', async () => {
    const returnRecord = buildNavlungoReturnRecord();
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'NAV-RETURN-ENDPOINT-1',
        returnTrackingNumber: 'RET-TRACK-ENDPOINT-1',
        returnTrackingUrl: 'https://tracking.example/RET-TRACK-ENDPOINT-1',
        returnBarcode: 'barcode-string',
        returnCarrierName: 'Sürat Kargo',
        returnStatus: 'created',
        responseSnapshot: {
          createPostHttpStatus: 201,
          providerMessage: 'Created',
        },
      }),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      ...returnRecord,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RETURN-ENDPOINT-1',
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    await createNavlungoReturnPickupForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      {
        ...env,
        NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      },
      {
        adapter,
        endpointVersionOverride: 'v2.1',
        carrierIdOverride: '10',
        endpointPathOverride: '/post/return',
        diagnosticConfirm: 'YES',
      },
    );

    const createInput = (adapter.createReturnShipment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createInput.endpointPath).toBe('/post/return');
    expect(createInput.requestSnapshot.posts[0].post_type).toBe(3);
    expect(createInput.requestSnapshot.posts[0].carrier_id).toBe(10);
    expect(createInput.requestSnapshot.posts[0].recipient).toEqual({ addressId: 55574 });
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnEndpointVersionTried: 'v2.1',
          navlungoReturnRequestedCarrierId: 10,
          navlungoReturnEndpointPathTried: '/post/return',
          navlungoReturnResolvedProviderPath: '/v2.1/post/return',
          navlungoReturnResolvedProviderUrl: 'https://domestic-api.navlungo.com/v2.1/post/return',
        }),
      }),
    }));
  });

  it('requires confirmation for live Navlungo return pickup diagnostic overrides', async () => {
    const returnRecord = buildNavlungoReturnRecord();
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn(),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    await expect(createNavlungoReturnPickupForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      env,
      {
        adapter,
        carrierOverride: '10',
      },
    )).rejects.toThrow('Explicit confirmation is required for Navlungo return pickup diagnostic live create.');
    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
  });

  it('auto-creates Navlungo return pickup for an approved return request with complete data', async () => {
    const returnRecord = buildNavlungoReturnRecord();
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'NAV-AUTO-1',
        returnTrackingNumber: 'AUTO-TRACK-1',
        returnTrackingUrl: 'https://tracking.example/AUTO-TRACK-1',
        returnBarcode: 'barcode-string',
        returnCarrierName: 'Sürat Kargo',
        returnStatus: 'created',
        responseSnapshot: {
          createPostHttpStatus: 201,
          providerMessage: 'Created',
        },
      }),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      ...returnRecord,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-AUTO-1',
      returnTrackingNumber: 'AUTO-TRACK-1',
      returnTrackingUrl: 'https://tracking.example/AUTO-TRACK-1',
      returnLabel: 'barcode-string',
      returnCarrierName: 'Sürat Kargo',
      navlungoReturnCreatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    const result = await autoCreateNavlungoReturnPickupForApprovedReturn('return-request-1', env, { adapter });

    expect(result).toEqual({ attempted: true, skippedReason: null });
    expect(adapter.createReturnShipment).toHaveBeenCalledOnce();
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnProvider: 'navlungo',
        returnProviderShipmentId: 'NAV-AUTO-1',
        returnTrackingNumber: 'AUTO-TRACK-1',
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnAutoCreateAttempted: true,
          navlungoReturnPickupSucceeded: true,
          shopifyReturnTrackingSyncSkippedReason: 'not_implemented',
        }),
      }),
    }));
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('blocks Navlungo return auto-create before provider call when customer district is missing', async () => {
    const base = buildNavlungoReturnRecord();
    const returnRecord = {
      ...base,
      vendorAllocation: {
        ...base.vendorAllocation,
        order: {
          ...base.vendorAllocation.order,
          shippingDistrict: null,
        },
      },
    };
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn(),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    const result = await autoCreateNavlungoReturnPickupForApprovedReturn('return-request-1', env, { adapter });

    expect(result).toEqual({
      attempted: false,
      skippedReason: 'missing_required_fields',
      missingFields: ['sender.district'],
    });
    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnAutoCreateAttempted: true,
          navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
          navlungoReturnPickupStatus: 'needs_attention',
          navlungoReturnPickupMissingFields: ['sender.district'],
          navlungoReturnMissingFields: ['sender.district'],
        }),
      }),
    }));
  });

  it('saves missing Navlungo return pickup address fields and clears diagnostics when resolved', async () => {
    const base = buildNavlungoReturnRecord();
    const returnRecord = {
      ...base,
      returnProviderSnapshot: {
        navlungoReturnPickupMissingFields: ['sender.district'],
        navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
      },
      vendorAllocation: {
        ...base.vendorAllocation,
        order: {
          ...base.vendorAllocation.order,
          shippingDistrict: null,
        },
      },
    };
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      ...returnRecord,
      returnProviderSnapshot: {
        navlungoReturnPickupMissingFields: [],
        navlungoReturnPickupCustomerOverrideKeys: ['district'],
      },
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    await saveNavlungoReturnPickupAddressCompletion(
      'return-request-1',
      { role: 'admin', vendorId: null },
      env,
      { district: 'Kadikoy' },
    );

    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnPickupCustomerOverrides: { district: 'Kadikoy' },
          navlungoReturnPickupCustomerOverrideKeys: ['district'],
          navlungoReturnPickupCustomerOverrideValuesRedacted: true,
          navlungoReturnPickupMissingFields: [],
          navlungoReturnMissingFields: [],
          navlungoReturnAutoCreateSkippedReason: null,
          navlungoReturnPickupStatus: 'ready',
        }),
      }),
    }));
  });

  it('uses saved Navlungo return pickup completion values in dry-run payloads', async () => {
    const base = buildNavlungoReturnRecord();
    const returnRecord = {
      ...base,
      returnProviderSnapshot: {
        navlungoReturnPickupCustomerOverrides: {
          district: 'Kadikoy',
        },
      },
      vendorAllocation: {
        ...base.vendorAllocation,
        order: {
          ...base.vendorAllocation.order,
          shippingDistrict: null,
        },
      },
    };
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue(returnRecord);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    const result = await createNavlungoReturnPickupForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      env,
      { dryRun: true },
    );

    expect(result.returnProviderSnapshot).toMatchObject({
      navlungoReturnPickupMissingFields: [],
      navlungoReturnPickupPayloadSummary: expect.objectContaining({
        senderKeys: expect.arrayContaining(['district']),
      }),
    });
  });

  it('uses completed Navlungo return pickup fields in live create payload', async () => {
    const base = buildNavlungoReturnRecord();
    const returnRecord = {
      ...base,
      returnProviderSnapshot: {
        navlungoReturnPickupCustomerOverrides: {
          district: 'Kadikoy',
        },
      },
      vendorAllocation: {
        ...base.vendorAllocation,
        order: {
          ...base.vendorAllocation.order,
          shippingDistrict: null,
        },
      },
    };
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'NAV-RETURN-COMPLETE-1',
        returnTrackingNumber: 'NAV-RETURN-COMPLETE-1',
        returnTrackingUrl: 'https://tracking.example/NAV-RETURN-COMPLETE-1',
        returnBarcode: 'barcode-string',
        returnCarrierName: 'Sürat Kargo',
        returnStatus: 'created',
        responseSnapshot: {
          createPostHttpStatus: 201,
          providerMessage: 'Created',
        },
      }),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      ...returnRecord,
      returnProviderShipmentId: 'NAV-RETURN-COMPLETE-1',
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    await createNavlungoReturnPickupForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      env,
      { adapter },
    );

    const requestSnapshot = (adapter.createReturnShipment as ReturnType<typeof vi.fn>).mock.calls[0][0].requestSnapshot;
    expect(requestSnapshot.posts[0].sender.district).toBe('Kadikoy');
    expect(requestSnapshot.posts[0].barcode_format).toBe('pdf-A5');
    expect(adapter.createReturnShipment).toHaveBeenCalledOnce();
  });

  it('does not create duplicate Navlungo return pickup when provider evidence already exists', async () => {
    const returnRecord = buildNavlungoReturnRecord({
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-EXISTING-1',
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn(),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);

    const result = await autoCreateNavlungoReturnPickupForApprovedReturn('return-request-1', env, { adapter });

    expect(result).toEqual({ attempted: false, skippedReason: 'return_provider_evidence_exists' });
    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
  });

  it('persists Navlungo return auto-create provider failure diagnostics without evidence', async () => {
    const returnRecord = buildNavlungoReturnRecord();
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      createReturnShipment: vi.fn().mockRejectedValue(
        new ShippingProviderExecutionError('Navlungo return create failed.', {
          createPostHttpStatus: 422,
          providerMessage: 'Validation Errors',
          failedFieldNames: ['posts.0.recipient.addressId'],
          validationErrorMessages: ['District is invalid'],
          validationResponseShape: {
            kind: 'json:object',
            topLevelKeys: ['message', 'status', 'errors'],
          },
        }),
      ),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({ navlungoSenderAddressId: '55574' }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    });

    const result = await autoCreateNavlungoReturnPickupForApprovedReturn('return-request-1', env, { adapter });

    expect(result).toEqual({ attempted: true, skippedReason: 'provider_create_failed' });
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnAutoCreateAttempted: true,
          navlungoReturnPickupSucceeded: false,
          navlungoReturnCreateSucceeded: false,
          navlungoReturnCreateHttpStatus: 422,
          providerMessage: 'Validation Errors',
          navlungoReturnValidationFields: ['posts.0.recipient.addressId'],
          navlungoReturnValidationMessages: ['District is invalid'],
          navlungoReturnValidationResponseShape: {
            kind: 'json:object',
            topLevelKeys: ['message', 'status', 'errors'],
          },
        }),
      }),
    }));
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        returnProvider: 'navlungo',
      }),
    }));
  });

  it('syncs Navlungo return pickup status with the stored return post number', async () => {
    const returnRecord = buildNavlungoReturnRecord({
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-STATUS-1',
      returnTrackingNumber: null,
      returnTrackingUrl: null,
      returnLabel: null,
      returnProviderSnapshot: {
        navlungoReturnPickupSucceeded: true,
      },
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      getShipmentStatus: vi.fn().mockResolvedValue({
        providerShipmentId: 'NAV-RET-STATUS-1',
        trackingNumber: 'CARRIER-RET-1',
        trackingUrl: 'https://tracking.example/CARRIER-RET-1',
        labelUrl: 'barcode-string',
        shipmentStatus: 'in_transit',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          navlungoStatusSyncAttempted: true,
          navlungoStatusSyncHttpStatus: 200,
          navlungoProviderStatusCode: 17,
          navlungoProviderStatusName: 'Transfer Aşamasında',
          navlungoNormalizedStatus: 'in_transit',
          navlungoTrackingEnriched: true,
          navlungoLogsCount: 2,
          navlungoStatusLogs: [
            {
              status_code: 16,
              action: 'Teslim Alındı',
              action_result: 'Pickup completed',
              created_at: '2026-05-22T10:00:00.000Z',
            },
            {
              status_code: 17,
              action: 'Transfer Aşamasında',
              action_result: 'In transit',
              created_at: '2026-05-22T11:00:00.000Z',
            },
          ],
          barcodeStatus: 'created',
          carrierName: 'Sürat Kargo',
          shopifyDeliveryStatusSyncSkippedReason: 'not_implemented',
        },
      }),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);
    prismaMock.returnRecord.update.mockResolvedValue({
      ...returnRecord,
      returnTrackingNumber: 'CARRIER-RET-1',
      returnTrackingUrl: 'https://tracking.example/CARRIER-RET-1',
      returnLabel: 'barcode-string',
      returnCarrierName: 'Sürat Kargo',
    });
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      ...returnRecord,
      returnTrackingNumber: 'CARRIER-RET-1',
      returnTrackingUrl: 'https://tracking.example/CARRIER-RET-1',
      returnLabel: 'barcode-string',
      returnCarrierName: 'Sürat Kargo',
    });

    await syncNavlungoReturnPickupStatusForReturn(
      'return-request-1',
      { role: 'admin', vendorId: null },
      env,
      { adapter },
    );

    expect(adapter.getShipmentStatus).toHaveBeenCalledWith('NAV-RET-STATUS-1');
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnTrackingNumber: 'CARRIER-RET-1',
        returnTrackingUrl: 'https://tracking.example/CARRIER-RET-1',
        returnLabel: 'barcode-string',
        returnCarrierName: 'Sürat Kargo',
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnStatusSyncAttempted: true,
          navlungoReturnStatusSyncHttpStatus: 200,
          navlungoReturnProviderStatusCode: 17,
          navlungoReturnProviderStatusName: 'Transfer Aşamasında',
          navlungoReturnNormalizedStatus: 'in_transit',
          navlungoReturnTrackingEnriched: true,
          navlungoReturnLogsCount: 2,
          navlungoReturnStatusLogs: expect.arrayContaining([
            expect.objectContaining({ status_code: 16 }),
            expect.objectContaining({ status_code: 17 }),
          ]),
          shopifyReturnStatusSyncSkippedReason: 'not_implemented',
        }),
      }),
    }));
  });

  it('blocks Navlungo return status sync when return provider shipment id is missing', async () => {
    const returnRecord = buildNavlungoReturnRecord({
      returnProvider: 'navlungo',
      returnProviderShipmentId: null,
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      getShipmentStatus: vi.fn(),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);

    await expect(
      syncNavlungoReturnPickupStatusForReturn(
        'return-request-1',
        { role: 'admin', vendorId: null },
        env,
        { adapter },
      ),
    ).rejects.toThrow('Navlungo return status sync requires a stored return post number.');

    expect(adapter.getShipmentStatus).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnStatusSyncAttempted: false,
          navlungoReturnStatusSyncSkippedReason: 'missing_return_provider_shipment_id',
          shopifyReturnStatusSyncSkippedReason: 'not_implemented',
        }),
      }),
    }));
  });

  it('persists Navlungo return status sync provider failures without changing evidence', async () => {
    const returnRecord = buildNavlungoReturnRecord({
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-STATUS-1',
      returnTrackingNumber: 'existing-tracking',
    });
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
      getShipmentStatus: vi.fn().mockRejectedValue(
        new ShippingProviderExecutionError('Navlungo detailed Check Post failed with HTTP 422.', {
          navlungoStatusSyncAttempted: true,
          navlungoStatusSyncHttpStatus: 422,
          navlungoProviderStatusCode: 999,
          navlungoProviderStatusName: 'Unknown Provider Status',
          navlungoStatusSyncValidationFields: ['post.post_number'],
          navlungoStatusSyncValidationMessages: ['post.post_number validation failed'],
        }),
      ),
    });
    prismaMock.returnRecord.findUnique.mockResolvedValue(returnRecord);

    await expect(
      syncNavlungoReturnPickupStatusForReturn(
        'return-request-1',
        { role: 'admin', vendorId: null },
        env,
        { adapter },
      ),
    ).rejects.toThrow('Navlungo detailed Check Post failed with HTTP 422.');

    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'return-request-1' },
      data: expect.objectContaining({
        returnProviderSnapshot: expect.objectContaining({
          navlungoReturnStatusSyncAttempted: true,
          navlungoReturnStatusSyncSucceeded: false,
          navlungoReturnStatusSyncHttpStatus: 422,
          navlungoReturnProviderStatusCode: 999,
          navlungoReturnStatusSyncValidationFields: ['post.post_number'],
          navlungoReturnStatusSyncValidationMessages: ['post.post_number validation failed'],
        }),
      }),
    }));
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        returnTrackingNumber: expect.any(String),
      }),
    }));
  });

  it('does not create duplicate Try OTO return shipments', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        lines: [{ sku: 'SKU-1', quantity: 1 }],
      },
      responseSnapshot: {
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          labelUrl: 'https://labels.example/return.pdf',
          createdAt: '2026-05-15T10:00:00.000Z',
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn(),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
    expect(result.returnShipment?.returnOrderId).toBe('OTO-ORDER-1-R1');
  });

  it('does not finalize existing Try OTO return requests or create a duplicate request', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      desi: 3,
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        lines: [{ sku: 'SKU-1', quantity: 1 }],
      },
      responseSnapshot: {
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: '31093945',
          status: 'request_created',
          finalized: false,
          labelRetrievable: false,
          labelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
          createdAt: '2026-05-15T10:00:00.000Z',
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn(),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
    expect(result.returnShipment).toMatchObject({
      returnOrderId: '31093945',
      status: 'request_created',
      finalized: false,
      labelRetrievable: false,
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('creates and persists Try OTO return shipment metadata', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        pickupLocationCode: 'PICKUP-1',
        deliveryOptionId: 'surat-kargo-marketplace',
        lines: [{ sku: 'SKU-1', quantity: 1 }],
      },
      responseSnapshot: {
        provider: 'try_oto',
        forwardDeliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionIdSource: 'delivery_option_lookup',
        forwardDeliveryOptionPersistedAt: 'delivery_option_selected',
        forwardDeliveryOptionRetainedAfterWebhook: true,
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'OTO-ORDER-1-R1',
        returnTrackingNumber: 'RET-TRACK-1',
        returnTrackingUrl: 'https://tracking.example/RET-TRACK-1',
        returnLabelUrl: 'https://labels.example/return.pdf',
        returnBarcode: 'RET-BARCODE-1',
        returnStatus: 'created',
        responseSnapshot: {
          status: 200,
          bodyKeys: ['printAWBURL', 'returnOrderId', 'trackingNumber'],
          requestKeys: ['items', 'orderId', 'pickupLocationCode'],
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({ fulfillmentStatus: 'Fulfilled' }));
    storedExecution = existing;

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createReturnShipment).toHaveBeenCalledWith({
      orderId: 'OTO-ORDER-1',
      pickupLocationCode: 'PICKUP-1',
      deliveryOptionId: 'surat-kargo-marketplace',
      packageWeight: 3,
      items: [{ sku: 'SKU-1', quantity: '1' }],
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: expect.objectContaining({
          responseSnapshot: expect.objectContaining({
            returnShipment: expect.objectContaining({
              returnOrderId: 'OTO-ORDER-1-R1',
              trackingNumber: 'RET-TRACK-1',
              labelUrl: 'https://labels.example/return.pdf',
              barcode: 'RET-BARCODE-1',
            }),
          }),
        }),
      }),
    );
    expect(result.returnShipment?.labelUrl).toBe('https://labels.example/return.pdf');
  });

  it('passes documented Try OTO return deliveryOptionId when already stored', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        pickupLocationCode: 'PICKUP-1',
        deliveryOptionId: 'surat-kargo-marketplace',
        lines: [{ sku: 'SKU-1', quantity: 1 }],
      },
      responseSnapshot: {
        provider: 'try_oto',
        forwardDeliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionIdSource: 'async_recovery',
        forwardDeliveryOptionPersistedAt: 'async_recovery',
        forwardDeliveryOptionRetainedAfterWebhook: true,
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'OTO-ORDER-1-R1',
        returnTrackingNumber: null,
        returnTrackingUrl: null,
        returnLabelUrl: null,
        returnBarcode: null,
        returnStatus: null,
        responseSnapshot: {
          status: 200,
          bodyKeys: ['returnOrderId'],
          requestKeys: ['deliveryOptionId', 'items', 'orderId', 'pickupLocationCode'],
          returnDeliveryOptionIdPresent: true,
          returnDeliveryOptionLookupCalled: false,
          returnDeliveryOptionLookupImplemented: false,
          returnFinalizationEndpointConfirmed: false,
          returnFinalizeEndpointImplemented: false,
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({ fulfillmentStatus: 'Fulfilled' }));
    storedExecution = existing;

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createReturnShipment).toHaveBeenCalledWith({
      orderId: 'OTO-ORDER-1',
      pickupLocationCode: 'PICKUP-1',
      deliveryOptionId: 'surat-kargo-marketplace',
      packageWeight: 3,
      items: [{ sku: 'SKU-1', quantity: '1' }],
    });
    expect(result.returnShipment?.diagnostics).toMatchObject({
      returnDeliveryOptionIdPresent: true,
      returnDeliveryOptionIdSource: 'request_snapshot',
      forwardDeliveryOptionIdPresent: true,
      forwardDeliveryOptionIdSource: 'async_recovery',
      forwardDeliveryOptionPersistedAt: 'async_recovery',
      forwardDeliveryOptionRetainedAfterWebhook: true,
      returnDeliveryOptionLookupCalled: false,
      returnDeliveryOptionLookupImplemented: false,
      returnFinalizationEndpointConfirmed: false,
      returnFinalizeEndpointImplemented: false,
    });
  });

  it('blocks Try OTO return creation before provider call when deliveryOptionId is missing', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        pickupLocationCode: 'PICKUP-1',
        lines: [{ sku: 'SKU-1', quantity: 1 }],
      },
      responseSnapshot: {
        provider: 'try_oto',
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn(),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({ fulfillmentStatus: 'Fulfilled' }));
    storedExecution = existing;

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
    expect(result.returnShipment).toMatchObject({
      status: 'skipped',
      returnOrderId: null,
      labelRetrievalNote: 'Try OTO return shipment was not created because deliveryOptionId is missing.',
      diagnostics: {
        returnSkippedReason: 'missing_delivery_option_id',
        forwardDeliveryOptionIdPresent: false,
        returnDeliveryOptionIdPresent: false,
        pickupLocationCodePresent: true,
        returnItemSkuPresent: true,
        returnItemQuantityPresent: true,
      },
    });
  });

  it('blocks Try OTO return creation before provider call when returned sku or quantity is missing', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        pickupLocationCode: 'PICKUP-1',
      },
      responseSnapshot: {
        provider: 'try_oto',
        forwardDeliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionIdSource: 'async_recovery',
        forwardDeliveryOptionPersistedAt: 'async_recovery',
        forwardDeliveryOptionRetainedAfterWebhook: true,
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn(),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        fulfillmentStatus: 'Fulfilled',
        lineItems: [
          {
            quantity: 1,
            lineAmount: 100,
            shopifyOrderLineItem: {
              sourceLineItemId: 'line-1',
              sku: null,
            },
          },
        ],
      }),
    );
    storedExecution = existing;

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createReturnShipment).not.toHaveBeenCalled();
    expect(result.returnShipment).toMatchObject({
      status: 'skipped',
      labelRetrievalNote: 'Try OTO return shipment was not created because returned item SKU or quantity is missing.',
      diagnostics: {
        returnSkippedReason: 'missing_return_items',
        forwardDeliveryOptionIdPresent: true,
        returnDeliveryOptionIdPresent: true,
        returnItemSkuPresent: false,
        returnItemQuantityPresent: false,
      },
    });
  });

  it('uses approved Shopify return line items and stored forward delivery option for Try OTO returns', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        pickupLocationCode: 'PICKUP-1',
        lines: [
          { sku: 'SKU-ORIGINAL-1', quantity: 2 },
          { sku: 'SKU-ORIGINAL-2', quantity: 1 },
        ],
      },
      responseSnapshot: {
        provider: 'try_oto',
        forwardDeliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionIdSource: 'async_recovery',
        forwardDeliveryOptionPersistedAt: 'async_recovery',
        forwardDeliveryOptionRetainedAfterWebhook: true,
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'OTO-ORDER-1-R1',
        returnTrackingNumber: 'RET-TRACK-1',
        returnTrackingUrl: null,
        returnLabelUrl: null,
        returnBarcode: 'RET-BARCODE-1',
        returnStatus: 'created',
        responseSnapshot: {
          status: 200,
          bodyKeys: ['barcode', 'returnOrderId', 'trackingNumber'],
          requestKeys: ['deliveryOptionId', 'items', 'orderId', 'pickupLocationCode'],
          returnDeliveryOptionIdPresent: true,
          returnItemSkuPresent: true,
          returnItemQuantityPresent: true,
          createReturnShipmentFinalized: true,
          returnFinalized: true,
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        fulfillmentStatus: 'Fulfilled',
        returnRecords: [
          {
            status: 'approved',
            returnLifecycleStatus: 'approved',
            sourceShopifyLineItemId: 'line-2',
          },
        ],
        lineItems: [
          {
            quantity: 2,
            lineAmount: 200,
            shopifyOrderLineItem: {
              sourceLineItemId: 'line-1',
              sku: 'SKU-ORIGINAL-1',
            },
          },
          {
            quantity: 1,
            lineAmount: 100,
            shopifyOrderLineItem: {
              sourceLineItemId: 'line-2',
              sku: 'SKU-RETURNED-2',
            },
          },
        ],
      }),
    );
    storedExecution = existing;

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.createReturnShipment).toHaveBeenCalledWith({
      orderId: 'OTO-ORDER-1',
      pickupLocationCode: 'PICKUP-1',
      deliveryOptionId: 'surat-kargo-marketplace',
      packageWeight: 3,
      items: [{ sku: 'SKU-RETURNED-2', quantity: '1' }],
    });
    expect(result.returnShipment).toMatchObject({
      trackingNumber: 'RET-TRACK-1',
      barcode: 'RET-BARCODE-1',
      status: 'created',
      finalized: true,
    });
    expect(result.returnShipment?.diagnostics).toMatchObject({
      returnDeliveryOptionIdPresent: true,
      returnDeliveryOptionIdSource: 'async_recovery',
      forwardDeliveryOptionIdPresent: true,
      forwardDeliveryOptionIdSource: 'async_recovery',
      forwardDeliveryOptionPersistedAt: 'async_recovery',
      forwardDeliveryOptionRetainedAfterWebhook: true,
      returnItemSkuPresent: true,
      returnItemQuantityPresent: true,
      createReturnShipmentFinalized: true,
      returnFinalized: true,
    });
  });

  it('marks Try OTO return creation without label as request created and unfinalized', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      requestSnapshot: {
        orderId: 'OTO-ORDER-1',
        pickupLocationCode: 'PICKUP-1',
        lines: [{ sku: 'SKU-1', quantity: 1 }],
      },
      responseSnapshot: {
        provider: 'try_oto',
        selectedDeliveryOptionId: 'surat-kargo-marketplace',
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      createReturnShipment: vi.fn().mockResolvedValue({
        returnOrderId: 'OTO-ORDER-1-R1',
        returnTrackingNumber: 'RET-TRACK-1',
        returnTrackingUrl: null,
        returnLabelUrl: null,
        returnBarcode: 'RET-BARCODE-1',
        returnStatus: null,
        responseSnapshot: {
          status: 200,
          bodyKeys: ['returnOrderId', 'trackingNumber'],
          requestKeys: ['items', 'orderId', 'pickupLocationCode'],
          returnOrderIdPresent: true,
          returnTrackingPresent: true,
          returnBarcodePresent: true,
          returnLabelPresent: false,
          returnFinalized: false,
          returnLabelRetrievable: false,
          returnProviderStatusSource: 'createReturnShipment',
          returnLabelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
          returnDeliveryOptionIdPresent: true,
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({ fulfillmentStatus: 'Fulfilled' }));
    storedExecution = existing;

    const result = await createTryOtoReturnShipmentLabel(existing.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(result.returnShipment).toMatchObject({
      returnOrderId: 'OTO-ORDER-1-R1',
      trackingNumber: 'RET-TRACK-1',
      labelUrl: null,
      status: 'request_created',
      finalized: false,
      labelRetrievable: false,
      providerStatusSource: 'createReturnShipment',
      labelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
    });
    expect(result.returnShipment?.diagnostics).toMatchObject({
      httpStatus: 200,
      returnProviderIdPresent: true,
      returnTrackingPresent: true,
      returnBarcodePresent: true,
      returnFinalized: false,
      returnLabelRetrievable: false,
      returnDeliveryOptionIdPresent: true,
    });
  });

  it('does not call unconfirmed reverse createShipment when creating Try OTO return requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, otoId: 31093945, returnOrderId: '31093945' })));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createReturnShipment({
      orderId: 'OTO-ORDER-1',
      pickupLocationCode: 'PICKUP-1',
      deliveryOptionId: 'surat-kargo-marketplace',
      items: [{ sku: 'SKU-1', quantity: '1' }],
      packageWeight: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://staging-api.tryoto.com/rest/v2/refreshToken',
      'https://staging-api.tryoto.com/rest/v2/createReturnShipment',
    ]);
    expect(result).toMatchObject({
      returnOrderId: '31093945',
      returnTrackingNumber: null,
      returnBarcode: null,
      returnLabelUrl: null,
      responseSnapshot: {
        returnFinalized: false,
        returnDeliveryOptionLookupImplemented: false,
        returnPriceLookupCalled: false,
        returnPriceLookupSuccess: false,
        returnPriceLookupOptionCount: 0,
        selectedReturnPriceOptionIdPresent: false,
        returnFinalizationEndpointConfirmed: false,
        returnFinalizeEndpointImplemented: false,
        returnFinalizationDisabledReason: 'reverse_create_shipment_unconfirmed',
        reverseCreateShipmentCalled: false,
        reverseCreateShipmentSuccess: false,
        reverseCreateShipmentResponseKeys: [],
        returnProviderStatusSource: 'createReturnShipment',
        returnLabelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
      },
    });
  });

  it('sends confirmed Try OTO createReturnShipment payload and finalizes when barcode or tracking is returned', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            returnOrderId: 'OTO-ORDER-1-R1',
            trackingNumber: 'RET-TRACK-1',
            printReturnAWBURL: 'https://labels.example/return-awb.pdf',
            brandedTrackingURL: 'https://track.example/RET-TRACK-1',
            deliveryCompany: 'Sürat Kargo',
            deliveryOptionName: 'Sürat Marketplace',
            returnOrderStatus: 'shipmentCreated',
            returnStatus: 'created',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createReturnShipment({
      orderId: 'OTO-ORDER-1',
      pickupLocationCode: 'PICKUP-1',
      deliveryOptionId: 'surat-kargo-marketplace',
      items: [{ sku: 'SKU-1', quantity: '1' }],
      packageWeight: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://staging-api.tryoto.com/rest/v2/createReturnShipment',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      orderId: 'OTO-ORDER-1',
      pickupLocationCode: 'PICKUP-1',
      deliveryOptionId: 'surat-kargo-marketplace',
      items: [{ sku: 'SKU-1', quantity: '1' }],
    });
    expect(result).toMatchObject({
      returnOrderId: 'OTO-ORDER-1-R1',
      returnTrackingNumber: 'RET-TRACK-1',
      returnTrackingUrl: 'https://track.example/RET-TRACK-1',
      returnLabelUrl: 'https://labels.example/return-awb.pdf',
      returnBarcode: 'RET-TRACK-1',
      returnCarrierName: 'Sürat Kargo',
      returnStatus: 'created',
      responseSnapshot: {
        requestKeys: ['deliveryOptionId', 'items', 'orderId', 'pickupLocationCode'],
        returnDeliveryOptionIdPresent: true,
        returnItemSkuPresent: true,
        returnItemQuantityPresent: true,
        createReturnShipmentFinalized: true,
        returnFinalized: true,
        returnLabelRetrievable: true,
        returnTrackingPresent: true,
        returnBarcodePresent: true,
        returnLabelPresent: true,
        returnCarrierName: 'Sürat Kargo',
        returnTrackingSourceChecked: 'createReturnShipment.trackingNumber',
        returnLabelSourceChecked: 'createReturnShipment.printReturnAWBURL',
        rawPrintReturnAwbUrlPresent: true,
        normalizedReturnLabelUrlPresent: true,
        returnLabelPersistenceStage: 'createReturnShipment',
        returnLabelOverwrittenByStaleSnapshot: false,
        createReturnShipmentLabelFieldPresent: true,
        reverseCreateShipmentCalled: false,
      },
    });
  });

  it('keeps Try OTO return request unfinalized without probing reverse price options', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, otoId: 31093945, returnOrderId: '31093945' })));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createReturnShipment({
      orderId: 'OTO-ORDER-1',
      pickupLocationCode: 'PICKUP-1',
      deliveryOptionId: 'surat-kargo-marketplace',
      items: [{ sku: 'SKU-1', quantity: '1' }],
      packageWeight: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/getPriceList');
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/createShipment');
    expect(result.responseSnapshot).toMatchObject({
      returnFinalized: false,
      returnPriceLookupCalled: false,
      returnPriceLookupSuccess: false,
      returnPriceLookupOptionCount: 0,
      selectedReturnPriceOptionIdPresent: false,
      reverseCreateShipmentCalled: false,
      returnLabelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
    });
  });

  it('blocks Try OTO return details probe without a return reference', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnDetails(existing.id, {
      env,
      adapter: buildAdapter({ provider: 'TRY_OTO' as const }),
    });

    expect(result.returnShipment?.detailsProbe).toMatchObject({
      status: 'blocked',
      errorMessage: 'Try OTO return details probe requires a return order id, tracking number, or barcode.',
    });
  });

  it('persists Try OTO return label URL found by getReturnDetails probe', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          trackingNumber: 'RET-TRACK-1',
          labelUrl: null,
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      probeReturnDetails: vi.fn().mockResolvedValue({
        returnLabelUrl: 'https://labels.example/return.pdf',
        returnTrackingNumber: 'RET-TRACK-1',
        returnBarcode: 'RET-BARCODE-1',
        returnStatus: 'created',
        responseSnapshot: {
          status: 200,
          bodyKeys: ['data'],
          nestedKeys: ['data.printAWBURL', 'data.trackingNumber'],
          labelLikeFieldsPresent: true,
          awbLikeFieldsPresent: true,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: true,
          trackingPresent: true,
          barcodePresent: true,
          providerStatus: 'created',
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnDetails(existing.id, {
      env,
      adapter,
    });

    expect(adapter.probeReturnDetails).toHaveBeenCalledWith('OTO-ORDER-1-R1');
    expect(result.returnShipment).toMatchObject({
      labelUrl: 'https://labels.example/return.pdf',
      labelRetrievalConfirmed: true,
      labelRetrievable: true,
      providerStatusSource: 'getReturnDetails',
      detailsProbe: {
        status: 'success',
        labelUrlPresent: true,
        responseKeys: ['data'],
        nestedKeys: ['data.printAWBURL', 'data.trackingNumber'],
      },
    });
  });

  it('keeps safe fallback when getReturnDetails has no return label URL', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      probeReturnDetails: vi.fn().mockResolvedValue({
        returnLabelUrl: null,
        returnTrackingNumber: 'RET-TRACK-1',
        returnBarcode: null,
        returnStatus: 'new_return',
        responseSnapshot: {
          status: 200,
          bodyKeys: ['data'],
          nestedKeys: ['data.status', 'data.trackingNumber'],
          labelLikeFieldsPresent: false,
          awbLikeFieldsPresent: false,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: false,
          trackingPresent: true,
          barcodePresent: false,
          providerStatus: 'new_return',
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnDetails(existing.id, {
      env,
      adapter,
    });

    expect(result.returnShipment).toMatchObject({
      labelUrl: null,
      labelRetrievalConfirmed: false,
      labelRetrievable: false,
      labelRetrievalNote: 'Return label is not available from getReturnDetails yet.',
      detailsProbe: {
        status: 'no_label',
        labelLikeFieldsPresent: false,
        labelUrlPresent: false,
      },
    });
  });

  it('does not let stale no-label probes remove a persisted printReturnAWBURL return label', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          trackingNumber: 'RET-TRACK-1',
          brandedTrackingURL: 'https://tracking.example/RET-TRACK-1',
          printReturnAWBURL: 'https://labels.example/return-awb.pdf',
          labelRetrievable: false,
          labelRetrievalConfirmed: false,
          diagnostics: {
            returnLabelRetrievable: false,
            labelFieldPresent: false,
          },
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      probeReturnDetails: vi.fn().mockResolvedValue({
        returnLabelUrl: null,
        returnTrackingNumber: 'RET-TRACK-1',
        returnBarcode: null,
        returnStatus: 'new_return',
        responseSnapshot: {
          status: 200,
          bodyKeys: ['data'],
          nestedKeys: ['data.status', 'data.trackingNumber'],
          labelLikeFieldsPresent: false,
          awbLikeFieldsPresent: false,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: false,
          trackingPresent: true,
          barcodePresent: false,
          providerStatus: 'new_return',
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnDetails(existing.id, {
      env,
      adapter,
    });

    expect(result.returnShipment).toMatchObject({
      labelUrl: 'https://labels.example/return-awb.pdf',
      trackingUrl: 'https://tracking.example/RET-TRACK-1',
      labelRetrievalConfirmed: true,
      labelRetrievable: true,
      detailsProbe: {
        status: 'no_label',
        labelUrlPresent: false,
      },
      diagnostics: {
        rawPrintReturnAwbUrlPresent: true,
        normalizedReturnLabelUrlPresent: true,
        returnLabelPersistenceStage: 'existing_return_snapshot',
        returnLabelOverwrittenByStaleSnapshot: false,
      },
    });
  });

  it('blocks Try OTO return link probe without a return reference', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnLink(existing.id, {
      env,
      adapter: buildAdapter({ provider: 'TRY_OTO' as const }),
    });

    expect(result.returnShipment?.linkProbe).toMatchObject({
      status: 'blocked',
      endpoint: '/rest/v2/getReturnLink',
      errorMessage: 'Try OTO return link probe requires a return order id, tracking number, or barcode.',
    });
  });

  it('persists clear Try OTO return label URL found by getReturnLink probe', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          labelUrl: null,
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      probeReturnLink: vi.fn().mockResolvedValue({
        returnLabelUrl: 'https://labels.example/return.pdf',
        returnTrackingNumber: null,
        returnBarcode: null,
        returnStatus: null,
        responseSnapshot: {
          status: 200,
          bodyKeys: ['data'],
          nestedKeys: ['data.printAWBURL'],
          labelLikeFieldsPresent: true,
          awbLikeFieldsPresent: true,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: true,
          actionUrlPresent: false,
          trackingPresent: false,
          barcodePresent: false,
          providerStatus: null,
          providerMessage: null,
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnLink(existing.id, {
      env,
      adapter,
    });

    expect(adapter.probeReturnLink).toHaveBeenCalledWith('OTO-ORDER-1-R1');
    expect(result.returnShipment).toMatchObject({
      labelUrl: 'https://labels.example/return.pdf',
      labelRetrievalConfirmed: true,
      labelRetrievable: true,
      providerStatusSource: 'getReturnLink',
      linkProbe: {
        status: 'success',
        endpoint: '/rest/v2/getReturnLink',
        labelUrlPresent: true,
        actionUrlPresent: false,
      },
    });
  });

  it('keeps getReturnLink action URL diagnostic-only when no clear label field exists', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      probeReturnLink: vi.fn().mockResolvedValue({
        returnLabelUrl: null,
        returnTrackingNumber: null,
        returnBarcode: null,
        returnStatus: null,
        responseSnapshot: {
          status: 200,
          bodyKeys: ['data'],
          nestedKeys: ['data.returnLink'],
          labelLikeFieldsPresent: false,
          awbLikeFieldsPresent: false,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: true,
          actionUrlPresent: true,
          trackingPresent: false,
          barcodePresent: false,
          providerStatus: null,
          providerMessage: null,
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnLink(existing.id, {
      env,
      adapter,
    });

    expect(result.returnShipment).toMatchObject({
      labelUrl: null,
      labelRetrievalConfirmed: false,
      labelRetrievable: false,
      labelRetrievalNote: 'Return label is not available from getReturnLink yet.',
      linkProbe: {
        status: 'no_label',
        actionUrlPresent: true,
        labelUrlPresent: false,
      },
    });
  });

  it('blocks Try OTO return AWB print probe without returnOrderId', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          trackingNumber: 'RET-TRACK-1',
        },
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnAwbPrint(existing.id, {
      env,
      adapter: buildAdapter({ provider: 'TRY_OTO' as const }),
    });

    expect(result.returnShipment?.awbPrintProbe).toMatchObject({
      status: 'blocked',
      endpoint: '/rest/v2/print/{returnOrderId}?printReverseShipment=true',
      errorMessage: 'Try OTO return AWB print probe requires a return order id.',
    });
  });

  it('persists Try OTO return label URL found by AWB print probe', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          labelUrl: null,
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      probeReturnAwbPrint: vi.fn().mockResolvedValue({
        returnLabelUrl: 'https://labels.example/return-awb.pdf',
        returnTrackingNumber: 'RET-TRACK-1',
        returnBarcode: 'RET-BARCODE-1',
        returnStatus: 'created',
        responseSnapshot: {
          status: 200,
          endpoint: '/rest/v2/print/OTO-ORDER-1-R1?printReverseShipment=true',
          bodyKeys: ['printAWBURL', 'trackingNumber'],
          nestedKeys: ['printAWBURL', 'trackingNumber'],
          labelLikeFieldsPresent: true,
          awbLikeFieldsPresent: true,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: true,
          trackingPresent: true,
          barcodePresent: true,
          providerStatus: 'created',
          providerMessage: null,
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnAwbPrint(existing.id, {
      env,
      adapter,
    });

    expect(adapter.probeReturnAwbPrint).toHaveBeenCalledWith('OTO-ORDER-1-R1');
    expect(result.returnShipment).toMatchObject({
      labelUrl: 'https://labels.example/return-awb.pdf',
      labelRetrievalConfirmed: true,
      labelRetrievable: true,
      providerStatusSource: 'return AWB print',
      awbPrintProbe: {
        status: 'success',
        endpoint: '/rest/v2/print/OTO-ORDER-1-R1?printReverseShipment=true',
        labelUrlPresent: true,
      },
    });
  });

  it('keeps safe fallback when AWB print returns no label URL', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
        },
      },
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
      probeReturnAwbPrint: vi.fn().mockResolvedValue({
        returnLabelUrl: null,
        returnTrackingNumber: null,
        returnBarcode: null,
        returnStatus: null,
        responseSnapshot: {
          status: 200,
          endpoint: '/rest/v2/print/OTO-ORDER-1-R1?printReverseShipment=true',
          bodyKeys: ['message'],
          nestedKeys: ['message'],
          labelLikeFieldsPresent: false,
          awbLikeFieldsPresent: false,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: false,
          trackingPresent: false,
          barcodePresent: false,
          providerStatus: null,
          providerMessage: 'No print data yet',
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await probeTryOtoReturnAwbPrint(existing.id, {
      env,
      adapter,
    });

    expect(result.returnShipment).toMatchObject({
      labelUrl: null,
      labelRetrievalConfirmed: false,
      labelRetrievable: false,
      labelRetrievalNote: 'Return AWB print did not return a label URL yet.',
      awbPrintProbe: {
        status: 'no_label',
        labelUrlPresent: false,
        providerMessage: 'No print data yet',
      },
    });
  });

  it('blocks Shopify return label upload probe when Shopify return id is missing', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      responseSnapshot: {
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          trackingNumber: 'RET-TRACK-1',
          labelUrl: 'https://labels.example/return.pdf',
        },
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.returnRecord.findFirst.mockResolvedValue(null);

    const result = await probeShopifyReturnLabelUpload(existing.id, {
      env,
      shopifyAdminService: {
        probeReturnLabelUpload: vi.fn(),
      },
    });

    expect(result.returnShipment?.shopifyReturnLabelUploadProbe).toMatchObject({
      status: 'blocked',
      skippedReason: 'missing_shopify_return_id',
      labelAccepted: false,
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responseSnapshot: expect.objectContaining({
            returnShipment: expect.objectContaining({
              shopifyReturnLabelUploadProbe: expect.objectContaining({
                skippedReason: 'missing_shopify_return_id',
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('syncs Shopify return tracking without requiring a return label URL', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      responseSnapshot: {
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          trackingNumber: 'RET-TRACK-1',
          brandedTrackingURL: 'https://tracking.example/RET-TRACK-1',
          carrierName: 'Sürat Kargo',
        },
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      sourceShopifyReturnGid: 'gid://shopify/Return/231',
      sourceShopifyReturnId: '231',
    });
    const probeReturnLabelUpload = vi.fn().mockResolvedValue({
      mutationUsed: 'reverseDeliveryCreateWithShipping',
      reverseFulfillmentOrderIdPresent: true,
      reverseLineItemIdsPresent: true,
      reverseDeliveryId: 'gid://shopify/ReverseDelivery/1',
      trackingAccepted: true,
      labelAccepted: false,
      returnedCarrierName: 'Sürat Kargo',
      userErrors: [],
      source: 'shopify_admin',
    });

    const result = await probeShopifyReturnLabelUpload(existing.id, {
      env,
      shopifyAdminService: {
        probeReturnLabelUpload,
      },
    });

    expect(probeReturnLabelUpload).toHaveBeenCalledWith({
      returnGid: 'gid://shopify/Return/231',
      trackingNumber: 'RET-TRACK-1',
      trackingUrl: 'https://tracking.example/RET-TRACK-1',
      labelUrl: null,
      carrierName: 'Sürat Kargo',
    });
    expect(result.returnShipment?.shopifyReturnLabelUploadProbe).toMatchObject({
      status: 'success',
      skippedReason: 'return_label_url_missing_tracking_only',
      trackingAccepted: true,
      labelAccepted: false,
      trackingOnlyMode: true,
      labelInputSent: false,
      shopifyCallAttempted: true,
    });
  });

  it('stores successful Shopify return label upload probe diagnostics', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      responseSnapshot: {
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          trackingNumber: 'RET-TRACK-1',
          brandedTrackingURL: 'https://tracking.example/RET-TRACK-1',
          printReturnAWBURL: 'https://labels.example/return.pdf',
          carrierName: 'Sürat Kargo',
          labelRetrievable: false,
          labelRetrievalConfirmed: false,
          diagnostics: {
            returnLabelRetrievable: false,
            labelFieldPresent: false,
          },
        },
      },
    });
    const shopifyAdminService = {
      probeReturnLabelUpload: vi.fn().mockResolvedValue({
        mutationUsed: 'reverseDeliveryCreateWithShipping',
        reverseFulfillmentOrderIdPresent: true,
        reverseLineItemIdsPresent: true,
        reverseDeliveryId: 'gid://shopify/ReverseDelivery/1',
        trackingAccepted: true,
        labelAccepted: true,
        returnedCarrierName: 'Sürat Kargo',
        userErrors: [],
        source: 'shopify_admin',
      }),
    };
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      sourceShopifyReturnGid: 'gid://shopify/Return/231',
      sourceShopifyReturnId: '231',
    });

    const result = await probeShopifyReturnLabelUpload(existing.id, {
      env,
      shopifyAdminService,
    });

    expect(shopifyAdminService.probeReturnLabelUpload).toHaveBeenCalledWith({
      returnGid: 'gid://shopify/Return/231',
      trackingNumber: 'RET-TRACK-1',
      trackingUrl: 'https://tracking.example/RET-TRACK-1',
      labelUrl: 'https://labels.example/return.pdf',
      carrierName: 'Sürat Kargo',
    });
    expect(result.returnShipment).toMatchObject({
      trackingUrl: 'https://tracking.example/RET-TRACK-1',
      labelUrl: 'https://labels.example/return.pdf',
      labelRetrievable: true,
      labelRetrievalConfirmed: true,
      diagnostics: {
        labelFieldPresent: true,
        returnLabelRetrievable: true,
        returnLabelSourceChecked: 'returnShipment.printReturnAWBURL',
      },
    });
    expect(result.returnShipment?.shopifyReturnLabelUploadProbe).toMatchObject({
      status: 'success',
      mutationUsed: 'reverseDeliveryCreateWithShipping',
      shopifyReturnIdPresent: true,
      reverseFulfillmentOrderIdPresent: true,
      reverseLineItemIdsPresent: true,
      reverseDeliveryIdPresent: true,
      trackingAccepted: true,
      labelAccepted: true,
      returnedCarrierName: 'Sürat Kargo',
      carrierNamePresent: true,
    });
  });

  it('persists Shopify user errors safely when external return label URL is rejected', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      shipmentStatus: 'DELIVERED',
      providerShipmentId: 'oto-1',
      trackingNumber: 'OTO-TRACK-1',
      responseSnapshot: {
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1-R1',
          trackingNumber: 'RET-TRACK-1',
          labelUrl: 'https://labels.example/return.pdf',
          carrierName: 'Sürat Kargo',
        },
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.returnRecord.findFirst.mockResolvedValue({
      sourceShopifyReturnGid: null,
      sourceShopifyReturnId: '231',
    });

    const result = await probeShopifyReturnLabelUpload(existing.id, {
      env,
      shopifyAdminService: {
        probeReturnLabelUpload: vi.fn().mockResolvedValue({
          mutationUsed: 'reverseDeliveryShippingUpdate',
          reverseFulfillmentOrderIdPresent: true,
          reverseLineItemIdsPresent: true,
          reverseDeliveryId: null,
          trackingAccepted: false,
          labelAccepted: false,
          returnedCarrierName: null,
          userErrors: [{ field: ['labelInput', 'fileUrl'], message: 'File URL is invalid.' }],
          source: 'shopify_admin',
        }),
      },
    });

    expect(result.returnShipment?.shopifyReturnLabelUploadProbe).toMatchObject({
      status: 'failed',
      mutationUsed: 'reverseDeliveryShippingUpdate',
      skippedReason: 'staged_upload_required_or_external_file_url_rejected',
      trackingAccepted: false,
      labelAccepted: false,
      carrierNamePresent: true,
      shopifyUserErrors: [{ field: ['labelInput', 'fileUrl'], message: 'File URL is invalid.' }],
    });
    expect(JSON.stringify(prismaMock.shipmentExecution.update.mock.calls)).not.toContain('Authorization');
  });

  it('registers a Try OTO webhook route that is disabled by default', async () => {
    const posts = new Map<
      string,
      (
        request: { body?: unknown; method?: string; headers?: Record<string, string> },
        reply: { code: (status: number) => { send: (body: unknown) => unknown } },
      ) => unknown
    >();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, ...args: unknown[]) => {
        const handler = args.at(-1) as (
          request: { body?: unknown; method?: string; headers?: Record<string, string> },
          reply: { code: (status: number) => { send: (body: unknown) => unknown } },
        ) => unknown;
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerShippingExecutionRoutes(app as never, env);
    const result = await posts.get('/webhooks/try-oto')?.(
      { body: {}, method: 'POST', headers: { 'content-type': 'application/json' } },
      reply,
    );

    expect(result).toEqual({
      status: 501,
      body: {
        message: 'Try OTO webhook ingestion is disabled.',
        signatureVerificationImplemented: false,
      },
    });
    const diagnostics = getShippingProviderGateDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
      },
      'try_oto',
    );
    expect(diagnostics).toMatchObject({
      lastWebhookReceived: true,
      lastWebhookHttpMethod: 'POST',
      lastWebhookContentType: 'application/json',
      lastWebhookMatchStatus: 'disabled',
      lastWebhookMatchedShipment: false,
      webhookSignatureVerificationImplemented: false,
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('handles unknown Try OTO webhook payloads without crashing or mutating data', async () => {
    const result = await ingestTryOtoWebhook(
      { unknown: true },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: false,
      matchStatus: 'unmatched',
      shipmentExecutionId: null,
      signatureVerificationImplemented: false,
    });
    const diagnostics = getShippingProviderGateDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
      },
      'try_oto',
    );
    expect(diagnostics).toMatchObject({
      lastWebhookReceived: true,
      lastWebhookPayloadKeys: ['unknown'],
      lastWebhookMatchStatus: 'unmatched',
      lastWebhookMatchedShipment: false,
      lastWebhookParseError: null,
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('records Try OTO webhook parse diagnostics safely', async () => {
    const result = await ingestTryOtoWebhook(null, {
      env: {
        ...env,
        TRY_OTO_ENABLED: true,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
      },
      httpMethod: 'POST',
      contentType: 'application/json',
    });

    expect(result).toMatchObject({
      ok: true,
      matched: false,
      matchStatus: 'unmatched',
    });
    const diagnostics = getShippingProviderGateDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
      },
      'try_oto',
    );
    expect(diagnostics).toMatchObject({
      lastWebhookReceived: true,
      lastWebhookMatchStatus: 'parse_error',
      lastWebhookParseError: 'Webhook payload body was not an object.',
      lastWebhookPayloadKeys: [],
    });
    expect(JSON.stringify(diagnostics)).not.toContain('Authorization');
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('ingests Try OTO webhook tracking updates into the matched shipment execution', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'OTO-ORDER-1039',
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'OTO-ORDER-1039',
        timeline: [{ label: 'Shipment created', at: '2026-05-15T10:00:00.000Z', status: 'created' }],
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await ingestTryOtoWebhook(
      {
        data: {
          orderId: 'OTO-ORDER-1039',
          trackingNumber: 'OTO-TRACK-1039',
          trackingUrl: 'https://track.example/OTO-TRACK-1039',
          printLabelURL: 'https://labels.example/OTO-TRACK-1039.pdf',
          status: 'in_transit',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: true,
      shipmentExecutionId: 'shipment-try_oto-alloc-1',
      shipmentStatus: 'in_transit',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-try_oto-alloc-1' },
        data: expect.objectContaining({
          trackingNumber: 'OTO-TRACK-1039',
          trackingUrl: 'https://track.example/OTO-TRACK-1039',
          labelUrl: 'https://labels.example/OTO-TRACK-1039.pdf',
          shipmentStatus: 'IN_TRANSIT',
          responseSnapshot: expect.objectContaining({
            webhookReceived: true,
            tryOtoWebhookReceived: true,
            lastTryOtoWebhookMatchStatus: 'matched',
            lastTryOtoWebhookMatchedByField: 'orderId',
            lastTryOtoWebhookContentType: null,
            lastTryOtoWebhookStatusField: 'in_transit',
            lastTryOtoWebhookParseError: null,
            tryOtoWebhookSignatureVerificationImplemented: false,
            tryOtoWebhookResponseKeys: expect.arrayContaining(['orderId', 'printLabelURL', 'status', 'trackingNumber', 'trackingUrl']),
            timeline: expect.arrayContaining([
              expect.objectContaining({ label: 'Try OTO webhook received', status: 'in_transit' }),
              expect.objectContaining({ label: 'Try OTO status updated', status: 'in_transit' }),
            ]),
          }),
        }),
      }),
    );
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
    const diagnostics = getShippingProviderGateDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
      },
      'try_oto',
    );
    expect(diagnostics).toMatchObject({
      lastWebhookReceived: true,
      lastWebhookMatchedShipment: true,
      lastWebhookMatchStatus: 'matched',
      lastWebhookMatchedByField: 'orderId',
      lastWebhookStatusValue: 'in_transit',
      lastWebhookPayloadKeys: ['data'],
    });
  });

  it('matches Try OTO webhooks against legacy internal order references', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-legacy-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'SPORJINAL-1039',
      requestSnapshot: {
        orderId: 'SPORJINAL-1039',
        externalOrderReference: 'SPORJINAL-1039',
        internalOrderReference: 'shopify-7616544244039-allocation-alloc-1039',
      },
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'SPORJINAL-1039',
        timeline: [{ label: 'Shipment created', at: '2026-05-15T10:00:00.000Z', status: 'created' }],
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(null);
    prismaMock.shipmentExecution.findMany.mockResolvedValue([existing]);
    storedExecution = existing;

    const result = await ingestTryOtoWebhook(
      {
        data: {
          orderId: 'shopify-7616544244039-allocation-alloc-1039',
          trackingNumber: 'OTO-TRACK-1039',
          status: 'delivered',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: true,
      shipmentExecutionId: 'shipment-try_oto-legacy-alloc-1',
      shipmentStatus: 'delivered',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-try_oto-legacy-alloc-1' },
        data: expect.objectContaining({
          trackingNumber: 'OTO-TRACK-1039',
          shipmentStatus: 'DELIVERED',
          responseSnapshot: expect.objectContaining({
            lastTryOtoWebhookMatchedByField: 'orderId',
            lastTryOtoWebhookStatusField: 'delivered',
            lastTryOtoWebhookStatusMapped: true,
          }),
        }),
      }),
    );
  });

  it('maps observed Try OTO searchingDriver webhook status to an in-progress local shipment status', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'OTO-ORDER-1039',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'OTO-ORDER-1039',
        forwardDeliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionIdSource: 'delivery_option_lookup',
        forwardDeliveryOptionPersistedAt: 'async_recovery',
        providerError: 'there is a shipment in progress',
        timeline: [{ label: 'Shipment failed', at: '2026-05-15T10:00:00.000Z', status: 'failed' }],
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await ingestTryOtoWebhook(
      {
        data: {
          otoId: 'OTO-ORDER-1039',
          dcTrackingNumber: 'OTO-TRACK-1039',
          brandedTrackingURL: 'https://track.example/OTO-TRACK-1039',
          printAWBURL: 'https://labels.example/OTO-TRACK-1039.pdf',
          status: 'searchingDriver',
          deliveryCompany: 'Sürat Kargo',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: true,
      shipmentStatus: 'in_transit',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trackingNumber: 'OTO-TRACK-1039',
          labelUrl: 'https://labels.example/OTO-TRACK-1039.pdf',
          shipmentStatus: 'IN_TRANSIT',
          responseSnapshot: expect.objectContaining({
            providerError: 'there is a shipment in progress',
            forwardDeliveryOptionId: 'surat-kargo-marketplace',
            forwardDeliveryOptionIdSource: 'delivery_option_lookup',
            forwardDeliveryOptionPersistedAt: 'async_recovery',
            forwardDeliveryOptionRetainedAfterWebhook: true,
            providerStatus: 'searchingDriver',
            lastTryOtoWebhookStatusMapped: true,
            lastTryOtoWebhookMappedShipmentStatus: 'in_transit',
            latestProviderStatusSource: 'webhook',
          }),
        }),
      }),
    );
    const diagnostics = getShippingProviderGateDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
      },
      'try_oto',
    );
    expect(diagnostics).toMatchObject({
      lastWebhookStatusValue: 'searchingDriver',
      lastWebhookStatusMapped: true,
      lastWebhookMappedLocalStatus: 'in_transit',
    });
  });

  it('maps confirmed Try OTO delivered webhook status to the local delivered shipment state', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'OTO-ORDER-1039',
      trackingNumber: 'OTO-TRACK-1039',
      labelUrl: 'https://labels.example/OTO-TRACK-1039.pdf',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'OTO-ORDER-1039',
        providerError: 'prior createShipment failed',
        timeline: [{ label: 'Shipment failed', at: '2026-05-15T10:00:00.000Z', status: 'failed' }],
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await ingestTryOtoWebhook(
      {
        data: {
          trackingNumber: 'OTO-TRACK-1039',
          dcTrackingNumber: 'OTO-TRACK-1039',
          trackingUrl: 'https://track.example/OTO-TRACK-1039',
          printAWBURL: 'https://labels.example/OTO-TRACK-1039.pdf',
          status: 'delivered',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: true,
      shipmentStatus: 'delivered',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trackingNumber: 'OTO-TRACK-1039',
          labelUrl: 'https://labels.example/OTO-TRACK-1039.pdf',
          shipmentStatus: 'DELIVERED',
          responseSnapshot: expect.objectContaining({
            providerError: 'prior createShipment failed',
            providerStatus: 'delivered',
            lastTryOtoWebhookStatusMapped: true,
            lastTryOtoWebhookMappedShipmentStatus: 'delivered',
            latestProviderStatusSource: 'webhook',
          }),
        }),
      }),
    );
    const diagnostics = getShippingProviderGateDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
      },
      'try_oto',
    );
    expect(diagnostics).toMatchObject({
      statusSyncSupport: 'webhook_ingest',
      lastWebhookStatusValue: 'delivered',
      lastWebhookStatusMapped: true,
      lastWebhookMappedLocalStatus: 'delivered',
    });
  });

  it('updates Try OTO return shipment label from reverseShipment webhooks', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'OTO-ORDER-1039',
      trackingNumber: 'OTO-TRACK-1039',
      labelUrl: 'https://labels.example/forward.pdf',
      shipmentStatus: 'DELIVERED',
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'OTO-ORDER-1039',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1039-R1',
          status: 'created',
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return label is processing or not returned by Try OTO yet.',
        },
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(null);
    prismaMock.shipmentExecution.findMany.mockResolvedValue([existing]);
    storedExecution = existing;

    const result = await ingestTryOtoWebhook(
      {
        data: {
          orderId: 'OTO-ORDER-1039-R1',
          reverseShipment: true,
          trackingNumber: 'RET-TRACK-1039',
          trackingUrl: 'https://track.example/RET-TRACK-1039',
          printAWBURL: 'https://labels.example/return-1039.pdf',
          status: 'delivered',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: true,
      shipmentExecutionId: 'shipment-try_oto-alloc-1',
      shipmentStatus: 'delivered',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-try_oto-alloc-1' },
        data: expect.objectContaining({
          responseSnapshot: expect.objectContaining({
            tryOtoWebhookReverseShipment: true,
            returnShipment: expect.objectContaining({
              returnOrderId: 'OTO-ORDER-1039-R1',
              trackingNumber: 'RET-TRACK-1039',
              trackingUrl: 'https://track.example/RET-TRACK-1039',
              labelUrl: 'https://labels.example/return-1039.pdf',
              labelRetrievalConfirmed: true,
              labelRetrievalNote: null,
              diagnostics: expect.objectContaining({
                webhookReverseShipment: true,
                webhookReverseShipmentPrintAwbUrlPresent: true,
                returnLabelSourceChecked: 'reverseShipmentWebhook',
                printEndpointImplemented: false,
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('keeps unknown Try OTO webhook statuses diagnostic-only', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'OTO-ORDER-1039',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'OTO-ORDER-1039',
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await ingestTryOtoWebhook(
      {
        data: {
          orderId: 'OTO-ORDER-1039',
          status: 'mysteryProviderStatus',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: true,
      shipmentStatus: 'failed',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'FAILED',
          responseSnapshot: expect.objectContaining({
            providerStatus: 'mysteryProviderStatus',
            lastTryOtoWebhookStatusMapped: false,
            lastTryOtoWebhookMappedShipmentStatus: null,
            latestProviderStatusSource: 'webhook',
          }),
        }),
      }),
    );
  });

  it('keeps duplicate Try OTO webhooks idempotent in the shipment timeline', async () => {
    const fingerprint = 'try_oto_webhook|OTO-ORDER-1039|||OTO-TRACK-1039||created||';
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'OTO-ORDER-1039',
      trackingNumber: 'OTO-TRACK-1039',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'OTO-ORDER-1039',
        timelineEventFingerprints: [fingerprint, `${fingerprint}|status_updated`],
        timeline: [
          { label: 'Try OTO webhook received', at: '2026-05-15T10:00:00.000Z', status: 'created' },
          { label: 'Try OTO status updated', at: '2026-05-15T10:00:01.000Z', status: 'created' },
        ],
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
    storedExecution = existing;

    await ingestTryOtoWebhook(
      {
        data: {
          orderId: 'OTO-ORDER-1039',
          trackingNumber: 'OTO-TRACK-1039',
          status: 'created',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    const updatePayload = prismaMock.shipmentExecution.update.mock.calls.at(-1)?.[0].data.responseSnapshot as {
      timeline?: Array<{ label: string }>;
    };
    expect(updatePayload.timeline?.filter((event) => event.label === 'Try OTO webhook received')).toHaveLength(1);
    expect(updatePayload.timeline?.filter((event) => event.label === 'Try OTO status updated')).toHaveLength(1);
  });

  it('records unmatched Try OTO webhooks safely without mutating shipments', async () => {
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(null);
    prismaMock.shipmentExecution.findMany.mockResolvedValue([]);

    const result = await ingestTryOtoWebhook(
      {
        data: {
          orderId: 'OTO-ORDER-MISSING',
          trackingNumber: 'OTO-TRACK-MISSING',
          status: 'created',
        },
      },
      {
        env: {
          ...env,
          TRY_OTO_ENABLED: true,
          TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      matched: false,
      matchStatus: 'unmatched',
      shipmentExecutionId: null,
    });
    const diagnostics = getShippingProviderGateDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'try_oto',
        TRY_OTO_ENABLED: true,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
      },
      'try_oto',
    );
    expect(diagnostics).toMatchObject({
      lastWebhookReceived: true,
      lastWebhookMatchedShipment: false,
      lastWebhookMatchStatus: 'unmatched',
      lastWebhookStatusValue: 'created',
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('diagnoses deprecated Kargo cargo integration env fallback without exposing values', () => {
    const diagnostics = getShippingProviderGateDiagnostics({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
      KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: '2547',
      KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE: 'deprecated',
    });

    expect(diagnostics.deprecatedEnvFallbacks).toEqual(['ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID']);
    expect(JSON.stringify(diagnostics)).not.toContain('2547');
  });

  it('marks Kargo execution ready only when all safe gates and config are present', () => {
    const diagnostics = getShippingProviderGateDiagnostics({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
    });

    expect(diagnostics).toMatchObject({
      provider: 'kargo_entegrator',
      executionReady: true,
      shippingExecutionEnabled: true,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: [],
      deprecatedEnvFallbacks: [],
    });
  });

  it('sends Kargo requests with documented bearer and JSON headers and parses data object responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          data: {
            id: 'ke-live-1028',
            tracking_number: null,
            status: 'created',
            shipping_cost: 88,
            currency: 'TRY',
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api/',
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });
    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'kargo_entegrator',
      requestSnapshot: {
        platform_id: 2547,
        platform_d_id: 1774,
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.kargoentegrator.com/api/shipments',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-kargo-key',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      platform_id: 2547,
      platform_d_id: 1774,
    });
    expect(result).toMatchObject({
      providerShipmentId: 'ke-live-1028',
      trackingNumber: null,
      shipmentStatus: 'created',
      shippingCost: 88,
      currency: 'TRY',
    });
    expect(result.responseSnapshot).toMatchObject({
      authHeaderMode: 'bearer',
      acceptHeader: 'application/json',
      detectedResponseFormat: 'json:data_object',
      bodyKeys: expect.arrayContaining(['id', 'tracking_number']),
    });
    expect(JSON.stringify(result.responseSnapshot)).not.toContain('test-kargo-key');
  });

  it('parses Kargo data array responses and maps provider shipment id from the first row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          data: [
            {
              id: 'ke-array-1028',
              tracking_number: 'TRACK-1028',
              tracking_url: 'https://track.example/TRACK-1028',
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
    });
    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'kargo_entegrator',
      requestSnapshot: {
        platform_id: 2547,
      },
    });

    expect(result).toMatchObject({
      providerShipmentId: 'ke-array-1028',
      trackingNumber: 'TRACK-1028',
      trackingUrl: 'https://track.example/TRACK-1028',
    });
    expect(result.responseSnapshot).toMatchObject({
      detectedResponseFormat: 'json:data_array',
      bodyKeys: expect.arrayContaining(['id', 'tracking_number']),
    });
  });

  it('treats HTML Kargo responses as invalid provider contract responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse('<html><body>Login</body></html>', {
        contentType: 'text/html; charset=utf-8',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          platform_id: 2547,
        },
      }),
    ).rejects.toMatchObject({
      message: 'Kargo Entegratör returned an invalid provider response format.',
      responseSnapshot: expect.objectContaining({
        status: 200,
        ok: true,
        contentType: 'text/html; charset=utf-8',
        detectedResponseFormat: 'html',
        authHeaderMode: 'bearer',
        responseSnippet: '<html><body>Login</body></html>',
        providerError: 'Provider returned HTML instead of JSON. Check endpoint and Bearer authentication.',
      }),
    });
  });

  it('parses safe Kargo provider validation failures without exposing secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          message: 'Validation failed.',
          errors: {
            'customer.district': ['The district field is required.'],
            token: 'should-not-render',
          },
          request_id: 'ke-req-422',
        }),
        {
          status: 422,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          platform_id: 2547,
          notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
          customer: {
            phone: '+905551112233',
          },
        },
      }),
    ).rejects.toMatchObject({
      message: 'Kargo Entegratör shipment execution failed with HTTP 422.',
      responseSnapshot: expect.objectContaining({
        status: 422,
        ok: false,
        providerError: 'Validation failed.',
        providerValidationErrors: ['The district field is required.'],
        requestId: 'ke-req-422',
        notificationUrlIncluded: true,
        bodyKeys: expect.arrayContaining(['errors', 'message', 'request_id']),
      }),
    });

    const error = await adapter
      .createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          platform_id: 2547,
        },
      })
      .catch((caught) => caught as ShippingProviderExecutionError);
    expect(JSON.stringify(error.responseSnapshot)).not.toContain('test-kargo-key');
    expect(JSON.stringify(error.responseSnapshot)).not.toContain('should-not-render');
    expect(JSON.stringify(error.responseSnapshot)).not.toContain('+905551112233');
  });

  it('records safe Kargo payload shape diagnostics on provider 500 responses', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          message: 'Server Error',
        }),
        {
          status: 500,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });

    const error = await adapter
      .createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          cargo_integration_id: 2547,
          warehouse_id: 1774,
          payment_type: 'cash_money',
          package_type: 'box',
          payor_type: 'sender',
          kg: 3,
          desi: 3,
          platform_id: '7616544244049',
          platform_d_id: '#1028',
          customer: {
            name: 'Test',
            surname: 'Customer',
            phone: '905551112233',
            email: 'customer@example.com',
            country: 'TR',
            postcode: '34000',
            city: 'Istanbul',
            district: 'Kadikoy',
            address: 'Test Mahallesi 1. Sokak No: 1',
          },
        },
      })
      .catch((caught) => caught as ShippingProviderExecutionError);

    expect(error.responseSnapshot).toMatchObject({
      status: 500,
      ok: false,
      providerError: 'Server Error',
      requestPath: '/api/shipments',
      selectedEnvironment: 'production',
      requestTargetHostname: 'app.kargoentegrator.com',
      providerMode: 'live',
      payloadDiagnostics: {
        topLevelKeys: expect.arrayContaining(['customer', 'payment_type', 'payor_type', 'platform_id']),
        customerKeys: expect.arrayContaining(['phone', 'district', 'address']),
        cargoIntegrationIdPresent: true,
        warehouseIdPresent: true,
        paymentType: 'cash_money',
        packageType: 'box',
        payorType: 'sender',
        kgPresent: true,
        kgType: 'number',
        desiPresent: true,
        desiType: 'number',
        platformIdPresent: true,
        platformDIdPresent: true,
        customerPhonePresent: true,
        customerDistrictPresent: true,
        customerCityPresent: true,
        addressFieldPresence: {
          customerAddress: true,
          customerPostcode: true,
          customerCountry: true,
          customerCity: true,
          customerDistrict: true,
        },
      },
    });
    expect(infoSpy).toHaveBeenCalledWith(
      '[shipping:kargo:provider-create-diagnostics]',
      expect.objectContaining({
        httpStatus: 500,
        providerMessage: 'Server Error',
        requestPath: '/api/shipments',
        providerMode: 'live',
      }),
    );
    const serialized = JSON.stringify(error.responseSnapshot);
    expect(serialized).not.toContain('905551112233');
    expect(serialized).not.toContain('Test Mahallesi');
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('test-kargo-key');
    infoSpy.mockRestore();
  });

  it('parses Kargo package_type validation failures clearly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          message: 'Seçilen paket tipi geçersiz.',
          errors: {
            package_type: ['Seçilen paket tipi geçersiz.'],
          },
        }),
        {
          status: 422,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          package_type: 'package',
        },
      }),
    ).rejects.toMatchObject({
      message: 'Kargo Entegratör shipment execution failed with HTTP 422.',
      responseSnapshot: expect.objectContaining({
        status: 422,
        ok: false,
        providerError: 'Seçilen paket tipi geçersiz.',
        providerValidationErrors: ['Seçilen paket tipi geçersiz.'],
        bodyKeys: expect.arrayContaining(['errors', 'message']),
      }),
    });
  });

  it('blocks Try OTO execution when the sandbox provider feature flag is disabled', async () => {
    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: false,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'try_oto',
      requestSnapshot: {
        orderId: 'POC-TR-1001',
        customer: {
          mobile: '905551112233',
          address: 'Test Mahallesi 1. Sokak No: 1',
        },
      },
    });

    expect(result).toMatchObject({
      providerShipmentId: null,
      shipmentStatus: 'pending',
      responseSnapshot: {
        dryRun: true,
        provider: 'try_oto',
        disabledGates: ['TRY_OTO_ENABLED'],
        payloadDiagnostics: {
          orderIdPresent: true,
          customerMobilePresent: true,
          customerAddressPresent: true,
        },
      },
    });
    expect(JSON.stringify(result.responseSnapshot)).not.toContain('905551112233');
    expect(JSON.stringify(result.responseSnapshot)).not.toContain('Test Mahallesi');
  });

  it('blocks Try OTO execution when the refresh token is missing', async () => {
    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: undefined,
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'try_oto',
        requestSnapshot: {
          orderId: 'POC-TR-1001',
        },
      }),
    ).rejects.toThrow('Missing TRY_OTO_REFRESH_TOKEN');
  });

  it('refreshes Try OTO token, looks up a delivery option, and executes createShipment with bearer auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            access_token: 'oto-access-token',
            token_type: 'Bearer',
            expires_in: '3600',
          }),
        ),
      )
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            deliveryCompany: [
              {
                deliveryOptionId: 7109,
                deliveryCompanyName: 'surat-kargo-marketplace',
                deliveryOptionName: 'Surat Marketplace',
                price: 42,
                currency: 'TRY',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            otoId: 540789,
          }),
        ),
      )
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            message: 'create shipment request is received.',
          }),
        ),
      )
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            status: 'shipmentCreated',
            shipmentId: 'OTO-SHIP-1001',
            trackingNumber: 'OTO-TRACK-1001',
            dcTrackingNumber: 'SURAT-1001',
            trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1001',
            printAWBURL: 'https://app.tryoto.com/print/awb?enc=sandbox',
            deliveryCompany: 'surat-kargo-marketplace',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'try_oto',
      requestSnapshot: {
        orderId: 'POC-TR-1001',
        externalOrderReference: 'POC-TR-1001',
        internalOrderReference: 'shopify-7616544244049-allocation-alloc-1',
        legacyInternalReferenceUsed: false,
        pickupLocationCode: 'tr-test-store-001',
        originCity: 'Istanbul',
        payment_method: 'paid',
        amount: 1299.9,
        amount_due: 0,
        currency: 'TRY',
        packageWeight: 1,
        packageCount: 1,
        customer: {
          name: 'Sandbox Customer',
          mobile: '905551112233',
          address: 'Test Mahallesi 1. Sokak No: 1',
          city: 'Istanbul',
          country: 'TR',
          district: 'Kadikoy',
        },
        items: [
          {
            name: 'Sandbox T-Shirt',
            sku: 'POC-TSHIRT-001',
            quantity: 1,
          },
        ],
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://staging-api.tryoto.com/rest/v2/refreshToken',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://staging-api.tryoto.com/rest/v2/checkOTODeliveryFee',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer oto-access-token' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://staging-api.tryoto.com/rest/v2/createOrder',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer oto-access-token',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://staging-api.tryoto.com/rest/v2/createShipment',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer oto-access-token' }),
      }),
    );
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      pickupLocationCode: 'tr-test-store-001',
      originCity: 'Istanbul',
      destinationCity: 'Istanbul',
      weight: 1,
      packageWeight: 1,
      customer: {
        city: 'Istanbul',
        country: 'TR',
      },
      payment_method: 'paid',
      currency: 'TRY',
      packageCount: 1,
    });
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toMatchObject({
      orderId: 'POC-TR-1001',
      pickupLocationCode: 'tr-test-store-001',
      deliveryOptionId: '7109',
      payment_method: 'paid',
      amount: 1299.9,
      amount_due: 0,
      currency: 'TRY',
      packageWeight: 1,
      originCity: 'Istanbul',
      customer: {
        name: 'Sandbox Customer',
        mobile: '905551112233',
        address: 'Test Mahallesi 1. Sokak No: 1',
        city: 'Istanbul',
        country: 'TR',
        district: 'Kadikoy',
      },
      items: [
        expect.objectContaining({
          name: 'Sandbox T-Shirt',
          sku: 'POC-TSHIRT-001',
          quantity: 1,
        }),
      ],
    });
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).not.toHaveProperty('externalOrderReference');
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).not.toHaveProperty('internalOrderReference');
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).not.toHaveProperty('legacyInternalReferenceUsed');
    expect(JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string)).toEqual({
      orderId: 'POC-TR-1001',
      deliveryOptionId: '7109',
    });
    expect(result).toMatchObject({
      providerShipmentId: 'OTO-SHIP-1001',
      trackingNumber: 'OTO-TRACK-1001',
      trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1001',
      labelUrl: 'https://app.tryoto.com/print/awb?enc=sandbox',
      shipmentStatus: 'created',
      currency: 'TRY',
      responseSnapshot: {
        provider: 'try_oto',
        providerOrderId: '540789',
        orderId: 'POC-TR-1001',
        shipmentId: 'OTO-SHIP-1001',
        trackingNumber: 'OTO-TRACK-1001',
        dcTrackingNumber: 'SURAT-1001',
        deliveryCompany: 'surat-kargo-marketplace',
        deliveryOptionId: '7109',
        forwardDeliveryOptionId: '7109',
        forwardDeliveryOptionIdSource: 'delivery_option_lookup',
        selectedDeliveryOptionId: '7109',
        payloadDiagnostics: {
          orderIdPresent: true,
          pickupLocationCodePresent: true,
          deliveryOptionIdPresent: true,
          customerMobilePresent: true,
          customerAddressPresent: true,
          customerCityPresent: true,
          customerCountryPresent: true,
          customerDistrictPresent: true,
        },
        deliveryOptionLookup: expect.objectContaining({
          called: true,
          success: true,
          optionCount: 1,
          selectedDeliveryCompanyName: 'surat-kargo-marketplace',
          selectedDeliveryOptionIdPresent: true,
          request: expect.objectContaining({
            endpoint: '/rest/v2/checkOTODeliveryFee',
            topLevelKeys: [
              'currency',
              'customer',
              'destinationCity',
              'originCity',
              'packageCount',
              'packageWeight',
              'payment_method',
              'pickupLocationCode',
              'weight',
            ],
            pickupLocationCodePresent: true,
            originCityPresent: true,
            packageWeightPresent: true,
            weightPresent: true,
            weightFieldNames: ['weight', 'packageWeight'],
            numericWeightPresent: true,
            weightType: 'number',
            customerCityPresent: true,
            customerCountryPresent: true,
            paymentMethodPresent: true,
            sourceFieldPresence: {
              pickupLocationCode: true,
              originCity: true,
              packageWeight: true,
              customerCity: true,
              customerCountry: true,
              paymentMethod: true,
            },
          }),
          response: expect.objectContaining({
            status: 200,
            topLevelKeys: ['deliveryCompany', 'success'],
            bodyKeys: ['deliveryCompany', 'success'],
            optionCount: 1,
            deliveryOptionIdPresent: true,
            deliveryCompanyNamePresent: true,
            pricingPresent: true,
            pricingKeys: ['currency', 'price'],
          }),
        }),
        selectedDeliveryCompanyName: 'surat-kargo-marketplace',
        selectedDeliveryOptionIdPresent: true,
        createOrder: expect.objectContaining({ ok: true, bodyKeys: expect.arrayContaining(['otoId']) }),
        createShipment: expect.objectContaining({
          ok: true,
          bodyKeys: expect.arrayContaining(['message', 'success']),
          providerError: 'create shipment request is received.',
        }),
        createShipmentRequestDiagnostics: {
          endpoint: '/rest/v2/createShipment',
          topLevelKeys: ['deliveryOptionId', 'orderId'],
          orderIdPresent: true,
          deliveryOptionIdPresent: true,
        },
        orderStatus: expect.objectContaining({
          ok: true,
          bodyKeys: expect.arrayContaining(['shipmentId', 'status', 'trackingNumber']),
        }),
      },
    });
	  const serialized = JSON.stringify(result.responseSnapshot);
	  expect(serialized).not.toContain('refresh-secret');
	  expect(serialized).not.toContain('oto-access-token');
	  expect(serialized).not.toContain('905551112233');
	  expect(serialized).not.toContain('Test Mahallesi');
	});

	it('reuses an existing Try OTO order on retry and skips createOrder', async () => {
	  const fetchMock = vi
	    .fn()
	    .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
	    .mockResolvedValueOnce(
	      mockProviderResponse(
	        JSON.stringify({
	          success: true,
	          deliveryCompany: [
	            {
	              deliveryOptionId: 7109,
	              deliveryCompanyName: 'surat-kargo-marketplace',
	              price: 42,
	              currency: 'TRY',
	            },
	          ],
	        }),
	      ),
	    )
	    .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, message: 'create shipment request is received.' })))
	    .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, status: 'processing' })));
	  vi.stubGlobal('fetch', fetchMock);

	  const adapter = new TryOtoAdapter({
	    ...env,
	    SHIPPING_PROVIDER: 'try_oto',
	    SHIPPING_EXECUTION_ENABLED: true,
	    TRY_OTO_ENABLED: true,
	    TRY_OTO_SANDBOX_MODE: true,
	    TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
	    TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
	  });

	  const result = await adapter.createShipment({
	    allocationId: 'alloc-1',
	    vendorId: 'sporjinal',
	    provider: 'try_oto',
	    retryContext: {
	      isRetry: true,
	      existingOrderId: 'POC-TR-RETRY-1001',
	      existingProviderOrderId: '540789',
	    },
	    requestSnapshot: {
	      orderId: 'POC-TR-RETRY-1001',
	      pickupLocationCode: 'tr-test-store-001',
	      originCity: 'Istanbul',
	      payment_method: 'paid',
	      amount: 1299.9,
	      amount_due: 0,
	      currency: 'TRY',
	      packageWeight: 1,
	      customer: {
	        name: 'Sandbox Customer',
	        mobile: '905551112233',
	        address: 'Test Mahallesi 1. Sokak No: 1',
	        city: 'Istanbul',
	        country: 'TR',
	        district: 'Kadikoy',
	      },
	      items: [],
	    },
	  });

	  expect(fetchMock).toHaveBeenCalledTimes(4);
	  expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/createOrder');
	  expect(fetchMock.mock.calls.map((call) => call[0])).toContain('https://staging-api.tryoto.com/rest/v2/createShipment');
	  expect(result.responseSnapshot).toMatchObject({
	    providerOrderId: '540789',
	    orderId: 'POC-TR-RETRY-1001',
	    createOrderSkipped: true,
	    createOrderSkipReason: 'existing order',
	    retrySource: 'existing execution',
	    createOrder: expect.objectContaining({
	      skipped: true,
	      skipReason: 'existing order',
	      retrySource: 'existing execution',
	    }),
	  });
	});

	it('continues Try OTO retry finalization when the existing order already hit OTO1063', async () => {
	  const fetchMock = vi
	    .fn()
	    .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
	    .mockResolvedValueOnce(
	      mockProviderResponse(
	        JSON.stringify({
	          success: true,
	          deliveryCompany: [
	            {
	              deliveryOptionId: 7109,
	              deliveryCompanyName: 'surat-kargo-marketplace',
	            },
	          ],
	        }),
	      ),
	    )
	    .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, message: 'create shipment request is received.' })))
	    .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, status: 'processing' })));
	  vi.stubGlobal('fetch', fetchMock);

	  const adapter = new TryOtoAdapter({
	    ...env,
	    SHIPPING_PROVIDER: 'try_oto',
	    SHIPPING_EXECUTION_ENABLED: true,
	    TRY_OTO_ENABLED: true,
	    TRY_OTO_SANDBOX_MODE: true,
	    TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
	    TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
	  });

	  const result = await adapter.createShipment({
	    allocationId: 'alloc-1',
	    vendorId: 'sporjinal',
	    provider: 'try_oto',
	    retryContext: {
	      isRetry: true,
	      existingOrderId: 'POC-TR-RETRY-1002',
	      existingOrderAlreadyExists: true,
	    },
	    requestSnapshot: {
	      orderId: 'POC-TR-RETRY-1002',
	      pickupLocationCode: 'tr-test-store-001',
	      originCity: 'Istanbul',
	      payment_method: 'paid',
	      amount: 1299.9,
	      amount_due: 0,
	      currency: 'TRY',
	      packageWeight: 1,
	      customer: {
	        name: 'Sandbox Customer',
	        mobile: '905551112233',
	        address: 'Test Mahallesi 1. Sokak No: 1',
	        city: 'Istanbul',
	        country: 'TR',
	        district: 'Kadikoy',
	      },
	      items: [],
	    },
	  });

	  expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/createOrder');
	  expect(fetchMock.mock.calls.map((call) => call[0])).toContain('https://staging-api.tryoto.com/rest/v2/createShipment');
	  expect(result.responseSnapshot).toMatchObject({
	    createOrderSkipped: true,
	    createOrderSkipReason: 'OTO1063 recovered',
	    retrySource: 'existing execution',
	  });
	});

	it('keeps unrelated Try OTO OTO1063 createOrder failures as provider failures', async () => {
	  const fetchMock = vi
	    .fn()
	    .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
	    .mockResolvedValueOnce(
	      mockProviderResponse(
	        JSON.stringify({
	          success: true,
	          deliveryCompany: [
	            {
	              deliveryOptionId: 7109,
	              deliveryCompanyName: 'surat-kargo-marketplace',
	            },
	          ],
	        }),
	      ),
	    )
	    .mockResolvedValueOnce(
	      mockProviderResponse(
	        JSON.stringify({
	          success: false,
	          otoErrorCode: 'OTO1063',
	          otoErrorMessage: 'Order Id is already exist',
	        }),
	        { status: 400 },
	      ),
	    );
	  vi.stubGlobal('fetch', fetchMock);

	  const adapter = new TryOtoAdapter({
	    ...env,
	    SHIPPING_PROVIDER: 'try_oto',
	    SHIPPING_EXECUTION_ENABLED: true,
	    TRY_OTO_ENABLED: true,
	    TRY_OTO_SANDBOX_MODE: true,
	    TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
	    TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
	  });

	  await expect(
	    adapter.createShipment({
	      allocationId: 'alloc-1',
	      vendorId: 'sporjinal',
	      provider: 'try_oto',
	      retryContext: {
	        isRetry: true,
	        existingOrderId: 'DIFFERENT-ORDER',
	      },
	      requestSnapshot: {
	        orderId: 'POC-TR-UNRELATED-1063',
	        pickupLocationCode: 'tr-test-store-001',
	        originCity: 'Istanbul',
	        payment_method: 'paid',
	        amount: 1299.9,
	        amount_due: 0,
	        currency: 'TRY',
	        packageWeight: 1,
	        customer: {
	          name: 'Sandbox Customer',
	          mobile: '905551112233',
	          address: 'Test Mahallesi 1. Sokak No: 1',
	          city: 'Istanbul',
	          country: 'TR',
	          district: 'Kadikoy',
	        },
	        items: [],
	      },
	    }),
	  ).rejects.toMatchObject({
	    message: 'Try OTO createOrder failed with HTTP 400.',
	    responseSnapshot: expect.objectContaining({
	      providerErrorCode: 'OTO1063',
	      providerError: 'Order Id is already exist',
	    }),
	  });
	  expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/createShipment');
	});

	it('surfaces Try OTO lookup 400 messages without calling createShipment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: false,
            otoErrorCode: 'OTO1009',
            errorMsg: 'originCity is required',
          }),
          { status: 400 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'try_oto',
        requestSnapshot: {
          orderId: 'POC-TR-LOOKUP-400',
          pickupLocationCode: 'tr-test-store-001',
          originCity: 'Istanbul',
          payment_method: 'paid',
          amount: 1299.9,
          amount_due: 0,
          currency: 'TRY',
          packageWeight: 1,
          customer: {
            name: 'Sandbox Customer',
            mobile: '905551112233',
            address: 'Test Mahallesi 1. Sokak No: 1',
            city: 'Istanbul',
            country: 'TR',
            district: 'Kadikoy',
          },
          items: [],
        },
      }),
    ).rejects.toMatchObject({
      message: 'Try OTO delivery option could not be resolved. Check pickup location, destination, package weight, and sandbox credit.',
      responseSnapshot: expect.objectContaining({
        deliveryOptionLookup: expect.objectContaining({
          called: true,
          success: false,
          providerError: 'originCity is required',
          response: expect.objectContaining({
            status: 400,
            providerError: 'originCity is required',
            providerValidationErrors: [],
          }),
        }),
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/createShipment');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('905551112233');
  });

  it('surfaces Try OTO createShipment 400 diagnostics safely', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            deliveryCompany: [
              {
                deliveryOptionId: 7109,
                deliveryCompanyName: 'surat-kargo-marketplace',
                price: 42,
                currency: 'TRY',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, otoId: 540789 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: false,
            otoErrorCode: 'OTO1010',
            otoErrorMessage: 'delivery option is not available',
          }),
          { status: 400 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'try_oto',
        requestSnapshot: {
          orderId: 'POC-TR-SHIPMENT-400',
          pickupLocationCode: 'tr-test-store-001',
          originCity: 'Istanbul',
          payment_method: 'paid',
          amount: 1299.9,
          amount_due: 0,
          currency: 'TRY',
          packageWeight: 1,
          customer: {
            name: 'Sandbox Customer',
            mobile: '905551112233',
            address: 'Test Mahallesi 1. Sokak No: 1',
            city: 'Istanbul',
            country: 'TR',
            district: 'Kadikoy',
          },
          items: [],
        },
      }),
    ).rejects.toMatchObject({
      message: 'Try OTO createShipment failed with HTTP 400.',
      responseSnapshot: expect.objectContaining({
        createShipment: expect.objectContaining({
          status: 400,
          ok: false,
          bodyKeys: expect.arrayContaining(['otoErrorCode', 'otoErrorMessage', 'success']),
          providerError: 'delivery option is not available',
          providerErrorCode: 'OTO1010',
        }),
        createShipmentRequestDiagnostics: expect.objectContaining({
          endpoint: '/rest/v2/createShipment',
          topLevelKeys: ['deliveryOptionId', 'orderId'],
          orderIdPresent: true,
          deliveryOptionIdPresent: true,
          deliveryOptionId: '7109',
        }),
        forwardDeliveryOptionId: '7109',
        forwardDeliveryOptionIdSource: 'delivery_option_lookup',
        forwardDeliveryOptionPersistedAt: 'delivery_option_selected',
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/orderStatus');
  });

  it('recovers Try OTO shipment-in-progress responses and captures orderStatus tracking fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            deliveryCompany: [
              {
                deliveryOptionId: 7109,
                deliveryCompanyName: 'surat-kargo-marketplace',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, otoId: 540789 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: false,
            otoErrorCode: 'OTO1011',
            errorMsg: 'there is a shipment in progress',
            otoErrorMessage: 'Shipment is already exist',
          }),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            status: 'shipmentCreated',
            shipmentId: 'OTO-SHIP-1001',
            trackingNumber: 'OTO-TRACK-1001',
            barcode: 'OTO-BARCODE-1001',
            printLabelURL: 'https://app.tryoto.example/label.pdf',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'try_oto',
      requestSnapshot: {
        orderId: 'POC-TR-SHIPMENT-IN-PROGRESS',
        pickupLocationCode: 'tr-test-store-001',
        originCity: 'Istanbul',
        payment_method: 'paid',
        amount: 1299.9,
        amount_due: 0,
        currency: 'TRY',
        packageWeight: 1,
        customer: {
          name: 'Sandbox Customer',
          mobile: '905551112233',
          address: 'Test Mahallesi 1. Sokak No: 1',
          city: 'Istanbul',
          country: 'TR',
          district: 'Kadikoy',
        },
        items: [],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain('https://staging-api.tryoto.com/rest/v2/orderStatus');
    expect(result).toMatchObject({
      providerShipmentId: 'OTO-SHIP-1001',
      trackingNumber: 'OTO-TRACK-1001',
      labelUrl: 'https://app.tryoto.example/label.pdf',
      shipmentStatus: 'created',
      responseSnapshot: expect.objectContaining({
        createShipmentRecovered: true,
        createShipmentRecoveryReason: 'existing shipment in progress',
        orderStatusCalledAfterRecovery: true,
        forwardDeliveryOptionId: '7109',
        forwardDeliveryOptionIdSource: 'delivery_option_lookup',
        forwardDeliveryOptionPersistedAt: 'delivery_option_selected',
        selectedDeliveryOptionId: '7109',
        barcode: 'OTO-BARCODE-1001',
        createShipment: expect.objectContaining({
          ok: true,
          recovered: true,
          recoveryReason: 'existing shipment in progress',
        }),
      }),
    });
  });

  it('keeps recovered Try OTO shipment-in-progress executions pending when tracking is not ready yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: true,
            deliveryCompany: [
              {
                deliveryOptionId: 7109,
                deliveryCompanyName: 'surat-kargo-marketplace',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, otoId: 540789 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            success: false,
            otoErrorCode: 'OTO1011',
            otoErrorMessage: 'Shipment is already exist',
          }),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, status: 'processing' })));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'try_oto',
      requestSnapshot: {
        orderId: 'POC-TR-SHIPMENT-PENDING',
        pickupLocationCode: 'tr-test-store-001',
        originCity: 'Istanbul',
        payment_method: 'paid',
        amount: 1299.9,
        amount_due: 0,
        currency: 'TRY',
        packageWeight: 1,
        customer: {
          name: 'Sandbox Customer',
          mobile: '905551112233',
          address: 'Test Mahallesi 1. Sokak No: 1',
          city: 'Istanbul',
          country: 'TR',
          district: 'Kadikoy',
        },
        items: [],
      },
    });

    expect(result).toMatchObject({
      providerShipmentId: '540789',
      trackingNumber: null,
      labelUrl: null,
      shipmentStatus: 'pending',
      responseSnapshot: expect.objectContaining({
        createShipmentRecovered: true,
        createShipmentRecoveryReason: 'existing shipment in progress',
        orderStatusCalledAfterRecovery: true,
        providerMessage: 'Try OTO shipment is already in progress; tracking/label pending.',
      }),
    });
  });

  it('builds Try OTO createOrder payload with required Turkey fields from allocation data', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Sandbox Customer',
          customerEmail: 'sandbox@example.com',
          customerPhone: '0555 111 22 33',
          shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
          shippingCity: 'Istanbul',
          shippingDistrict: 'Kadikoy',
          shippingCountry: 'TR',
          shippingPostcode: '34710',
        },
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-try-oto',
      vendorId: 'sporjinal',
      preferredProvider: 'TRY_OTO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
        packageWeight: 2,
        tryOtoOriginCity: 'Istanbul',
      },
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'try_oto',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'try_oto',
          TRY_OTO_ENABLED: true,
          TRY_OTO_SANDBOX_MODE: true,
          TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
          TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
        },
        vendorId: 'sporjinal',
      },
    );

    expect(preview).toMatchObject({
      provider: 'try_oto',
      warehouseId: 'tr-test-store-001',
      payload: {
        orderId: 'SPORJINAL-1027',
        externalOrderReference: 'SPORJINAL-1027',
        internalOrderReference: 'shopify-7616544244049-allocation-alloc-1',
        legacyInternalReferenceUsed: false,
        pickupLocationCode: 'tr-test-store-001',
        originCity: 'Istanbul',
        payment_method: 'paid',
        amount: 4999,
        amount_due: 0,
        currency: 'TRY',
        packageCount: 1,
        packageWeight: 2,
        customer: {
          name: 'Sandbox Customer',
          email: 'sandbox@example.com',
          mobile: '905551112233',
          address: 'Test Mahallesi 1. Sokak No: 1',
          city: 'Istanbul',
          country: 'TR',
          district: 'Kadikoy',
          postcode: '34710',
        },
        items: [
          expect.objectContaining({
            name: 'Nike Air Max Alpha Trainer 6',
            sku: 'FQ1833-200-41',
            quantity: 1,
          }),
        ],
      },
      warnings: expect.arrayContaining([
        'Try OTO is sandbox-only in this phase.',
      ]),
    });
  });

  it('persists Try OTO shipment execution with allocation relation and finite desi', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Sandbox Customer',
          customerEmail: 'sandbox@example.com',
          customerPhone: '0555 111 22 33',
          shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
          shippingCity: 'Istanbul',
          shippingDistrict: 'Kadikoy',
          shippingCountry: 'TR',
          shippingPostcode: '34710',
        },
        lineItems: [
          {
            quantity: 1,
            lineAmount: 499,
            shopifyOrderLineItem: {
              title: 'Sandbox Mug',
              sku: 'POC-MUG-001',
            },
          },
        ],
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-try-oto',
      vendorId: 'sporjinal',
      preferredProvider: 'TRY_OTO',
      shippingEnabled: true,
      defaultDesi: null,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
        tryOtoOriginCity: 'Istanbul',
      },
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'pending',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        provider: 'try_oto',
        dryRun: true,
      },
    });

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'try_oto',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'try_oto',
          TRY_OTO_ENABLED: true,
          TRY_OTO_SANDBOX_MODE: true,
          TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
          TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    const createData = prismaMock.shipmentExecution.create.mock.calls[0]?.[0].data;
    expect(createData).toMatchObject({
      provider: 'TRY_OTO',
      warehouseId: 'tr-test-store-001',
      desi: 1,
      allocation: {
        connect: {
          id: 'alloc-1',
        },
      },
      vendor: {
        connect: {
          id: 'sporjinal',
        },
      },
      requestSnapshot: expect.objectContaining({
        pickupLocationCode: 'tr-test-store-001',
        originCity: 'Istanbul',
        packageWeight: 1,
      }),
    });
    expect(Number.isNaN(createData?.desi)).toBe(false);
    expect(createData).not.toHaveProperty('allocationId');
  });

  it('treats async Try OTO createShipment failures with existing order context as created', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        fulfillmentStatus: 'Pending',
        order: {
          id: 'order-1',
          customerName: 'Sandbox Customer',
          customerEmail: 'sandbox@example.com',
          customerPhone: '0555 111 22 33',
          shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
          shippingCity: 'Istanbul',
          shippingDistrict: 'Kadikoy',
          shippingCountry: 'TR',
          shippingPostcode: '34710',
        },
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-try-oto',
      vendorId: 'sporjinal',
      preferredProvider: 'TRY_OTO',
      shippingEnabled: true,
      defaultDesi: 1,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
        tryOtoOriginCity: 'Istanbul',
      },
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
    });
    adapter.createShipment.mockRejectedValue(
      new ShippingProviderExecutionError('Try OTO createShipment failed with HTTP 400.', {
        provider: 'try_oto',
        operation: 'createShipment',
        status: 400,
        ok: false,
        createOrder: {
          ok: true,
          operation: 'createOrder',
          bodyKeys: ['otoId'],
        },
        createShipment: {
          status: 400,
          ok: false,
          bodyKeys: ['message'],
          providerError: 'Shipment is still being prepared.',
        },
        providerError: 'Shipment is still being prepared.',
        deliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionIdSource: 'delivery_option_lookup',
        forwardDeliveryOptionPersistedAt: 'delivery_option_selected',
        selectedDeliveryOptionId: 'surat-kargo-marketplace',
      }),
    );

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'try_oto',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'try_oto',
          TRY_OTO_ENABLED: true,
          TRY_OTO_SANDBOX_MODE: true,
          TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
          TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      shipmentStatus: 'created',
      providerShipmentId: 'SPORJINAL-1027',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'CREATED',
          providerShipmentId: 'SPORJINAL-1027',
          responseSnapshot: expect.objectContaining({
            tryOtoAsyncPending: true,
            forwardDeliveryOptionId: 'surat-kargo-marketplace',
            forwardDeliveryOptionIdSource: 'delivery_option_lookup',
            forwardDeliveryOptionPersistedAt: 'delivery_option_selected',
            selectedDeliveryOptionId: 'surat-kargo-marketplace',
            providerMessage: 'Shipment was created. Tracking or label may still be processing.',
            error: 'Try OTO createShipment failed with HTTP 400.',
          }),
        }),
      }),
    );
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alloc-1' },
        data: expect.objectContaining({
          shippingStatus: 'label_created',
          carrier: 'try_oto',
        }),
      }),
    );
  });

  it('keeps non-recoverable Try OTO validation errors failed', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Sandbox Customer',
          customerEmail: 'sandbox@example.com',
          customerPhone: '0555 111 22 33',
          shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
          shippingCity: 'Istanbul',
          shippingDistrict: 'Kadikoy',
          shippingCountry: 'TR',
          shippingPostcode: '34710',
        },
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-try-oto',
      vendorId: 'sporjinal',
      preferredProvider: 'TRY_OTO',
      shippingEnabled: true,
      defaultDesi: 1,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
        tryOtoOriginCity: 'Istanbul',
      },
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
    });
    adapter.createShipment.mockRejectedValue(
      new ShippingProviderExecutionError('Try OTO createShipment failed with HTTP 422.', {
        provider: 'try_oto',
        operation: 'createShipment',
        status: 422,
        ok: false,
        createOrder: {
          ok: true,
          operation: 'createOrder',
        },
        createShipment: {
          status: 422,
          ok: false,
          providerValidationErrors: ['customer.mobile is required'],
        },
        providerValidationErrors: ['customer.mobile is required'],
      }),
    );

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'try_oto',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'try_oto',
          TRY_OTO_ENABLED: true,
          TRY_OTO_SANDBOX_MODE: true,
          TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
          TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result.shipmentStatus).toBe('failed');
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'FAILED',
          responseSnapshot: expect.objectContaining({
            providerValidationErrors: ['customer.mobile is required'],
          }),
        }),
      }),
    );
  });

  it('blocks Try OTO shipment execution before provider lookup when origin city is missing', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        order: {
          id: 'order-1',
          customerName: 'Sandbox Customer',
          customerEmail: 'sandbox@example.com',
          customerPhone: '0555 111 22 33',
          shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
          shippingCity: 'Istanbul',
          shippingDistrict: 'Kadikoy',
          shippingCountry: 'TR',
          shippingPostcode: '34710',
        },
      }),
    );
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      id: 'ship-config-try-oto',
      vendorId: 'sporjinal',
      preferredProvider: 'TRY_OTO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
      },
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      warehouses: [],
    });
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          provider: 'try_oto',
        },
        {
          env: {
            ...env,
            SHIPPING_PROVIDER: 'try_oto',
            TRY_OTO_ENABLED: true,
            TRY_OTO_SANDBOX_MODE: true,
            TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
            TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
          },
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Try OTO origin city is required for delivery option lookup.');

    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('uses configured Try OTO deliveryOptionId without delivery option lookup', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, otoId: 540790 })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, message: 'create shipment request is received.' })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, status: 'processing' })));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'try_oto',
      requestSnapshot: {
        orderId: 'POC-TR-1002',
        pickupLocationCode: 'tr-test-store-001',
        deliveryOptionId: 'configured-7109',
        payment_method: 'paid',
        amount: 1299.9,
        amount_due: 0,
        currency: 'TRY',
        packageWeight: 1,
        customer: {
          name: 'Sandbox Customer',
          mobile: '905551112233',
          address: 'Test Mahallesi 1. Sokak No: 1',
          city: 'Istanbul',
          country: 'TR',
          district: 'Kadikoy',
        },
        items: [],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain('https://staging-api.tryoto.com/rest/v2/checkOTODeliveryFee');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      orderId: 'POC-TR-1002',
      deliveryOptionId: 'configured-7109',
    });
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toEqual({
      orderId: 'POC-TR-1002',
      deliveryOptionId: 'configured-7109',
    });
    expect(result.responseSnapshot).toMatchObject({
      deliveryOptionLookup: expect.objectContaining({
        called: false,
        selectedDeliveryOptionIdPresent: true,
        configuredDeliveryOptionIdPresent: true,
      }),
      createShipmentRequestDiagnostics: {
        topLevelKeys: ['deliveryOptionId', 'orderId'],
        orderIdPresent: true,
        deliveryOptionIdPresent: true,
      },
    });
  });

  it('serializes resolved Try OTO lookup fields even when origin city is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, deliveryCompany: [] })));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'try_oto',
        requestSnapshot: {
          orderId: 'POC-TR-1004',
          pickupLocationCode: 'tr-test-store-001',
          payment_method: 'paid',
          amount: 1299.9,
          amount_due: 0,
          currency: 'TRY',
          packageWeight: 1,
          customer: {
            name: 'Sandbox Customer',
            mobile: '905551112233',
            address: 'Test Mahallesi 1. Sokak No: 1',
            city: 'Istanbul',
            country: 'TR',
            district: 'Kadikoy',
          },
          items: [],
        },
      }),
    ).rejects.toMatchObject({
      message: 'Try OTO delivery option could not be resolved. Check pickup location, destination, package weight, and sandbox credit.',
      responseSnapshot: expect.objectContaining({
        deliveryOptionLookup: expect.objectContaining({
          called: true,
          success: true,
          request: expect.objectContaining({
            topLevelKeys: ['currency', 'customer', 'destinationCity', 'packageWeight', 'payment_method', 'pickupLocationCode', 'weight'],
            pickupLocationCodePresent: true,
            originCityPresent: false,
            packageWeightPresent: true,
            weightPresent: true,
            weightFieldNames: ['weight', 'packageWeight'],
            numericWeightPresent: true,
            weightType: 'number',
            customerCityPresent: true,
            customerCountryPresent: true,
            paymentMethodPresent: true,
          }),
        }),
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      pickupLocationCode: 'tr-test-store-001',
      destinationCity: 'Istanbul',
      weight: 1,
      packageWeight: 1,
      customer: {
        city: 'Istanbul',
        country: 'TR',
      },
      payment_method: 'paid',
      currency: 'TRY',
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('905551112233');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('Test Mahallesi');
  });

  it('blocks Try OTO shipment creation when delivery options cannot be resolved', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ success: true, deliveryCompany: [] })));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'try_oto',
        requestSnapshot: {
          orderId: 'POC-TR-1003',
          pickupLocationCode: 'tr-test-store-001',
          originCity: 'Istanbul',
          payment_method: 'paid',
          amount: 1299.9,
          amount_due: 0,
          currency: 'TRY',
          packageWeight: 1,
          customer: {
            name: 'Sandbox Customer',
            mobile: '905551112233',
            address: 'Test Mahallesi 1. Sokak No: 1',
            city: 'Istanbul',
            country: 'TR',
            district: 'Kadikoy',
          },
          items: [],
        },
      }),
    ).rejects.toMatchObject({
      message: 'Try OTO delivery option could not be resolved. Check pickup location, destination, package weight, and sandbox credit.',
      responseSnapshot: expect.objectContaining({
        deliveryOptionLookup: {
          called: true,
          success: true,
          optionCount: 0,
          selectedDeliveryCompanyName: null,
          selectedDeliveryOptionIdPresent: false,
          request: expect.objectContaining({
            endpoint: '/rest/v2/checkOTODeliveryFee',
            topLevelKeys: [
              'currency',
              'customer',
              'destinationCity',
              'originCity',
              'packageWeight',
              'payment_method',
              'pickupLocationCode',
              'weight',
            ],
            pickupLocationCodePresent: true,
            originCityPresent: true,
            packageWeightPresent: true,
            weightPresent: true,
            weightFieldNames: ['weight', 'packageWeight'],
            numericWeightPresent: true,
            weightType: 'number',
            customerCityPresent: true,
            customerCountryPresent: true,
            paymentMethodPresent: true,
            sourceFieldPresence: {
              pickupLocationCode: true,
              originCity: true,
              packageWeight: true,
              customerCity: true,
              customerCountry: true,
              paymentMethod: true,
            },
          }),
          response: expect.objectContaining({
            status: 200,
            topLevelKeys: ['deliveryCompany', 'success'],
            bodyKeys: ['deliveryCompany', 'success'],
            optionCount: 0,
            deliveryOptionIdPresent: false,
            deliveryCompanyNamePresent: false,
            pricingPresent: false,
            pricingKeys: [],
          }),
        },
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('905551112233');
  });

  it('refreshes Try OTO shipment status through orderStatus and captures tracking, barcode, and label fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(
        mockProviderResponse(
          JSON.stringify({
            status: 'shipmentCreated',
            shipmentId: 'OTO-SHIP-1001',
            trackingNumber: 'OTO-TRACK-1001',
            dcTrackingNumber: 'SURAT-1001',
            trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1001',
            barcode: 'OTO-BARCODE-1001',
            printLabelURL: 'https://app.tryoto.example/label.pdf',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.getShipmentStatus('OTO-ORDER-1001');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://staging-api.tryoto.com/rest/v2/orderStatus',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer oto-access-token',
        }),
        body: JSON.stringify({ orderId: 'OTO-ORDER-1001' }),
      }),
    );
    expect(result).toMatchObject({
      providerShipmentId: 'OTO-SHIP-1001',
      trackingNumber: 'OTO-TRACK-1001',
      trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1001',
      labelUrl: 'https://app.tryoto.example/label.pdf',
      shipmentStatus: 'created',
      responseSnapshot: {
        barcode: 'OTO-BARCODE-1001',
        orderId: 'OTO-ORDER-1001',
      },
    });
  });

  it('keeps missing Try OTO status fields pending safely when orderStatus has no tracking details', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ access_token: 'oto-access-token', expires_in: 3600 })))
      .mockResolvedValueOnce(mockProviderResponse(JSON.stringify({ status: 'processing' })));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TryOtoAdapter({
      ...env,
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: true,
      TRY_OTO_ENABLED: true,
      TRY_OTO_SANDBOX_MODE: true,
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'refresh-secret',
    });

    const result = await adapter.getShipmentStatus('OTO-ORDER-1002');

    expect(result).toMatchObject({
      providerShipmentId: 'OTO-ORDER-1002',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'pending',
    });
  });

  it('refreshes and persists Try OTO shipment execution status without touching Kargo executions', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-try_oto-alloc-1',
      provider: 'TRY_OTO',
      providerShipmentId: 'OTO-ORDER-1001',
      trackingNumber: null,
      labelUrl: null,
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        orderId: 'OTO-ORDER-1001',
        forwardDeliveryOptionId: 'surat-kargo-marketplace',
        forwardDeliveryOptionIdSource: 'delivery_option_lookup',
        forwardDeliveryOptionPersistedAt: 'async_recovery',
        providerError: 'Previous createShipment error',
      },
      requestSnapshot: {
        orderId: 'OTO-ORDER-1001',
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'TRY_OTO' as const,
    });
    adapter.getShipmentStatus.mockResolvedValue({
      providerShipmentId: 'OTO-SHIP-1001',
      trackingNumber: 'OTO-TRACK-1001',
      trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1001',
      labelUrl: 'https://app.tryoto.example/label.pdf',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        provider: 'try_oto',
        orderId: 'OTO-ORDER-1001',
        barcode: 'OTO-BARCODE-1001',
        providerStatus: 'shipmentCreated',
      },
    });

    const result = await refreshTryOtoShipmentStatus('shipment-try_oto-alloc-1', {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.getShipmentStatus).toHaveBeenCalledWith('OTO-ORDER-1001');
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-try_oto-alloc-1' },
        data: expect.objectContaining({
          providerShipmentId: 'OTO-SHIP-1001',
          trackingNumber: 'OTO-TRACK-1001',
          trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1001',
          labelUrl: 'https://app.tryoto.example/label.pdf',
          shipmentStatus: 'CREATED',
          responseSnapshot: expect.objectContaining({
            barcode: 'OTO-BARCODE-1001',
            providerStatus: 'shipmentCreated',
            providerError: 'Previous createShipment error',
            forwardDeliveryOptionId: 'surat-kargo-marketplace',
            forwardDeliveryOptionIdSource: 'delivery_option_lookup',
            forwardDeliveryOptionPersistedAt: 'async_recovery',
            forwardDeliveryOptionRetainedAfterStatusRefresh: true,
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      providerShipmentId: 'OTO-SHIP-1001',
      trackingNumber: 'OTO-TRACK-1001',
      labelUrl: 'https://app.tryoto.example/label.pdf',
      barcode: 'OTO-BARCODE-1001',
    });

    prismaMock.shipmentExecution.findUnique.mockResolvedValue(
      buildShipmentExecution({
        id: 'shipment-kargo_entegrator-alloc-1',
        provider: 'KARGO_ENTEGRATOR',
      }),
    );
    await expect(
      refreshTryOtoShipmentStatus('shipment-kargo_entegrator-alloc-1', {
        env,
        vendorId: 'sporjinal',
        adapter,
      }),
    ).rejects.toThrow('only available for Try OTO');
  });

  it('syncs detailed Navlungo status, enriches tracking, and records deduped timeline logs', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NAV-POST-1001',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'navlungo',
        timelineEventFingerprints: ['navlungo_status_log|PickedUp|16|2026-05-15T11:00:00.000Z'],
        timeline: [{ label: 'Picked up', at: '2026-05-15T11:00:00.000Z', status: 'OK' }],
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.getShipmentStatus.mockResolvedValue({
      providerShipmentId: 'NAV-POST-1001',
      trackingNumber: 'SURAT-TRACK-1001',
      trackingUrl: 'https://tracking.navlungo.example/NAV-POST-1001',
      labelUrl: 'barcode-string',
      shipmentStatus: 'in_transit',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        provider: 'navlungo',
        navlungoStatusSyncAttempted: true,
        navlungoStatusSyncHttpStatus: 200,
        navlungoStatusSyncResolvedProviderUrl: 'https://domestic-api.navlungo.com/v2.1/post/check',
        navlungoStatusSyncResolvedProviderPath: '/v2.1/post/check',
        navlungoStatusSyncRequestPayloadKeys: ['post', 'limit'],
        navlungoStatusSyncPostPayloadKeys: ['post_number'],
        navlungoStatusSyncLimit: 1,
        navlungoStatusSyncResponseShape: { kind: 'json:object', topLevelKeys: ['status', 'data'] },
        navlungoProviderStatusCode: 17,
        navlungoProviderStatusName: 'In Transit',
        navlungoNormalizedStatus: 'in_transit',
        navlungoTrackingEnriched: true,
        navlungoGeoStatus: 'verified',
        navlungoGeoBadAddress: true,
        navlungoCarrierTrackingPresent: true,
        navlungoLogsCount: 2,
        navlungoStatusLogs: [
          { status_code: 16, action: 'PickedUp', action_result: 'OK', created_at: '2026-05-15T11:00:00.000Z' },
          { status_code: 17, action: 'InTransit', action_result: 'OK', created_at: '2026-05-15T12:00:00.000Z' },
        ],
        shopifyDeliveryStatusSyncSkippedReason: 'not_implemented',
      },
    });

    const result = await syncNavlungoShipmentStatus('shipment-navlungo-alloc-1', {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.getShipmentStatus).toHaveBeenCalledWith('NAV-POST-1001');
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-navlungo-alloc-1' },
        data: expect.objectContaining({
          providerShipmentId: 'NAV-POST-1001',
          trackingNumber: 'SURAT-TRACK-1001',
          trackingUrl: 'https://tracking.navlungo.example/NAV-POST-1001',
          labelUrl: 'barcode-string',
          shipmentStatus: 'IN_TRANSIT',
          responseSnapshot: expect.objectContaining({
            navlungoStatusSyncAttempted: true,
            navlungoStatusSyncHttpStatus: 200,
            navlungoStatusSyncResolvedProviderPath: '/v2.1/post/check',
            navlungoStatusSyncRequestPayloadKeys: ['post', 'limit'],
            navlungoStatusSyncPostPayloadKeys: ['post_number'],
            navlungoStatusSyncLimit: 1,
            navlungoProviderStatusCode: 17,
            navlungoNormalizedStatus: 'in_transit',
            navlungoGeoBadAddress: true,
            shopifyDeliveryStatusSyncSkippedReason: 'not_implemented',
            timeline: expect.arrayContaining([
              expect.objectContaining({ label: 'Picked up' }),
              expect.objectContaining({ label: 'In transit', at: '2026-05-15T12:00:00.000Z' }),
              expect.objectContaining({ label: 'Navlungo status synced', status: 'in_transit' }),
            ]),
          }),
        }),
      }),
    );
    const updatePayload = prismaMock.shipmentExecution.update.mock.calls.at(-1)?.[0].data.responseSnapshot as {
      timeline?: Array<{ label: string }>;
    };
    expect(updatePayload.timeline?.filter((event) => event.label === 'Picked up')).toHaveLength(1);
    expect(result).toMatchObject({
      trackingNumber: 'SURAT-TRACK-1001',
      trackingUrl: 'https://tracking.navlungo.example/NAV-POST-1001',
      labelUrl: 'barcode-string',
      shipmentStatus: 'in_transit',
    });
  });

  it('keeps unknown Navlungo detailed statuses diagnostic-only', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-navlungo-alloc-1',
      provider: 'NAVLUNGO',
      providerShipmentId: 'NAV-POST-1001',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'navlungo',
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.getShipmentStatus.mockResolvedValue({
      providerShipmentId: 'NAV-POST-1001',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'pending',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        provider: 'navlungo',
        navlungoStatusSyncAttempted: true,
        navlungoStatusSyncHttpStatus: 200,
        navlungoProviderStatusCode: 999,
        navlungoProviderStatusName: 'Mystery',
        navlungoNormalizedStatus: null,
        navlungoLogsCount: 0,
      },
    });

    await syncNavlungoShipmentStatus('shipment-navlungo-alloc-1', {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'CREATED',
          responseSnapshot: expect.objectContaining({
            navlungoProviderStatusCode: 999,
            navlungoProviderStatusName: 'Mystery',
          }),
        }),
      }),
    );
  });

  it('blocks Navlungo detailed status sync when provider shipment id is missing', async () => {
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(
      buildShipmentExecution({
        id: 'shipment-navlungo-alloc-1',
        provider: 'NAVLUNGO',
        providerShipmentId: null,
      }),
    );

    await expect(
      syncNavlungoShipmentStatus('shipment-navlungo-alloc-1', {
        env,
        vendorId: 'sporjinal',
      }),
    ).rejects.toThrow('stored provider post number');
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('routes the generic manual status refresh to Navlungo without changing Try OTO refresh behavior', async () => {
    prismaMock.shipmentExecution.findUnique
      .mockResolvedValueOnce(
        buildShipmentExecution({
          id: 'shipment-navlungo-alloc-1',
          provider: 'NAVLUNGO',
        }),
      )
      .mockResolvedValueOnce(
        buildShipmentExecution({
          id: 'shipment-navlungo-alloc-1',
          provider: 'NAVLUNGO',
          providerShipmentId: 'NAV-POST-1001',
          shipmentStatus: 'CREATED',
        }),
      );
    const adapter = buildAdapter({
      provider: 'NAVLUNGO' as const,
    });
    adapter.getShipmentStatus.mockResolvedValue({
      providerShipmentId: 'NAV-POST-1001',
      trackingNumber: 'NAV-POST-1001',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        provider: 'navlungo',
        navlungoStatusSyncAttempted: true,
        navlungoStatusSyncHttpStatus: 200,
      },
    });

    await refreshShipmentExecutionStatus('shipment-navlungo-alloc-1', {
      env,
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.getShipmentStatus).toHaveBeenCalledWith('NAV-POST-1001');
  });
});
