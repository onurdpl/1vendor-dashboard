import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findUnique: vi.fn(),
  },
  vendorBillingProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  userVendorAccess: {
    findMany: vi.fn(),
  },
  vendorProfileAuditLog: {
    createMany: vi.fn(),
    findMany: vi.fn(),
  },
}));

const authenticateRequestMock = vi.hoisted(() => vi.fn(async (
  request: { authUser?: unknown },
  reply: ReturnType<typeof createReply>,
) => {
  if (!request.authUser) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}));
const requireVendorAccessMock = vi.hoisted(() => vi.fn(async (
  request: { vendorContext?: { vendorId: string }; headers?: Record<string, string> },
  reply: ReturnType<typeof createReply>,
) => {
  const requestedVendorId = request.headers?.['x-vendor-id'];
  if (requestedVendorId === 'unlinked-vendor') {
    return reply.code(403).send({ message: 'Requested vendor is not allowed for this user.' });
  }
  request.vendorContext = { vendorId: requestedVendorId ?? 'sporjinal' };
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: authenticateRequestMock,
  })),
}));

vi.mock('../backend/src/modules/vendor-access/vendor-access.middleware.js', () => ({
  requireVendorAccess: requireVendorAccessMock,
}));

const {
  bindLogoIsbasiFirmToVendor,
  getVendorBillingLegalSelfView,
  getVendorBillingProfile,
  upsertVendorBillingProfile,
  __vendorBillingProfileTesting,
} = await import('../backend/src/modules/vendors/vendor-billing-profile.service.js');
const { resolveRequestVendorContext } = await import('../backend/src/modules/vendor-access/vendor-access.service.js');
const { registerVendorBillingProfileRoutes } = await import(
  '../backend/src/modules/vendors/vendor-billing-profile.routes.js'
);

const now = new Date('2026-06-05T10:00:00.000Z');

function billingProfileRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'billing-profile-1',
    vendorId: 'sporjinal',
    legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
    taxNumber: '1111111111',
    taxOffice: 'Kadikoy',
    billingAddress: 'Billing address 1',
    billingCity: null,
    billingDistrict: null,
    iban: null,
    authorizedPerson: null,
    billingEmail: null,
    billingPhone: null,
    legalEntityType: null,
    logoIsbasiCustomerCode: null,
    logoIsbasiCustomerId: null,
    logoIsbasiEinvoiceEligible: null,
    logoIsbasiLastCheckedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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
    authUser?: { id?: string; role?: string };
    vendorContext?: { vendorId: string };
    headers?: Record<string, string>;
    params?: Record<string, string>;
    body?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

type RouteOptions = { preHandler?: Array<(request: Parameters<RouteHandler>[0], reply: ReturnType<typeof createReply>) => unknown> };

function createRegisteredRoutes() {
  const gets = new Map<string, RouteHandler>();
  const getOptions = new Map<string, RouteOptions>();
  const puts = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn((path: string, options: RouteOptions, handler: RouteHandler) => {
      gets.set(path, handler);
      getOptions.set(path, options);
    }),
    put: vi.fn((path: string, _options: unknown, handler: RouteHandler) => {
      puts.set(path, handler);
    }),
  };

  registerVendorBillingProfileRoutes(app as never, {} as never);
  return { gets, getOptions, puts };
}

async function executeGetRoute(
  route: string,
  request: Parameters<RouteHandler>[0],
  registered = createRegisteredRoutes(),
) {
  const reply = createReply();
  for (const preHandler of registered.getOptions.get(route)?.preHandler ?? []) {
    await preHandler(request, reply);
    if (reply.sent) {
      return { result: reply.payload, reply };
    }
  }
  const result = await registered.gets.get(route)?.(request, reply);
  return { result, reply };
}

