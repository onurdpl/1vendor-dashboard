import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vendor: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  userVendorAccess: {
    create: vi.fn(),
  },
  vendorProfileAuditLog: {
    createMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  provisionVendor,
  VendorProvisioningError,
  __vendorProvisioningTesting,
} = await import('../backend/src/modules/vendors/vendor-provisioning.service.js');
const { registerVendorProvisioningRoutes } = await import(
  '../backend/src/modules/vendors/vendor-provisioning.routes.js'
);
const { verifyPasswordHash } = await import('../backend/src/modules/auth/password-hashing.js');
const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');

const authEnv = {
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '1h',
} as AppEnv;

const provisioningBody = {
  vendorId: 'newvendor',
  vendorName: 'New Vendor',
  adminName: 'Vendor Admin',
  adminEmail: 'ADMIN@NEWVENDOR.TEST',
  adminPhone: '+90 555 111 2233',
  restrictionReason: 'Operational review',
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

function createRegisteredRoutes() {
  const posts = new Map<string, (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => unknown>();
  const app = {
    post: vi.fn((path: string, _options: unknown, handler: (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => unknown) => {
      posts.set(path, handler);
    }),
  };

  registerVendorProvisioningRoutes(app as never, authEnv);

  return {
    posts,
  };
}

function setupProvisioningMocks() {
  prismaMock.vendor.findUnique.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.vendor.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: data.id,
    name: data.name,
    status: data.status,
    restrictionReason: data.restrictionReason,
  }));
  prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'user-newvendor-admin',
    email: data.email,
  }));
  prismaMock.userVendorAccess.create.mockResolvedValue({ id: 'access-newvendor-admin' });
  prismaMock.vendorProfileAuditLog.createMany.mockResolvedValue({ count: 1 });
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
}

function buildProvisionedLoginRecord(passwordHash: string) {
  return {
    id: 'user-newvendor-admin',
    email: 'admin@newvendor.test',
    name: 'Vendor Admin',
    role: 'VENDOR',
    status: 'active',
    passwordHash,
    vendorLinks: [
      {
        vendor: {
          id: 'newvendor',
          name: 'New Vendor',
          status: 'inactive',
          restrictionReason: 'Operational review',
          restrictedByUserId: 'admin-user-1',
          restrictedAt: new Date('2026-07-04T10:00:00.000Z'),
        },
      },
    ],
  };
}

