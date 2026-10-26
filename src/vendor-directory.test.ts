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
        { id: 'desc' },
      ],
      take: 101,
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
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
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

  it('uses the unchanged 100 default and 200 maximum limits with one bounded lookahead row', async () => {
    await listAdminVendorDirectory();
    expect(prismaMock.vendor.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 101 }));
    await listAdminVendorDirectory({ limit: 500 });
    expect(prismaMock.vendor.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 201 }));
  });

  it('paginates 523 vendors without duplicates or gaps, including identical timestamps and names', async () => {
    const rows = Array.from({ length: 523 }, (_, index) => ({
      ...activeVendor,
      id: `vendor-${String(index).padStart(4, '0')}`,
      name: index % 3 === 0 ? 'Same name' : `Vendor ${index}`,
      status: index % 2 === 0 ? 'active' : 'inactive',
      updatedAt: new Date(Date.UTC(2026, 6, 6, 0, 0, Math.floor(index / 5))),
      createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, Math.floor(index / 10))),
    }));

    function matches(row: typeof rows[number], condition: Record<string, any>): boolean {
      if (condition.AND && !condition.AND.every((part: Record<string, any>) => matches(row, part))) return false;
      if (condition.OR && !condition.OR.some((part: Record<string, any>) => matches(row, part))) return false;
      for (const field of ['id', 'name', 'status', 'updatedAt', 'createdAt'] as const) {
        const predicate = condition[field];
        if (predicate === undefined) continue;
        const value = row[field];
        if (typeof predicate === 'object' && predicate !== null && !(predicate instanceof Date)) {
          if (predicate.contains !== undefined && !String(value).toLowerCase().includes(String(predicate.contains).toLowerCase())) return false;
          if (predicate.not !== undefined && value === predicate.not) return false;
          if (predicate.lt !== undefined && !(value < predicate.lt)) return false;
        } else if (value instanceof Date && predicate instanceof Date ? value.getTime() !== predicate.getTime() : value !== predicate) {
          return false;
        }
      }
      return true;
    }

    prismaMock.vendor.findMany.mockImplementation(async ({ where, take }: { where: Record<string, any>; take: number }) =>
      rows.filter((row) => matches(row, where)).sort((left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime()
        || right.createdAt.getTime() - left.createdAt.getTime()
        || right.id.localeCompare(left.id),
      ).slice(0, take));

    async function collect(options: { search?: string; status?: string; limit?: number }) {
      const ids: string[] = [];
      let cursor: string | null = null;
      let pageCount = 0;
      do {
        const result = await listAdminVendorDirectory({ ...options, ...(cursor ? { cursor } : {}) });
        ids.push(...result.vendors.map((vendor) => vendor.vendorId));
        pageCount += 1;
        expect(result.hasMore).toBe(Boolean(result.nextCursor));
        cursor = result.nextCursor;
      } while (cursor && pageCount < 600);
      expect(pageCount).toBeLessThan(600);
      return ids;
    }

    const firstPage = await listAdminVendorDirectory();
    expect(firstPage.vendors).toHaveLength(100);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const all = await collect({});
    expect(all).toHaveLength(523);
    expect(new Set(all).size).toBe(523);
    expect(new Set(all)).toEqual(new Set(rows.map((row) => row.id)));
    const active = await collect({ status: 'active', limit: 31 });
    expect(active).toHaveLength(262);
    expect(new Set(active)).toEqual(new Set(rows.filter((row) => row.status === 'active').map((row) => row.id)));
    const restricted = await collect({ status: 'restricted', limit: 31 });
    expect(restricted).toHaveLength(261);
    expect(new Set(restricted)).toEqual(new Set(rows.filter((row) => row.status !== 'active').map((row) => row.id)));
    const duplicateNames = await collect({ search: 'same name', limit: 19 });
    expect(duplicateNames).toHaveLength(175);
    expect(new Set(duplicateNames)).toEqual(new Set(rows.filter((row) => row.name === 'Same name').map((row) => row.id)));
    const idSearch = await collect({ search: 'vendor-000', limit: 3 });
    expect(idSearch).toHaveLength(10);
    expect(new Set(idSearch)).toEqual(new Set(rows.filter((row) => row.id.includes('vendor-000')).map((row) => row.id)));
    expect(await collect({ search: 'missing' })).toEqual([]);
  });

  it('returns no cursor for an exact last page and rejects malformed or incompatible cursors', async () => {
    const second = { ...restrictedVendor, id: 'sporjinal-2', updatedAt: new Date('2026-07-05T10:00:00.000Z') };
    const third = { ...restrictedVendor, id: 'sporjinal-3', updatedAt: new Date('2026-07-04T10:00:00.000Z') };
    prismaMock.vendor.findMany.mockResolvedValueOnce([restrictedVendor, second, third]);
    const first = await listAdminVendorDirectory({ limit: 2, search: 'spor', status: 'restricted' });
    expect(first.vendors).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    prismaMock.vendor.findMany.mockResolvedValueOnce([third]);
    const last = await listAdminVendorDirectory({ limit: 2, search: 'spor', status: 'restricted', cursor: first.nextCursor });
    expect(last.vendors).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
    expect(prismaMock.vendor.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { AND: [
        { OR: [
          { id: { contains: 'spor', mode: 'insensitive' } },
          { name: { contains: 'spor', mode: 'insensitive' } },
        ], status: { not: 'active' } },
        { OR: [
          { updatedAt: { lt: second.updatedAt } },
          { updatedAt: second.updatedAt, createdAt: { lt: second.createdAt } },
          { updatedAt: second.updatedAt, createdAt: second.createdAt, id: { lt: second.id } },
        ] },
      ] },
    }));

    const beforeInvalid = prismaMock.vendor.findMany.mock.calls.length;
    for (const cursor of ['', 'not+base64', 'e30', Buffer.from(JSON.stringify({ v: 2 })).toString('base64url')]) {
      await expect(listAdminVendorDirectory({ cursor })).rejects.toThrow('Invalid vendor directory cursor.');
    }
    await expect(listAdminVendorDirectory({ cursor: first.nextCursor, limit: 2, search: 'other', status: 'restricted' }))
      .rejects.toThrow('does not match');
    await expect(listAdminVendorDirectory({ cursor: first.nextCursor, limit: 2, search: 'spor', status: 'active' }))
      .rejects.toThrow('does not match');
    await expect(listAdminVendorDirectory({ cursor: first.nextCursor, limit: 3, search: 'spor', status: 'restricted' }))
      .rejects.toThrow('does not match');
    expect(prismaMock.vendor.findMany).toHaveBeenCalledTimes(beforeInvalid);
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

  it('allows an admin with no Vendor memberships', async () => {
    const { gets } = createRegisteredRoutes();
    const result = await gets.get('/admin/vendors')?.(
      { authUser: { role: 'admin', vendorAccess: [] } as never },
      createReply(),
    );
    expect(result).toEqual(expect.objectContaining({ vendors: [expect.objectContaining({ vendorId: 'yalispor' })] }));
  });

  it('returns 400 for malformed and mismatched cursors before querying vendors', async () => {
    const { gets } = createRegisteredRoutes();
    const reply = createReply();
    const result = await gets.get('/admin/vendors')?.({ authUser: { role: 'admin' }, query: { cursor: 'bad!' } }, reply);
    expect(reply.statusCode).toBe(400);
    expect(result).toEqual({ status: 400, body: { message: 'Invalid vendor directory cursor.' } });
    expect(prismaMock.vendor.findMany).not.toHaveBeenCalled();
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
