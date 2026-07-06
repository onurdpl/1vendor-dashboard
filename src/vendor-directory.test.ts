import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

const { listAdminVendorDirectory } = await import('../backend/src/modules/vendors/vendor-directory.service.js');
const { registerVendorDirectoryRoutes } = await import('../backend/src/modules/vendors/vendor-directory.routes.js');

const activeVendor = {
  id: 'yalispor',
  name: 'Yalı Spor',
  status: 'active',
  restrictionReason: null,
  restrictedAt: null,
  updatedAt: new Date('2026-07-05T10:00:00.000Z'),
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
};

const restrictedVendor = {
  id: 'sporjinal',
  name: 'Sporjinal',
  status: 'inactive',
  restrictionReason: 'Operational review',
  restrictedAt: new Date('2026-07-03T10:00:00.000Z'),
  updatedAt: new Date('2026-07-06T10:00:00.000Z'),
  createdAt: new Date('2026-07-02T10:00:00.000Z'),
};

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    sent: false,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return {
        send: vi.fn((body: unknown) => {
          reply.payload = body;
          reply.sent = true;
          return { status, body };
        }),
      };
    }),
  };

  return reply;
}

type RouteHandler = (
  request: {
    authUser?: { role?: string };
    query?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

function createRegisteredRoutes() {
  const gets = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn((path: string, _options: unknown, handler: RouteHandler) => {
      gets.set(path, handler);
    }),
  };

  registerVendorDirectoryRoutes(app as never, {} as never);
  return { gets };
}

describe('admin vendor directory service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findMany.mockResolvedValue([restrictedVendor, activeVendor]);
  });

  it('lists vendors newest updated first with safe directory DTO fields', async () => {
    const result = await listAdminVendorDirectory();

    expect(prismaMock.vendor.findMany).toHaveBeenCalledWith({
      where: {},
      select: {
        id: true,
        name: true,
        status: true,
        restrictionReason: true,
        restrictedAt: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: [
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 100,
    });
    expect(result.vendors).toEqual([
      {
        vendorId: 'sporjinal',
        vendorName: 'Sporjinal',
        status: 'inactive',
        statusLabel: 'Restricted',
        restrictionReason: 'Operational review',
        restrictedAt: '2026-07-03T10:00:00.000Z',
        updatedAt: '2026-07-06T10:00:00.000Z',
        createdAt: '2026-07-02T10:00:00.000Z',
        profileUrl: '/admin/vendors/sporjinal',
      },
      {
        vendorId: 'yalispor',
        vendorName: 'Yalı Spor',
        status: 'active',
        statusLabel: 'Active',
        restrictionReason: null,
        restrictedAt: null,
        updatedAt: '2026-07-05T10:00:00.000Z',
        createdAt: '2026-07-01T10:00:00.000Z',
        profileUrl: '/admin/vendors/yalispor',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/temporaryPassword|passwordHash|tokenPlaintext|tokenHash/i);
  });

  it('searches vendor ID and name case-insensitively', async () => {
    await listAdminVendorDirectory({ search: '  spor  ' });

    expect(prismaMock.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { id: { contains: 'spor', mode: 'insensitive' } },
            { name: { contains: 'spor', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('filters active vendors', async () => {
    await listAdminVendorDirectory({ status: 'active' });

    expect(prismaMock.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'active',
        },
      }),
    );
  });

  it('filters restricted vendors without exposing inactive as product language', async () => {
    await listAdminVendorDirectory({ status: 'restricted' });

    expect(prismaMock.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: 'active' },
        },
      }),
    );
  });
});

describe('admin vendor directory route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findMany.mockResolvedValue([activeVendor]);
  });

  it('allows admins to list vendors', async () => {
    const { gets } = createRegisteredRoutes();
    const result = await gets.get('/admin/vendors')?.(
      { authUser: { role: 'admin' }, query: { search: 'yali' } },
      createReply(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        vendors: [
          expect.objectContaining({
            vendorId: 'yalispor',
            vendorName: 'Yalı Spor',
            statusLabel: 'Active',
          }),
        ],
      }),
    );
  });

  it.each(['vendor', 'support', 'finance', undefined])('rejects %s access to the vendor directory', async (role) => {
    const { gets } = createRegisteredRoutes();
    const reply = createReply();
    const authUser = role ? { role } : undefined;

    const result = await gets.get('/admin/vendors')?.({ authUser }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(prismaMock.vendor.findMany).not.toHaveBeenCalled();
  });

  it('returns safe errors without exposing backend details', async () => {
    prismaMock.vendor.findMany.mockRejectedValueOnce(new Error('Prisma connection stack detail'));
    const { gets } = createRegisteredRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/vendors')?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(500);
    expect(result).toEqual({ status: 500, body: { message: 'Vendor directory could not be loaded.' } });
    expect(JSON.stringify(result)).not.toContain('Prisma connection stack detail');
  });
});
