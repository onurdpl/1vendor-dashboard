import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: { findUnique: vi.fn() },
  userVendorAccess: { findMany: vi.fn() },
}));
const listOrders = vi.hoisted(() => vi.fn());
const workflowSummary = vi.hoisted(() => vi.fn());
const orderDetail = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/auth/auth.service.js', () => ({ createAuthService: vi.fn(() => ({})) }));
vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: async (request: { headers: Record<string, string | string[] | undefined>; authUser?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
      const role = request.headers['x-test-role'];
      if (typeof role !== 'string') return reply.code(401).send({ message: 'Unauthorized' });
      request.authUser = { id: 'actor-1', email: 'actor@example.test', name: 'Actor', role, status: 'active' };
    },
  })),
}));
vi.mock('../backend/src/modules/orders/orders.service.js', () => ({
  listVendorOrders: listOrders,
  getVendorOrdersWorkflowSummary: workflowSummary,
  getVendorOrderByIdForUser: orderDetail,
  OrderRejectValidationError: class extends Error {},
  addBlockedAllocationResolutionNote: vi.fn(),
  executeShopifyRefundForAdminOrder: vi.fn(),
  getAdminShopifyOrderBreakdown: vi.fn(),
  planAllocationSplitForVendorOrder: vi.fn(),
  previewShopifyRefundForAdminOrder: vi.fn(),
  rejectVendorOrderAllocation: vi.fn(),
  requestCancelRefundReviewForAdminOrder: vi.fn(),
  returnBlockedAllocationToVendor: vi.fn(),
  splitAllocationForVendorOrder: vi.fn(),
  transferAllocationEconomicsForAdminOrder: vi.fn(),
}));
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({ createShopifyAdminService: vi.fn(() => ({})) }));
vi.mock('../backend/src/modules/product-panel/product-panel-variant-disable-outbox.service.js', () => ({
  ProductPanelVariantDisableDryRunSendError: class extends Error {},
  sendProductPanelVariantDisableDryRunEventsForOrder: vi.fn(),
}));

const { registerOrdersRoutes } = await import('../backend/src/modules/orders/orders.routes.js');
const createFastify = createRequire(`${process.cwd()}/backend/package.json`)('fastify');
const vendorA = { id: 'vendor-a', name: 'Vendor A', status: 'active' };
const vendorB = { id: 'vendor-b', name: 'Vendor B', status: 'inactive' };
const paths = ['/orders', '/orders/workflow-summary'] as const;

function appForTest() {
  const app = createFastify();
  registerOrdersRoutes(app, {} as never);
  return app;
}
function headers(role: string, vendorId?: string | string[]) {
  return { 'x-test-role': role, ...(vendorId === undefined ? {} : { 'x-vendor-id': vendorId }) };
}

