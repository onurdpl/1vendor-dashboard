import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  RESTRICTED_VENDOR_MESSAGE,
  RestrictedVendorError,
  assertVendorOperationalAccess,
  requireUnrestrictedVendorMutation,
} = await import('../backend/src/modules/vendor-access/restricted-vendor.js');

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      return payload;
    }),
  };
  return reply;
}

describe('restricted vendor operational access', () => {
  beforeEach(() => {
    prismaMock.vendor.findUnique.mockReset();
  });

  it('allows active vendors to perform operational mutations', async () => {
    prismaMock.vendor.findUnique.mockResolvedValueOnce({ id: 'vendor-a', status: 'active' });

    await expect(assertVendorOperationalAccess('vendor-a')).resolves.toBeUndefined();

    expect(prismaMock.vendor.findUnique).toHaveBeenCalledWith({
      where: { id: 'vendor-a' },
      select: { id: true, status: true },
    });
  });

  it('blocks inactive vendors with the seller-safe restricted message', async () => {
    prismaMock.vendor.findUnique.mockResolvedValueOnce({ id: 'vendor-a', status: 'inactive' });

    await expect(assertVendorOperationalAccess('vendor-a')).rejects.toMatchObject({
      name: 'RestrictedVendorError',
      message: RESTRICTED_VENDOR_MESSAGE,
      statusCode: 403,
    } satisfies Partial<RestrictedVendorError>);
  });

  it('returns 403 from route middleware for restricted vendor mutations', async () => {
    prismaMock.vendor.findUnique.mockResolvedValueOnce({ id: 'vendor-a', status: 'inactive' });
    const reply = createReply();

    await requireUnrestrictedVendorMutation(
      {
        authUser: { role: 'vendor' },
        vendorContext: { vendorId: 'vendor-a' },
      } as never,
      reply as never,
    );

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ message: RESTRICTED_VENDOR_MESSAGE });
  });

  it('does not block admin-scoped mutations through the vendor guard', async () => {
    const reply = createReply();

    await requireUnrestrictedVendorMutation(
      {
        authUser: { role: 'admin' },
        vendorContext: { vendorId: 'vendor-a' },
      } as never,
      reply as never,
    );

    expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});
