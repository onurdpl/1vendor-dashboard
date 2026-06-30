import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findUnique: vi.fn(),
  },
  vendorIntegrationClient: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorIntegrationAuditLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  vendorAllocation: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  vendorIntegrationStatusEvent: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  vendorIntegrationShipmentEvent: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  vendorIntegrationInvoiceEvent: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { hashVendorIntegrationToken, createVendorIntegrationClientToken } = await import(
  '../backend/src/modules/vendor-integration/vendor-integration.tokens.js'
);
const { registerVendorIntegrationRoutes } = await import(
  '../backend/src/modules/vendor-integration/vendor-integration.routes.js'
);
const { resetVendorIntegrationRateLimitForTests } = await import(
  '../backend/src/modules/vendor-integration/vendor-integration.rate-limit.js'
);

function buildClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    vendorIdentifier: 'sporjinal',
    providerName: 'Provider A',
    enabled: true,
    scopes: ['orders:read'],
    revokedAt: null,
    ...overrides,
  };
}

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-sporjinal-1',
    sourceShopifyOrderNumber: '#1001',
    originalVendorId: 'sporjinal',
    assignedVendorId: 'sporjinal',
    allocationStatus: 'ACTIVE',
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    vendorIntegrationTrackingUrl: null,
    vendorIntegrationShippedAt: null,
    vendorIntegrationStatus: 'acknowledged',
    vendorIntegrationStatusMessage: 'Order imported into Entegra',
    vendorIntegrationStatusUpdatedAt: new Date('2026-05-31T10:06:00.000Z'),
    vendorIntegrationProvider: 'Provider A',
    vendorInvoiceNumber: null,
    vendorInvoiceDate: null,
    vendorInvoiceUrl: null,
    vendorInvoiceAmount: null,
    vendorInvoiceReceivedAt: null,
    createdAt: new Date('2026-05-31T10:00:00.000Z'),
    updatedAt: new Date('2026-05-31T10:05:00.000Z'),
    order: {
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      sourceShopifyOrderNumber: '#1001',
      shopifyCreatedAt: new Date('2026-05-31T09:55:00.000Z'),
      currency: 'TRY',
      financialStatus: 'paid',
      paymentGatewayName: 'PayTR Marketplace',
      taxesIncluded: true,
      orderTaxAmount: '118.17',
      shippingAmount: '29.90',
      discountAmount: '15.50',
      orderNote: 'Provider note',
      orderTags: ['entegrasyon'],
      customerName: 'Test Customer',
      customerEmail: 'customer@example.test',
      customerPhone: '+900000000000',
      billingFullName: 'Billing Customer',
      billingCompany: 'Billing Co',
      billingPhone: '+900000000001',
      billingCity: 'Istanbul',
      billingDistrict: 'Besiktas',
      billingAddress1: 'Billing address 1',
      billingAddress2: 'Floor 2',
      billingPostcode: '34330',
      shippingCountry: 'TR',
      shippingPostcode: '34000',
      shippingCity: 'Istanbul',
      shippingDistrict: 'Kadikoy',
      shippingAddress: 'Test address',
      totalPrice: '1299.90',
    },
    fulfillment: null,
    lineItems: [
      {
        id: 'allocation-line-1',
        quantity: 1,
        lineAmount: '1299.90',
        shopifyOrderLineItem: {
          sourceLineItemId: 'gid://shopify/LineItem/1',
          shopifyProductId: 'gid://shopify/Product/1',
          sourceVariantId: 'gid://shopify/ProductVariant/1',
          sku: 'SKU-1',
          title: 'Test Product',
          imageUrl: null,
          unitPrice: '1299.90',
          unitPriceVatIncluded: '1299.90',
          lineTotalVatIncluded: '1299.90',
          lineTaxAmount: '118.17',
          vatRate: '10',
        },
      },
    ],
    ...overrides,
  };
}

