import { beforeEach, describe, expect, it, vi } from 'vitest';

const SettlementCommissionInvoiceProvider = {
  LOGO_ISBASI: 'LOGO_ISBASI',
} as const;

const SettlementCommissionInvoiceStatus = {
  PENDING: 'PENDING',
  CREATED: 'CREATED',
} as const;

const prismaMock = vi.hoisted(() => ({
  settlementCommissionInvoice: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { previewSettlementLogoOutgoingInvoiceSync } = await import(
  '../backend/src/modules/finance/settlement-logo-outgoing-invoice-sync-preview.service.js'
);

function buildEnv(overrides: Record<string, unknown> = {}) {
  return {
    LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
    LOGO_ISBASI_API_KEY: 'api-key',
    LOGO_ISBASI_USERNAME: 'username',
    LOGO_ISBASI_PASSWORD: 'password',
    ...overrides,
  } as never;
}

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settlement-invoice-1',
    createdAt: new Date('2026-06-12T10:01:00.000Z'),
    provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
    status: SettlementCommissionInvoiceStatus.CREATED,
    providerInvoiceId: 'logo-invoice-local',
    providerUuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
    providerEttn: null,
    invoiceNo: null,
    requestSnapshotJson: {
      logoPayload: {
        salesInvoiceDetails: [
          {
            price: 100.42,
            taxRate: 20,
          },
        ],
      },
    },
    ...overrides,
  };
}

function buildClient(rowsByPage: Array<unknown[]> = [[buildProviderInvoice()]]) {
  return {
    login: vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      jsonParseFailed: false,
      body: {
        data: {
          accessToken: 'access-token',
          tenantId: 'tenant-1',
          userId: 'user-1',
        },
      },
    }),
    listSalesInvoices: vi.fn().mockImplementation((_session, input) => Promise.resolve({
      status: 200,
      ok: true,
      jsonParseFailed: false,
      body: {
        data: {
          data: rowsByPage[input.page - 1] ?? [],
          totalCount: rowsByPage.flat().length,
        },
      },
      requestUrl: 'https://logo.test/api/v1.0/invoices/invoices',
      requestMethod: 'POST',
      requestContentType: 'application/json; charset=utf-8',
      requestAccept: 'application/json',
      responseContentType: 'application/json',
      responseBodySnippet: '{"ok":true}',
      queryParameters: [],
    })),
  };
}

function buildProviderInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: '12345',
    invoiceId: '12345',
    salesInvoiceId: 12345,
    uuid: '82691c7b-28d6-4e30-95c9-c0658e90f090',
    uuId: '82691c7b-28d6-4e30-95c9-c0658e90f090',
    date: '2026-06-12T12:00:00',
    issueDate: '2026-06-12T12:00:00',
    amount: 120.5,
    total: 120.5,
    currency: 'TRY',
    status: 'Henüz GİB’e Gönderilmedi',
    statusCode: 10,
    eType: 'EARSIV',
    eGovermentType: 'EARSIV',
    eGovermentTypeDesc: 'E-Arşiv',
    connectStatusDescription: 'Provider waiting',
    connectStatusCode: 20,
    customer: {
      name: 'Yali Spor',
      taxNumber: 'hidden-in-safe-summary',
    },
    accountingStatus: {
      state: 'not_synced',
      nested: { hidden: true },
    },
    rawPayload: { hidden: true },
    ...overrides,
  };
}

