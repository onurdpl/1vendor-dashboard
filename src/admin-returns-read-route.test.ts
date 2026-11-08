import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: { findUnique: vi.fn() },
  userVendorAccess: { findMany: vi.fn() },
}));
const listReturns = vi.hoisted(() => vi.fn());
const statusOptions = vi.hoisted(() => vi.fn());
const dashboardReturns = vi.hoisted(() => vi.fn());
const returnDetail = vi.hoisted(() => vi.fn());
const reviewReturn = vi.hoisted(() => vi.fn());
const markReturnReceived = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/auth/auth.service.js', () => ({ createAuthService: vi.fn(() => ({})) }));
vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: async (request: { headers: Record<string, string | string[] | undefined>; authUser?: unknown },
      reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
      const role = request.headers['x-test-role'];
      if (typeof role !== 'string') return reply.code(401).send({ message: 'Unauthorized' });
      request.authUser = { id: 'actor-1', email: 'actor@example.test', name: 'Actor', role, status: 'active' };
    },
  })),
}));
vi.mock('../backend/src/modules/returns/returns.service.js', () => ({
  getVendorReturnById: returnDetail,
  listVendorDashboardReturns: dashboardReturns,
  listVendorReturns: listReturns,
  listVendorReturnStatusOptions: statusOptions,
  markReturnReceived,
  reviewReturn,
  ReturnReviewError: class extends Error {},
}));
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({ createShopifyAdminService: vi.fn(() => ({})) }));
vi.mock('../backend/src/modules/returns/return-reason-backfill.service.js', () => ({ backfillShopifyReturnReasons: vi.fn() }));
vi.mock('../backend/src/modules/returns/duplicate-return-cleanup.service.js', () => ({ cleanupDuplicateReturnRecords: vi.fn() }));
vi.mock('../backend/src/modules/returns/abandoned-approved-return-auto-cancel.service.js', () => ({
  runAbandonedApprovedReturnAutoCancel: vi.fn(),
}));

const { registerReturnsRoutes } = await import('../backend/src/modules/returns/returns.routes.js');
const createFastify = createRequire(`${process.cwd()}/backend/package.json`)('fastify');
const vendorA = { id: 'vendor-a', name: 'Vendor A', status: 'active' };
const vendorB = { id: 'vendor-b', name: 'Vendor B', status: 'restricted' };
const paths = ['/returns', '/returns/status-options', '/returns/dashboard', '/returns/return-a'] as const;

function appForTest() {
  const app = createFastify();
  registerReturnsRoutes(app, {} as never);
  return app;
}

function headers(role: string, vendorId?: string | string[]) {
  return { 'x-test-role': role, ...(vendorId === undefined ? {} : { 'x-vendor-id': vendorId }) };
}

