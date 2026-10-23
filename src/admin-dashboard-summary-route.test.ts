import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: { findUnique: vi.fn() },
  userVendorAccess: { findMany: vi.fn() },
}));
const getDashboardOperationalSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/auth/auth.service.js', () => ({ createAuthService: vi.fn(() => ({})) }));
vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: async (request: {
      headers: Record<string, string | string[] | undefined>;
      authUser?: { id: string; email: string; name: string; role: string; status: string };
    }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
      const role = request.headers['x-test-role'];
      if (typeof role !== 'string') return reply.code(401).send({ message: 'Unauthorized' });
      request.authUser = {
        id: 'real-actor-1', email: 'actor@example.test', name: 'Real Actor', role, status: 'active',
      };
    },
  })),
}));
vi.mock('../backend/src/modules/dashboard/dashboard-summary.service.js', () => ({
  getDashboardOperationalSummary: getDashboardOperationalSummaryMock,
}));

const { registerDashboardSummaryRoutes } = await import('../backend/src/modules/dashboard/dashboard-summary.routes.js');
const createFastify = createRequire(`${process.cwd()}/backend/package.json`)('fastify');

const vendorA = { id: 'vendor-a', name: 'Vendor A', status: 'active' };
const vendorB = { id: 'vendor-b', name: 'Vendor B', status: 'inactive' };

function createApp() {
  const app = createFastify();
  registerDashboardSummaryRoutes(app, {} as never);
  return app;
}

function headers(role: string, vendorId?: string | string[]) {
  return { 'x-test-role': role, ...(vendorId === undefined ? {} : { 'x-vendor-id': vendorId }) };
}

describe('GET /dashboard/summary Admin target isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      [vendorA, vendorB].find((vendor) => vendor.id === where.id) ?? null,
    );
    prismaMock.userVendorAccess.findMany.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      where.userId === 'real-actor-1' ? [{ vendorId: vendorA.id, vendor: vendorA }] : [],
    );
    getDashboardOperationalSummaryMock.mockImplementation(async (vendorId: string) => ({ vendorId }));
  });

  it.each([vendorA, vendorB])('lets a zero-membership Admin read only $id summary', async (vendor) => {
    const app = createApp();
    prismaMock.userVendorAccess.findMany.mockResolvedValue([]);
    try {
      const result = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers('admin', vendor.id) });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ vendorId: vendor.id });
      expect(getDashboardOperationalSummaryMock).toHaveBeenCalledExactlyOnceWith(vendor.id);
      expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([1, 2])('ignores %i Admin memberships and preserves the authenticated actor', async (membershipCount) => {
    const app = createApp();
    const actors: string[] = [];
    app.addHook('onSend', async (request: { authUser?: { id: string } }) => { actors.push(request.authUser?.id ?? 'missing'); });
    prismaMock.userVendorAccess.findMany.mockResolvedValue(
      Array.from({ length: membershipCount }, () => ({ vendorId: vendorA.id, vendor: vendorA })),
    );
    try {
      const result = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers('admin', vendorB.id) });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ vendorId: vendorB.id });
      expect(actors).toEqual(['real-actor-1']);
      expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['missing', undefined, 400],
    ['empty', '', 400],
    ['nonexistent', 'missing-vendor', 404],
    ['combined duplicate', ['vendor-a', 'vendor-b'], 400],
    ['comma-separated ambiguous', 'vendor-a, vendor-b', 400],
  ])('rejects %s Admin target before summary work', async (_label, target, status) => {
    const app = createApp();
    try {
      const result = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers('admin', target) });
      expect(result.statusCode).toBe(status);
      expect(getDashboardOperationalSummaryMock).not.toHaveBeenCalled();
      expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects two identical raw HTTP X-Vendor-Id headers on a local Fastify socket', async () => {
    const app = createApp();
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a local TCP port.');
      const status = await new Promise<number>((resolve, reject) => {
        const outgoing = httpRequest({
          host: '127.0.0.1', port: address.port, path: '/dashboard/summary',
          headers: { 'x-test-role': 'admin', 'X-Vendor-Id': [vendorA.id, vendorA.id] },
        }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        });
        outgoing.on('error', reject);
        outgoing.end();
      });
      expect(status).toBe(400);
      expect(getDashboardOperationalSummaryMock).not.toHaveBeenCalled();
      expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('preserves Vendor membership reads and rejects foreign header spoofing', async () => {
    const app = createApp();
    try {
      const own = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers('vendor', vendorA.id) });
      const foreign = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers('vendor', vendorB.id) });
      expect(own.statusCode).toBe(200);
      expect(own.json()).toEqual({ vendorId: vendorA.id });
      expect(foreign.statusCode).toBe(403);
      expect(getDashboardOperationalSummaryMock).toHaveBeenCalledTimes(1);
      expect(getDashboardOperationalSummaryMock).toHaveBeenCalledWith(vendorA.id);
      expect(prismaMock.userVendorAccess.findMany).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('preserves a restricted Vendor member’s read and the legacy single-membership fallback', async () => {
    const app = createApp();
    prismaMock.userVendorAccess.findMany.mockResolvedValue([{ vendorId: vendorB.id, vendor: vendorB }]);
    try {
      const explicit = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers('vendor', vendorB.id) });
      const fallback = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers('vendor') });
      expect(explicit.statusCode).toBe(200);
      expect(fallback.statusCode).toBe(200);
      expect(explicit.json()).toEqual({ vendorId: vendorB.id });
      expect(fallback.json()).toEqual({ vendorId: vendorB.id });
      expect(getDashboardOperationalSummaryMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it.each(['support', 'finance'])('does not give %s global Admin read access', async (role) => {
    const app = createApp();
    try {
      const result = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: headers(role, vendorB.id) });
      expect(result.statusCode).toBe(403);
      expect(getDashboardOperationalSummaryMock).not.toHaveBeenCalled();
      expect(prismaMock.userVendorAccess.findMany).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('requires authentication', async () => {
    const app = createApp();
    try {
      const result = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: { 'x-vendor-id': vendorA.id } });
      expect(result.statusCode).toBe(401);
      expect(getDashboardOperationalSummaryMock).not.toHaveBeenCalled();
      expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
