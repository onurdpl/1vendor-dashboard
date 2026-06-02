import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorIntegrationClient: {
    create: vi.fn(),
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
    vendorIntegrationStatus: 'acknowledged',
    vendorIntegrationStatusMessage: 'Order imported into Entegra',
    vendorIntegrationStatusUpdatedAt: new Date('2026-05-31T10:06:00.000Z'),
    vendorIntegrationProvider: 'Provider A',
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

  return { gets, posts, hooks };
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

async function injectVendorIntegrationOrders(headers: Record<string, string>, query: Record<string, string> = {}) {
  const { gets, hooks } = createRegisteredRoutes();
  const route = gets.get('/api/vendor-integration/orders');
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers,
    method: 'GET',
    url: '/api/vendor-integration/orders',
    id: 'req-1',
    query,
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

async function injectAdminRoute(
  method: 'GET' | 'POST',
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
) {
  const { gets, posts } = createRegisteredRoutes();
  const route = method === 'GET' ? gets.get(path) : posts.get(path);
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers: options.headers ?? {},
    method,
    url: path,
    id: 'admin-req-1',
    body: options.body,
    query: options.query ?? {},
    params: options.params ?? {},
  };

  const result = await route?.handler?.(request, reply);
  return {
    statusCode: reply.statusCode,
    payload: reply.sent ? reply.payload : result,
  };
}

describe('vendor integration API foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    process.env.ADMIN_PROBE_TOKEN = 'admin-test-token';
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

  it('admin token creation returns plaintext once and stores only the hash', async () => {
    prismaMock.vendorIntegrationClient.create.mockResolvedValueOnce({
      id: 'client-created',
      vendorIdentifier: 'sporjinal',
      providerName: 'ayensoftware-test',
      scopes: ['orders:read'],
    });

    const response = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      headers: { 'x-admin-probe-token': 'admin-test-token' },
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
    expect(prismaMock.vendorIntegrationClient.create.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        tokenHash: hashVendorIntegrationToken(token),
      }),
    );
    expect(prismaMock.vendorIntegrationClient.create.mock.calls[0]?.[0].data).not.toHaveProperty('token');
  });

  it('created admin token can call the vendor integration orders endpoint', async () => {
    prismaMock.vendorIntegrationClient.create.mockResolvedValueOnce({
      id: 'client-created',
      vendorIdentifier: 'sporjinal',
      providerName: 'ayensoftware-test',
      scopes: ['orders:read'],
    });

    const created = await injectAdminRoute('POST', '/admin/vendor-integration/tokens', {
      headers: { 'x-admin-probe-token': 'admin-test-token' },
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

  it('revokes admin-managed tokens and rejects the token after revocation', async () => {
    prismaMock.vendorIntegrationClient.update.mockResolvedValueOnce({
      id: 'client-1',
      vendorIdentifier: 'sporjinal',
      providerName: 'Provider A',
      enabled: false,
      revokedAt: new Date('2026-06-01T12:00:00.000Z'),
    });

    const revokeResponse = await injectAdminRoute('POST', '/admin/vendor-integration/tokens/:id/revoke', {
      headers: { 'x-admin-probe-token': 'admin-test-token' },
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
      headers: { 'x-admin-probe-token': 'admin-test-token' },
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
});