describe('vendor billing profile service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockResolvedValue({ id: 'sporjinal' });
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(null);
    prismaMock.vendorBillingProfile.upsert.mockResolvedValue(billingProfileRecord());
    prismaMock.vendorBillingProfile.update.mockResolvedValue(billingProfileRecord());
    prismaMock.userVendorAccess.findMany.mockResolvedValue([]);
    prismaMock.vendorProfileAuditLog.createMany.mockResolvedValue({ count: 0 });
    prismaMock.vendorProfileAuditLog.findMany.mockResolvedValue([]);
  });

  it('returns null when a vendor has no billing profile yet', async () => {
    const result = await getVendorBillingProfile('sporjinal');

    expect(result).toBeNull();
    expect(prismaMock.vendor.findUnique).toHaveBeenCalledWith({
      where: { id: 'sporjinal' },
      select: { id: true },
    });
    expect(prismaMock.vendorBillingProfile.findUnique).toHaveBeenCalledWith({
      where: { vendorId: 'sporjinal' },
    });
  });

  it('returns an existing billing profile without secret fields', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(
      billingProfileRecord({
        iban: 'TR000000000000000000000000',
        billingEmail: 'billing@example.test',
      }),
    );

    const result = await getVendorBillingProfile('sporjinal');

    expect(result).toEqual({
      id: 'billing-profile-1',
      vendorId: 'sporjinal',
      legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
      taxNumber: '1111111111',
      taxOffice: 'Kadikoy',
      billingAddress: 'Billing address 1',
      billingCity: null,
      billingDistrict: null,
      iban: 'TR000000000000000000000000',
      authorizedPerson: null,
      billingEmail: 'billing@example.test',
      billingPhone: null,
      legalEntityType: null,
      logoIsbasiCustomerCode: null,
      logoIsbasiCustomerId: null,
      logoIsbasiEinvoiceEligible: null,
      logoIsbasiLastCheckedAt: null,
      createdAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toMatch(/password|secret|token/i);
  });

  it('returns only the approved vendor billing and legal self-view fields', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(
      billingProfileRecord({
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
        iban: 'TR000000000000000000000000',
        authorizedPerson: 'Owner',
        billingEmail: 'billing@example.test',
        billingPhone: '+905551112233',
        legalEntityType: 'limited_company',
        logoIsbasiCustomerCode: 'LOGO-CODE-1',
        logoIsbasiCustomerId: 'LOGO-ID-1',
        logoIsbasiEinvoiceEligible: true,
        logoIsbasiLastCheckedAt: now,
        unexpectedInternalField: 'do-not-expose',
      }),
    );

    const result = await getVendorBillingLegalSelfView('sporjinal');

    expect(result).toEqual({
      legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
      legalEntityType: 'limited_company',
      taxNumber: '1111111111',
      taxOffice: 'Kadikoy',
      billingAddress: 'Billing address 1',
      billingCity: 'Istanbul',
      billingDistrict: 'Kadikoy',
      authorizedPerson: 'Owner',
      billingEmail: 'billing@example.test',
      billingPhone: '+905551112233',
      iban: 'TR000000000000000000000000',
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('vendorId');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('logoIsbasiCustomerCode');
    expect(result).not.toHaveProperty('logoIsbasiCustomerId');
    expect(result).not.toHaveProperty('logoIsbasiEinvoiceEligible');
    expect(result).not.toHaveProperty('logoIsbasiLastCheckedAt');
    expect(result).not.toHaveProperty('unexpectedInternalField');
  });

  it('preserves nullable values in the vendor billing and legal self-view', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(billingProfileRecord());

    const result = await getVendorBillingLegalSelfView('sporjinal');

    expect(result).toMatchObject({
      legalEntityType: null,
      billingCity: null,
      billingDistrict: null,
      authorizedPerson: null,
      billingEmail: null,
      billingPhone: null,
      iban: null,
    });
  });

  it('returns null for a missing vendor billing and legal self-view profile', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(null);

    await expect(getVendorBillingLegalSelfView('sporjinal')).resolves.toBeNull();
  });

  it('upserts a trimmed billing profile for an existing vendor', async () => {
    prismaMock.vendorBillingProfile.upsert.mockResolvedValue(
      billingProfileRecord({
        legalCompanyName: 'Sporjinal Ltd',
        taxNumber: '2222222222',
        taxOffice: 'Besiktas',
        billingAddress: 'Address 2',
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
        iban: null,
        authorizedPerson: 'Owner',
        billingEmail: 'billing@sporjinal.test',
        billingPhone: '+905551112233',
        legalEntityType: 'limited_company',
        logoIsbasiCustomerCode: 'LOGO-CODE-1',
        logoIsbasiCustomerId: 'LOGO-ID-1',
        logoIsbasiEinvoiceEligible: true,
        logoIsbasiLastCheckedAt: now,
      }),
    );

    const result = await upsertVendorBillingProfile('sporjinal', {
      legalCompanyName: '  Sporjinal Ltd  ',
      taxNumber: ' 2222222222 ',
      taxOffice: ' Besiktas ',
      billingAddress: ' Address 2 ',
      billingCity: ' Istanbul ',
      billingDistrict: ' Kadikoy ',
      iban: '',
      authorizedPerson: ' Owner ',
      billingEmail: ' billing@sporjinal.test ',
      billingPhone: ' +905551112233 ',
      legalEntityType: ' limited_company ',
      logoIsbasiCustomerCode: ' LOGO-CODE-1 ',
      logoIsbasiCustomerId: ' LOGO-ID-1 ',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: '2026-06-05T10:00:00.000Z',
    });

    expect(prismaMock.vendorBillingProfile.upsert).toHaveBeenCalledWith({
      where: { vendorId: 'sporjinal' },
      update: {
        legalCompanyName: 'Sporjinal Ltd',
        taxNumber: '2222222222',
        taxOffice: 'Besiktas',
        billingAddress: 'Address 2',
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
        iban: null,
        authorizedPerson: 'Owner',
        billingEmail: 'billing@sporjinal.test',
        billingPhone: '+905551112233',
        legalEntityType: 'limited_company',
        logoIsbasiCustomerCode: 'LOGO-CODE-1',
      },
      create: {
        vendorId: 'sporjinal',
        legalCompanyName: 'Sporjinal Ltd',
        taxNumber: '2222222222',
        taxOffice: 'Besiktas',
        billingAddress: 'Address 2',
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
        iban: null,
        authorizedPerson: 'Owner',
        billingEmail: 'billing@sporjinal.test',
        billingPhone: '+905551112233',
        legalEntityType: 'limited_company',
        logoIsbasiCustomerCode: 'LOGO-CODE-1',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        legalCompanyName: 'Sporjinal Ltd',
        taxNumber: '2222222222',
        taxOffice: 'Besiktas',
        billingAddress: 'Address 2',
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
      }),
    );
    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'billing_legal_profile',
          fieldName: 'legalCompanyName',
          snapshotImpact: 'FUTURE_SETTLEMENT_APPROVALS_ONLY',
        }),
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'billing_legal_profile',
          fieldName: 'billingEmail',
          snapshotImpact: 'FUTURE_SETTLEMENT_APPROVALS_ONLY',
        }),
      ]),
    });
  });

  it('does not write audit rows when normalized billing values are unchanged', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(
      billingProfileRecord({
        legalCompanyName: 'Sporjinal Ltd',
        taxNumber: '2222222222',
        taxOffice: 'Besiktas',
        billingAddress: 'Address 2',
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
        logoIsbasiCustomerCode: 'CUST001',
      }),
    );
    prismaMock.vendorBillingProfile.upsert.mockResolvedValue(
      billingProfileRecord({
        legalCompanyName: 'Sporjinal Ltd',
        taxNumber: '2222222222',
        taxOffice: 'Besiktas',
        billingAddress: 'Address 2',
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
        logoIsbasiCustomerCode: 'CUST001',
      }),
    );

    await upsertVendorBillingProfile('sporjinal', {
      legalCompanyName: ' Sporjinal Ltd ',
      taxNumber: ' 2222222222 ',
      taxOffice: ' Besiktas ',
      billingAddress: ' Address 2 ',
      billingCity: ' Istanbul ',
      billingDistrict: ' Kadikoy ',
      logoIsbasiCustomerCode: ' CUST001 ',
    });

    expect(prismaMock.vendorProfileAuditLog.createMany).not.toHaveBeenCalled();
  });

  it('clears stale Logo İşbaşı binding fields when customer code changes manually', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValueOnce(
      billingProfileRecord({
        logoIsbasiCustomerCode: 'CUST001',
      }),
    );
    prismaMock.vendorBillingProfile.upsert.mockResolvedValue(
      billingProfileRecord({
        logoIsbasiCustomerCode: 'YSKOD1',
        logoIsbasiCustomerId: null,
        logoIsbasiEinvoiceEligible: null,
        logoIsbasiLastCheckedAt: null,
      }),
    );

    await upsertVendorBillingProfile('sporjinal', {
      legalCompanyName: 'Sporjinal Ltd',
      taxNumber: '2222222222',
      taxOffice: 'Besiktas',
      billingAddress: 'Address 2',
      logoIsbasiCustomerCode: 'YSKOD1',
    });

    expect(prismaMock.vendorBillingProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          logoIsbasiCustomerCode: 'YSKOD1',
          logoIsbasiCustomerId: null,
          logoIsbasiEinvoiceEligible: null,
          logoIsbasiLastCheckedAt: null,
        }),
      }),
    );
  });

  it('does not clear Logo İşbaşı binding fields when customer code is unchanged', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValueOnce(
      billingProfileRecord({
        logoIsbasiCustomerCode: 'CUST001',
      }),
    );

    await upsertVendorBillingProfile('sporjinal', {
      legalCompanyName: 'Sporjinal Ltd',
      taxNumber: '2222222222',
      taxOffice: 'Besiktas',
      billingAddress: 'Address 2',
      logoIsbasiCustomerCode: ' CUST001 ',
    });

    const updateData = prismaMock.vendorBillingProfile.upsert.mock.calls[0][0].update;
    expect(updateData).toEqual(expect.objectContaining({ logoIsbasiCustomerCode: 'CUST001' }));
    expect(updateData).not.toHaveProperty('logoIsbasiCustomerId');
    expect(updateData).not.toHaveProperty('logoIsbasiEinvoiceEligible');
    expect(updateData).not.toHaveProperty('logoIsbasiLastCheckedAt');
  });

  it.each([
    ['legalCompanyName', { legalCompanyName: '', taxNumber: '1', taxOffice: 'Office', billingAddress: 'Address' }],
    ['taxNumber', { legalCompanyName: 'Company', taxNumber: null, taxOffice: 'Office', billingAddress: 'Address' }],
    ['taxOffice', { legalCompanyName: 'Company', taxNumber: '1', taxOffice: [], billingAddress: 'Address' }],
    ['billingAddress', { legalCompanyName: 'Company', taxNumber: '1', taxOffice: 'Office', billingAddress: {} }],
  ])('requires %s on update', async (field, input) => {
    await expect(upsertVendorBillingProfile('sporjinal', input)).rejects.toThrow(`${field} is required.`);
    expect(prismaMock.vendorBillingProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-string optional values', () => {
    expect(() =>
      __vendorBillingProfileTesting.normalizeBillingProfileInput({
        legalCompanyName: 'Company',
        taxNumber: '1',
        taxOffice: 'Office',
        billingAddress: 'Address',
        billingEmail: { value: 'billing@example.test' },
      }),
    ).toThrow('billingEmail must be a string or null.');
  });

  it('allows only Logo İşbaşı customer code through admin billing profile input', () => {
    const result = __vendorBillingProfileTesting.normalizeBillingProfileInput({
      legalCompanyName: 'Company',
      taxNumber: '1',
      taxOffice: 'Office',
      billingAddress: 'Address',
      logoIsbasiCustomerCode: ' CUST001 ',
      logoIsbasiCustomerId: 'LOGO-ID-1',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: '2026-06-05T10:00:00.000Z',
    });

    expect(result).toEqual(
      expect.objectContaining({
        logoIsbasiCustomerCode: 'CUST001',
      }),
    );
    expect(result).not.toHaveProperty('logoIsbasiCustomerId');
    expect(result).not.toHaveProperty('logoIsbasiEinvoiceEligible');
    expect(result).not.toHaveProperty('logoIsbasiLastCheckedAt');
  });

  it('binds and rebinds Logo İşbaşı firm identity through the dedicated binding path', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(
      billingProfileRecord({
        logoIsbasiCustomerCode: 'CUST001',
        logoIsbasiCustomerId: 'firm-1',
        logoIsbasiEinvoiceEligible: false,
        logoIsbasiLastCheckedAt: new Date('2026-06-04T10:00:00.000Z'),
      }),
    );
    prismaMock.vendorBillingProfile.update.mockResolvedValue(
      billingProfileRecord({
        logoIsbasiCustomerCode: 'CUST005',
        logoIsbasiCustomerId: 'firm-5',
        logoIsbasiEinvoiceEligible: true,
        logoIsbasiLastCheckedAt: now,
      }),
    );

    const result = await bindLogoIsbasiFirmToVendor('sporjinal', {
      logoIsbasiCustomerCode: 'CUST005',
      logoIsbasiCustomerId: 'firm-5',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: now,
    });

    expect(prismaMock.vendorBillingProfile.update).toHaveBeenCalledWith({
      where: { vendorId: 'sporjinal' },
      data: {
        logoIsbasiCustomerCode: 'CUST005',
        logoIsbasiCustomerId: 'firm-5',
        logoIsbasiEinvoiceEligible: true,
        logoIsbasiLastCheckedAt: now,
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        logoIsbasiCustomerCode: 'CUST005',
        logoIsbasiCustomerId: 'firm-5',
        logoIsbasiEinvoiceEligible: true,
        logoIsbasiLastCheckedAt: '2026-06-05T10:00:00.000Z',
      }),
    );
    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'logo_binding',
          fieldName: 'logoIsbasiCustomerCode',
          snapshotImpact: 'PROVIDER_REBIND_REQUIRED',
        }),
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'logo_binding',
          fieldName: 'logoIsbasiCustomerId',
          snapshotImpact: 'PROVIDER_REBIND_REQUIRED',
        }),
      ]),
    });
  });

  it('fails closed when the vendor does not exist', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue(null);

    await expect(
      upsertVendorBillingProfile('missing-vendor', {
        legalCompanyName: 'Company',
        taxNumber: '1',
        taxOffice: 'Office',
        billingAddress: 'Address',
      }),
    ).rejects.toThrow('Vendor could not be found.');
    expect(prismaMock.vendorBillingProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('vendor billing context isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a vendor own linked context and denies an unlinked context', async () => {
    prismaMock.userVendorAccess.findMany.mockResolvedValue([
      { vendorId: 'sporjinal', vendor: { name: 'Sporjinal', status: 'active' } },
    ]);
    const user = { id: 'vendor-user-1', role: 'vendor' as const };

    await expect(resolveRequestVendorContext(user as never, 'sporjinal')).resolves.toMatchObject({
      ok: true,
      context: { vendorId: 'sporjinal' },
    });
    await expect(resolveRequestVendorContext(user as never, 'unlinked-vendor')).resolves.toEqual({
      ok: false,
      code: 403,
      message: 'Requested vendor is not allowed for this user.',
    });
  });

  it('requires an explicit context for a vendor linked to multiple vendors', async () => {
    prismaMock.userVendorAccess.findMany.mockResolvedValue([
      { vendorId: 'vendor-a', vendor: { name: 'Vendor A', status: 'active' } },
      { vendorId: 'vendor-b', vendor: { name: 'Vendor B', status: 'active' } },
    ]);

    await expect(resolveRequestVendorContext({ id: 'vendor-user-1', role: 'vendor' } as never)).resolves.toEqual({
      ok: false,
      code: 400,
      message: 'Vendor context is required for this user.',
    });
  });
});