describe('Admin Returns read target isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      [vendorA, vendorB].find(vendor => vendor.id === where.id) ?? null);
    prismaMock.userVendorAccess.findMany.mockResolvedValue([{ vendorId: vendorA.id, vendor: vendorA }]);
    listReturns.mockImplementation(async (vendorId: string) => [{ id: `return-${vendorId}`, vendorId }]);
    statusOptions.mockImplementation(async (vendorId: string) => [`status-${vendorId}`]);
    dashboardReturns.mockImplementation(async (vendorId: string) => [{ id: `return-${vendorId}`, status: 'requested' }]);
    returnDetail.mockImplementation(async (vendorId: string, returnId: string) =>
      returnId === `return-${vendorId}` ? { id: returnId, vendorId } : null);
  });

  it('lets a zero-membership Admin read each explicit Vendor, including a restricted Vendor', async () => {
    const app = appForTest();
    prismaMock.userVendorAccess.findMany.mockResolvedValue([]);
    try {
      for (const vendor of [vendorA, vendorB]) {
        const list = await app.inject({ method: 'GET', url: '/returns', headers: headers('admin', vendor.id) });
        const statuses = await app.inject({ method: 'GET', url: '/returns/status-options', headers: headers('admin', vendor.id) });
        const dashboard = await app.inject({ method: 'GET', url: '/returns/dashboard', headers: headers('admin', vendor.id) });
        const detail = await app.inject({ method: 'GET', url: `/returns/return-${vendor.id}`, headers: headers('admin', vendor.id) });
        expect(list.statusCode).toBe(200);
        expect(list.json()).toEqual([{ id: `return-${vendor.id}`, vendorId: vendor.id }]);
        expect(statuses.json()).toEqual([`status-${vendor.id}`]);
        expect(dashboard.statusCode).toBe(200);
        expect(dashboard.json()).toEqual([{ id: `return-${vendor.id}`, status: 'requested' }]);
        expect(detail.statusCode).toBe(200);
        expect(detail.json()).toEqual({ id: `return-${vendor.id}`, vendorId: vendor.id });
      }
      expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
      expect(reviewReturn).not.toHaveBeenCalled();
      expect(markReturnReceived).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('validates Returns filters before calling the Vendor-scoped list service', async () => {
    const app = appForTest();
    try {
      const valid = await app.inject({ method: 'GET',
        url: '/returns?workflow=needs-action&status=In%20Review&source=pending&search=shoe&limit=101&offset=100',
        headers: headers('admin', vendorA.id) });
      expect(valid.statusCode).toBe(200);
      expect(listReturns).toHaveBeenCalledWith(vendorA.id, {
        workflow: 'needs-action', status: 'In Review', source: 'pending', search: 'shoe', limit: 101, offset: 100,
      });
      for (const query of ['workflow=invalid', 'source=unknown', 'status=', 'status=%20']) {
        expect((await app.inject({ method: 'GET', url: `/returns?${query}`,
          headers: headers('admin', vendorA.id) })).statusCode).toBe(400);
      }
    } finally { await app.close(); }
  });

  it.each(paths)('fails closed for missing, invalid and conflicting Admin targets on %s', async path => {
    const app = appForTest();
    try {
      for (const [target, status] of [[undefined, 400], ['', 400], ['vendor-a,vendor-b', 400],
        [['vendor-a', 'vendor-b'], 400], ['missing', 404]] as const) {
        expect((await app.inject({ method: 'GET', url: path, headers: headers('admin', target) })).statusCode).toBe(status);
      }
      expect(listReturns).not.toHaveBeenCalled();
      expect(dashboardReturns).not.toHaveBeenCalled();
      expect(returnDetail).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects duplicate identical raw Admin target headers', async () => {
    const app = appForTest();
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('Expected local TCP port');
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest({ host: '127.0.0.1', port: address.port, path: '/returns/return-vendor-a',
          headers: { 'x-test-role': 'admin', 'X-Vendor-Id': [vendorA.id, vendorA.id] } }, response => {
          response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
        });
        request.on('error', reject); request.end();
      });
      expect(status).toBe(400);
      expect(returnDetail).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('keeps Vendor membership checks and return-detail ownership', async () => {
    const app = appForTest();
    try {
      expect((await app.inject({ method: 'GET', url: '/returns/return-vendor-a', headers: headers('vendor', vendorA.id) })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/returns/return-vendor-b', headers: headers('vendor', vendorA.id) })).statusCode).toBe(404);
      for (const path of paths) {
        expect((await app.inject({ method: 'GET', url: path, headers: headers('vendor', vendorB.id) })).statusCode).toBe(403);
      }
      expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('does not grant another Vendor return detail to an Admin selecting Vendor A', async () => {
    const app = appForTest();
    try {
      expect((await app.inject({ method: 'GET', url: '/returns/return-vendor-b', headers: headers('admin', vendorA.id) })).statusCode).toBe(404);
      expect(returnDetail).toHaveBeenCalledWith(vendorA.id, 'return-vendor-b', expect.any(Object));
    } finally { await app.close(); }
  });
});
