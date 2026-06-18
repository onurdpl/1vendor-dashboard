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
  bindLogoIsbasiFirmToVendor,
  getVendorBillingProfile,
  upsertVendorBillingProfile,
  __vendorBillingProfileTesting,
} = await import('../backend/src/modules/vendors/vendor-billing-profile.service.js');
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
    authUser?: { role?: string };
    params?: Record<string, string>;
    body?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

function createRegisteredRoutes() {
  const gets = new Map<string, RouteHandler>();
  const puts = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn((path: string, _options: unknown, handler: RouteHandler) => {
      gets.set(path, handler);
    }),
    put: vi.fn((path: string, _options: unknown, handler: RouteHandler) => {
      puts.set(path, handler);
    }),
  };

  registerVendorBillingProfileRoutes(app as never, {} as never);
  return { gets, puts };
}

describe('vendor billing profile service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockResolvedValue({ id: 'sporjinal' });
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(null);
    prismaMock.vendorBillingProfile.upsert.mockResolvedValue(billingProfileRecord());
    prismaMock.vendorBillingProfile.update.mockResolvedValue(billingProfileRecord());
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

describe('vendor billing profile routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendor.findUnique.mockResolvedValue({ id: 'sporjinal' });
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(null);
    prismaMock.vendorBillingProfile.upsert.mockResolvedValue(billingProfileRecord());
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
