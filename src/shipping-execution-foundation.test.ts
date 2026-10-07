import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorShippingConfig: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    upsert: vi.fn(),
  },
  vendorShippingWarehouse: {
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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
  sopyoShipmentIntent: {
    findUnique: vi.fn(),
  },
  customerCancellationRequestItem: {
    findFirst: vi.fn(),
  },
  returnRecord: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
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
  createShipmentExecution,
  getShippingProviderGateDiagnostics,
  getShipmentExecutionById,
  getShippingProviderReadinessDiagnostics,
  inferShipmentDesi,
  previewShipmentExecution,
  refreshKargonomiShipmentProviderData,
  refreshShipmentExecutionStatus,
  retryDryRunShipmentExecution,
  retryFailedShipmentExecution,
  syncKargonomiWarehouseDetails,
  upsertVendorShippingConfig,
} = await import(
  '../backend/src/modules/shipping/shipping-execution.service.js'
);
const { ShippingProviderExecutionError, createShippingProviderAdapter } = await import('../backend/src/modules/shipping/shipping-provider.adapter.js');
const { registerShippingExecutionRoutes } = await import('../backend/src/modules/shipping/shipping-execution.routes.js');
const { clearKargonomiLocationLookupCache } = await import('../backend/src/modules/shipping/kargonomi-provider.adapter.js');

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
  SHIPPING_EXECUTION_ENABLED: true,
  SHIPPING_SANDBOX_MODE: false,
  SHIPPING_PROVIDER: 'hepsijet' as const,
};