describe('Logo sales invoice sync preview', () => {
  beforeEach(() => {
    prismaMock.settlementCommissionInvoice.findUnique.mockReset();
    prismaMock.settlementCommissionInvoice.update.mockReset();
  });

  it('matches providerInvoiceId against sales invoice identifiers and maps safe fields', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(buildRecord({ providerInvoiceId: '12345' }));
    const client = buildClient();

    const result = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
      now: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      search: {
        matched: true,
        ambiguity: false,
        pagesChecked: 1,
        totalProviderCount: 1,
      },
      matchedInvoice: {
        id: '12345',
        uuid: '82691c7b-28d6-4e30-95c9-c0658e90f090',
        uuId: '82691c7b-28d6-4e30-95c9-c0658e90f090',
        invoiceId: '12345',
        salesInvoiceId: '12345',
        date: '2026-06-12T12:00:00',
        amount: 120.5,
        total: 120.5,
        currency: 'TRY',
        statusCode: 10,
        customerDisplayName: 'Yali Spor',
      },
      mappedFields: {
        providerUuid: '82691c7b-28d6-4e30-95c9-c0658e90f090',
        providerInvoiceId: '12345',
        providerEttn: '82691c7b-28d6-4e30-95c9-c0658e90f090',
        gibStatus: null,
        gibStatusCode: null,
        documentStatus: 'Provider waiting',
        documentStatusCode: 20,
        documentType: 'EARSIV',
        invoiceDate: '2026-06-12T12:00:00',
        invoiceTotalMinor: 12050,
        invoiceCurrency: 'TRY',
        invoiceNoCandidate: null,
        invoiceNumberAvailable: false,
        invoiceNumberSource: 'unknown',
        invoiceNumberRecoveryPossible: true,
      },
      candidateInvoices: [
        {
          id: '12345',
          uuid: '82691c7b-28d6-4e30-95c9-c0658e90f090',
          uuId: '82691c7b-28d6-4e30-95c9-c0658e90f090',
          salesInvoiceId: '12345',
          invoiceId: '12345',
          customerDisplayName: 'Yali Spor',
          matchSignals: {
            providerInvoiceIdEqualsId: true,
            salesInvoiceIdEqualsProviderInvoiceId: true,
            invoiceIdEqualsProviderInvoiceId: true,
            providerUuidEqualsUuid: true,
            providerUuidEqualsUuId: true,
            invoiceNumberPresent: false,
            amountNearRecordTotal: true,
          },
        },
      ],
    });
    expect(client.listSalesInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token' }),
      expect.objectContaining({
        dateStart: '2026-06-05T10:01:00.000Z',
        dateEnd: '2026-06-20T00:00:00.000Z',
        page: 1,
        pageSize: 100,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(prismaMock.settlementCommissionInvoice.update).not.toHaveBeenCalled();
  });

  it('returns at most 20 safe candidate invoice summaries with providerInvoiceId match signals', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(buildRecord({ providerInvoiceId: '750' }));
	    const rows = Array.from({ length: 25 }, (_, index) => buildProviderInvoice({
	      uuid: `uuid-${index}`,
	      uuId: `uuid-${index}`,
	      invoiceId: `invoice-${index}`,
	      salesInvoiceId: index === 3 ? '750' : `sales-${index}`,
      rawPayload: { hidden: `secret-${index}` },
    }));
    const client = buildClient([rows]);

    const result = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
      now: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result.candidateInvoices).toHaveLength(20);
    expect(result.candidateInvoices[3]).toMatchObject({
      uuId: 'uuid-3',
      salesInvoiceId: '750',
      invoiceId: 'invoice-3',
      matchSignals: {
        providerInvoiceIdEqualsId: false,
        salesInvoiceIdEqualsProviderInvoiceId: true,
        invoiceIdEqualsProviderInvoiceId: false,
	        providerUuidEqualsUuid: false,
	        providerUuidEqualsUuId: false,
	        invoiceNumberPresent: false,
	        amountNearRecordTotal: true,
	      },
	    });
    expect(JSON.stringify(result.candidateInvoices)).not.toContain('secret-');
    expect(JSON.stringify(result.candidateInvoices)).not.toContain('rawPayload');
    expect(prismaMock.settlementCommissionInvoice.update).not.toHaveBeenCalled();
  });

  it('does not populate invoiceNo unless provider response contains a documented invoice number key', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(buildRecord());
    const client = buildClient([[buildProviderInvoice({ invoiceNumber: 'REE202600000068' })]]);

    const result = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
      now: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result.mappedFields).toMatchObject({
      invoiceNoCandidate: 'REE202600000068',
      invoiceNumberAvailable: true,
      invoiceNumberSource: 'invoiceNumber',
    });
    expect(result.record?.invoiceNo).toBeNull();
    expect(prismaMock.settlementCommissionInvoice.update).not.toHaveBeenCalled();
  });

  it('maps number aliases, date, amount, currency, and explicit GIB fields when present', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(buildRecord({ providerInvoiceId: '750' }));
    const client = buildClient([[buildProviderInvoice({
      id: '750',
      invoiceId: null,
      salesInvoiceId: null,
      invoiceNumber: null,
      invoiceNo: null,
      documentNumber: null,
      number: 'REE202600000068',
      date: '2026-06-13T09:00:00',
      issueDate: null,
      amount: null,
	      total: '240.25',
	      currency: 'TRY',
	      status: 'Created',
	      statusCode: 5,
	      connectStatusDescription: null,
	      connectStatusCode: null,
	      gibStatus: 'Henüz GİB’e Gönderilmedi',
	      gibStatusCode: 105,
	    })]]);

    const result = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
      now: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result.search).toMatchObject({ matched: true, ambiguity: false });
    expect(result.mappedFields).toMatchObject({
      providerInvoiceId: '750',
      invoiceNoCandidate: 'REE202600000068',
      invoiceNumberSource: 'number',
      invoiceDate: '2026-06-13T09:00:00',
      invoiceTotalMinor: 24025,
      invoiceCurrency: 'TRY',
      documentStatus: 'Created',
      documentStatusCode: 5,
      gibStatus: 'Henüz GİB’e Gönderilmedi',
      gibStatusCode: 105,
    });
  });

  it('handles no match and ambiguous matches without selecting mapped invoice fields', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(buildRecord());
    const noMatch = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
	      env: buildEnv(),
	      client: buildClient([[buildProviderInvoice({ uuid: 'other-uuid', uuId: 'other-uuid' })]]),
	      now: new Date('2026-06-19T00:00:00.000Z'),
	    });
    expect(noMatch.search).toMatchObject({ matched: false, ambiguity: false });
    expect(noMatch.matchedInvoice).toBeNull();

    const duplicateMatch = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client: buildClient([[buildProviderInvoice(), buildProviderInvoice({ invoiceId: 'einvoice-row-2' })]]),
      now: new Date('2026-06-19T00:00:00.000Z'),
    });
    expect(duplicateMatch.search).toMatchObject({ matched: false, ambiguity: true });
    expect(duplicateMatch.warnings).toContain('Multiple Logo sales invoice rows matched the same provider invoice id or UUID; no mapped invoice was selected.');
    expect(duplicateMatch.matchedInvoice).toBeNull();
  });

  it('rejects non-created records, missing identifiers, and non-Logo providers before provider list call', async () => {
    const client = buildClient();
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord({
      status: SettlementCommissionInvoiceStatus.PENDING,
    }));
    const pending = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });
    expect(pending.blockers).toContain('SettlementCommissionInvoice status must be CREATED before Logo sales invoice sync preview.');

    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord({ providerInvoiceId: null, providerUuid: null }));
    const missingIdentifiers = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });
    expect(missingIdentifiers.blockers).toContain('SettlementCommissionInvoice providerInvoiceId or providerUuid is required before Logo sales invoice sync preview.');

    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord({ provider: 'OTHER_PROVIDER' }));
    const otherProvider = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });
    expect(otherProvider.blockers).toContain('SettlementCommissionInvoice provider must be LOGO_ISBASI before Logo sales invoice sync preview.');
    expect(client.listSalesInvoices).not.toHaveBeenCalled();
  });
});
