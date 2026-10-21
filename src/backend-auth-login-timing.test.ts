import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const updateManyMock = vi.hoisted(() => vi.fn());
const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
      updateMany: updateManyMock,
    },
    $queryRaw: queryRawMock,
  },
}));

function makeDemoPasswordHash(password: string) {
  return `demo_sha256_v1:${createHash('sha256').update(`vendor-dashboard-demo:${password}`).digest('hex')}`;
}

const authEnv = {
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '1h',
} as AppEnv;

describe('backend auth login timing', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    updateMock.mockResolvedValue({});
    updateManyMock.mockReset();
    queryRawMock.mockReset();
  });

  it('returns safe stage timings and rechecks credentials before issuing a token', async () => {
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service');
    const original = {
      id: 'user-1',
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'VENDOR',
      status: 'active',
      passwordHash: makeDemoPasswordHash('demo123'),
      credentialVersion: 0,
      vendorLinks: [
        {
          vendor: {
            id: 'vendor-a',
            name: 'Vendor A',
            status: 'active',
            restrictionReason: null,
            restrictedByUserId: null,
            restrictedAt: null,
          },
        },
      ],
    };
    findUniqueMock.mockResolvedValue(original);
    updateManyMock.mockImplementation(async ({ data }: { data: { passwordHash: string } }) => {
      findUniqueMock.mockResolvedValue({ ...original, passwordHash: data.passwordHash });
      return { count: 1 };
    });

    const result = await createAuthService(authEnv).login({
      email: 'vendor@example.com',
      password: 'demo123',
    });

    expect(result?.token).toEqual(expect.any(String));
    expect(result?.user.vendorAccess).toEqual([
      {
        vendorId: 'vendor-a',
        vendorName: 'Vendor A',
        status: 'active',
        restrictionReason: null,
        restrictionChangedByUserId: null,
        restrictionChangedAt: null,
      },
    ]);
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'vendor@example.com' },
        include: {
          vendorLinks: {
            include: {
              vendor: true,
            },
          },
        },
      }),
    );
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      select: { passwordHash: true, credentialVersion: true, status: true },
    }));
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', passwordHash: original.passwordHash, credentialVersion: 0 },
    }));
    expect(result?.timing).toMatchObject({
      dbConnectionAcquisitionMode: 'not_probed',
      vendorAccessLookupMode: 'included_in_user_lookup',
      passwordHashMode: 'demo_sha256_v1',
    });
    expect(result?.timing.userLookupMs).toEqual(expect.any(Number));
    expect(result?.timing.passwordVerificationMs).toEqual(expect.any(Number));
    expect(result?.timing.tokenSignMs).toEqual(expect.any(Number));
    expect(result?.timing.serviceTotalMs).toEqual(expect.any(Number));
    expect(JSON.stringify(result?.timing)).not.toContain('vendor@example.com');
    expect(JSON.stringify(result?.timing)).not.toContain('demo123');
    expect(JSON.stringify(result?.timing)).not.toContain(result?.token);
  });
});
