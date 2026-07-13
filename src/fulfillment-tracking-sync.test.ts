import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  fulfillment: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const shopifyAdminMock = vi.hoisted(() => ({
  fetchFulfillmentOrders: vi.fn(),
  createFulfillmentTracking: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: () => shopifyAdminMock,
}));

const { createFulfillmentService } = await import('../backend/src/modules/fulfillments/fulfillment.service.js');

const env = {
  NODE_ENV: 'test' as const,
  PORT: 4000,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
  CORS_ORIGIN: ['http://localhost:5173'],
  JWT_SECRET: 'test',
  JWT_EXPIRES_IN: '12h',
  SHOPIFY_WEBHOOK_SECRET: 'test',
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_SHOP_DOMAIN: 'demo.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
  SCHEDULED_RECONCILIATION_ENABLED: false,
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
  SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
  SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
  SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
  EMAIL_NOTIFICATIONS_ENABLED: false,
  EMAIL_PROVIDER: 'noop' as const,
  EMAIL_ADMIN_RECIPIENTS: [],
  SHIPPING_EXECUTION_ENABLED: false,
  SHIPPING_SANDBOX_MODE: false,
  SHIPPING_PROVIDER: 'hepsijet' as const,
  KARGO_ENTEGRATOR_ENABLED: false,
  KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
  TRY_OTO_ENABLED: false,
  TRY_OTO_SANDBOX_MODE: false,
  TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
};

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-sporjinal-1039',
    assignedVendorId: 'sporjinal',
    allocationStatus: 'ACTIVE',
    cancellationReason: null,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    order: {
      sourceShopifyOrderId: 'gid://shopify/Order/1039',
    },
    fulfillment: null,
    lineItems: [
      {
        shopifyOrderLineItem: {
          sourceLineItemId: 'gid://shopify/LineItem/20346971095377',
        },
      },
    ],
    ...overrides,
  };
}

function buildRequest(body: { trackingNumber?: string; carrier?: string; trackingUrl?: string | null; notifyCustomer?: boolean } = {}) {
  return {
    allocationId: 'alloc-sporjinal-1039',
    body: {
      trackingNumber: 'OTO-TRACK-1039',
      carrier: 'Sürat Kargo',
      trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1039',
      notifyCustomer: false,
      ...body,
    },
    authUser: {
      id: 'vendor-user',
      email: 'vendor@example.com',
      role: 'vendor' as const,
    },
    vendorContext: {
      vendorId: 'sporjinal',
      role: 'vendor' as const,
      allowedVendorIds: ['sporjinal'],
    },
  };
}

