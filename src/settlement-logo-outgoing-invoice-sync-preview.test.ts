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
    getOutgoingInvoiceDataList: vi.fn().mockImplementation((_session, input) => Promise.resolve({
      status: 200,
      ok: true,
      jsonParseFailed: false,
      body: {
        data: {
          data: rowsByPage[input.page - 1] ?? [],
          totalCount: rowsByPage.flat().length,
        },
      },
      requestUrl: 'https://logo.test/api/v1.0/einvoices/GetOutgoingInvoiceDataList',
      requestMethod: 'POST',
      requestContentType: 'application/json-patch+json',
      requestAccept: 'text/plain',
      responseContentType: 'application/json',
      responseBodySnippet: '{"ok":true}',
      queryParameters: [],
    })),
  };
}

function buildProviderInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: 'einvoice-row-1',
    salesInvoiceId: 12345,
    uuId: '82691c7b-28d6-4e30-95c9-c0658e90f090',
    issueDate: '2026-06-12T12:00:00',
    amount: 120.5,
    currency: 'TRY',
    status: 'Henüz GİB’e Gönderilmedi',
    statusCode: 10,
    eGovermentType: 'EARSIV',
    eGovermentTypeDesc: 'E-Arşiv',
    connectStatusDescription: 'Provider waiting',
    connectStatusCode: 20,
    accountingStatus: {
      state: 'not_synced',
      nested: { hidden: true },
    },
    rawPayload: { hidden: true },
    ...overrides,
  };
}

describe('Logo outgoing invoice sync preview', () => {
  beforeEach(() => {
    prismaMock.settlementCommissionInvoice.findUnique.mockReset();
    prismaMock.settlementCommissionInvoice.update.mockReset();
  });

  it('matches providerUuid against uuId case-insensitively and maps safe fields', async () => {
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
        uuId: '82691c7b-28d6-4e30-95c9-c0658e90f090',
        invoiceId: 'einvoice-row-1',
        salesInvoiceId: '12345',
        amount: 120.5,
        currency: 'TRY',
        statusCode: 10,
      },
      mappedFields: {
        providerUuid: '82691c7b-28d6-4e30-95c9-c0658e90f090',
        providerInvoiceId: '12345',
        providerEttn: '82691c7b-28d6-4e30-95c9-c0658e90f090',
        gibStatus: 'Henüz GİB’e Gönderilmedi',
        gibStatusCode: 10,
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
          uuId: '82691c7b-28d6-4e30-95c9-c0658e90f090',
          salesInvoiceId: '12345',
          invoiceId: 'einvoice-row-1',
          matchSignals: {
            uuidEqualsProviderUuid: true,
            salesInvoiceIdEqualsProviderInvoiceId: true,
            invoiceIdEqualsProviderInvoiceId: false,
            amountNearRecordTotal: false,
          },
        },
      ],
    });
    expect(client.getOutgoingInvoiceDataList).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token' }),
      expect.objectContaining({
        issueDateStart: '2026-06-05T10:01:00.000Z',
        issueDateEnd: '2026-06-20T00:00:00.000Z',
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
        uuidEqualsProviderUuid: false,
        salesInvoiceIdEqualsProviderInvoiceId: true,
        invoiceIdEqualsProviderInvoiceId: false,
        amountNearRecordTotal: false,
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

  it('handles no match and ambiguous matches without selecting mapped invoice fields', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(buildRecord());
    const noMatch = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client: buildClient([[buildProviderInvoice({ uuId: 'other-uuid' })]]),
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
    expect(duplicateMatch.warnings).toContain('Multiple Logo outgoing invoice rows matched the same provider UUID; no mapped invoice was selected.');
    expect(duplicateMatch.matchedInvoice).toBeNull();
  });

  it('rejects non-created records, missing UUID, and non-Logo providers before provider list call', async () => {
    const client = buildClient();
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord({
      status: SettlementCommissionInvoiceStatus.PENDING,
    }));
    const pending = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });
    expect(pending.blockers).toContain('SettlementCommissionInvoice status must be CREATED before Logo outgoing invoice sync preview.');

    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord({ providerUuid: null }));
    const missingUuid = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });
    expect(missingUuid.blockers).toContain('SettlementCommissionInvoice providerUuid is required before Logo outgoing invoice sync preview.');

    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord({ provider: 'OTHER_PROVIDER' }));
    const otherProvider = await previewSettlementLogoOutgoingInvoiceSync('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });
    expect(otherProvider.blockers).toContain('SettlementCommissionInvoice provider must be LOGO_ISBASI before Logo outgoing invoice sync preview.');
    expect(client.getOutgoingInvoiceDataList).not.toHaveBeenCalled();
  });
});