function createRegisteredRoutes() {
  const hooks = new Map<string, (request: Record<string, unknown>, reply: { statusCode: number }) => Promise<void>>();
  const gets = new Map<string, {
    options?: { preHandler: Array<(request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>> };
    handler?: (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>;
  }>();
  const posts = new Map<string, {
    options?: { preHandler: Array<(request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>> };
    handler?: (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>;
  }>();
  const app = {
    log: {
      info: vi.fn(),
    },
    addHook: vi.fn((name: string, handler: (request: Record<string, unknown>, reply: { statusCode: number }) => Promise<void>) => {
      hooks.set(name, handler);
    }),
    get: vi.fn((path: string, options: { preHandler?: Array<(request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>> } | ((request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>), handler?: (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>) => {
      gets.set(path, typeof options === 'function' ? { handler: options } : { options: { preHandler: options.preHandler ?? [] }, handler });
    }),
    post: vi.fn((path: string, options: { preHandler?: Array<(request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>> } | ((request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>), handler?: (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>) => {
      posts.set(path, typeof options === 'function' ? { handler: options } : { options: { preHandler: options.preHandler ?? [] }, handler });
    }),
  };

  registerVendorIntegrationRoutes(app as never);

  return { gets, posts, hooks, app };
}

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    sent: false,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      reply.sent = true;
      return payload;
    }),
  };

  return reply;
}

const adminUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  role: 'admin',
};

async function injectVendorIntegrationOrders(
  headers: Record<string, string>,
  query: Record<string, unknown> = {},
  options: { ip?: string } = {},
) {
  const { gets, hooks } = createRegisteredRoutes();
  const route = gets.get('/api/vendor-integration/orders');
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers,
    method: 'GET',
    url: '/api/vendor-integration/orders',
    id: 'req-1',
    query,
    ip: options.ip ?? '127.0.0.1',
  };

  for (const preHandler of route?.options?.preHandler ?? []) {
    await preHandler(request, reply);
    if (reply.sent) {
      await hooks.get('onResponse')?.(request, reply);
      return { statusCode: reply.statusCode, payload: reply.payload, request };
    }
  }

  const result = await route?.handler?.(request, reply);
  const payload = reply.sent ? reply.payload : result;
  await hooks.get('onResponse')?.(request, reply);

  return { statusCode: reply.statusCode, payload, request };
}

async function injectVendorIntegrationStatus(
  allocationId: string,
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
) {
  const { posts, hooks } = createRegisteredRoutes();
  const route = posts.get('/api/vendor-integration/orders/:allocationId/status');
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers,
    method: 'POST',
    url: `/api/vendor-integration/orders/${allocationId}/status`,
    id: 'status-req-1',
    params: { allocationId },
    body,
  };

  for (const preHandler of route?.options?.preHandler ?? []) {
    await preHandler(request, reply);
    if (reply.sent) {
      await hooks.get('onResponse')?.(request, reply);
      return { statusCode: reply.statusCode, payload: reply.payload, request };
    }
  }

  const result = await route?.handler?.(request, reply);
  const payload = reply.sent ? reply.payload : result;
  await hooks.get('onResponse')?.(request, reply);

  return { statusCode: reply.statusCode, payload, request };
}

async function injectVendorIntegrationShipment(
  allocationId: string,
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
) {
  const { posts, hooks } = createRegisteredRoutes();
  const route = posts.get('/api/vendor-integration/orders/:allocationId/shipment');
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers,
    method: 'POST',
    url: `/api/vendor-integration/orders/${allocationId}/shipment`,
    id: 'shipment-req-1',
    params: { allocationId },
    body,
  };

  for (const preHandler of route?.options?.preHandler ?? []) {
    await preHandler(request, reply);
    if (reply.sent) {
      await hooks.get('onResponse')?.(request, reply);
      return { statusCode: reply.statusCode, payload: reply.payload, request };
    }
  }

  const result = await route?.handler?.(request, reply);
  const payload = reply.sent ? reply.payload : result;
  await hooks.get('onResponse')?.(request, reply);

  return { statusCode: reply.statusCode, payload, request };
}

async function injectVendorIntegrationInvoice(
  allocationId: string,
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
) {
  const { posts, hooks } = createRegisteredRoutes();
  const route = posts.get('/api/vendor-integration/orders/:allocationId/invoice');
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers,
    method: 'POST',
    url: `/api/vendor-integration/orders/${allocationId}/invoice`,
    id: 'invoice-req-1',
    params: { allocationId },
    body,
  };

  for (const preHandler of route?.options?.preHandler ?? []) {
    await preHandler(request, reply);
    if (reply.sent) {
      await hooks.get('onResponse')?.(request, reply);
      return { statusCode: reply.statusCode, payload: reply.payload, request };
    }
  }

  const result = await route?.handler?.(request, reply);
  const payload = reply.sent ? reply.payload : result;
  await hooks.get('onResponse')?.(request, reply);

  return { statusCode: reply.statusCode, payload, request };
}

async function injectAdminRoute(
  method: 'GET' | 'POST',
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
    params?: Record<string, string>;
    authUser?: Record<string, unknown>;
  } = {},
) {
  const registered = createRegisteredRoutes();
  const route = method === 'GET' ? registered.gets.get(path) : registered.posts.get(path);
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers: options.headers ?? {},
    method,
    url: path,
    id: 'admin-req-1',
    body: options.body,
    query: options.query ?? {},
    params: options.params ?? {},
    authUser: options.authUser,
  };

  for (const preHandler of route?.options?.preHandler ?? []) {
    await preHandler(request, reply);
    if (reply.sent) {
      return {
        statusCode: reply.statusCode,
        payload: reply.payload,
        app: registered.app,
      };
    }
  }

  const result = await route?.handler?.(request, reply);
  return {
    statusCode: reply.statusCode,
    payload: reply.sent ? reply.payload : result,
    app: registered.app,
  };
}