describe('Admin Orders read target isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      [vendorA, vendorB].find(vendor => vendor.id === where.id) ?? null);
    prismaMock.userVendorAccess.findMany.mockResolvedValue([{ vendorId: vendorA.id, vendor: vendorA }]);
    listOrders.mockImplementation(async (vendorId: string) => [{ id: `${vendorId}-allocation`, vendorId }]);
    workflowSummary.mockImplementation(async (vendorId: string) => ({ vendorId, all: vendorId === vendorA.id ? 1 : 0, awaitingShipment: 0, shipmentReview: 0, trackingMissing: 0 }));
  });

  it.each(paths)('allows a zero-membership Admin to read a restricted, unlinked target on %s', async path => {
    const app = appForTest();
    prismaMock.userVendorAccess.findMany.mockResolvedValue([]);
    try {
      const result = await app.inject({ method: 'GET', url: path, headers: headers('admin', vendorB.id) });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject(path === '/orders' ? [{ vendorId: vendorB.id }] : { vendorId: vendorB.id });
      expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
      expect(path === '/orders' ? listOrders : workflowSummary).toHaveBeenCalledWith(vendorB.id, ...(path === '/orders' ? [{ limit: 100, offset: 0, workflow: 'all' }] : []));
    } finally { await app.close(); }
  });

  it.each([1, 2])('ignores %i Admin memberships and retains real actor', async count => {
    const app = appForTest();
    const actors: string[] = [];
    app.addHook('onSend', async (request: { authUser?: { id: string } }) => { actors.push(request.authUser?.id ?? 'missing'); });
    prismaMock.userVendorAccess.findMany.mockResolvedValue(Array.from({ length: count }, () => ({ vendorId: vendorA.id, vendor: vendorA })));
    try {
      const result = await app.inject({ method: 'GET', url: '/orders', headers: headers('admin', vendorB.id) });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual([{ id: 'vendor-b-allocation', vendorId: vendorB.id }]);
      expect(actors).toEqual(['actor-1']);
      expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(paths)('keeps both read services isolated by assigned target on %s', async path => {
    const app = appForTest();
    try {
      for (const vendor of [vendorA, vendorB]) {
        const result = await app.inject({ method: 'GET', url: path, headers: headers('admin', vendor.id) });
        expect(result.statusCode).toBe(200);
        expect(result.json()).toMatchObject(path === '/orders' ? [{ vendorId: vendor.id }] : { vendorId: vendor.id });
      }
    } finally { await app.close(); }
  });

  it.each(paths)('rejects missing, invalid, and conflicting Admin targets on %s', async path => {
    const app = appForTest();
    try {
      for (const [target, status] of [[undefined, 400], ['', 400], ['vendor-a, vendor-b', 400], [['vendor-a', 'vendor-b'], 400], ['missing', 404]] as const) {
        const result = await app.inject({ method: 'GET', url: path, headers: headers('admin', target) });
        expect(result.statusCode).toBe(status);
      }
      expect(listOrders).not.toHaveBeenCalled();
      expect(workflowSummary).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(paths)('rejects duplicate identical raw HTTP headers on %s', async path => {
    const app = appForTest();
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('Expected local TCP port');
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest({ host: '127.0.0.1', port: address.port, path,
          headers: { 'x-test-role': 'admin', 'X-Vendor-Id': [vendorA.id, vendorA.id] } }, response => {
          response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
        });
        request.on('error', reject); request.end();
      });
      expect(status).toBe(400);
      expect(listOrders).not.toHaveBeenCalled();
      expect(workflowSummary).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(paths)('preserves Vendor membership and does not grant support/finance global scope on %s', async path => {
    const app = appForTest();
    try {
      expect((await app.inject({ method: 'GET', url: path, headers: headers('vendor', vendorA.id) })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: path, headers: headers('vendor', vendorB.id) })).statusCode).toBe(403);
      for (const role of ['support', 'finance']) {
        expect((await app.inject({ method: 'GET', url: path, headers: headers(role, vendorB.id) })).statusCode).toBe(403);
      }
      expect((await app.inject({ method: 'GET', url: path, headers: { 'x-vendor-id': vendorA.id } })).statusCode).toBe(401);
      expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(paths)('requires Vendor membership but retains restricted-member read on %s', async path => {
    const app = appForTest();
    try {
      prismaMock.userVendorAccess.findMany.mockResolvedValueOnce([]);
      expect((await app.inject({ method: 'GET', url: path, headers: headers('vendor', vendorB.id) })).statusCode).toBe(403);
      prismaMock.userVendorAccess.findMany.mockResolvedValue([{ vendorId: vendorB.id, vendor: vendorB }]);
      const result = await app.inject({ method: 'GET', url: path, headers: headers('vendor', vendorB.id) });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject(path === '/orders' ? [{ vendorId: vendorB.id }] : { vendorId: vendorB.id });
    } finally { await app.close(); }
  });

  it('leaves detail route on existing membership authorization', async () => {
    const app = appForTest();
    try {
      const result = await app.inject({ method: 'GET', url: '/orders/order-1', headers: headers('admin', vendorB.id) });
      expect(result.statusCode).toBe(403);
      expect(orderDetail).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