describe('fulfillment tracking sync', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findUnique.mockReset();
    prismaMock.vendorAllocation.update.mockReset();
    prismaMock.fulfillment.upsert.mockReset();
    prismaMock.$transaction.mockReset();
    shopifyAdminMock.fetchFulfillmentOrders.mockReset();
    shopifyAdminMock.createFulfillmentTracking.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    shopifyAdminMock.fetchFulfillmentOrders.mockResolvedValue({
      fulfillmentOrders: [
        {
          id: 'gid://shopify/FulfillmentOrder/fo-1039',
          status: 'OPEN',
          lineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/foli-1039',
              lineItemId: 'gid://shopify/LineItem/20346971095377',
              quantity: 1,
            },
          ],
        },
      ],
    });
    shopifyAdminMock.createFulfillmentTracking.mockResolvedValue({
      fulfillmentId: 'gid://shopify/Fulfillment/fulfillment-1039',
      status: 'submitted',
      source: 'shopify_admin',
      fulfillmentCreated: true,
      skippedReason: null,
      fulfillmentOrderIdPresent: true,
      fulfillmentIdPresent: true,
    });
  });

  it('blocks tracking mutation from canonical cancellation metadata alone', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      allocationStatus: 'ACTIVE',
      cancellationReason: null,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      order: {
        sourceShopifyOrderId: 'gid://shopify/Order/1039',
        cancelledAt: new Date('2026-07-11T20:23:00.000Z'),
      },
    }));
    const service = createFulfillmentService(env);

    await expect(service.updateAllocationTracking(buildRequest())).resolves.toEqual({
      ok: false,
      code: 409,
      message: 'Full Shopify order cancellation blocks this operation.',
    });
    expect(shopifyAdminMock.fetchFulfillmentOrders).not.toHaveBeenCalled();
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
  });

  it('builds line-item scoped Shopify tracking payload from allocation data', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation());
    const service = createFulfillmentService(env);

    const result = await service.updateAllocationTracking(buildRequest());

    expect(result.ok).toBe(true);
    expect(shopifyAdminMock.createFulfillmentTracking).toHaveBeenCalledWith({
      allocationId: 'alloc-sporjinal-1039',
      shopifyOrderId: 'gid://shopify/Order/1039',
      trackingNumber: 'OTO-TRACK-1039',
      carrier: 'Sürat Kargo',
      trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1039',
      notifyCustomer: false,
      lineItemsByFulfillmentOrder: [
        {
          fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/fo-1039',
          fulfillmentOrderLineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/foli-1039',
              quantity: 1,
            },
          ],
        },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      shopifyFulfillmentCreated: true,
      shopifyFulfillmentSkippedReason: null,
      shopifyFulfillmentOrderIdPresent: true,
      shopifyFulfillmentIdPresent: true,
      shopifyFulfillmentOrderLookupAttempted: true,
      shopifyFulfillmentOrderLookupSuccess: true,
      shopifyFulfillmentOrderCount: 1,
      shopifySelectedFulfillmentOrderIdPresent: true,
    });
  });

  it('matches Shopify fulfillment order line items across GID and numeric identifier formats', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation());
    shopifyAdminMock.fetchFulfillmentOrders.mockResolvedValue({
      fulfillmentOrders: [
        {
          id: '753159',
          status: 'OPEN',
          lineItems: [
            {
              id: '951357',
              lineItemId: '20346971095377',
              quantity: 1,
            },
          ],
        },
      ],
    });
    const service = createFulfillmentService(env);

    const result = await service.updateAllocationTracking(buildRequest());

    expect(result.ok).toBe(true);
    expect(shopifyAdminMock.createFulfillmentTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId: '753159',
            fulfillmentOrderLineItems: [
              {
                id: '951357',
                quantity: 1,
              },
            ],
          },
        ],
      }),
    );
  });

  it('blocks safely when Shopify fulfillment order data is missing', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation());
    shopifyAdminMock.fetchFulfillmentOrders.mockResolvedValue({ fulfillmentOrders: [] });
    const service = createFulfillmentService(env);

    const result = await service.updateAllocationTracking(buildRequest());

    expect(result).toEqual({
      ok: false,
      code: 502,
      message: 'Shopify fulfillment order data is missing; cannot sync tracking automatically.',
    });
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
  });

  it('does not create a fulfillment from a non-open Shopify fulfillment order', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation());
    shopifyAdminMock.fetchFulfillmentOrders.mockResolvedValue({
      fulfillmentOrders: [
        {
          id: 'gid://shopify/FulfillmentOrder/closed-1039',
          status: 'CLOSED',
          lineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/closed-line-1039',
              lineItemId: 'gid://shopify/LineItem/20346971095377',
              quantity: 1,
            },
          ],
        },
      ],
    });
    const service = createFulfillmentService(env);

    const result = await service.updateAllocationTracking(buildRequest());

    expect(result).toEqual({
      ok: false,
      code: 502,
      message: 'Shopify fulfillment order data is missing; cannot sync tracking automatically.',
    });
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
  });

  it('does not create a duplicate Shopify fulfillment when matching sync already exists', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        shippingStatus: 'shipped',
        fulfillment: {
          fulfillmentStatus: 'fulfillment_submitted',
          trackingNumber: 'OTO-TRACK-1039',
          carrier: 'Sürat Kargo',
          trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1039',
          notifyCustomer: false,
          shopifyFulfillmentId: 'gid://shopify/Fulfillment/existing-1039',
          fulfilledAt: new Date('2026-05-18T10:00:00.000Z'),
          shipmentCreatedAt: new Date('2026-05-18T09:55:00.000Z'),
          shipmentUpdatedAt: new Date('2026-05-18T10:00:00.000Z'),
        },
      }),
    );
    const service = createFulfillmentService(env);

    const result = await service.updateAllocationTracking(buildRequest());

    expect(result).toMatchObject({
      ok: true,
      shopifyFulfillmentCreated: false,
      shopifyFulfillmentSkippedReason: 'already_synced',
      shopifyFulfillmentOrderIdPresent: false,
      shopifyFulfillmentIdPresent: true,
    });
    expect(shopifyAdminMock.fetchFulfillmentOrders).not.toHaveBeenCalled();
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
  });

  it('does not duplicate Shopify fulfillment when existing tracking differs', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        fulfillment: {
          fulfillmentStatus: 'fulfillment_submitted',
          trackingNumber: 'DIFFERENT',
          carrier: 'Sürat Kargo',
          trackingUrl: null,
          notifyCustomer: false,
          shopifyFulfillmentId: 'gid://shopify/Fulfillment/existing-1039',
          fulfilledAt: new Date('2026-05-18T10:00:00.000Z'),
          shipmentCreatedAt: new Date('2026-05-18T09:55:00.000Z'),
          shipmentUpdatedAt: new Date('2026-05-18T10:00:00.000Z'),
        },
      }),
    );
    const service = createFulfillmentService(env);

    const result = await service.updateAllocationTracking(buildRequest());

    expect(result).toEqual({
      ok: false,
      code: 409,
      message: 'Shopify fulfillment already exists for this allocation; tracking sync was not duplicated.',
    });
    expect(shopifyAdminMock.createFulfillmentTracking).not.toHaveBeenCalled();
  });

  it('does not report success when Shopify creation response has no fulfillment id', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation());
    shopifyAdminMock.createFulfillmentTracking.mockResolvedValue({
      fulfillmentId: '',
      status: 'submitted',
      source: 'shopify_admin',
      fulfillmentCreated: true,
      skippedReason: null,
      fulfillmentOrderIdPresent: true,
      fulfillmentIdPresent: false,
    });
    const service = createFulfillmentService(env);

    const result = await service.updateAllocationTracking(buildRequest());

    expect(result).toEqual({
      ok: false,
      code: 502,
      message: 'Shopify fulfillment creation response did not include a fulfillment id.',
    });
    expect(prismaMock.fulfillment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          fulfillmentStatus: 'fulfillment_sync_failed',
          shopifyFulfillmentOrderId: 'gid://shopify/FulfillmentOrder/fo-1039',
          errorMessage: 'Shopify fulfillment creation response did not include a fulfillment id.',
        }),
      }),
    );
  });
});
