import { beforeEach, describe, expect, it, vi } from 'vitest';

const getVendorBillingProfileMock = vi.hoisted(() => vi.fn());
const bindLogoIsbasiFirmToVendorMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/vendors/vendor-billing-profile.service.js', async () => {
  const actual = await vi.importActual<typeof import('../backend/src/modules/vendors/vendor-billing-profile.service.js')>(
    '../backend/src/modules/vendors/vendor-billing-profile.service.js',
  );
  return {
    ...actual,
    bindLogoIsbasiFirmToVendor: bindLogoIsbasiFirmToVendorMock,
    getVendorBillingProfile: getVendorBillingProfileMock,
  };
});

const {
  LogoIsbasiClient,
  extractSessionFromLoginResponse,
  sanitizeLoginResponse,
} = await import('../backend/src/modules/logo-isbasi/logo-isbasi.client.js');
const {
  buildLogoIsbasiCommissionInvoicePreview,
  sanitizeLogoIsbasiInvoicePreviewPayload,
} = await import('../backend/src/modules/logo-isbasi/logo-isbasi-commission-preview.js');
const { extractInvoiceShape, registerLogoIsbasiRoutes } = await import('../backend/src/modules/logo-isbasi/logo-isbasi.routes.js');

const vendorBillingProfile = {
  id: 'billing-sporjinal',
  vendorId: 'sporjinal',
  legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
  taxNumber: '6490512763',
  taxOffice: 'Kadikoy',
  billingAddress: 'Billing address 1',
  billingCity: 'Istanbul',
  billingDistrict: 'Atasehir',
  iban: null,
  authorizedPerson: 'Authorized User',
  billingEmail: 'billing@sporjinal.test',
  billingPhone: '+905551112233',
  legalEntityType: 'limited_company',
  logoIsbasiCustomerCode: 'LOGO-CUSTOMER-1',
  logoIsbasiCustomerId: 'LOGO-ID-1',
  logoIsbasiEinvoiceEligible: true,
  logoIsbasiLastCheckedAt: '2026-06-07T10:00:00.000Z',
  createdAt: '2026-06-07T10:00:00.000Z',
  updatedAt: '2026-06-07T10:00:00.000Z',
};

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return {
        send: vi.fn((body: unknown) => {
          reply.payload = body;
          return body;
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

function createRegisteredRoutes(envOverrides: Record<string, unknown> = {}) {
  const posts = new Map<string, RouteHandler>();
  const app = {
    post: vi.fn((path: string, _options: unknown, handler: RouteHandler) => {
      posts.set(path, handler);
    }),
  };

  registerLogoIsbasiRoutes(app as never, {
    LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
    LOGO_ISBASI_API_KEY: 'api-key-secret',
    LOGO_ISBASI_USERNAME: 'integration-user@example.test',
    LOGO_ISBASI_PASSWORD: 'password-secret',
    ...envOverrides,
  } as never);

  return { posts };
}

describe('Logo İşbaşı client and commission invoice preview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.ADMIN_PROBES_ENABLED = 'true';
    getVendorBillingProfileMock.mockResolvedValue(vendorBillingProfile);
    bindLogoIsbasiFirmToVendorMock.mockResolvedValue({
      ...vendorBillingProfile,
      logoIsbasiCustomerCode: 'CUST001',
      logoIsbasiCustomerId: 'firm-1',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: '2026-06-08T10:00:00.000Z',
    });
  });

  it('sends the documented integration login request shape', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { accessToken: 'abcdef123456', tenantId: 'tenant-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new LogoIsbasiClient({
      baseUrl: 'https://soho-isbasi-mwv2-test.logo-paas.com/',
      apiKey: 'api-key-secret',
      username: 'integration-user@example.test',
      password: 'password-secret',
      fetchImpl: fetchMock as never,
    });

    await client.login();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://soho-isbasi-mwv2-test.logo-paas.com/api/v1.0/user/integrationLogin',
      expect.objectContaining({
        method: 'POST',
        headers: {
          apiKey: 'api-key-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'integration-user@example.test',
          password: 'password-secret',
        }),
      }),
    );
  });

  it('reuses login session for firm discovery and returns sanitized firm samples', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: 'firm-1',
              code: 'CARI-1',
              name: 'Sporjinal Spor Malzemeleri A.S.',
              firmType: 'customer',
              taxNumber: '6490512763',
              eInvoiceResponsible: true,
              eArchiveResponsible: false,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/firms')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://soho-isbasi-mwv2-test.logo-paas.com/api/v1.0/firms/firms',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer full-secret-access-token',
          tenantId: 'tenant-1',
          apiKey: 'api-key-secret',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        success: true,
        count: 1,
        sampleFirms: [
          expect.objectContaining({
            id: 'firm-1',
            code: 'CARI-1',
            name: 'Sporjinal Spor Malzemeleri A.S.',
            taxNumberMasked: '64******63',
            eInvoiceResponsible: true,
            eArchiveResponsible: false,
          }),
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('6490512763');
    expect(JSON.stringify(result)).not.toContain('full-secret-access-token');
    expect(JSON.stringify(result)).not.toContain('api-key-secret');
  });

  it('returns sanitized Logo firm detail fields only', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: {
            id: 'firm-1',
            code: 'CARI-1',
            name: 'Sporjinal Spor Malzemeleri A.S.',
            firmType: 'customer',
            taxNumber: '6490512763',
            taxOffice: 'Kadikoy',
            city: 'Istanbul',
            district: 'Atasehir',
            eInvoiceResponsible: true,
            eArchiveResponsible: false,
            eDispatchResponsible: true,
            phone: '+905551112233',
            address: 'Sensitive address',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/firms/:firmId')?.(
      { authUser: { role: 'admin' }, params: { firmId: 'firm-1' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        success: true,
        firm: expect.objectContaining({
          id: 'firm-1',
          code: 'CARI-1',
          name: 'Sporjinal Spor Malzemeleri A.S.',
          taxNumberMasked: '64******63',
          taxOffice: 'Kadikoy',
          city: 'Istanbul',
          district: 'Atasehir',
          eDispatchResponsible: true,
        }),
      }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('6490512763');
    expect(serialized).not.toContain('+905551112233');
    expect(serialized).not.toContain('Sensitive address');
    expect(serialized).not.toContain('full-secret-access-token');
  });

  it('discovers sanitized Logo invoice list samples without exposing secrets', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: 'invoice-1',
              invoiceNumber: 'INV202600001',
              invoiceDate: '2026-06-08',
              totalAmount: '120.00',
              currency: 'TL',
              scenario: 'TEMELFATURA',
              status: 'draft',
              invoiceType: 'SATIS',
              customer: {
                name: 'Sporjinal Spor Malzemeleri A.S.',
                taxNumber: '6490512763',
                email: 'billing@sporjinal.test',
                phone: '+905551112233',
              },
              apiKey: 'provider-api-key-secret',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/invoices')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://soho-isbasi-mwv2-test.logo-paas.com/api/v1.0/salesInvoices/salesInvoices',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer full-secret-access-token',
          tenantId: 'tenant-1',
          apiKey: 'api-key-secret',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        success: true,
        count: 1,
        sampleInvoices: [
          expect.objectContaining({
            id: 'invoice-1',
            invoiceNumber: 'INV202600001',
            date: '2026-06-08',
            amount: '120.00',
            currency: 'TL',
            scenario: 'TEMELFATURA',
            status: 'draft',
            invoiceType: 'SATIS',
            customerName: 'Sporjinal Spor Malzemeleri A.S.',
          }),
        ],
      }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('6490512763');
    expect(serialized).not.toContain('billing@sporjinal.test');
    expect(serialized).not.toContain('+905551112233');
    expect(serialized).not.toContain('provider-api-key-secret');
    expect(serialized).not.toContain('full-secret-access-token');
  });

  it('returns sanitized Logo invoice detail and shape without exposing tokens or personal fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: {
            id: 'invoice-1',
            currency: 'TL',
            invoiceType: 'SATIS',
            scenario: 'TEMELFATURA',
            customer: {
              id: 'firm-1',
              code: 'CUST001',
              name: 'Sporjinal Spor Malzemeleri A.S.',
              taxNumber: '6490512763',
              taxOffice: 'Kadikoy',
              city: 'Istanbul',
              district: 'Atasehir',
              email: 'billing@sporjinal.test',
              phone: '+905551112233',
            },
            salesInvoiceDetails: [
              {
                id: 'line-1',
                itemCode: 'SPORGYM-COMMISSION',
                name: 'Pazaryeri Komisyon Hizmeti',
                quantity: 1,
                price: '100',
                taxRate: '20',
                secret: 'line-secret-value',
              },
            ],
            eGovernmentInvoice: {
              scenario: 'TEMELFATURA',
              receiverTaxNumber: '6490512763',
              receiverEmail: 'billing@sporjinal.test',
              receiverPhone: '+905551112233',
              accessToken: 'invoice-access-token-secret',
            },
            eArchivePortalInvoice: {
              internetSale: false,
              recipientTaxNumber: '11111111111',
              recipientEmail: 'customer@example.test',
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/invoices/:invoiceId')?.(
      { authUser: { role: 'admin' }, params: { invoiceId: 'invoice-1' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://soho-isbasi-mwv2-test.logo-paas.com/api/v1.0/salesInvoices/invoice-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        success: true,
        invoice: expect.objectContaining({
          invoiceId: 'invoice-1',
          currency: 'TL',
          invoiceType: 'SATIS',
          scenario: 'TEMELFATURA',
          customer: expect.objectContaining({
            taxNumberMasked: '64******63',
            emailMasked: 'b***@sporjinal.test',
            phoneMasked: '***33',
          }),
          eGovernmentInvoice: expect.objectContaining({
            scenario: 'TEMELFATURA',
            receiverTaxNumber: '64******63',
            receiverEmail: 'b***@sporjinal.test',
            receiverPhone: '***33',
            accessToken: '[redacted]',
          }),
          eArchivePortalInvoice: expect.objectContaining({
            internetSale: false,
            recipientTaxNumber: '11*******11',
            recipientEmail: 'c***@example.test',
          }),
        }),
        shape: expect.objectContaining({
          hasEGovernmentInvoice: true,
          eGovernmentInvoiceKeys: ['accessToken', 'receiverEmail', 'receiverPhone', 'receiverTaxNumber', 'scenario'],
          hasEArchivePortalInvoice: true,
          eArchivePortalInvoiceKeys: ['internetSale', 'recipientEmail', 'recipientTaxNumber'],
          lineItemShape: ['id', 'itemCode', 'name', 'price', 'quantity', 'secret', 'taxRate'],
        }),
      }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('6490512763');
    expect(serialized).not.toContain('11111111111');
    expect(serialized).not.toContain('billing@sporjinal.test');
    expect(serialized).not.toContain('customer@example.test');
    expect(serialized).not.toContain('+905551112233');
    expect(serialized).not.toContain('invoice-access-token-secret');
    expect(serialized).not.toContain('line-secret-value');
    expect(serialized).not.toContain('full-secret-access-token');
  });

  it('extracts Logo invoice shape from invoice detail payloads', () => {
    const shape = extractInvoiceShape({
      currencyCode: 'TL',
      type: 'SATIS',
      invoiceScenario: 'TEMELFATURA',
      salesInvoiceDetails: [
        {
          productDetail: { name: 'Pazaryeri Komisyon Hizmeti' },
          quantity: 1,
          taxRate: '20',
        },
      ],
      eGovernmentInvoice: {
        alias: 'urn:mail',
        scenario: 'TEMELFATURA',
      },
      eArchivePortalInvoice: {
        internetSale: false,
      },
    });

    expect(shape).toEqual({
      hasEGovernmentInvoice: true,
      eGovernmentInvoiceKeys: ['alias', 'scenario'],
      hasEArchivePortalInvoice: true,
      eArchivePortalInvoiceKeys: ['internetSale'],
      currency: 'TL',
      invoiceType: 'SATIS',
      scenario: 'TEMELFATURA',
      lineItemShape: ['productDetail', 'quantity', 'taxRate'],
    });
  });

  it('matches a vendor billing profile to a Logo firm by tax number without saving', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: 'firm-1',
              code: 'CARI-1',
              name: 'Sporjinal Spor Malzemeleri A.S.',
              firmType: 'customer',
              tcknVkn: '6490512763',
              eInvoiceResponsible: true,
              eArchiveResponsible: false,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    getVendorBillingProfileMock.mockResolvedValue(vendorBillingProfile);
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/:vendorId/logo-isbasi/match-firm')?.(
      { authUser: { role: 'admin' }, params: { vendorId: 'sporjinal' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(getVendorBillingProfileMock).toHaveBeenCalledWith('sporjinal');
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        success: true,
        vendorId: 'sporjinal',
        matchStatus: 'exact_match',
        matchMethod: 'taxNumberOrTckn',
        exactMatch: expect.objectContaining({
          id: 'firm-1',
          taxNumberMasked: '64******63',
        }),
        possibleMatches: [],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('6490512763');
    expect(JSON.stringify(result)).not.toContain('full-secret-access-token');
  });

  it('matches Logo firm code before tax number and name', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: 'firm-by-tax',
              code: 'TAX001',
              name: 'Sporjinal Spor Malzemeleri A.S.',
              firmType: 'customer',
              tcknVkn: '6490512763',
            },
            {
              id: 'firm-by-code',
              code: 'CUST001',
              name: 'Manual Logo Customer',
              firmType: 'customer',
              tcknVkn: '1111111111',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    getVendorBillingProfileMock.mockResolvedValue({
      ...vendorBillingProfile,
      logoIsbasiCustomerCode: 'CUST001',
      taxNumber: '6490512763',
      legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
    });
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/:vendorId/logo-isbasi/match-firm')?.(
      { authUser: { role: 'admin' }, params: { vendorId: 'sporjinal' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        matchStatus: 'exact_match',
        matchMethod: 'logoIsbasiCustomerCode',
        exactMatch: expect.objectContaining({
          id: 'firm-by-code',
          code: 'CUST001',
          name: 'Manual Logo Customer',
          taxNumberMasked: '11******11',
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('1111111111');
    expect(JSON.stringify(result)).not.toContain('full-secret-access-token');
  });

  it('binds an exact matched Logo firm to the vendor billing profile', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: 'firm-1',
              code: 'CUST001',
              name: 'Sporjinal Spor Malzemeleri A.S.',
              firmType: 'customer',
              tcknVkn: '6490512763',
              eInvoiceResponsible: true,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    getVendorBillingProfileMock.mockResolvedValue({
      ...vendorBillingProfile,
      logoIsbasiCustomerCode: null,
      logoIsbasiCustomerId: null,
    });
    bindLogoIsbasiFirmToVendorMock.mockResolvedValue({
      ...vendorBillingProfile,
      logoIsbasiCustomerCode: 'CUST001',
      logoIsbasiCustomerId: 'firm-1',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: '2026-06-08T10:00:00.000Z',
    });
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/:vendorId/logo-isbasi/bind-matched-firm')?.(
      { authUser: { role: 'admin' }, params: { vendorId: 'sporjinal' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(bindLogoIsbasiFirmToVendorMock).toHaveBeenCalledWith('sporjinal', {
      logoIsbasiCustomerCode: 'CUST001',
      logoIsbasiCustomerId: 'firm-1',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: expect.any(Date),
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        success: true,
        writesPerformed: true,
        vendorId: 'sporjinal',
        matchStatus: 'exact_match',
        matchMethod: 'taxNumberOrTckn',
        logoIsbasiCustomerCode: 'CUST001',
        logoIsbasiCustomerId: 'firm-1',
        logoIsbasiEinvoiceEligible: true,
        logoIsbasiLastCheckedAt: '2026-06-08T10:00:00.000Z',
        previousBinding: {
          logoIsbasiCustomerCode: null,
          logoIsbasiCustomerId: null,
        },
        newBinding: {
          logoIsbasiCustomerCode: 'CUST001',
          logoIsbasiCustomerId: 'firm-1',
        },
        matchedFirm: {
          name: 'Sporjinal Spor Malzemeleri A.S.',
          code: 'CUST001',
          taxNumberMasked: '64******63',
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('6490512763');
    expect(JSON.stringify(result)).not.toContain('full-secret-access-token');
  });

  it('allows rebinding and replaces the old Logo firm identity', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: 'firm-5',
              code: 'CUST005',
              name: 'Sporjinal Spor Malzemeleri A.S.',
              firmType: 'customer',
              tcknVkn: '6490512763',
              eInvoiceResponsible: false,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    getVendorBillingProfileMock.mockResolvedValue({
      ...vendorBillingProfile,
      logoIsbasiCustomerCode: 'CUST001',
      logoIsbasiCustomerId: 'firm-1',
    });
    bindLogoIsbasiFirmToVendorMock.mockResolvedValue({
      ...vendorBillingProfile,
      logoIsbasiCustomerCode: 'CUST005',
      logoIsbasiCustomerId: 'firm-5',
      logoIsbasiEinvoiceEligible: false,
      logoIsbasiLastCheckedAt: '2026-06-08T11:00:00.000Z',
    });
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/:vendorId/logo-isbasi/bind-matched-firm')?.(
      { authUser: { role: 'admin' }, params: { vendorId: 'sporjinal' } },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(bindLogoIsbasiFirmToVendorMock).toHaveBeenCalledWith('sporjinal', {
      logoIsbasiCustomerCode: 'CUST005',
      logoIsbasiCustomerId: 'firm-5',
      logoIsbasiEinvoiceEligible: false,
      logoIsbasiLastCheckedAt: expect.any(Date),
    });
    expect(result).toEqual(
      expect.objectContaining({
        matchStatus: 'exact_match',
        matchMethod: 'taxNumberOrTckn',
        logoIsbasiCustomerCode: 'CUST005',
        logoIsbasiCustomerId: 'firm-5',
        previousBinding: {
          logoIsbasiCustomerCode: 'CUST001',
          logoIsbasiCustomerId: 'firm-1',
        },
        newBinding: {
          logoIsbasiCustomerCode: 'CUST005',
          logoIsbasiCustomerId: 'firm-5',
        },
      }),
    );
  });

  it('does not bind when Logo firm matching is not exact', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 'full-secret-access-token', tenantId: 'tenant-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: 'firm-possible',
              code: 'CUST-POSSIBLE',
              name: 'Sporjinal',
              firmType: 'customer',
              tcknVkn: '1111111111',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    getVendorBillingProfileMock.mockResolvedValue({
      ...vendorBillingProfile,
      logoIsbasiCustomerCode: null,
    });
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/:vendorId/logo-isbasi/bind-matched-firm')?.(
      { authUser: { role: 'admin' }, params: { vendorId: 'sporjinal' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(bindLogoIsbasiFirmToVendorMock).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        success: false,
        writesPerformed: false,
        errorCode: 'LOGO_ISBASI_NO_EXACT_MATCH',
        matchStatus: 'possible_matches',
        possibleMatches: [
          expect.objectContaining({
            code: 'CUST-POSSIBLE',
            taxNumberMasked: '11******11',
          }),
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('1111111111');
  });

  it('returns a controlled missing env response from the login probe', async () => {
    const { posts } = createRegisteredRoutes({ LOGO_ISBASI_API_KEY: undefined });
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        missingEnv: ['LOGO_ISBASI_API_KEY'],
        writesPerformed: false,
        externalApiCallAttempted: false,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('password-secret');
    expect(JSON.stringify(result)).not.toContain('api-key-secret');
  });

  it('returns a controlled invalid base URL response from the login probe', async () => {
    const { posts } = createRegisteredRoutes({ LOGO_ISBASI_BASE_URL: 'not a url' });
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_BASE_URL_INVALID',
        message: 'LOGO_ISBASI_BASE_URL must be a valid URL.',
        missingEnv: ['LOGO_ISBASI_BASE_URL'],
      }),
    );
  });

  it('returns sanitized Logo API non-2xx response details', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: '401', message: 'Invalid credentials password=secret-password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_UPSTREAM_NON_2XX',
        message: 'Logo İşbaşı login request failed.',
        httpStatus: 401,
        login: expect.objectContaining({
          code: '401',
          message: 'Invalid credentials password=[redacted]',
          accessTokenPresent: false,
          tenantIdPresent: false,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('returns controlled JSON parse failure diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_JSON_PARSE_FAILED',
        message: 'Logo İşbaşı login returned a non-JSON response.',
        httpStatus: 200,
      }),
    );
  });

  it('returns controlled missing session field diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { accessToken: 'abcdef1234567890' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_SESSION_FIELDS_MISSING',
        message: 'Logo İşbaşı login response is missing required session fields.',
        missingSessionFields: ['tenantId'],
        login: expect.objectContaining({
          accessTokenPresent: true,
          tenantIdPresent: false,
          tokenPreview: 'abcdef...7890',
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('abcdef1234567890');
  });

  it('sanitizes login responses without exposing credentials or full token', () => {
    const sanitized = sanitizeLoginResponse({
      ok: true,
      code: 200,
      message: 'token=secret-token password=secret-password',
      data: {
        accessToken: 'abcdef1234567890',
        tenantId: 'tenant-1',
        userEmail: 'user@example.test',
      },
    });

    expect(sanitized).toEqual(
      expect.objectContaining({
        accessTokenPresent: true,
        tenantIdPresent: true,
        userEmailPresent: true,
        tokenPreview: 'abcdef...7890',
      }),
    );
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('abcdef1234567890');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('secret-token');
  });

  it('extracts Logo session values from common response shapes without guessing missing fields', () => {
    expect(extractSessionFromLoginResponse({ data: { access_token: 'token-1', tenantId: 'tenant-1' } })).toEqual(
      expect.objectContaining({
        accessToken: 'token-1',
        tenantId: 'tenant-1',
        accessTokenPresent: true,
        tenantIdPresent: true,
        missing: [],
      }),
    );
    expect(extractSessionFromLoginResponse({ accessToken: 'token-2' })).toEqual(
      expect.objectContaining({
        accessToken: 'token-2',
        tenantId: null,
        missing: ['tenantId'],
      }),
    );
  });

  it('builds a commission service invoice preview without e-archive internet fields', () => {
    const preview = buildLogoIsbasiCommissionInvoicePreview({
      vendorBillingProfile,
      commissionAmount: '100',
      vatRate: '20',
      currency: 'TL',
      description: 'Pazaryeri komisyon hizmet bedeli',
      sourcePeriod: '2026-06',
    });

    expect(preview.payload).toEqual(
      expect.objectContaining({
        invoiceId: 0,
        currency: 'TL',
        exchangeRate: 1,
        vatIncluded: false,
      }),
    );
    expect(preview.payload.salesInvoiceDetails).toEqual([
      expect.objectContaining({
        quantity: 1,
        taxRate: '20',
        price: '100',
        productDetail: expect.objectContaining({
          itemCode: 'SPORGYM-COMMISSION',
          itemType: 2,
          name: 'Sporgym Pazaryeri Komisyon Hizmeti',
        }),
      }),
    ]);
    expect(preview.warnings).toContain('eGovernmentInvoice enum/required fields unknown; omitted in dry-run.');
    const serialized = JSON.stringify(preview.payload);
    expect(serialized).not.toMatch(/shipmentAgentItem|website|eArchivePaymentType|eArchivePaymentDate/);
  });

  it('masks tax number in sanitized API preview responses', () => {
    const preview = buildLogoIsbasiCommissionInvoicePreview({
      vendorBillingProfile,
      commissionAmount: '100',
      vatRate: '20',
      currency: 'TL',
      description: 'Pazaryeri komisyon hizmet bedeli',
    });

    const sanitized = sanitizeLogoIsbasiInvoicePreviewPayload(preview.payload);

    expect((sanitized.customer as Record<string, unknown>).tcknVkn).toBe('64******63');
    expect(JSON.stringify(sanitized)).not.toContain('6490512763');
  });

  it('validates required vendor billing fields and does not call network in the preview endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    getVendorBillingProfileMock.mockResolvedValue({ ...vendorBillingProfile, billingCity: null });
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/:vendorId/logo-isbasi/commission-invoice-preview')?.(
      {
        authUser: { role: 'admin' },
        params: { vendorId: 'sporjinal' },
        body: {
          commissionAmount: '100',
          vatRate: '20',
          currency: 'TL',
          description: 'Pazaryeri komisyon hizmet bedeli',
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(400);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        externalApiCallAttempted: false,
        message: expect.stringContaining('billingCity'),
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
