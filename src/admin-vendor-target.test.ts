import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: { findUnique: vi.fn() },
  userVendorAccess: { findMany: vi.fn() },
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

const { resolveAdminVendorTarget } = await import('../backend/src/modules/vendor-access/admin-vendor-target.service.js');
const { resolveRequestVendorContext } = await import('../backend/src/modules/vendor-access/vendor-access.service.js');
const { requireUnrestrictedVendorMutation } = await import('../backend/src/modules/vendor-access/restricted-vendor.js');

const admin = { id: 'admin-1', email: 'admin@example.test', name: 'Admin', role: 'admin', status: 'active' };
const vendorA = { id: 'vendor-a', name: 'Vendor A', status: 'active' };
const vendorB = { id: 'vendor-b', name: 'Vendor B', status: 'inactive' };

function request(authUser: unknown) {
  return { authUser } as never;
}

describe('isolated admin vendor target resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      [vendorA, vendorB].find((vendor) => vendor.id === where.id) ?? null,
    );
  });

  it.each([
    ['active Vendor A', vendorA],
    ['inactive Vendor B', vendorB],
  ])('resolves %s with the real Admin actor and no membership query', async (_label, vendor) => {
    expect(await resolveAdminVendorTarget(request(admin), vendor.id)).toEqual({ ok: true, actor: admin, vendor });
    expect(prismaMock.vendor.findUnique).toHaveBeenCalledWith({
      where: { id: vendor.id }, select: { id: true, name: true, status: true },
    });
    expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
  });

  it('resolves an unlinked Vendor even when Admin has other memberships', async () => {
    prismaMock.userVendorAccess.findMany.mockResolvedValue([{ vendorId: vendorA.id, vendor: vendorA }]);
    expect(await resolveAdminVendorTarget(request(admin), vendorB.id)).toEqual({ ok: true, actor: admin, vendor: vendorB });
    expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '   ', 12, {}, ['vendor-a'], ['vendor-a', 'vendor-b']])(
    'rejects missing, invalid, or duplicate structured target %j', async (target) => {
      expect(await resolveAdminVendorTarget(request(admin), target)).toEqual({
        ok: false, code: 400, message: 'A single explicit vendor ID is required.',
      });
      expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    },
  );

  it('looks up the explicit ID and fails closed for a nonexistent Vendor', async () => {
    expect(await resolveAdminVendorTarget(request(admin), ' absent ')).toEqual({
      ok: false, code: 404, message: 'Vendor not found.',
    });
    expect(prismaMock.vendor.findUnique).toHaveBeenCalledWith({
      where: { id: 'absent' }, select: { id: true, name: true, status: true },
    });
  });

  it.each(['vendor', 'support', 'finance', 'other'])(
    'denies %s without looking up a Vendor or membership', async (role) => {
      expect(await resolveAdminVendorTarget(request({ ...admin, role }), vendorA.id)).toEqual({
        ok: false, code: 403, message: 'Admin access required.',
      });
      expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.userVendorAccess.findMany).not.toHaveBeenCalled();
    },
  );

  it('denies an unauthenticated request before target lookup', async () => {
    expect(await resolveAdminVendorTarget(request(undefined), vendorA.id)).toEqual({
      ok: false, code: 401, message: 'Unauthorized',
    });
    expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
  });

  it('preserves legacy Vendor membership resolution and Admin first-link fallback', async () => {
    prismaMock.userVendorAccess.findMany.mockResolvedValue([{ vendorId: vendorA.id, vendor: vendorA }]);
    expect(await resolveRequestVendorContext({ ...admin, role: 'vendor' }, vendorA.id)).toMatchObject({
      ok: true, context: { vendorId: vendorA.id, accessScope: 'vendor' },
    });
    expect(await resolveRequestVendorContext({ ...admin, role: 'vendor' }, vendorB.id)).toMatchObject({
      ok: false, code: 403,
    });
    expect(await resolveRequestVendorContext(admin)).toMatchObject({
      ok: true, context: { vendorId: vendorA.id, accessScope: 'admin' },
    });
  });

  it('does not change the restricted-Vendor mutation guard', async () => {
    prismaMock.vendor.findUnique.mockResolvedValueOnce({ id: vendorB.id, status: vendorB.status });
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await requireUnrestrictedVendorMutation(
      { authUser: { ...admin, role: 'vendor' }, vendorContext: { vendorId: vendorB.id } } as never,
      reply as never,
    );
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalled();
  });
});
