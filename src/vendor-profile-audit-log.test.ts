import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorProfileAuditLog: {
    createMany: vi.fn(),
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

const {
  auditVendorProfileChanges,
  listVendorProfileAuditLogs,
  __vendorProfileAuditLogTesting,
} = await import('../backend/src/modules/vendors/vendor-profile-audit-log.service.js');
const { registerVendorProfileAuditLogRoutes } = await import(
  '../backend/src/modules/vendors/vendor-profile-audit-log.routes.js'
);

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
    params?: Record<string, string>;
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

  registerVendorProfileAuditLogRoutes(app as never, {} as never);
  return { gets };
}

describe('vendor profile audit log service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendorProfileAuditLog.createMany.mockResolvedValue({ count: 0 });
    prismaMock.vendorProfileAuditLog.findMany.mockResolvedValue([]);
  });

  it('writes one append-only audit row per changed field', async () => {
    await auditVendorProfileChanges({
      vendorId: 'sporjinal',
      section: 'finance_policy',
      before: {
        commissionPercent: '10.00',
        commissionVatPercent: '18.00',
      },
      after: {
        commissionPercent: '12.00',
        commissionVatPercent: '20.00',
      },
      actor: {
        userId: 'admin-1',
        email: 'admin@example.test',
      },
      source: 'admin_finance_policy_update',
    });

    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'finance_policy',
          fieldName: 'commissionPercent',
          changedByUserId: 'admin-1',
          changedByEmail: 'admin@example.test',
          snapshotImpact: 'FUTURE_LEDGER_ROWS_ONLY',
        }),
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'finance_policy',
          fieldName: 'commissionVatPercent',
          snapshotImpact: 'FUTURE_LEDGER_ROWS_ONLY',
        }),
      ],
    });
    expect(prismaMock.vendorProfileAuditLog).not.toHaveProperty('update');
    expect(prismaMock.vendorProfileAuditLog).not.toHaveProperty('delete');
  });

  it('does not write audit rows when normalized values are unchanged', async () => {
    await auditVendorProfileChanges({
      vendorId: 'sporjinal',
      section: 'billing_legal_profile',
      before: {
        legalCompanyName: 'Sporjinal Ltd',
      },
      after: {
        legalCompanyName: ' Sporjinal Ltd ',
      },
      source: 'admin_billing_profile_update',
    });

    expect(prismaMock.vendorProfileAuditLog.createMany).not.toHaveBeenCalled();
  });

  it('maps provider rebind, payout, and unclear fields to explicit impacts', () => {
    expect(__vendorProfileAuditLogTesting.fieldImpact('logo_binding', 'logoIsbasiCustomerId')).toBe(
      'PROVIDER_REBIND_REQUIRED',
    );
    expect(__vendorProfileAuditLogTesting.fieldImpact('billing_legal_profile', 'iban')).toBe(
      'FUTURE_PAYOUT_RELEVANT',
    );
    expect(__vendorProfileAuditLogTesting.fieldImpact('shipping_operations', 'shippingVatPercent')).toBe(
      'UNKNOWN',
    );
  });

  it('returns audit logs newest first with safe DTO values', async () => {
    prismaMock.vendorProfileAuditLog.findMany.mockResolvedValue([
      {
        id: 'audit-new',
        vendorId: 'sporjinal',
        section: 'finance_policy',
        fieldName: 'settlementDelayDays',
        oldValue: 21,
        newValue: 0,
        changedByUserId: 'admin-1',
        changedByEmail: 'admin@example.test',
        changedAt: new Date('2026-06-18T12:00:00.000Z'),
        reason: null,
        snapshotImpact: 'FUTURE_LEDGER_ROWS_ONLY',
        source: 'admin_finance_policy_update',
      },
    ]);

    const logs = await listVendorProfileAuditLogs('sporjinal', { limit: 20 });

    expect(prismaMock.vendorProfileAuditLog.findMany).toHaveBeenCalledWith({
      where: {
        vendorId: 'sporjinal',
      },
      orderBy: {
        changedAt: 'desc',
      },
      take: 20,
    });
    expect(logs[0]).toEqual(
      expect.objectContaining({
        id: 'audit-new',
        changedAt: '2026-06-18T12:00:00.000Z',
      }),
    );
  });
});

describe('vendor profile audit log routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendorProfileAuditLog.findMany.mockResolvedValue([
      {
        id: 'audit-route',
        vendorId: 'sporjinal',
        section: 'shipping_operations',
        fieldName: 'defaultWarehouseId',
        oldValue: null,
        newValue: '55574',
        changedByUserId: null,
        changedByEmail: null,
        changedAt: new Date('2026-06-18T12:00:00.000Z'),
        reason: null,
        snapshotImpact: 'FUTURE_SHIPMENTS_AND_RETURNS_ONLY',
        source: 'admin_shipping_config_update',
      },
    ]);
  });

  it('requires admin access for audit log reads', async () => {
    const { gets } = createRegisteredRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/vendors/:vendorId/profile-audit-logs')?.(
      {
        authUser: { role: 'vendor' },
        params: { vendorId: 'sporjinal' },
      },
      reply,
    );

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ message: 'Admin access required.' });
    expect(result).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(prismaMock.vendorProfileAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('reads audit logs through the admin endpoint with section and limit filters', async () => {
    const { gets } = createRegisteredRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/vendors/:vendorId/profile-audit-logs')?.(
      {
        authUser: { role: 'admin' },
        params: { vendorId: 'sporjinal' },
        query: {
          section: 'shipping_operations',
          limit: '10',
        },
      },
      reply,
    );

    expect(prismaMock.vendorProfileAuditLog.findMany).toHaveBeenCalledWith({
      where: {
        vendorId: 'sporjinal',
        section: 'shipping_operations',
      },
      orderBy: {
        changedAt: 'desc',
      },
      take: 10,
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 'audit-route',
        changedAt: '2026-06-18T12:00:00.000Z',
      }),
    ]);
  });
});