describe('vendor integration API foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVendorIntegrationRateLimitForTests();
    delete process.env.VENDOR_INTEGRATION_RATE_LIMIT_PER_MINUTE;
    prismaMock.vendor.findUnique.mockResolvedValue({ id: 'sporjinal', status: 'active' });
    prismaMock.vendorIntegrationClient.findMany.mockResolvedValue([]);
    prismaMock.vendorIntegrationClient.update.mockResolvedValue({ id: 'client-1' });
    prismaMock.vendorIntegrationAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.vendorIntegrationAuditLog.findMany.mockResolvedValue([]);
    prismaMock.vendorAllocation.findMany.mockResolvedValue([buildAllocation()]);
    prismaMock.vendorAllocation.findFirst.mockResolvedValue({
      id: 'alloc-sporjinal-1',
      assignedVendorId: 'sporjinal',
    });
    prismaMock.vendorAllocation.update.mockResolvedValue({
      id: 'alloc-sporjinal-1',
      assignedVendorId: 'sporjinal',
      vendorIntegrationStatus: 'acknowledged',
      vendorIntegrationStatusMessage: 'Order imported into Entegra',
      vendorIntegrationStatusUpdatedAt: new Date('2026-05-31T10:06:00.000Z'),
      vendorIntegrationProvider: 'Provider A',
      lastVendorIntegrationRequestId: 'status-req-1',
    });
    prismaMock.vendorIntegrationStatusEvent.create.mockResolvedValue({ id: 'status-event-1' });
    prismaMock.vendorIntegrationStatusEvent.findUnique.mockResolvedValue(null);
    prismaMock.vendorIntegrationShipmentEvent.create.mockResolvedValue({ id: 'shipment-event-1' });
    prismaMock.vendorIntegrationShipmentEvent.findUnique.mockResolvedValue(null);
    prismaMock.vendorIntegrationInvoiceEvent.create.mockResolvedValue({ id: 'invoice-event-1' });
    prismaMock.vendorIntegrationInvoiceEvent.findUnique.mockResolvedValue(null);
    process.env.ADMIN_PROBE_TOKEN = 'admin-test-token';
  });

  it('allows requests under the configured vendor integration rate limit', async () => {
    process.env.VENDOR_INTEGRATION_RATE_LIMIT_PER_MINUTE = '2';
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValue(buildClient());

    const first = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' });
    const second = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns 429 when a vendor integration client exceeds the configured rate limit', async () => {
    process.env.VENDOR_INTEGRATION_RATE_LIMIT_PER_MINUTE = '1';
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValue(buildClient());

    const first = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' });
    const second = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.payload).toEqual({ message: 'Rate limit exceeded.' });
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps separate rate limit buckets for separate vendor integration clients', async () => {
    process.env.VENDOR_INTEGRATION_RATE_LIMIT_PER_MINUTE = '1';
    prismaMock.vendorIntegrationClient.findUnique
      .mockResolvedValueOnce(buildClient({ id: 'client-1' }))
      .mockResolvedValueOnce(buildClient({ id: 'client-2', vendorIdentifier: 'yalispor' }));

    const first = await injectVendorIntegrationOrders({ authorization: 'Bearer first-token' });
    const second = await injectVendorIntegrationOrders({ authorization: 'Bearer second-token' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { assignedVendorId: 'sporjinal' },
      }),
    );
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { assignedVendorId: 'yalispor' },
      }),
    );
  });

  it('rate limits invalid token attempts by IP without logging bearer tokens', async () => {
    process.env.VENDOR_INTEGRATION_RATE_LIMIT_PER_MINUTE = '1';
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValue(null);

    const first = await injectVendorIntegrationOrders({ authorization: 'Bearer invalid-token-one' }, {}, { ip: '203.0.113.10' });
    const second = await injectVendorIntegrationOrders({ authorization: 'Bearer invalid-token-two' }, {}, { ip: '203.0.113.10' });

    expect(first.statusCode).toBe(401);
    expect(first.payload).toEqual({ message: 'Vendor integration token is invalid.' });
    expect(second.statusCode).toBe(429);
    expect(second.payload).toEqual({ message: 'Rate limit exceeded.' });
    expect(prismaMock.vendorIntegrationAuditLog.create).not.toHaveBeenCalled();
    expect(JSON.stringify(prismaMock.vendorIntegrationAuditLog.create.mock.calls)).not.toContain('invalid-token');
  });

  it('rejects invalid tokens', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(null);

    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer invalid-token' });

    expect(response.statusCode).toBe(401);
    expect(response.payload).toEqual({ message: 'Vendor integration token is invalid.' });
    expect(prismaMock.vendorAllocation.findMany).not.toHaveBeenCalled();
  });

  it('rejects revoked tokens', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ revokedAt: new Date() }));

    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer revoked-token' });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Vendor integration token is disabled or revoked.' });
    expect(prismaMock.vendorAllocation.findMany).not.toHaveBeenCalled();
  });

  it('rejects clients without orders read scope and writes an audit log', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: [] }));

    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer scoped-token' });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Missing required scope: orders:read' });
    expect(prismaMock.vendorIntegrationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          vendorIdentifier: 'sporjinal',
          method: 'GET',
          statusCode: 403,
          requestId: 'req-1',
        }),
      }),
    );
  });

  it('returns only allocations for the authenticated vendor', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());

    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' }, { limit: '25' });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedVendorId: 'sporjinal',
        },
        take: 26,
      }),
    );
    expect(response.payload).toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: 'alloc-sporjinal-1',
            vendorIdentifier: 'sporjinal',
            shopifyOrderNumber: '#1001',
            shopifyCreatedAt: '2026-05-31T09:55:00.000Z',
            vendorIntegrationStatus: 'acknowledged',
            vendorIntegrationStatusMessage: 'Order imported into Entegra',
            vendorIntegrationStatusUpdatedAt: '2026-05-31T10:06:00.000Z',
            vendorIntegrationProvider: 'Provider A',
            financial: expect.objectContaining({
              currency: 'TRY',
              financialStatus: 'paid',
              paymentGatewayName: 'PayTR Marketplace',
              taxesIncluded: true,
              orderTaxAmount: '118.17',
              shippingAmount: '29.90',
              discountAmount: '15.50',
            }),
            billingAddress: expect.objectContaining({
              fullName: 'Billing Customer',
              district: 'Besiktas',
            }),
            orderNote: 'Provider note',
            orderTags: ['entegrasyon'],
            shipment: expect.objectContaining({
              carrier: null,
              trackingNumber: null,
              trackingUrl: null,
              externalShippedAt: null,
            }),
            lineItems: [
              expect.objectContaining({
                sku: 'SKU-1',
                shopifyProductId: 'gid://shopify/Product/1',
                unitPriceVatIncluded: '1299.90',
                lineTotalVatIncluded: '1299.90',
                lineTaxAmount: '118.17',
                vatRate: '10',
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('keeps the existing first-page response when cursor is missing', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());

    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' }, { limit: '25' });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedVendorId: 'sporjinal' },
        take: 26,
      }),
    );
    expect(prismaMock.vendorAllocation.findMany.mock.calls[0]?.[0]).not.toHaveProperty('cursor');
    expect(response.payload).toEqual(
      expect.objectContaining({
        pagination: expect.objectContaining({ limit: 25 }),
      }),
    );
  });

  it('passes a valid cursor through to Prisma pagination unchanged', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());

    const response = await injectVendorIntegrationOrders(
      { authorization: 'Bearer valid-token' },
      { limit: '25', cursor: 'alloc-sporjinal-1' },
    );

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'alloc-sporjinal-1' },
        skip: 1,
        take: 26,
      }),
    );
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['null', null],
    ['array', ['alloc-sporjinal-1']],
    ['object', { id: 'alloc-sporjinal-1' }],
    ['overlong', 'a'.repeat(129)],
  ])('rejects %s vendor integration orders cursor values', async (_label, cursor) => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());

    const response = await injectVendorIntegrationOrders(
      { authorization: 'Bearer valid-token' },
      { cursor },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Invalid pagination cursor.' });
    expect(prismaMock.vendorAllocation.findMany).not.toHaveBeenCalled();
  });

  it('returns a safe 400 when Prisma rejects an otherwise valid cursor lookup', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());
    prismaMock.vendorAllocation.findMany.mockRejectedValueOnce({
      code: 'P2025',
      message: 'Record for cursor does not exist.',
    });

    const response = await injectVendorIntegrationOrders(
      { authorization: 'Bearer valid-token' },
      { cursor: 'alloc-missing' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Invalid pagination cursor.' });
    expect(JSON.stringify(response.payload)).not.toContain('P2025');
    expect(JSON.stringify(response.payload)).not.toContain('Record for cursor does not exist');
  });

  it('writes audit logs without request or response bodies', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());

    await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' });

    expect(prismaMock.vendorIntegrationAuditLog.create).toHaveBeenCalledWith({
      data: {
        clientId: 'client-1',
        vendorIdentifier: 'sporjinal',
        method: 'GET',
        path: '/api/vendor-integration/orders',
        statusCode: 200,
        requestId: 'req-1',
      },
      select: { id: true },
    });
  });

  it('returns external shipment values in the vendor orders feed', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        shippingStatus: 'In Transit',
        carrier: 'Yurtici Kargo',
        trackingNumber: 'ABC123456',
        vendorIntegrationTrackingUrl: 'https://tracking.example/ABC123456',
        vendorIntegrationShippedAt: new Date('2026-06-02T12:00:00.000Z'),
      }),
    ]);

    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            shippingStatus: 'In Transit',
            shipment: expect.objectContaining({
              carrier: 'Yurtici Kargo',
              trackingNumber: 'ABC123456',
              trackingUrl: 'https://tracking.example/ABC123456',
              shipmentCreatedAt: '2026-06-02T12:00:00.000Z',
              externalShippedAt: '2026-06-02T12:00:00.000Z',
            }),
          }),
        ],
      }),
    );
  });

  it('returns vendor invoice snapshots in the vendor orders feed', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient());
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        vendorInvoiceNumber: 'ABC202600001',
        vendorInvoiceDate: new Date('2026-06-02T00:00:00.000Z'),
        vendorInvoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
        vendorInvoiceAmount: '1299.90',
        vendorInvoiceReceivedAt: new Date('2026-06-02T12:30:00.000Z'),
      }),
    ]);

    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer valid-token' });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            vendorInvoice: {
              invoiceNumber: 'ABC202600001',
              invoiceDate: '2026-06-02',
              invoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
              invoiceAmount: '1299.90',
              receivedAt: '2026-06-02T12:30:00.000Z',
            },
          }),
        ],
      }),
    );
  });

  it('rejects status writes without status write scope and writes an audit log', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['orders:read'] }));

    const response = await injectVendorIntegrationStatus(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer read-token',
        'idempotency-key': 'status-key-1',
      },
      { status: 'acknowledged', message: 'Order imported into Entegra' },
    );

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Missing required scope: status:write' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorIntegrationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          vendorIdentifier: 'sporjinal',
          method: 'POST',
          statusCode: 403,
          requestId: 'status-req-1',
        }),
      }),
    );
  });

  it('rejects status writes without an idempotency key', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['status:write'] }));

    const response = await injectVendorIntegrationStatus(
      'alloc-sporjinal-1',
      { authorization: 'Bearer write-token' },
      { status: 'acknowledged' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Idempotency-Key header is required.' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('blocks vendor integration writes for restricted vendors', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['status:write'] }));
    prismaMock.vendor.findUnique.mockResolvedValueOnce({ id: 'sporjinal', status: 'inactive' });

    const response = await injectVendorIntegrationStatus(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'status-key-1',
      },
      { status: 'acknowledged', message: 'Order imported into Entegra' },
    );

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({
      message: 'Your account is temporarily restricted. Please contact support if you believe this is incorrect.',
    });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects unsupported vendor integration statuses', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['status:write'] }));

    const response = await injectVendorIntegrationStatus(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'status-key-1',
      },
      { status: 'shipped' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Unsupported vendor integration status.' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('prevents vendors from updating another vendor allocation status', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['status:write'] }));
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(null);

    const response = await injectVendorIntegrationStatus(
      'alloc-yalispor-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'status-key-1',
      },
      { status: 'processing' },
    );

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'Vendor allocation not found.' });
    expect(prismaMock.vendorAllocation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'alloc-yalispor-1',
          assignedVendorId: 'sporjinal',
        },
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('updates vendor integration status for the authenticated vendor allocation', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['status:write'] }));

    const response = await injectVendorIntegrationStatus(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'status-key-1',
      },
      { status: 'acknowledged', message: 'Order imported into Entegra' },
    );

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alloc-sporjinal-1' },
        data: expect.objectContaining({
          vendorIntegrationStatus: 'acknowledged',
          vendorIntegrationStatusMessage: 'Order imported into Entegra',
          vendorIntegrationProvider: 'Provider A',
          lastVendorIntegrationRequestId: 'status-req-1',
        }),
      }),
    );
    expect(prismaMock.vendorIntegrationStatusEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          vendorAllocationId: 'alloc-sporjinal-1',
          vendorIdentifier: 'sporjinal',
          status: 'acknowledged',
          idempotencyKey: 'status-key-1',
        }),
      }),
    );
    expect(response.payload).toEqual(
      expect.objectContaining({
        idempotent: false,
        allocation: expect.objectContaining({
          id: 'alloc-sporjinal-1',
          vendorIntegrationStatus: 'acknowledged',
          vendorIntegrationStatusMessage: 'Order imported into Entegra',
        }),
      }),
    );
  });

  it('returns the previous status result for repeated idempotency keys without duplicate events', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['status:write'] }));
    prismaMock.vendorIntegrationStatusEvent.findUnique.mockResolvedValueOnce({
      vendorAllocation: {
        id: 'alloc-sporjinal-1',
        assignedVendorId: 'sporjinal',
        vendorIntegrationStatus: 'processing',
        vendorIntegrationStatusMessage: 'Already processing',
        vendorIntegrationStatusUpdatedAt: new Date('2026-05-31T10:07:00.000Z'),
        vendorIntegrationProvider: 'Provider A',
        lastVendorIntegrationRequestId: 'status-req-1',
      },
    });

    const response = await injectVendorIntegrationStatus(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'status-key-1',
      },
      { status: 'failed', message: 'Should not overwrite' },
    );

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        idempotent: true,
        allocation: expect.objectContaining({
          vendorIntegrationStatus: 'processing',
          vendorIntegrationStatusMessage: 'Already processing',
        }),
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorIntegrationStatusEvent.create).not.toHaveBeenCalled();
  });

  it('rejects shipment writes without shipment write scope and writes an audit log', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['orders:read'] }));

    const response = await injectVendorIntegrationShipment(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer read-token',
        'idempotency-key': 'shipment-key-1',
      },
      { carrier: 'Yurtici Kargo', trackingNumber: 'ABC123456' },
    );

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Missing required scope: shipment:write' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorIntegrationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          vendorIdentifier: 'sporjinal',
          method: 'POST',
          statusCode: 403,
          requestId: 'shipment-req-1',
        }),
      }),
    );
  });

  it('rejects shipment writes without an idempotency key', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['shipment:write'] }));

    const response = await injectVendorIntegrationShipment(
      'alloc-sporjinal-1',
      { authorization: 'Bearer write-token' },
      { carrier: 'Yurtici Kargo', trackingNumber: 'ABC123456' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Idempotency-Key header is required.' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects shipment writes for another vendor allocation', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['shipment:write'] }));
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(null);

    const response = await injectVendorIntegrationShipment(
      'alloc-yalispor-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'shipment-key-1',
      },
      { carrier: 'Yurtici Kargo', trackingNumber: 'ABC123456' },
    );

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'Vendor allocation not found.' });
    expect(prismaMock.vendorAllocation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'alloc-yalispor-1',
          assignedVendorId: 'sporjinal',
        },
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects shipment writes without carrier or tracking number', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValue(buildClient({ scopes: ['shipment:write'] }));

    const missingCarrier = await injectVendorIntegrationShipment(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'shipment-key-1',
      },
      { trackingNumber: 'ABC123456' },
    );
    const missingTracking = await injectVendorIntegrationShipment(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'shipment-key-2',
      },
      { carrier: 'Yurtici Kargo' },
    );

    expect(missingCarrier.statusCode).toBe(400);
    expect(missingCarrier.payload).toEqual({ message: 'carrier is required.' });
    expect(missingTracking.statusCode).toBe(400);
    expect(missingTracking.payload).toEqual({ message: 'trackingNumber is required.' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('updates shipment fields for the authenticated vendor allocation without Shopify fulfillment mutation', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['shipment:write'] }));
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({
      id: 'alloc-sporjinal-1',
      assignedVendorId: 'sporjinal',
      carrier: 'Yurtici Kargo',
      trackingNumber: 'ABC123456',
      vendorIntegrationTrackingUrl: 'https://tracking.example/ABC123456',
      vendorIntegrationShippedAt: new Date('2026-06-02T12:00:00.000Z'),
      shippingStatus: 'In Transit',
      lastVendorIntegrationShipmentRequestId: 'shipment-req-1',
    });

    const response = await injectVendorIntegrationShipment(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'shipment-key-1',
      },
      {
        carrier: 'Yurtici Kargo',
        trackingNumber: 'ABC123456',
        trackingUrl: 'https://tracking.example/ABC123456',
        shippedAt: '2026-06-02T12:00:00Z',
      },
    );

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alloc-sporjinal-1' },
        data: expect.objectContaining({
          carrier: 'Yurtici Kargo',
          trackingNumber: 'ABC123456',
          vendorIntegrationTrackingUrl: 'https://tracking.example/ABC123456',
          vendorIntegrationShippedAt: new Date('2026-06-02T12:00:00.000Z'),
          shippingStatus: 'In Transit',
          lastVendorIntegrationShipmentRequestId: 'shipment-req-1',
        }),
      }),
    );
    expect(prismaMock.vendorIntegrationShipmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          vendorAllocationId: 'alloc-sporjinal-1',
          vendorIdentifier: 'sporjinal',
          carrier: 'Yurtici Kargo',
          trackingNumber: 'ABC123456',
          idempotencyKey: 'shipment-key-1',
        }),
      }),
    );
    expect(JSON.stringify(prismaMock)).not.toContain('shopifyFulfillment');
    expect(response.payload).toEqual(
      expect.objectContaining({
        idempotent: false,
        allocation: expect.objectContaining({
          carrier: 'Yurtici Kargo',
          trackingNumber: 'ABC123456',
          trackingUrl: 'https://tracking.example/ABC123456',
          shippedAt: '2026-06-02T12:00:00.000Z',
          shippingStatus: 'In Transit',
        }),
      }),
    );
  });

  it('returns the previous shipment result for repeated idempotency keys without duplicate events', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['shipment:write'] }));
    prismaMock.vendorIntegrationShipmentEvent.findUnique.mockResolvedValueOnce({
      vendorAllocation: {
        id: 'alloc-sporjinal-1',
        assignedVendorId: 'sporjinal',
        carrier: 'Yurtici Kargo',
        trackingNumber: 'ABC123456',
        vendorIntegrationTrackingUrl: 'https://tracking.example/ABC123456',
        vendorIntegrationShippedAt: new Date('2026-06-02T12:00:00.000Z'),
        shippingStatus: 'In Transit',
        lastVendorIntegrationShipmentRequestId: 'shipment-req-1',
      },
    });

    const response = await injectVendorIntegrationShipment(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'shipment-key-1',
      },
      { carrier: 'Different Carrier', trackingNumber: 'DIFFERENT' },
    );

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        idempotent: true,
        allocation: expect.objectContaining({
          carrier: 'Yurtici Kargo',
          trackingNumber: 'ABC123456',
        }),
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorIntegrationShipmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects invoice writes without invoice write scope and writes an audit log', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['orders:read'] }));

    const response = await injectVendorIntegrationInvoice(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer read-token',
        'idempotency-key': 'invoice-key-1',
      },
      { invoiceNumber: 'ABC202600001', invoiceDate: '2026-06-02', invoiceAmount: '1299.90' },
    );

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Missing required scope: invoice:write' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorIntegrationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          vendorIdentifier: 'sporjinal',
          method: 'POST',
          statusCode: 403,
          requestId: 'invoice-req-1',
        }),
      }),
    );
  });

  it('rejects invoice writes without an idempotency key', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['invoice:write'] }));

    const response = await injectVendorIntegrationInvoice(
      'alloc-sporjinal-1',
      { authorization: 'Bearer write-token' },
      { invoiceNumber: 'ABC202600001', invoiceDate: '2026-06-02', invoiceAmount: '1299.90' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Idempotency-Key header is required.' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects invoice writes for another vendor allocation', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['invoice:write'] }));
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(null);

    const response = await injectVendorIntegrationInvoice(
      'alloc-yalispor-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'invoice-key-1',
      },
      { invoiceNumber: 'ABC202600001', invoiceDate: '2026-06-02', invoiceAmount: '1299.90' },
    );

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'Vendor allocation not found.' });
    expect(prismaMock.vendorAllocation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'alloc-yalispor-1',
          assignedVendorId: 'sporjinal',
        },
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects invalid invoice amounts and dates', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValue(buildClient({ scopes: ['invoice:write'] }));

    const invalidAmount = await injectVendorIntegrationInvoice(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'invoice-key-1',
      },
      { invoiceNumber: 'ABC202600001', invoiceDate: '2026-06-02', invoiceAmount: '-1.00' },
    );
    const invalidDate = await injectVendorIntegrationInvoice(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'invoice-key-2',
      },
      { invoiceNumber: 'ABC202600001', invoiceDate: '2026-02-31', invoiceAmount: '1299.90' },
    );

    expect(invalidAmount.statusCode).toBe(400);
    expect(invalidAmount.payload).toEqual({ message: 'invoiceAmount must be a valid decimal amount.' });
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.payload).toEqual({ message: 'invoiceDate must be a valid YYYY-MM-DD date.' });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('updates invoice snapshot fields for the authenticated vendor allocation without accounting or Shopify mutation', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['invoice:write'] }));
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({
      id: 'alloc-sporjinal-1',
      assignedVendorId: 'sporjinal',
      vendorInvoiceNumber: 'ABC202600001',
      vendorInvoiceDate: new Date('2026-06-02T00:00:00.000Z'),
      vendorInvoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
      vendorInvoiceAmount: '1299.90',
      vendorInvoiceReceivedAt: new Date('2026-06-02T12:30:00.000Z'),
      lastVendorIntegrationInvoiceRequestId: 'invoice-req-1',
    });

    const response = await injectVendorIntegrationInvoice(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'invoice-key-1',
      },
      {
        invoiceNumber: 'ABC202600001',
        invoiceDate: '2026-06-02',
        invoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
        invoiceAmount: '1299.90',
      },
    );

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alloc-sporjinal-1' },
        data: expect.objectContaining({
          vendorInvoiceNumber: 'ABC202600001',
          vendorInvoiceDate: new Date('2026-06-02T00:00:00.000Z'),
          vendorInvoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
          lastVendorIntegrationInvoiceRequestId: 'invoice-req-1',
        }),
      }),
    );
    expect(prismaMock.vendorIntegrationInvoiceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          vendorAllocationId: 'alloc-sporjinal-1',
          vendorIdentifier: 'sporjinal',
          invoiceNumber: 'ABC202600001',
          invoiceDate: new Date('2026-06-02T00:00:00.000Z'),
          idempotencyKey: 'invoice-key-1',
        }),
      }),
    );
    expect(JSON.stringify(prismaMock)).not.toContain('shopifyFulfillment');
    expect(JSON.stringify(prismaMock)).not.toContain('settlement');
    expect(JSON.stringify(prismaMock)).not.toContain('payout');
    expect(response.payload).toEqual(
      expect.objectContaining({
        idempotent: false,
        allocation: expect.objectContaining({
          vendorInvoiceNumber: 'ABC202600001',
          vendorInvoiceDate: '2026-06-02',
          vendorInvoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
          vendorInvoiceAmount: '1299.90',
          vendorInvoiceReceivedAt: '2026-06-02T12:30:00.000Z',
        }),
      }),
    );
  });

  it('returns the previous invoice result for repeated idempotency keys without duplicate events', async () => {
    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ scopes: ['invoice:write'] }));
    prismaMock.vendorIntegrationInvoiceEvent.findUnique.mockResolvedValueOnce({
      vendorAllocation: {
        id: 'alloc-sporjinal-1',
        assignedVendorId: 'sporjinal',
        vendorInvoiceNumber: 'ABC202600001',
        vendorInvoiceDate: new Date('2026-06-02T00:00:00.000Z'),
        vendorInvoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
        vendorInvoiceAmount: '1299.90',
        vendorInvoiceReceivedAt: new Date('2026-06-02T12:30:00.000Z'),
        lastVendorIntegrationInvoiceRequestId: 'invoice-req-1',
      },
    });

    const response = await injectVendorIntegrationInvoice(
      'alloc-sporjinal-1',
      {
        authorization: 'Bearer write-token',
        'idempotency-key': 'invoice-key-1',
      },
      { invoiceNumber: 'DIFFERENT', invoiceDate: '2026-06-03', invoiceAmount: '1.00' },
    );

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        idempotent: true,
        allocation: expect.objectContaining({
          vendorInvoiceNumber: 'ABC202600001',
          vendorInvoiceDate: '2026-06-02',
          vendorInvoiceAmount: '1299.90',
        }),
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorIntegrationInvoiceEvent.create).not.toHaveBeenCalled();
  });

  it('stores only the token hash when generating client credentials', async () => {
    prismaMock.vendorIntegrationClient.create.mockResolvedValueOnce({
      id: 'client-1',
      vendorIdentifier: 'sporjinal',
      providerName: 'Provider A',
      scopes: ['orders:read'],
    });

    const created = await createVendorIntegrationClientToken(
      {
        vendorIdentifier: 'sporjinal',
        providerName: 'Provider A',
        scopes: ['orders:read'],
      },
      prismaMock,
    );

    expect(created.token).toMatch(/^spg_vi_/);
    expect(prismaMock.vendorIntegrationClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenHash: hashVendorIntegrationToken(created.token),
        }),
      }),
    );
    expect(prismaMock.vendorIntegrationClient.create.mock.calls[0]?.[0].data).not.toHaveProperty('token');
  });

  it('rejects unauthenticated admin token creation requests', async () => {
    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read'],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationClient.create).not.toHaveBeenCalled();
  });

  it('rejects vendor users for admin token creation', async () => {
    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: { id: 'vendor-user-1', email: 'vendor@example.test', role: 'vendor' },
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read'],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationClient.create).not.toHaveBeenCalled();
  });

  it('rejects static probe token alone for admin token creation', async () => {
    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      headers: { 'x-admin-probe-token': 'admin-test-token' },
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read'],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationClient.create).not.toHaveBeenCalled();
  });

  it('admin token creation returns plaintext once and stores only the hash', async () => {
    prismaMock.vendorIntegrationClient.create.mockResolvedValueOnce({
      id: 'client-created',
      vendorIdentifier: 'sporjinal',
      providerName: 'ayensoftware-test',
      scopes: ['orders:read'],
    });

    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: adminUser,
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.payload).toEqual(
      expect.objectContaining({
        clientId: 'client-created',
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read'],
        token: expect.stringMatching(/^spg_vi_/),
        tokenWarning: expect.stringContaining('shown only once'),
      }),
    );
    const token = (response.payload as { token: string }).token;
    expect(response.app.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'VENDOR_INTEGRATION_TOKEN_CREATED',
        adminUserId: 'admin-1',
        adminEmail: 'admin@example.test',
        clientId: 'client-created',
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
      }),
      'vendor integration admin action',
    );
    expect(JSON.stringify(response.app.log.info.mock.calls)).not.toContain(token);
    expect(prismaMock.vendorIntegrationClient.create.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        tokenHash: hashVendorIntegrationToken(token),
      }),
    );
    expect(prismaMock.vendorIntegrationClient.create.mock.calls[0]?.[0].data).not.toHaveProperty('token');
  });

  it('admin token creation accepts the implemented scope allowlist', async () => {
    prismaMock.vendorIntegrationClient.create.mockResolvedValueOnce({
      id: 'client-created',
      vendorIdentifier: 'sporjinal',
      providerName: 'ayensoftware-test',
      scopes: ['invoice:write', 'orders:read', 'shipment:write', 'status:write'],
    });

    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: adminUser,
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read', 'status:write', 'shipment:write', 'invoice:write'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.payload).toEqual(
      expect.objectContaining({
        scopes: ['invoice:write', 'orders:read', 'shipment:write', 'status:write'],
        token: expect.stringMatching(/^spg_vi_/),
      }),
    );
    expect(prismaMock.vendorIntegrationClient.create.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        scopes: ['invoice:write', 'orders:read', 'shipment:write', 'status:write'],
      }),
    );
  });

  it('admin token creation rejects unknown scopes', async () => {
    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: adminUser,
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read', 'orders:delete'],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Unsupported vendor integration scope: orders:delete' });
    expect(prismaMock.vendorIntegrationClient.create).not.toHaveBeenCalled();
  });

  it('admin token creation rejects empty scope lists', async () => {
    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: adminUser,
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'At least one scope is required.' });
    expect(prismaMock.vendorIntegrationClient.create).not.toHaveBeenCalled();
  });

  it('admin token creation rejects non-string scopes', async () => {
    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: adminUser,
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read', 123],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Invalid vendor integration scope.' });
    expect(prismaMock.vendorIntegrationClient.create).not.toHaveBeenCalled();
  });

  it('admin token creation normalizes duplicate scopes deterministically', async () => {
    prismaMock.vendorIntegrationClient.create.mockResolvedValueOnce({
      id: 'client-created',
      vendorIdentifier: 'sporjinal',
      providerName: 'ayensoftware-test',
      scopes: ['orders:read', 'status:write'],
    });

    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: adminUser,
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['status:write', ' orders:read ', 'orders:read'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.payload).toEqual(
      expect.objectContaining({
        scopes: ['orders:read', 'status:write'],
      }),
    );
    expect(prismaMock.vendorIntegrationClient.create.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        scopes: ['orders:read', 'status:write'],
      }),
    );
  });

  it('created admin token can call the vendor integration orders endpoint', async () => {
    prismaMock.vendorIntegrationClient.create.mockResolvedValueOnce({
      id: 'client-created',
      vendorIdentifier: 'sporjinal',
      providerName: 'ayensoftware-test',
      scopes: ['orders:read'],
    });

    const created = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      authUser: adminUser,
      body: {
        vendorIdentifier: 'sporjinal',
        providerName: 'ayensoftware-test',
        scopes: ['orders:read'],
      },
    });
    const token = (created.payload as { token: string }).token;
    prismaMock.vendorIntegrationClient.findUnique.mockImplementationOnce(async (input: { where: { tokenHash: string } }) => {
      return input.where.tokenHash === hashVendorIntegrationToken(token) ? buildClient({ id: 'client-created' }) : null;
    });

    const response = await injectVendorIntegrationOrders({ authorization: `Bearer ${token}` });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(expect.objectContaining({ data: [expect.objectContaining({ vendorIdentifier: 'sporjinal' })] }));
  });

  it('admin revokes admin-managed tokens and rejects the token after revocation', async () => {
    prismaMock.vendorIntegrationClient.update.mockResolvedValueOnce({
      id: 'client-1',
      vendorIdentifier: 'sporjinal',
      providerName: 'Provider A',
      enabled: false,
      revokedAt: new Date('2026-06-01T12:00:00.000Z'),
    });

    const revokeResponse = await injectAdminRoute('POST', '/admin/vendor-integration/tokens/:id/revoke', {
      authUser: adminUser,
      params: { id: 'client-1' },
    });

    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.payload).toEqual(
      expect.objectContaining({
        clientId: 'client-1',
        enabled: false,
        revokedAt: '2026-06-01T12:00:00.000Z',
      }),
    );
    expect(prismaMock.vendorIntegrationClient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'client-1' },
        data: expect.objectContaining({ enabled: false, revokedAt: expect.any(Date) }),
      }),
    );

    prismaMock.vendorIntegrationClient.findUnique.mockResolvedValueOnce(buildClient({ enabled: false, revokedAt: new Date() }));
    const response = await injectVendorIntegrationOrders({ authorization: 'Bearer revoked-token' });
    expect(response.statusCode).toBe(403);
  });

  it('rejects static probe token alone for admin token revocation', async () => {
    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens/:id/revoke', {
      headers: { 'x-admin-probe-token': 'admin-test-token' },
      params: { id: 'client-1' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationClient.update).not.toHaveBeenCalled();
  });

  it('allows authenticated admin users to revoke provider tokens without exposing token material', async () => {
    prismaMock.vendorIntegrationClient.update.mockResolvedValueOnce({
      id: 'client-1',
      vendorIdentifier: 'sporjinal',
      providerName: 'Provider A',
      enabled: false,
      revokedAt: new Date('2026-06-01T12:00:00.000Z'),
    });

    const revokeResponse = await injectAdminRoute('POST', '/admin/vendor-integration/tokens/:id/revoke', {
      authUser: adminUser,
      params: { id: 'client-1' },
    });

    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.payload).toEqual(
      expect.objectContaining({
        clientId: 'client-1',
        enabled: false,
        revokedAt: '2026-06-01T12:00:00.000Z',
      }),
    );
    expect(JSON.stringify(revokeResponse.payload)).not.toContain('tokenHash');
    expect(JSON.stringify(revokeResponse.payload)).not.toContain('spg_vi_');
  });

  it('lists vendor integration audit logs without bodies', async () => {
    prismaMock.vendorIntegrationAuditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-1',
        clientId: 'client-1',
        vendorIdentifier: 'sporjinal',
        method: 'GET',
        path: '/api/vendor-integration/orders',
        statusCode: 200,
        requestId: 'req-1',
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    ]);

    const response = await injectAdminRoute('GET', '/admin/vendor-integration/audit-logs', {
      authUser: adminUser,
      query: { vendorIdentifier: 'sporjinal' },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorIntegrationAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vendorIdentifier: 'sporjinal' },
        take: 50,
      }),
    );
    expect(response.payload).toEqual({
      data: [
        {
          id: 'audit-1',
          clientId: 'client-1',
          vendorIdentifier: 'sporjinal',
          method: 'GET',
          path: '/api/vendor-integration/orders',
          statusCode: 200,
          requestId: 'req-1',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(response.payload)).not.toContain('body');
  });

  it('rejects unauthenticated admin audit log requests', async () => {
    const response = await injectAdminRoute('GET', '/admin/vendor-integration/audit-logs', {
      query: { vendorIdentifier: 'sporjinal' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('rejects vendor users for admin audit logs', async () => {
    const response = await injectAdminRoute('GET', '/admin/vendor-integration/audit-logs', {
      authUser: { id: 'vendor-user-1', email: 'vendor@example.test', role: 'vendor' },
      query: { vendorIdentifier: 'sporjinal' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('rejects static probe token alone for admin audit logs', async () => {
    const response = await injectAdminRoute('GET', '/admin/vendor-integration/audit-logs', {
      headers: { 'x-admin-probe-token': 'admin-test-token' },
      query: { vendorIdentifier: 'sporjinal' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('returns read-only admin provider summaries without token material', async () => {
    prismaMock.vendorIntegrationClient.findMany.mockResolvedValueOnce([
      {
        id: 'client-1',
        providerName: 'Provider A',
        vendorIdentifier: 'sporjinal',
        scopes: ['orders:read', 'status:write'],
        enabled: true,
        revokedAt: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:05:00.000Z'),
        lastUsedAt: new Date('2026-06-01T11:00:00.000Z'),
        auditLogs: [
          {
            method: 'GET',
            path: '/api/vendor-integration/orders',
            statusCode: 200,
            requestId: 'req-1',
            createdAt: new Date('2026-06-01T12:00:00.000Z'),
          },
        ],
      },
    ]);
    prismaMock.vendorIntegrationAuditLog.findMany.mockResolvedValueOnce([
      {
        clientId: 'client-1',
        statusCode: 200,
        createdAt: new Date(),
      },
      {
        clientId: 'client-1',
        statusCode: 429,
        createdAt: new Date(),
      },
    ]);

    const response = await injectAdminRoute('GET', '/admin/vendor-integration/providers', {
      authUser: { role: 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.vendorIntegrationClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          tokenHash: true,
        }),
      }),
    );
    expect(response.payload).toEqual(
      expect.objectContaining({
        providers: [
          expect.objectContaining({
            clientId: 'client-1',
            providerName: 'Provider A',
            vendorIdentifier: 'sporjinal',
            scopes: ['orders:read', 'status:write'],
            enabled: true,
            revokedAt: null,
            lastUsedAt: '2026-06-01T11:00:00.000Z',
            requestsLast24h: 2,
            rateLimitedLast24h: 1,
            authFailuresLast24h: null,
            recentAuditLogs: [
              {
                method: 'GET',
                path: '/api/vendor-integration/orders',
                statusCode: 200,
                requestId: 'req-1',
                createdAt: '2026-06-01T12:00:00.000Z',
              },
            ],
          }),
        ],
      }),
    );
    expect(JSON.stringify(response.payload)).not.toContain('tokenHash');
    expect(JSON.stringify(response.payload)).not.toContain('spg_vi_');
    expect(JSON.stringify(response.payload)).not.toContain('requestBody');
    expect(JSON.stringify(response.payload)).not.toContain('responseBody');
  });

  it('rejects read-only admin provider summaries for non-admin users', async () => {
    const response = await injectAdminRoute('GET', '/admin/vendor-integration/providers', {
      authUser: { role: 'vendor' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Forbidden' });
    expect(prismaMock.vendorIntegrationClient.findMany).not.toHaveBeenCalled();
  });
});