describe('backend vendor provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvisioningMocks();
  });

  it('creates a restricted vendor, initial vendor admin user, access link, and audit record in one transaction', async () => {
    const result = await provisionVendor(provisioningBody, {
      actor: {
        userId: 'admin-user-1',
        email: 'admin@sporgym.test',
      },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.vendor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'newvendor',
          name: 'New Vendor',
          status: 'inactive',
          restrictionReason: 'Operational review',
          restrictedByUserId: 'admin-user-1',
          restrictedAt: expect.any(Date),
        }),
      }),
    );
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@newvendor.test',
          name: 'Vendor Admin',
          role: 'VENDOR',
          status: 'active',
          passwordHash: expect.stringMatching(/^\$argon2id\$/),
        }),
      }),
    );
    expect(prismaMock.user.create.mock.calls[0]?.[0].data).not.toHaveProperty('adminPhone');
    expect(prismaMock.userVendorAccess.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-newvendor-admin',
        vendorId: 'newvendor',
      },
    });
    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          vendorId: 'newvendor',
          section: 'vendor_status',
          fieldName: 'status',
          newValue: 'inactive',
          changedByUserId: 'admin-user-1',
          changedByEmail: 'admin@sporgym.test',
          reason: 'Operational review',
          source: 'admin_vendor_provisioning',
        }),
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({
        vendorId: 'newvendor',
        vendorName: 'New Vendor',
        adminUserId: 'user-newvendor-admin',
        adminEmail: 'admin@newvendor.test',
        vendorStatus: 'inactive',
        restrictionReason: 'Operational review',
        temporaryPassword: expect.stringMatching(/^spg_/),
      }),
    );
  });

  it('returns the temporary password once without storing it in user or audit records', async () => {
    const result = await provisionVendor(provisioningBody, {
      actor: {
        userId: 'admin-user-1',
        email: 'admin@sporgym.test',
      },
    });
    const createdUserData = prismaMock.user.create.mock.calls[0]?.[0].data;
    const createdAuditData = prismaMock.vendorProfileAuditLog.createMany.mock.calls[0]?.[0].data;

    expect(createdUserData.passwordHash).not.toBe(result.temporaryPassword);
    expect(await verifyPasswordHash(createdUserData.passwordHash, result.temporaryPassword)).toEqual(
      expect.objectContaining({
        valid: true,
        scheme: 'argon2id',
      }),
    );
    expect(JSON.stringify(createdUserData)).not.toContain(result.temporaryPassword);
    expect(JSON.stringify(createdAuditData)).not.toContain(result.temporaryPassword);
  });

  it('lets the provisioned restricted vendor admin log in with the temporary password', async () => {
    const result = await provisionVendor(provisioningBody, {
      actor: {
        userId: 'admin-user-1',
        email: 'admin@sporgym.test',
      },
    });
    const passwordHash = prismaMock.user.create.mock.calls[0]?.[0].data.passwordHash;
    prismaMock.user.findUnique.mockResolvedValueOnce(buildProvisionedLoginRecord(passwordHash));

    const loginResult = await createAuthService(authEnv).login({
      email: 'ADMIN@NEWVENDOR.TEST',
      password: result.temporaryPassword,
    });

    expect(loginResult?.token).toEqual(expect.any(String));
    expect(loginResult?.user).toEqual(
      expect.objectContaining({
        email: 'admin@newvendor.test',
        role: 'vendor',
        vendorAccess: [
          {
            vendorId: 'newvendor',
            vendorName: 'New Vendor',
            status: 'inactive',
            restrictionReason: 'Operational review',
            restrictionChangedByUserId: 'admin-user-1',
            restrictionChangedAt: '2026-07-04T10:00:00.000Z',
          },
        ],
      }),
    );
  });

  it('rejects duplicate vendor ids without creating records', async () => {
    prismaMock.vendor.findUnique.mockResolvedValueOnce({ id: 'newvendor' });

    await expect(provisionVendor(provisioningBody)).rejects.toMatchObject({
      message: 'A vendor with this ID already exists.',
      statusCode: 409,
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate admin emails without attaching an existing user', async () => {
    prismaMock.vendor.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });

    await expect(provisionVendor(provisioningBody)).rejects.toMatchObject({
      message: 'A user with this email already exists.',
      statusCode: 409,
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.userVendorAccess.create).not.toHaveBeenCalled();
  });

  it('requires manually entered vendor ids to match Shopify seller_info normalization', () => {
    expect(__vendorProvisioningTesting.normalizeProvisionedVendorId('newvendor-01')).toBe('newvendor-01');
    expect(() => __vendorProvisioningTesting.normalizeProvisionedVendorId('NewVendor')).toThrow(
      'vendorId must use lowercase letters, numbers, hyphen, or underscore so it matches Shopify seller_info after current ingestion normalization.',
    );
    expect(() => __vendorProvisioningTesting.normalizeProvisionedVendorId('new/vendor')).toThrow(
      'vendorId must not contain path separators.',
    );
  });

  it('exposes an admin-only provisioning route', async () => {
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/provision')?.(
      {
        authUser: {
          id: 'admin-user-1',
          email: 'admin@sporgym.test',
          name: 'Demo Admin',
          role: 'admin',
          status: 'active',
        },
        body: provisioningBody,
      },
      reply,
    );

    expect(reply.statusCode).toBe(201);
    expect(result).toEqual({
      status: 201,
      body: expect.objectContaining({
        vendorId: 'newvendor',
        adminEmail: 'admin@newvendor.test',
        temporaryPassword: expect.stringMatching(/^spg_/),
      }),
    });
    expect(prismaMock.vendor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restrictedByUserId: 'admin-user-1',
        }),
      }),
    );
  });

  it.each([
    ['vendor', { id: 'vendor-user-1', email: 'vendor@example.test', name: 'Vendor', role: 'vendor', status: 'active' }],
    ['support', { id: 'support-user-1', email: 'support@example.test', name: 'Support', role: 'support', status: 'active' }],
    ['unauthenticated', undefined],
  ])('rejects %s provisioning requests', async (_label, authUser) => {
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/provision')?.(
      {
        authUser,
        body: provisioningBody,
      },
      reply,
    );

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(prismaMock.vendor.create).not.toHaveBeenCalled();
  });

  it('returns duplicate errors from the provisioning route with the service status code', async () => {
    prismaMock.vendor.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/provision')?.(
      {
        authUser: {
          id: 'admin-user-1',
          email: 'admin@sporgym.test',
          name: 'Demo Admin',
          role: 'admin',
          status: 'active',
        },
        body: provisioningBody,
      },
      reply,
    );

    expect(reply.statusCode).toBe(409);
    expect(result).toEqual({ status: 409, body: { message: 'A user with this email already exists.' } });
  });

  it('returns validation errors from the provisioning route without creating records', async () => {
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/provision')?.(
      {
        authUser: {
          id: 'admin-user-1',
          email: 'admin@sporgym.test',
          name: 'Demo Admin',
          role: 'admin',
          status: 'active',
        },
        body: {
          ...provisioningBody,
          vendorId: 'NewVendor',
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(400);
    expect(result).toEqual({
      status: 400,
      body: {
        message:
          'vendorId must use lowercase letters, numbers, hyphen, or underscore so it matches Shopify seller_info after current ingestion normalization.',
      },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
