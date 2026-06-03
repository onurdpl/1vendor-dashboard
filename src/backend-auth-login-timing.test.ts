import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
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
    queryRawMock.mockReset();
  });

  it('returns safe stage timings and avoids a duplicate successful-login user query', async () => {
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service');
    findUniqueMock.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'VENDOR',
      status: 'active',
      passwordHash: makeDemoPasswordHash('demo123'),
      vendorLinks: [
        {
          vendor: {
            id: 'vendor-a',
            name: 'Vendor A',
          },
        },
      ],
    });

    const result = await createAuthService(authEnv).login({
      email: 'vendor@example.com',
      password: 'demo123',
    });

    expect(result?.token).toEqual(expect.any(String));
    expect(result?.user.vendorAccess).toEqual([{ vendorId: 'vendor-a', vendorName: 'Vendor A' }]);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
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
