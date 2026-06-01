import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorIntegrationClient: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorIntegrationAuditLog: {
    create: vi.fn(),
  },
  vendorAllocation: {
    findMany: vi.fn(),
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
    createdAt: new Date('2026-05-31T10:00:00.000Z'),
    updatedAt: new Date('2026-05-31T10:05:00.000Z'),
    order: {
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      sourceShopifyOrderNumber: '#1001',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.test',
      customerPhone: '+900000000000',
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
          sourceVariantId: 'gid://shopify/ProductVariant/1',
          sku: 'SKU-1',
          title: 'Test Product',
          imageUrl: null,
          unitPrice: '1299.90',
        },
      },
    ],
    ...overrides,
  };
}

function createRegisteredRoute() {
  const hooks = new Map<string, (request: Record<string, unknown>, reply: { statusCode: number }) => Promise<void>>();
  const route: {
    path?: string;
    options?: { preHandler: Array<(request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>> };
    handler?: (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>;
  } = {};
  const app = {
    addHook: vi.fn((name: string, handler: (request: Record<string, unknown>, reply: { statusCode: number }) => Promise<void>) => {
      hooks.set(name, handler);
    }),
    get: vi.fn((path: string, options: typeof route.options, handler: typeof route.handler) => {
      route.path = path;
      route.options = options;
      route.handler = handler;
    }),
  };

  registerVendorIntegrationRoutes(app as never);

  return { route, hooks };
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
  const { route, hooks } = createRegisteredRoute();
  const reply = createReply();
  const request: Record<string, unknown> = {
    headers,
    method: 'GET',
    url: '/api/vendor-integration/orders',
    id: 'req-1',
    query,
  };

  for (const preHandler of route.options?.preHandler ?? []) {
    await preHandler(request, reply);
    if (reply.sent) {
      await hooks.get('onResponse')?.(request, reply);
      return { statusCode: reply.statusCode, payload: reply.payload, request };
    }
  }

  const result = await route.handler?.(request, reply);
  const payload = reply.sent ? reply.payload : result;
  await hooks.get('onResponse')?.(request, reply);

  return { statusCode: reply.statusCode, payload, request };
}

describe('vendor integration API foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendorIntegrationClient.update.mockResolvedValue({ id: 'client-1' });
    prismaMock.vendorIntegrationAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.vendorAllocation.findMany.mockResolvedValue([buildAllocation()]);
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
            lineItems: [expect.objectContaining({ sku: 'SKU-1' })],
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
});
