import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { buildAuthHashReport } from '../backend/src/modules/auth/auth-hash-report.cli.js';
import { hashPasswordArgon2id, makeDemoPasswordHash } from '../backend/src/modules/auth/password-hashing.js';
import { upsertSeedUser } from '../backend/prisma/seed-user-utils.js';

const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
      findMany: vi.fn(),
    },
    $queryRaw: queryRawMock,
  },
}));

const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');

const authEnv = {
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '1h',
} as AppEnv;

function buildUser(passwordHash: string) {
  return {
    id: 'user-1',
    email: 'vendor@example.com',
    name: 'Vendor User',
    role: 'VENDOR',
    status: 'active',
    passwordHash,
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
}

function expectLoginResponseShape(result: Awaited<ReturnType<ReturnType<typeof createAuthService>['login']>>) {
  expect(result).toEqual(
    expect.objectContaining({
      token: expect.any(String),
      user: expect.objectContaining({
        id: 'user-1',
        email: 'vendor@example.com',
        role: 'vendor',
        vendorAccess: [
          {
            vendorId: 'vendor-a',
            vendorName: 'Vendor A',
            status: 'active',
            restrictionReason: null,
            restrictionChangedByUserId: null,
            restrictionChangedAt: null,
          },
        ],
      }),
      timing: expect.any(Object),
    }),
  );
}

describe('auth password hashing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRawMock.mockReset();
  });

  it('lets an Argon2id user login without changing the response shape', async () => {
    const passwordHash = await hashPasswordArgon2id('demo123');
    findUniqueMock.mockResolvedValueOnce(buildUser(passwordHash));

    const result = await createAuthService(authEnv).login({
      email: 'vendor@example.com',
      password: 'demo123',
    });

    expectLoginResponseShape(result);
    expect(result?.timing.passwordHashMode).toBe('argon2id');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('lets a user with a restricted vendor account login', async () => {
    const passwordHash = await hashPasswordArgon2id('demo123');
    findUniqueMock.mockResolvedValueOnce({
      ...buildUser(passwordHash),
      vendorLinks: [
        {
          vendor: {
            id: 'vendor-a',
            name: 'Vendor A',
            status: 'inactive',
            restrictionReason: 'Operational review',
            restrictedByUserId: 'admin-user-1',
            restrictedAt: new Date('2026-07-01T10:00:00.000Z'),
          },
        },
      ],
    });

    const result = await createAuthService(authEnv).login({
      email: 'vendor@example.com',
      password: 'demo123',
    });

    expect(result?.user.vendorAccess).toEqual([
      {
        vendorId: 'vendor-a',
        vendorName: 'Vendor A',
        status: 'inactive',
        restrictionReason: 'Operational review',
        restrictionChangedByUserId: 'admin-user-1',
        restrictionChangedAt: '2026-07-01T10:00:00.000Z',
      },
    ]);
    expect(result?.token).toEqual(expect.any(String));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('lets a legacy demo_sha256_v1 user login and migrates the hash to Argon2id', async () => {
    findUniqueMock.mockResolvedValueOnce(buildUser(makeDemoPasswordHash('demo123')));
    updateMock.mockResolvedValueOnce({});

    const result = await createAuthService(authEnv).login({
      email: 'vendor@example.com',
      password: 'demo123',
    });

    expectLoginResponseShape(result);
    expect(result?.timing.passwordHashMode).toBe('demo_sha256_v1');
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: expect.stringMatching(/^\$argon2id\$/),
      },
    });
  });

  it('does not migrate a legacy demo_sha256_v1 user after a failed login', async () => {
    findUniqueMock.mockResolvedValueOnce(buildUser(makeDemoPasswordHash('demo123')));

    const result = await createAuthService(authEnv).login({
      email: 'vendor@example.com',
      password: 'wrong',
    });

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not overwrite existing passwordHash values in seed updates', async () => {
    const userUpsert = vi.fn().mockResolvedValue({ id: 'seed-user-1' });
    const userVendorAccessCreateMany = vi.fn().mockResolvedValue({ count: 1 });

    await upsertSeedUser(
      {
        user: { upsert: userUpsert },
        userVendorAccess: { createMany: userVendorAccessCreateMany },
      },
      {
        email: 'vendor@example.com',
        name: 'Vendor User',
        role: 'VENDOR',
        vendorIds: ['sporjinal'],
      },
      {
        hashPassword: async () => '$argon2id$seeded',
      },
    );

    expect(userUpsert).toHaveBeenCalledWith({
      where: { email: 'vendor@example.com' },
      update: {
        name: 'Vendor User',
        role: 'VENDOR',
        status: 'active',
      },
      create: {
        email: 'vendor@example.com',
        name: 'Vendor User',
        role: 'VENDOR',
        status: 'active',
        passwordHash: '$argon2id$seeded',
      },
    });
    expect(userUpsert.mock.calls[0][0].update).not.toHaveProperty('passwordHash');
  });

  it('builds a hash report with scheme counts only', () => {
    const bcryptHash = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO';
    const reportText = JSON.stringify(
      buildAuthHashReport([
        { passwordHash: makeDemoPasswordHash('demo123') },
        { passwordHash: '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$hash' },
        { passwordHash: bcryptHash },
        { passwordHash: 'unsupported-hash' },
      ]),
    );

    expect(JSON.parse(reportText)).toEqual({
      userCount: 4,
      schemes: {
        argon2id: 1,
        demo_sha256_v1: 1,
        bcrypt: 1,
        other: 1,
      },
    });
    expect(reportText).not.toContain(makeDemoPasswordHash('demo123'));
    expect(reportText).not.toContain(bcryptHash);
    expect(reportText).not.toContain('unsupported-hash');
  });

  it('keeps the legacy demo hash helper deterministic for migration compatibility', () => {
    expect(makeDemoPasswordHash('demo123')).toBe(
      `demo_sha256_v1:${createHash('sha256').update('vendor-dashboard-demo:demo123').digest('hex')}`,
    );
  });
});