function buildNavlungoProviderMetadata(overrides: Record<string, unknown> = {}) {
  return {
    navlungoSenderAddressId: '55574',
    navlungoReturnRecipientAddressId: '55574',
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

function buildKargonomiShippingConfig(overrides: Record<string, unknown> = {}) {
  return {
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

function buildNavlungoForwardShipmentExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shipment-execution-1',
    provider: 'NAVLUNGO',
    shipmentStatus: 'CREATED',
    providerShipmentId: 'NAV-POST-1',
    trackingNumber: 'TRK-1',
    trackingUrl: 'https://tracking.example/TRK-1',
    labelUrl: 'barcode-string',
    warehouseId: '55574',
    requestSnapshot: {
      platform: 'shopify',
      posts: [
        {
          reference_id: 'SP-1054-ABC123',
          carrier_id: 9,
          post_type: 2,
          sender: { addressId: 55574 },
          recipient: { name: 'redacted' },
          post: { desi: 3, package_count: 1, price: '', note: '' },
          barcode_format: 'pdf-A6',
          custom_data_4: '55574',
        },
      ],
    },
    responseSnapshot: {
      senderMode: 'addressId',
      providerShipmentId: 'NAV-POST-1',
    },
    updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    ...overrides,
  };
}

function buildNavlungoReturnRecordWithShipmentExecutions(
  shipmentExecutions: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  const base = buildNavlungoReturnRecord(overrides);
  return {
    ...base,
    vendorAllocation: {
      ...base.vendorAllocation,
      shipmentExecutions,
    },
  };
}

function buildAllocation(overrides: Record<string, unknown> = {}) {
  const base = {
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
      sourceShopifyOrderId: '7616544244049',
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
  };
  return {
    ...base,
    ...overrides,
    order: {
      ...base.order,
      ...((overrides.order as Record<string, unknown> | undefined) ?? {}),
    },
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
      shippingAddress1: 'Test Mahallesi 1. Sokak No: 1',
      shippingStateId: '34',
      shippingCityId: '828',
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
    prismaMock.vendorShippingConfig.findUniqueOrThrow.mockReset();
    prismaMock.vendorShippingConfig.upsert.mockReset();
    prismaMock.vendorShippingWarehouse.upsert.mockReset();
    prismaMock.vendorShippingWarehouse.update.mockReset();
    prismaMock.vendorShippingWarehouse.updateMany.mockReset();
    prismaMock.shipmentExecution.findUnique.mockReset();
    prismaMock.shipmentExecution.findFirst.mockReset();
    prismaMock.shipmentExecution.findMany.mockReset();
    prismaMock.shipmentExecution.create.mockReset();
    prismaMock.shipmentExecution.update.mockReset();
    prismaMock.shipmentShippingCost.findFirst.mockReset();
    prismaMock.shipmentShippingCost.upsert.mockReset();
    prismaMock.fulfillment.upsert.mockReset();
    prismaMock.sopyoShipmentIntent.findUnique.mockReset();
    prismaMock.sopyoShipmentIntent.findUnique.mockResolvedValue(null);
    prismaMock.customerCancellationRequestItem.findFirst.mockReset();
    prismaMock.customerCancellationRequestItem.findFirst.mockResolvedValue(null);
    prismaMock.returnRecord.findFirst.mockReset();
    prismaMock.returnRecord.findUnique.mockReset();
    prismaMock.returnRecord.update.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$queryRaw.mockReset();
    prismaMock.$queryRaw.mockResolvedValue([]);
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

  it('blocks shipment preview and create from canonical cancellation metadata alone', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      allocationStatus: 'ACTIVE',
      cancellationReason: null,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      order: {
        id: 'order-cancelled',
        cancelledAt: new Date('2026-07-11T20:23:00.000Z'),
      },
    }));

    await expect(previewShipmentExecution(
      { allocationId: 'alloc-1', provider: 'hepsijet' },
      { vendorId: 'sporjinal', env: { ...env, SHIPPING_EXECUTION_ENABLED: true } },
    )).rejects.toThrow('Full Shopify order cancellation blocks this operation.');
    await expect(createShipmentExecution(
      { allocationId: 'alloc-1', provider: 'hepsijet' },
      { vendorId: 'sporjinal', env: { ...env, SHIPPING_EXECUTION_ENABLED: true } },
    )).rejects.toThrow('Full Shopify order cancellation blocks this operation.');
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('blocks terminal allocation preview before Kargonomi destination lookup and maps the route error to 409', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      fullRefundTerminalFact: { id: 'terminal-fact-1' },
    }));
    const kargonomiDestinationClient = {
      listStates: vi.fn(),
      listCities: vi.fn(),
    };

    await expect(previewShipmentExecution(
      { allocationId: 'alloc-1', provider: 'kargonomi' },
      {
        vendorId: 'sporjinal',
        env: { ...env, SHIPPING_PROVIDER: 'kargonomi' },
        kargonomiDestinationClient,
      },
    )).rejects.toMatchObject({ code: 'ALLOCATION_REFUND_TERMINAL' });

    const posts = new Map<string, (request: unknown, reply: unknown) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, ...args: unknown[]) => posts.set(path, args.at(-1) as never)),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };
    registerShippingExecutionRoutes(app as never, env);
    const routeResult = await posts.get('/shipments/preview')?.(
      {
        body: { allocationId: 'alloc-1', provider: 'kargonomi' },
        vendorContext: { vendorId: 'sporjinal' },
        headers: {},
        protocol: 'https',
        hostname: 'example.test',
      },
      reply,
    );

    expect(routeResult).toEqual({
      status: 409,
      body: {
        code: 'ALLOCATION_REFUND_TERMINAL',
        message: 'Allocation is operationally closed by a verified full refund.',
      },
    });
    expect(kargonomiDestinationClient.listStates).not.toHaveBeenCalled();
    expect(kargonomiDestinationClient.listCities).not.toHaveBeenCalled();
  });

  it('blocks terminal allocation Kargonomi create before destination lookup, provider call, or durable claim', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      fullRefundTerminalFact: { id: 'terminal-fact-1' },
    }));
    const adapter = buildAdapter({ provider: 'KARGONOMI' as const });
    const kargonomiDestinationClient = {
      listStates: vi.fn(),
      listCities: vi.fn(),
    };

    await expect(createShipmentExecution(
      { allocationId: 'alloc-1', provider: 'kargonomi' },
      {
        env: { ...env, SHIPPING_PROVIDER: 'kargonomi' },
        vendorId: 'sporjinal',
        adapter,
        kargonomiDestinationClient,
      },
    )).rejects.toMatchObject({ code: 'ALLOCATION_REFUND_TERMINAL' });

    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(kargonomiDestinationClient.listStates).not.toHaveBeenCalled();
    expect(kargonomiDestinationClient.listCities).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('re-reads terminal state under the shared order lock before creating the shipment claim', async () => {
    let allocationReadCount = 0;
    prismaMock.vendorAllocation.findUnique.mockImplementation(async () => {
      allocationReadCount += 1;
      return buildAllocation({
        fullRefundTerminalFact: allocationReadCount >= 6 ? { id: 'terminal-fact-race-winner' } : null,
      });
    });
    const adapter = buildAdapter();

    await expect(createShipmentExecution(
      { allocationId: 'alloc-1' },
      { env, vendorId: 'sporjinal', adapter },
    )).rejects.toMatchObject({ code: 'ALLOCATION_REFUND_TERMINAL' });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('persists provider result and shipment history when a valid durable claim predates terminal closure', async () => {
    let terminalFactPresent = false;
    prismaMock.vendorAllocation.findUnique.mockImplementation(async () => buildAllocation({
      fullRefundTerminalFact: terminalFactPresent ? { id: 'terminal-fact-after-claim' } : null,
    }));
    const adapter = buildAdapter();
    adapter.createShipment.mockImplementation(async () => {
      terminalFactPresent = true;
      return {
        providerShipmentId: 'hpj-before-terminal',
        trackingNumber: 'TRK-BEFORE-TERMINAL',
        trackingUrl: 'https://tracking.example/TRK-BEFORE-TERMINAL',
        labelUrl: 'https://labels.example/TRK-BEFORE-TERMINAL.pdf',
        shipmentStatus: 'created',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: { ok: true },
      };
    });

    const result = await createShipmentExecution(
      { allocationId: 'alloc-1' },
      { env, vendorId: 'sporjinal', adapter },
    );

    expect(prismaMock.shipmentExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shipmentStatus: 'PENDING' }),
      }),
    );
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerShipmentId: 'hpj-before-terminal',
          trackingNumber: 'TRK-BEFORE-TERMINAL',
        }),
      }),
    );
    expect(result).toMatchObject({
      providerShipmentId: 'hpj-before-terminal',
      trackingNumber: 'TRK-BEFORE-TERMINAL',
      shipmentStatus: 'created',
    });
  });

  it('blocks terminal allocation shipment retry before provider call or retry claim', async () => {
    const failedExecution = buildShipmentExecution({ shipmentStatus: 'FAILED' });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(failedExecution);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      fullRefundTerminalFact: { id: 'terminal-fact-1' },
    }));
    const adapter = buildAdapter();

    await expect(retryFailedShipmentExecution(failedExecution.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    })).rejects.toMatchObject({ code: 'ALLOCATION_REFUND_TERMINAL' });

    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks terminal allocation dry-run retry before provider call or retry claim', async () => {
    const dryRunExecution = buildShipmentExecution({
      shipmentStatus: 'PENDING',
      responseSnapshot: { dryRun: true, disabledGates: ['SHIPPING_EXECUTION_ENABLED'] },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(dryRunExecution);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      fullRefundTerminalFact: { id: 'terminal-fact-1' },
    }));
    const adapter = buildAdapter();

    await expect(retryDryRunShipmentExecution(dryRunExecution.id, {
      env,
      actorRole: 'admin',
      adapter,
    })).rejects.toMatchObject({ code: 'ALLOCATION_REFUND_TERMINAL' });

    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks shipment retry from canonical cancellation metadata alone', async () => {
    const failedExecution = buildShipmentExecution({ shipmentStatus: 'FAILED' });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(failedExecution);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      cancellationReason: null,
      order: {
        id: 'order-cancelled-retry',
        cancelledAt: new Date('2026-07-11T20:23:00.000Z'),
      },
    }));

    await expect(retryFailedShipmentExecution(failedExecution.id, {
      env: { ...env, SHIPPING_EXECUTION_ENABLED: true },
      vendorId: 'sporjinal',
    })).rejects.toThrow('Full Shopify order cancellation blocks this operation.');
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('blocks provider creation when a pending customer cancellation wins the canonical order lock', async () => {
    const adapter = buildAdapter();
    prismaMock.customerCancellationRequestItem.findFirst.mockResolvedValue({ id: 'pending-cancellation-item' });

    await expect(createShipmentExecution(
      { allocationId: 'alloc-1' },
      { env, vendorId: 'sporjinal', adapter },
    )).rejects.toMatchObject({
      code: 'CUSTOMER_CANCELLATION_PENDING',
      statusCode: 409,
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks a failed provider retry before provider call when customer cancellation is pending', async () => {
    const failedExecution = buildShipmentExecution({ shipmentStatus: 'FAILED' });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(failedExecution);
    prismaMock.customerCancellationRequestItem.findFirst.mockResolvedValue({ id: 'pending-cancellation-item' });
    const adapter = buildAdapter();

    await expect(retryFailedShipmentExecution(failedExecution.id, {
      env,
      vendorId: 'sporjinal',
      adapter,
    })).rejects.toMatchObject({
      code: 'CUSTOMER_CANCELLATION_PENDING',
      statusCode: 409,
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks a dry-run retry before provider readiness or provider call when customer cancellation is pending', async () => {
    const dryRunExecution = buildShipmentExecution({
      shipmentStatus: 'PENDING',
      responseSnapshot: { dryRun: true, disabledGates: ['SHIPPING_EXECUTION_ENABLED'] },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(dryRunExecution);
    prismaMock.customerCancellationRequestItem.findFirst.mockResolvedValue({ id: 'pending-cancellation-item' });
    const adapter = buildAdapter();

    await expect(retryDryRunShipmentExecution(dryRunExecution.id, {
      env,
      actorRole: 'admin',
      adapter,
    })).rejects.toMatchObject({
      code: 'CUSTOMER_CANCELLATION_PENDING',
      statusCode: 409,
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(adapter.createShipment).not.toHaveBeenCalled();
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

  it('preserves and syncs existing Kargonomi provider evidence even when a cancellation hold appears later', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargonomi-alloc-1',
      provider: 'KARGONOMI',
      providerShipmentId: '2653543',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'kargonomi',
        shipmentId: '2653543',
        createShipmentCalled: true,
        confirmShippingPriceCalled: true,
      },
      allocation: buildAllocationWithShopifyFulfillmentData({
        fulfillment: {
          shopifyFulfillmentId: null,
          shipmentCreatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      }),
    });
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
      refreshProviderData: vi.fn().mockResolvedValue({
        providerShipmentId: '2653543',
        trackingNumber: 'KSUR2653543SKDXP',
        trackingUrl: null,
        labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
        shipmentStatus: 'created',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          provider: 'kargonomi',
          flow: 'provider_data_refresh',
          providerShipmentId: '2653543',
          trackingNumberPresent: true,
          shippingProviderName: 'Sürat Kargo',
          barcode: 'data:application/pdf;base64,JVBERi0xLjQ=',
          labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
          barcodeFetchCalled: true,
          barcodeFetch: {
            ok: true,
            httpStatus: 200,
            topLevelKeys: ['data', 'format'],
            detectedFormat: 'pdf_like_value',
            pdfLikeValuePresent: true,
            labelUrlPresent: true,
          },
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.shipmentExecution.findFirst.mockResolvedValue({
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      trackingUrl: null,
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
    });
    prismaMock.customerCancellationRequestItem.findFirst.mockResolvedValue({ id: 'pending-cancellation-item' });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    storedExecution = existing as typeof storedExecution;

    const result = await refreshKargonomiShipmentProviderData(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
        KARGONOMI_API_TOKEN: 'test-token',
      },
      vendorId: 'sporjinal',
      adapter,
    });

    expect(adapter.refreshProviderData).toHaveBeenCalledWith('2653543');
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'shipment-kargonomi-alloc-1',
      provider: 'kargonomi',
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      barcode: 'data:application/pdf;base64,JVBERi0xLjQ=',
    });
    expect(shopifyAdminMock.createFulfillmentTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        allocationId: 'alloc-1',
        trackingNumber: 'KSUR2653543SKDXP',
        carrier: 'Sürat Kargo',
        trackingUrl: null,
        notifyCustomer: false,
      }),
    );
    expect(result.providerResponseSummary).toMatchObject({
      autoSyncAttempted: true,
      autoSyncSucceeded: true,
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSynced: true,
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-kargonomi-alloc-1' },
        data: expect.objectContaining({
          providerShipmentId: '2653543',
          trackingNumber: 'KSUR2653543SKDXP',
          labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
          responseSnapshot: expect.objectContaining({
            providerDataRefreshSucceeded: true,
            providerDataRefreshEndpointUsed: '/shipments/:id/refresh-provider-data',
            createShipmentCalled: false,
            confirmShippingPriceCalled: false,
            persistedBarcodePresent: true,
          }),
        }),
      }),
    );
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alloc-1' },
        data: expect.objectContaining({
          trackingNumber: 'KSUR2653543SKDXP',
          carrier: 'Sürat Kargo',
        }),
      }),
    );
    expect(prismaMock.fulfillment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vendorAllocationId: 'alloc-1' },
        update: expect.objectContaining({
          trackingNumber: 'KSUR2653543SKDXP',
          carrier: 'Sürat Kargo',
          syncStatus: 'carrier_refreshed',
        }),
      }),
    );
  });

  it('marks refreshed Kargonomi shipments cancelled while preserving tracking and label history', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargonomi-alloc-1',
      provider: 'KARGONOMI',
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      trackingUrl: 'https://tracking.test/KSUR2653543SKDXP',
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      shipmentStatus: 'CREATED',
      responseSnapshot: {
        provider: 'kargonomi',
        shipmentId: '2653543',
      },
      allocation: buildAllocationWithShopifyFulfillmentData({
        fulfillment: {
          shopifyFulfillmentId: null,
          shipmentCreatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      }),
    });
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
      refreshProviderData: vi.fn().mockResolvedValue({
        providerShipmentId: '2653543',
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'cancelled',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          provider: 'kargonomi',
          flow: 'provider_data_refresh',
          providerShipmentId: '2653543',
          status: 'cancelled',
          statusLabel: 'İptal edildi',
          providerStatus: 'cancelled',
          providerStatusLabel: 'İptal edildi',
          kargonomiCancelled: true,
          shippingProviderName: 'Sürat Kargo',
        },
      }),
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    storedExecution = existing as typeof storedExecution;

    const result = await refreshKargonomiShipmentProviderData(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargonomi',
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
        KARGONOMI_API_TOKEN: 'test-token',
      },
      vendorId: 'sporjinal',
      adapter,
    });

    expect(result.shipmentStatus).toBe('cancelled');
    expect(result.trackingNumber).toBe('KSUR2653543SKDXP');
    expect(result.labelUrl).toBe('data:application/pdf;base64,JVBERi0xLjQ=');
    expect(result.providerResponseSummary).toMatchObject({
      kargonomiCancelled: true,
      providerStatus: 'cancelled',
      providerStatusLabel: 'İptal edildi',
      autoSyncSkippedReason: 'shipment_not_created',
    });
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trackingNumber: 'KSUR2653543SKDXP',
          labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
          shipmentStatus: 'CANCELLED',
          responseSnapshot: expect.objectContaining({
            kargonomiCancelled: true,
            providerStatus: 'cancelled',
            providerStatusLabel: 'İptal edildi',
          }),
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

  it('syncs Kargonomi warehouse details and resolved location IDs', async () => {
    const originalConfig = buildKargonomiShippingConfig({
      vendorId: 'yalispor',
      defaultWarehouseId: '112666',
      warehouses: [
        {
          id: 'warehouse-yalispor-112666',
          configId: 'shipping-config-yalispor',
          vendorId: 'yalispor',
          provider: 'KARGONOMI',
          warehouseId: '112666',
          name: 'Yalispor Kargonomi warehouse',
          address: null,
          isDefault: true,
          metadata: { legacy: 'kept' },
          createdAt: new Date('2026-06-01T10:00:00.000Z'),
          updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        },
      ],
    });
    const updatedConfig = buildKargonomiShippingConfig({
      vendorId: 'yalispor',
      defaultWarehouseId: '112666',
      warehouses: [
        {
          id: 'warehouse-yalispor-112666',
          configId: 'shipping-config-yalispor',
          vendorId: 'yalispor',
          provider: 'KARGONOMI',
          warehouseId: '112666',
          name: 'Yalispor Kargonomi warehouse',
          address: 'Synced warehouse address',
          isDefault: true,
          metadata: {
            legacy: 'kept',
            contactName: 'Yalispor Depo',
            phone: '+902121112233',
            stateName: 'İstanbul',
            cityName: 'Kadıköy',
            stateId: '34',
            cityId: '828',
            lookupStatus: 'resolved',
            lookupError: null,
            kargonomiWarehouseSyncedAt: '2026-06-01T10:05:00.000Z',
          },
          createdAt: new Date('2026-06-01T10:00:00.000Z'),
          updatedAt: new Date('2026-06-01T10:05:00.000Z'),
        },
      ],
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(originalConfig).mockResolvedValueOnce(updatedConfig);
    prismaMock.vendorShippingWarehouse.update.mockResolvedValue({});
    const client = {
      getWarehouse: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: {
          data: {
            contact_name: 'Yalispor Depo',
            contact_phone: '+902121112233',
            address: 'Synced warehouse address',
            state: 'ISTANBUL',
            city: 'KADIKOY',
          },
        },
      }),
      listStates: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: '34', name: 'İstanbul' }] },
      }),
      listCities: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: '828', name: 'Kadıköy' }] },
      }),
    };

    const result = await syncKargonomiWarehouseDetails('yalispor', '112666', env, { client });

    expect(client.getWarehouse).toHaveBeenCalledWith('112666');
    expect(client.listStates).toHaveBeenCalled();
    expect(client.listCities).toHaveBeenCalledWith('34');
    expect(prismaMock.vendorShippingWarehouse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          vendorId_provider_warehouseId: {
            vendorId: 'yalispor',
            provider: 'KARGONOMI',
            warehouseId: '112666',
          },
        },
        data: expect.objectContaining({
          address: 'Synced warehouse address',
          metadata: expect.objectContaining({
            legacy: 'kept',
            contactName: 'Yalispor Depo',
            phone: '+902121112233',
            stateName: 'İstanbul',
            cityName: 'Kadıköy',
            stateId: '34',
            cityId: '828',
            lookupStatus: 'resolved',
            lookupError: null,
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      provider: 'KARGONOMI',
      warehouseId: '112666',
      warehouse: {
        contactNamePresent: true,
        phonePresent: true,
        addressPresent: true,
        stateName: 'İstanbul',
        cityName: 'Kadıköy',
        stateId: '34',
        cityId: '828',
      },
      syncedConfig: {
        warehouses: [
          expect.objectContaining({
            syncStatus: expect.objectContaining({
              phonePresent: true,
              addressPresent: true,
              stateIdPresent: true,
              cityIdPresent: true,
            }),
          }),
        ],
      },
    });
  });

  it('does not persist Kargonomi warehouse details when state/city lookup fails', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce(buildKargonomiShippingConfig());
    const client = {
      getWarehouse: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: {
          warehouse: {
            contact_name: 'Sporjinal Depo',
            contact_phone: '+902121112233',
            address: 'Synced warehouse address',
            state: 'Istanbul',
            city: 'Unknown District',
          },
        },
      }),
      listStates: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: '34', name: 'Istanbul' }] },
      }),
      listCities: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: '828', name: 'Kadikoy' }] },
      }),
    };

    await expect(syncKargonomiWarehouseDetails('sporjinal', '112668', env, { client })).rejects.toThrow(
      'Kargonomi warehouse location could not be resolved',
    );
    expect(prismaMock.vendorShippingWarehouse.update).not.toHaveBeenCalled();
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

  it('uses Shopify Worldwide address2 split for Turkey Kargonomi destination without mutating persisted order fields', async () => {
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
    const order = {
      id: 'order-1081',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
      customerPhone: '+90 555 111 22 33',
      shippingAddress: 'İncirağacı Sokak no 6b, 6B ⁠Kartal',
      shippingCity: 'İstanbul',
      shippingDistrict: '6B ⁠Kartal',
      shippingCountry: 'TR',
      shippingPostcode: '34870',
      webhookEvents: [
        {
          rawPayload: JSON.stringify({
            shipping_address: {
              address1: 'İncirağacı Sokak no 6b',
              address2: '6B ⁠Kartal',
              city: 'İstanbul',
              country_code: 'TR',
              zip: '34870',
            },
          }),
        },
      ],
    };
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({ order }));
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'kg-1081',
      trackingNumber: 'KG-TRACK-1081',
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
        body: { data: [{ id: 828, name: 'Kartal' }] },
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

    expect(kargonomiDestinationClient.listCities).toHaveBeenCalledWith('34');
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          buyer: expect.objectContaining({
            buyer_address: 'İncirağacı Sokak no 6b, 6B ⁠Kartal',
            buyer_state_id: '34',
            buyer_city_id: '828',
          }),
          destinationResolution: expect.objectContaining({
            source: 'order_shipping_address_lookup',
            resolved: true,
            districtRawValue: '6B ⁠Kartal',
            districtResolvedValue: 'Kartal',
            districtResolutionSource: 'shopify_worldwide_split',
          }),
        }),
      }),
    );
    expect(order.shippingDistrict).toBe('6B ⁠Kartal');
  });

  it('keeps clean Turkey address2 as exact Kargonomi district fallback', async () => {
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
          id: 'order-clean-address2',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress: 'İncirağacı Sokak no 6b, Kartal',
          shippingCity: 'İstanbul',
          shippingDistrict: null,
          shippingCountry: 'TR',
          webhookEvents: [
            {
              rawPayload: JSON.stringify({
                shipping_address: {
                  address1: 'İncirağacı Sokak no 6b',
                  address2: 'Kartal',
                  city: 'İstanbul',
                  country_code: 'TR',
                },
              }),
            },
          ],
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'kg-clean',
      trackingNumber: 'KG-TRACK-CLEAN',
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
        body: { data: [{ id: 828, name: 'Kartal' }] },
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

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          destinationResolution: expect.objectContaining({
            districtRawValue: 'Kartal',
            districtResolvedValue: 'Kartal',
            districtResolutionSource: 'exact',
          }),
        }),
      }),
    );
  });

  it('does not guess malformed Turkey address2 district and blocks Kargonomi create when unresolved', async () => {
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
          id: 'order-malformed-address2',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress: 'İncirağacı Sokak no 6b, 6B Kartal',
          shippingCity: 'İstanbul',
          shippingDistrict: null,
          shippingCountry: 'TR',
          webhookEvents: [
            {
              rawPayload: JSON.stringify({
                shipping_address: {
                  address1: 'İncirağacı Sokak no 6b',
                  address2: '6B Kartal',
                  city: 'İstanbul',
                  country_code: 'TR',
                },
              }),
            },
          ],
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
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
        body: { data: [{ id: 828, name: 'Kartal' }] },
      }),
    };

    await expect(createShipmentExecution(
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
    )).rejects.toThrow('Kargonomi destination could not be resolved from the order shipping address.');

    expect(kargonomiDestinationClient.listStates).toHaveBeenCalled();
    expect(kargonomiDestinationClient.listCities).toHaveBeenCalledWith('34');
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('uses corrected persisted shipping fields when stale orders/create webhook address is invalid', async () => {
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
          id: 'order-1080',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress: 'Çınar Mahallesi Orhan Sokak 1/3, Maltepe',
          shippingCity: 'İstanbul',
          shippingDistrict: 'Maltepe',
          shippingPostcode: '34841',
          shippingCountry: 'TR',
          webhookEvents: [
            {
              rawPayload: JSON.stringify({
                shipping_address: {
                  address1: 'NA',
                  address2: 'NA NA',
                  city: 'NA',
                  zip: null,
                  country: 'Türkiye',
                },
              }),
            },
          ],
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'kg-1080',
      trackingNumber: 'KG-TRACK-1080',
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
        body: { data: [{ id: 828, name: 'Maltepe' }] },
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
            buyer_address: 'Çınar Mahallesi Orhan Sokak 1/3, Maltepe',
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

  it('reports unresolved corrected Kargonomi destination lookup separately from invalid destination guard', async () => {
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
          id: 'order-1080',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress: 'Çınar Mahallesi Orhan Sokak 1/3, Maltepe',
          shippingCity: 'İstanbul',
          shippingDistrict: 'Maltepe',
          shippingPostcode: '34841',
          shippingCountry: 'TR',
          webhookEvents: [
            {
              rawPayload: JSON.stringify({
                shipping_address: {
                  address1: 'NA',
                  address2: 'NA NA',
                  city: 'NA',
                  zip: null,
                  country: 'Türkiye',
                },
              }),
            },
          ],
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    const unresolvedLookup = createShipmentExecution(
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
    );

    let error: unknown;
    try {
      await unresolvedLookup;
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('Kargonomi destination could not be resolved from the order shipping address.');
    expect(message).not.toContain('invalid_order_destination');
    expect(adapter.createShipment).not.toHaveBeenCalled();
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
    ).rejects.toThrow('Order destination address is invalid or incomplete. Kargonomi shipment was blocked before provider call.');
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

  it('blocks Kargonomi before fallback IDs are used when order destination contains NA placeholders', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'yalispor',
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
        assignedVendorId: 'yalispor',
        order: {
          id: 'order-1080',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress: 'NA, NA NA',
          shippingCity: 'NA',
          shippingDistrict: 'NA',
          shippingPostcode: null,
          webhookEvents: [
            {
              rawPayload: JSON.stringify({
                shipping_address: {
                  address1: 'NA',
                  address2: 'NA NA',
                  city: 'NA',
                  zip: null,
                  country: 'Türkiye',
                },
              }),
            },
          ],
        },
      }),
    );
    const adapter = buildAdapter({
      provider: 'KARGONOMI' as const,
    });
    const kargonomiDestinationClient = {
      listStates: vi.fn(),
      listCities: vi.fn(),
    };

    const blockedCreate = createShipmentExecution(
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
        vendorId: 'yalispor',
        adapter,
        kargonomiDestinationClient,
      },
    );

    await expect(blockedCreate).rejects.toThrow('Order destination address is invalid or incomplete. Kargonomi shipment was blocked before provider call.');
    await expect(blockedCreate).rejects.toThrow('skippedReason: invalid_order_destination');
    expect(kargonomiDestinationClient.listStates).not.toHaveBeenCalled();
    expect(kargonomiDestinationClient.listCities).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks Kargonomi stored destination IDs when the order destination address is invalid', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'yalispor',
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
        assignedVendorId: 'yalispor',
        order: {
          id: 'order-1080',
          customerName: 'Test Customer',
          customerEmail: 'customer@example.com',
          customerPhone: '+90 555 111 22 33',
          shippingAddress: 'NA, NA NA',
          shippingCity: 'NA',
          shippingDistrict: 'NA',
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
          },
          vendorId: 'yalispor',
          adapter,
        },
      ),
    ).rejects.toThrow('invalidOrderDestination: true');
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
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

  it('syncs successful Kargonomi shipment tracking to Shopify fulfillment automatically', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(buildKargonomiShippingConfig());
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    const adapter = buildAdapter({ provider: 'KARGONOMI' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      trackingUrl: null,
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        provider: 'kargonomi',
        shippingProviderName: 'Sürat Kargo',
        barcode: 'data:application/pdf;base64,JVBERi0xLjQ=',
      },
    });

    const result = await createShipmentExecution(
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

    expect(shopifyAdminMock.createFulfillmentTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        allocationId: 'alloc-1',
        shopifyOrderId: 'gid://shopify/Order/1055',
        trackingNumber: 'KSUR2653543SKDXP',
        carrier: 'Sürat Kargo',
        trackingUrl: null,
        notifyCustomer: false,
      }),
    );
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSynced: true,
      autoSyncAttempted: true,
      autoSyncSucceeded: true,
      shopifyFulfillmentId: 'gid://shopify/Fulfillment/fulfillment-1055',
      shopifyFulfillmentOrderId: 'gid://shopify/FulfillmentOrder/fo-1055',
      fulfillmentTrackingNumberPresent: true,
    });
  });

  it('skips automatic Kargonomi Shopify sync when tracking is missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(buildKargonomiShippingConfig());
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    const adapter = buildAdapter({ provider: 'KARGONOMI' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: '2653543',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        provider: 'kargonomi',
        shippingProviderName: 'Sürat Kargo',
      },
    });

    const result = await createShipmentExecution(
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

    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: false,
      shopifyFulfillmentSynced: false,
      shopifyFulfillmentSyncSkippedReason: 'tracking_missing',
      autoSyncSkippedReason: 'tracking_missing',
    });
  });

  it('skips automatic Kargonomi Shopify sync when carrier is missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(buildKargonomiShippingConfig());
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    const adapter = buildAdapter({ provider: 'KARGONOMI' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      trackingUrl: null,
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        provider: 'kargonomi',
      },
    });

    const result = await createShipmentExecution(
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

    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: false,
      shopifyFulfillmentSynced: false,
      shopifyFulfillmentSyncSkippedReason: 'carrier_missing',
      autoSyncSkippedReason: 'carrier_missing',
    });
  });

  it('does not duplicate automatic Kargonomi Shopify sync when fulfillment already exists', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(buildKargonomiShippingConfig());
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData({
      fulfillment: {
        shopifyFulfillmentId: 'gid://shopify/Fulfillment/existing-1055',
        shopifyFulfillmentOrderId: 'gid://shopify/FulfillmentOrder/fo-1055',
        shipmentCreatedAt: new Date('2026-05-18T09:55:00.000Z'),
      },
    }));
    const adapter = buildAdapter({ provider: 'KARGONOMI' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      trackingUrl: null,
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        provider: 'kargonomi',
        shippingProviderName: 'Sürat Kargo',
      },
    });

    const result = await createShipmentExecution(
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

    expect(shopifyAdminMock.fetchFulfillmentOrders).not.toHaveBeenCalled();
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSynced: true,
      shopifyFulfillmentSyncSkippedReason: 'already_fulfilled',
      autoSyncSkippedReason: 'already_fulfilled',
      shopifyFulfillmentId: 'gid://shopify/Fulfillment/existing-1055',
      shopifyFulfillmentOrderId: 'gid://shopify/FulfillmentOrder/fo-1055',
    });
  });

  it('persists automatic Kargonomi Shopify sync errors safely', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(buildKargonomiShippingConfig());
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocationWithShopifyFulfillmentData());
    shopifyAdminMock.fetchFulfillmentOrders.mockResolvedValueOnce({ fulfillmentOrders: [] });
    const adapter = buildAdapter({ provider: 'KARGONOMI' as const });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      trackingUrl: null,
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ok: true,
        provider: 'kargonomi',
        shippingProviderName: 'Sürat Kargo',
      },
    });

    const result = await createShipmentExecution(
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

    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
    expect(result.providerResponseSummary).toMatchObject({
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSynced: false,
      autoSyncAttempted: true,
      autoSyncSucceeded: false,
      autoSyncSkippedReason: 'Shopify fulfillment order data is missing; cannot sync tracking automatically.',
    });
  });

  it('preserves vendor isolation when creating shipments', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
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

  it('reports passive provider diagnostics for Navlungo and Try OTO', () => {
    const navlungoDiagnostics = getShippingProviderGateDiagnostics(env, 'navlungo');
    const tryOtoDiagnostics = getShippingProviderGateDiagnostics(env, 'try_oto');

    expect(navlungoDiagnostics).toMatchObject({
      provider: 'navlungo',
      supportedProviders: ['kargonomi'],
      executionReady: false,
      providerEnabled: false,
      missing: ['inactive_shipping_provider'],
      warnings: ['Navlungo is passive. Kargonomi is the only active shipping provider.'],
    });
    expect(tryOtoDiagnostics).toMatchObject({
      provider: 'try_oto',
      supportedProviders: ['kargonomi'],
      executionReady: false,
      providerEnabled: false,
      webhookIngestEnabled: false,
      missing: ['inactive_shipping_provider'],
      warnings: ['Try OTO is passive. Kargonomi is the only active shipping provider.'],
    });
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

	  it('merges partial Navlungo shipping config metadata without wiping sender details', async () => {
    const existingConfig = {
      id: 'shipping-config-sporjinal',
      vendorId: 'sporjinal',
      preferredProvider: 'NAVLUNGO',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: 18,
      providerMetadata: buildNavlungoProviderMetadata({
        navlungoSenderAddressId: '55574',
        navlungoSenderName: 'Stored sender',
        navlungoSenderCity: 'Istanbul',
        navlungoReturnRecipientAddressId: '77701',
      }),
      warehouses: [],
      updatedAt: new Date('2026-05-22T09:00:00.000Z'),
    };
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(existingConfig);
    prismaMock.vendorShippingConfig.upsert.mockResolvedValue(existingConfig);
    prismaMock.vendorShippingConfig.findUniqueOrThrow.mockResolvedValue({
      ...existingConfig,
      providerMetadata: {
        ...existingConfig.providerMetadata,
        navlungoCarrierId: '10',
      },
      updatedAt: new Date('2026-05-22T09:05:00.000Z'),
    });

    const result = await upsertVendorShippingConfig('sporjinal', {
      preferredProvider: 'navlungo',
      defaultDesi: 3,
      providerMetadata: {
        navlungoCarrierId: '10',
      },
      warehouses: [],
    });

    expect(prismaMock.vendorShippingConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        providerMetadata: expect.objectContaining({
          navlungoSenderAddressId: '55574',
          navlungoSenderName: 'Stored sender',
          navlungoSenderCity: 'Istanbul',
          navlungoReturnRecipientAddressId: '77701',
          navlungoCarrierId: '10',
        }),
      }),
    }));
    expect(result.providerMetadata).toMatchObject({
      navlungoSenderName: 'Stored sender',
      navlungoReturnRecipientAddressId: '77701',
      navlungoCarrierId: '10',
    });
  });

  it('preserves synced Kargonomi warehouse details when saving config without address metadata', async () => {
    const syncedMetadata = {
      legacy: 'kept',
      contactName: 'Sporjinal Depo',
      phone: '+902121112233',
      stateName: 'Konya',
      cityName: 'Selçuklu',
      stateId: '42',
      cityId: '796',
      lookupStatus: 'resolved',
      lookupError: null,
      kargonomiWarehouseSyncedAt: '2026-06-08T11:35:43.443Z',
    };
    const existingConfig = {
      id: 'shipping-config-sporjinal',
      vendorId: 'sporjinal',
      preferredProvider: 'KARGONOMI',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '112666',
      shippingVatPercent: 18,
      providerMetadata: {},
      warehouses: [
        {
          id: 'warehouse-stale-default',
          vendorId: 'sporjinal',
          configId: 'shipping-config-sporjinal',
          provider: 'KARGONOMI',
          warehouseId: '112668',
          name: 'Old default warehouse',
          address: null,
          metadata: null,
          isDefault: true,
          createdAt: new Date('2026-06-08T11:00:00.000Z'),
          updatedAt: new Date('2026-06-08T11:00:00.000Z'),
        },
        {
          id: 'warehouse-synced-default',
          vendorId: 'sporjinal',
          configId: 'shipping-config-sporjinal',
          provider: 'KARGONOMI',
          warehouseId: '112666',
          name: 'Sporjinal',
          address: 'Synced warehouse address',
          metadata: syncedMetadata,
          isDefault: true,
          createdAt: new Date('2026-06-08T11:05:00.000Z'),
          updatedAt: new Date('2026-06-08T11:35:43.443Z'),
        },
      ],
      updatedAt: new Date('2026-06-08T11:35:54.540Z'),
    };
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(existingConfig);
    prismaMock.vendorShippingConfig.upsert.mockResolvedValue(existingConfig);
    prismaMock.vendorShippingConfig.findUniqueOrThrow.mockResolvedValue({
      ...existingConfig,
      warehouses: existingConfig.warehouses.map((warehouse) => ({
        ...warehouse,
        isDefault: warehouse.warehouseId === '112666',
      })),
    });

    await upsertVendorShippingConfig('sporjinal', {
      preferredProvider: 'kargonomi',
      defaultDesi: 3,
      defaultWarehouseId: '112666',
      warehouses: [
        {
          warehouseId: '112666',
          name: null,
          address: null,
          isDefault: true,
          provider: 'kargonomi',
        },
      ],
    });

    expect(prismaMock.vendorShippingWarehouse.updateMany).toHaveBeenCalledWith({
      where: {
        vendorId: 'sporjinal',
        provider: 'KARGONOMI',
      },
      data: {
        isDefault: false,
      },
    });
    expect(prismaMock.vendorShippingWarehouse.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vendorId_provider_warehouseId: {
          vendorId: 'sporjinal',
          provider: 'KARGONOMI',
          warehouseId: '112666',
        },
      },
      update: expect.objectContaining({
        name: 'Sporjinal',
        address: 'Synced warehouse address',
        isDefault: true,
      }),
    }));
    const upsertCall = prismaMock.vendorShippingWarehouse.upsert.mock.calls.at(-1)?.[0];
    expect(upsertCall?.update).not.toHaveProperty('metadata');
  });

  it('rejects retired Try OTO status refresh before any provider call', async () => {
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(
      buildShipmentExecution({ id: 'shipment-try-oto-retired', provider: 'TRY_OTO' }),
    );
    const adapter = buildAdapter({ provider: 'TRY_OTO' as const });
    await expect(refreshShipmentExecutionStatus('shipment-try-oto-retired', {
      env, vendorId: 'sporjinal', adapter,
    })).rejects.toThrow('Try OTO is retired');
    expect(adapter.getShipmentStatus).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('cannot construct a retired Try OTO client while preserving Kargonomi selection', () => {
    expect(() => createShippingProviderAdapter(env, 'try_oto')).toThrow('Try OTO is retired');
    expect(createShippingProviderAdapter(env, 'kargonomi').provider).toBe('KARGONOMI');
  });

  it('does not register retired provider webhooks or probes', () => {
    const app = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    registerShippingExecutionRoutes(app as never, env);
    const paths = app.post.mock.calls.map(([path]) => path);
    expect(paths).not.toContain('/webhooks/try-oto');
    expect(paths.some((path) => /try-oto|lidio|odoo/.test(path))).toBe(false);
    expect(paths).not.toContain('/admin/shipments/:id/probe-shopify-return-label');
    expect(paths).toContain('/shipments/create');
    expect(paths).toContain('/shipments/:id/refresh-provider-data');
  });

  it.each(['/shipments/:id/refresh', '/shipments/:id/create-return', '/shipments/:id/cancel'])(
    'keeps %s as a rejection-only compatibility endpoint', async (path) => {
      const app = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
      registerShippingExecutionRoutes(app as never, env);
      const handler = app.post.mock.calls.find(([registered]) => registered === path)?.at(-1);
      expect(handler).toBeTypeOf('function');
      const reply = { code: vi.fn(), send: vi.fn() };
      reply.code.mockReturnValue(reply);
      await handler({ vendorContext: { vendorId: 'sporjinal' } }, reply);
      expect(reply.code).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        code: 'inactive_shipping_provider', activeProvider: 'kargonomi',
      }));
      expect(prismaMock.shipmentExecution.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    },
  );

  it('rejects retired Navlungo status refresh before any provider call', async () => {
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(
      buildShipmentExecution({ id: 'shipment-navlungo-alloc-1', provider: 'NAVLUNGO' }),
    );
    const adapter = buildAdapter({ provider: 'NAVLUNGO' as const });
    await expect(refreshShipmentExecutionStatus('shipment-navlungo-alloc-1', {
      env, vendorId: 'sporjinal', adapter,
    })).rejects.toThrow('Navlungo is retired');
    expect(adapter.getShipmentStatus).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('cannot construct a retired Navlungo client while preserving Kargonomi selection', () => {
    expect(() => createShippingProviderAdapter(env, 'navlungo')).toThrow('Navlungo is retired');
    expect(createShippingProviderAdapter(env, 'kargonomi').provider).toBe('KARGONOMI');
  });

  it('does not register a Navlungo shipment update route', () => {
    const app = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    registerShippingExecutionRoutes(app as never, env);
    expect(app.post.mock.calls.map(([path]) => path)).not.toContain('/shipments/:id/update-navlungo');
  });
});