describe('vendor billing profile routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockResolvedValue({ id: 'sporjinal' });
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(null);
    prismaMock.vendorBillingProfile.upsert.mockResolvedValue(billingProfileRecord());
    authenticateRequestMock.mockClear();
    requireVendorAccessMock.mockClear();
  });

  it('registers and serves the vendor self-view through auth, role, and vendor access guards', async () => {
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(billingProfileRecord({
      iban: 'TR000000000000000000000000',
    }));
    const registered = createRegisteredRoutes();
    const options = registered.getOptions.get('/vendor/billing-profile');

    expect(options?.preHandler).toHaveLength(3);
    expect(options?.preHandler?.[0]).toBe(authenticateRequestMock);
    expect(options?.preHandler?.[2]).toBe(requireVendorAccessMock);

    const { result, reply } = await executeGetRoute('/vendor/billing-profile', {
      authUser: { id: 'vendor-user-1', role: 'vendor' },
      headers: { 'x-vendor-id': 'sporjinal' },
    }, registered);

    expect(reply.sent).toBe(false);
    expect(requireVendorAccessMock).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
      iban: 'TR000000000000000000000000',
    }));
    expect(result).not.toHaveProperty('vendorId');
    expect(prismaMock.vendorBillingProfile.findUnique).toHaveBeenCalledWith({ where: { vendorId: 'sporjinal' } });
  });

  it('denies unauthenticated, admin, support, finance, and unlinked vendor self-view requests', async () => {
    const unauthenticated = await executeGetRoute('/vendor/billing-profile', {});
    expect(unauthenticated.reply.statusCode).toBe(401);

    for (const role of ['admin', 'support', 'finance'] as const) {
      const denied = await executeGetRoute('/vendor/billing-profile', {
        authUser: { id: `${role}-user`, role },
        headers: { 'x-vendor-id': 'sporjinal' },
      });
      expect(denied.reply.statusCode).toBe(403);
      expect(denied.reply.payload).toEqual({ message: 'Vendor access required.' });
    }

    const unlinked = await executeGetRoute('/vendor/billing-profile', {
      authUser: { id: 'vendor-user-1', role: 'vendor' },
      headers: { 'x-vendor-id': 'unlinked-vendor' },
    });
    expect(unlinked.reply.statusCode).toBe(403);
    expect(unlinked.reply.payload).toEqual({ message: 'Requested vendor is not allowed for this user.' });
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
  });

  it('requires admin access for billing profile reads', async () => {
    const { gets } = createRegisteredRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/vendors/:vendorId/billing-profile')?.(
      {
        authUser: { role: 'vendor' },
        params: { vendorId: 'sporjinal' },
      },
      reply,
    );

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ message: 'Admin access required.' });
    expect(result).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
  });

  it('returns null for an admin read when no profile exists', async () => {
    const { gets } = createRegisteredRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/vendors/:vendorId/billing-profile')?.(
      {
        authUser: { role: 'admin' },
        params: { vendorId: 'sporjinal' },
      },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(result).toBeNull();
  });

  it('creates a billing profile through the admin route', async () => {
    const { puts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await puts.get('/admin/vendors/:vendorId/billing-profile')?.(
      {
        authUser: { role: 'admin' },
        params: { vendorId: 'sporjinal' },
        body: {
          legalCompanyName: 'Sporjinal Ltd',
          taxNumber: '1111111111',
          taxOffice: 'Kadikoy',
          billingAddress: 'Address 1',
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        vendorId: 'sporjinal',
        legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
      }),
    );
    expect(prismaMock.vendorBillingProfile.upsert).toHaveBeenCalledTimes(1);
  });

  it('returns a readable 400 for invalid billing profile input', async () => {
    const { puts } = createRegisteredRoutes();
    const reply = createReply();

    await puts.get('/admin/vendors/:vendorId/billing-profile')?.(
      {
        authUser: { role: 'admin' },
        params: { vendorId: 'sporjinal' },
        body: {
          legalCompanyName: '',
          taxNumber: '1111111111',
          taxOffice: 'Kadikoy',
          billingAddress: 'Address 1',
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({ message: 'legalCompanyName is required.' });
  });
});
