import { beforeEach, describe, expect, it, vi } from 'vitest';

const SettlementApprovalStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
} as const;

const SettlementCommissionInvoiceProvider = {
  LOGO_ISBASI: 'LOGO_ISBASI',
} as const;

const SettlementCommissionInvoiceStatus = {
  PENDING: 'PENDING',
  CREATED: 'CREATED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
} as const;

const prismaMock = vi.hoisted(() => ({
  settlementCommissionInvoice: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { executeSettlementLogoCommissionInvoiceCreate } = await import(
  '../backend/src/modules/finance/settlement-logo-commission-invoice-create.service.js'
);

function buildImmutableLogoRequestSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
    settlementApprovalId: 'approval-1',
    vendorId: 'vendor-a',
    payloadBuilderVersion: 'settlement-logo-request-v1',
    requestBuiltAt: '2026-06-12T10:00:00.000Z',
    settlementApprovalSnapshot: { id: 'approval-1', status: 'APPROVED' },
    settlementBillingSnapshot: { logoIsbasiCustomerCode: 'YSKOD1', logoIsbasiCustomerId: 'logo-customer-1' },
    settlementLineSnapshotSummary: { lineCount: 1 },
    executionSnapshotGuard: { ok: true, blockers: [] },
    logoPayload: {
      customer: { code: 'YSKOD1' },
      salesInvoiceDetails: [
        {
          productDetail: {
            itemCode: 'SPORGYM-COMMISSION',
            itemType: 2,
          },
          quantity: 1,
          price: 100,
          taxRate: 20,
        },
      ],
    },
    ...overrides,
  };
}

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settlement-invoice-1',
    createdAt: new Date('2026-06-12T10:01:00.000Z'),
    updatedAt: new Date('2026-06-12T10:01:00.000Z'),
    settlementApprovalId: 'approval-1',
    vendorId: 'vendor-a',
    provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
    status: SettlementCommissionInvoiceStatus.PENDING,
    providerInvoiceId: null,
    providerUuid: null,
    providerEttn: null,
    invoiceNo: null,
    documentStatus: null,
    documentContentType: null,
    documentSize: null,
    documentFetchedAt: null,
    documentSnapshotJson: null,
    requestSnapshotJson: buildImmutableLogoRequestSnapshot(),
    responseSnapshotJson: null,
    failureCode: null,
    failureMessage: null,
    failedAt: null,
    unknownReason: null,
    unknownAt: null,
    reconciliationStatus: null,
    reconciliationEvidenceJson: null,
    reconciledAt: null,
    reconciledBy: null,
    retryCount: 0,
    lastRetriedAt: null,
    createdBy: 'admin-1',
    cancelledBy: null,
    cancelledAt: null,
    settlementApproval: {
      id: 'approval-1',
      status: SettlementApprovalStatus.APPROVED,
    },
    ...overrides,
  };
}

function buildEnv(overrides: Record<string, unknown> = {}) {
  return {
    LOGO_ISBASI_CREATE_ENABLED: true,
    LOGO_ISBASI_CREATE_ENVIRONMENT: 'test',
    LOGO_ISBASI_EXPECTED_TENANT_ID: 'tenant-1',
    LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
    LOGO_ISBASI_API_KEY: 'api-key',
    LOGO_ISBASI_USERNAME: 'username',
    LOGO_ISBASI_PASSWORD: 'password',
    ...overrides,
  } as never;
}

function buildClient() {
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
    createIntegrationInvoice: vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      jsonParseFailed: false,
      body: {
        data: {
          invoiceId: 'logo-invoice-1',
          uuid: 'logo-uuid-1',
          ettn: 'logo-ettn-1',
          invoiceNo: 'ABC202600001',
        },
      },
      requestUrl: 'https://logo.test/api/v1.0/invoices/integrationInvoices',
      requestMethod: 'POST',
      requestContentType: 'application/json; charset=utf-8',
      requestAccept: 'application/json',
      responseContentType: 'application/json',
      responseBodySnippet: '{"ok":true}',
      queryParameters: [],
    }),
  };
}

describe('controlled settlement Logo commission invoice create', () => {
  beforeEach(() => {
    prismaMock.settlementCommissionInvoice.findUnique.mockReset();
    prismaMock.settlementCommissionInvoice.findFirst.mockReset();
    prismaMock.settlementCommissionInvoice.update.mockReset();
    prismaMock.settlementCommissionInvoice.findFirst.mockResolvedValue({ id: 'settlement-invoice-1', status: 'PENDING' });
  });

  it('calls Logo once for a PENDING record with guard pass and marks CREATED', async () => {
    const pending = buildRecord();
    prismaMock.settlementCommissionInvoice.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        status: SettlementCommissionInvoiceStatus.CREATED,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
        responseSnapshotJson: { ok: true },
      }),
    );
    const client = buildClient();

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: true,
      externalApiCallAttempted: true,
      status: 'created',
      providerResult: {
        httpStatus: 200,
        invoiceId: 'logo-invoice-1',
        uuid: 'logo-uuid-1',
        ettn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
      },
      record: {
        status: 'created',
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
      },
    });
    expect(client.createIntegrationInvoice).toHaveBeenCalledTimes(1);
    expect(client.createIntegrationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      pending.requestSnapshotJson.logoPayload,
    );
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.CREATED,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
      }),
    });
  });

  it('does not require expected tenant env when other create guards pass', async () => {
    const pending = buildRecord();
    prismaMock.settlementCommissionInvoice.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        status: SettlementCommissionInvoiceStatus.CREATED,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
        responseSnapshotJson: { ok: true },
      }),
    );
    const client = buildClient();

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv({ LOGO_ISBASI_EXPECTED_TENANT_ID: undefined }),
      client,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'created',
      warnings: ['Tenant validation skipped because LOGO_ISBASI_EXPECTED_TENANT_ID is not configured.'],
      environmentGuard: {
        allowed: true,
        expectedTenantConfigured: false,
        actualTenantPresent: true,
        tenantValidationStatus: 'skipped',
      },
    });
    expect(client.createIntegrationInvoice).toHaveBeenCalledTimes(1);
  });

  it('blocks when expected tenant is configured but Logo login returns no tenant id', async () => {
    const pending = buildRecord();
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(pending);
    const client = buildClient();
    client.login.mockResolvedValueOnce({
      status: 200,
      ok: true,
      jsonParseFailed: false,
      body: {
        data: {
          accessToken: 'access-token',
          userId: 'user-1',
        },
      },
    });

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      blockers: ['Logo tenant id was not returned by login response; cannot validate expected tenant.'],
      environmentGuard: {
        allowed: false,
        expectedTenantConfigured: true,
        actualTenantPresent: false,
        tenantValidationStatus: 'blocked_missing_actual',
      },
    });
    expect(client.createIntegrationInvoice).not.toHaveBeenCalled();
  });

  it('marks clear provider failure as FAILED', async () => {
    const pending = buildRecord();
    prismaMock.settlementCommissionInvoice.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        status: SettlementCommissionInvoiceStatus.FAILED,
        failureCode: 'LOGO_ISBASI_UPSTREAM_NON_2XX',
        failureMessage: 'Validation failed.',
        failedAt: new Date('2026-06-12T10:05:00.000Z'),
      }),
    );
    const client = buildClient();
    client.createIntegrationInvoice.mockResolvedValueOnce({
      status: 422,
      ok: false,
      jsonParseFailed: false,
      body: { message: 'Validation failed.' },
      requestUrl: 'https://logo.test/api/v1.0/invoices/integrationInvoices',
      requestMethod: 'POST',
      responseBodySnippet: '{"message":"Validation failed."}',
      responseContentType: 'application/json',
      requestContentType: 'application/json; charset=utf-8',
      requestAccept: 'application/json',
      queryParameters: [],
    });

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      writesPerformed: true,
      status: 'failed',
      record: {
        status: 'failed',
        failureCode: 'LOGO_ISBASI_UPSTREAM_NON_2XX',
        failureMessage: 'Validation failed.',
      },
    });
    expect(client.createIntegrationInvoice).toHaveBeenCalledTimes(1);
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.FAILED,
        failureCode: 'LOGO_ISBASI_UPSTREAM_NON_2XX',
        failureMessage: 'Validation failed.',
      }),
    });
  });

  it('marks timeout or ambiguous create error as UNKNOWN', async () => {
    const pending = buildRecord();
    prismaMock.settlementCommissionInvoice.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        status: SettlementCommissionInvoiceStatus.UNKNOWN,
        unknownReason: 'Logo create returned an ambiguous network/timeout result. Reconciliation is required before retry.',
        unknownAt: new Date('2026-06-12T10:06:00.000Z'),
      }),
    );
    const client = buildClient();
    client.createIntegrationInvoice.mockRejectedValueOnce(new Error('network timeout'));

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      writesPerformed: true,
      status: 'unknown',
      blockers: ['Logo create outcome is UNKNOWN. Reconciliation is required before retry.'],
    });
    expect(client.createIntegrationInvoice).toHaveBeenCalledTimes(1);
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.UNKNOWN,
        unknownReason: 'Logo create returned an ambiguous network/timeout result. Reconciliation is required before retry.',
      }),
    });
  });

  it('blocks UNKNOWN, CREATED, and CANCELLED records before Logo create', async () => {
    const client = buildClient();
    for (const status of [
      SettlementCommissionInvoiceStatus.UNKNOWN,
      SettlementCommissionInvoiceStatus.CREATED,
      SettlementCommissionInvoiceStatus.CANCELLED,
    ]) {
      prismaMock.settlementCommissionInvoice.findUnique.mockReset();
      prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord({ status }));

      const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
        env: buildEnv(),
        client,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe('blocked');
    }
    expect(client.createIntegrationInvoice).not.toHaveBeenCalled();
  });

  it('blocks missing request snapshot before Logo create', async () => {
    const client = buildClient();
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({ requestSnapshotJson: null }),
    );

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      blockers: expect.arrayContaining([
        'SettlementCommissionInvoice requestSnapshotJson is required before Logo execution.',
      ]),
    });
    expect(client.createIntegrationInvoice).not.toHaveBeenCalled();
  });

  it('blocks non-approved settlement before Logo create', async () => {
    const client = buildClient();
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({
        settlementApproval: {
          id: 'approval-1',
          status: SettlementApprovalStatus.DRAFT,
        },
      }),
    );

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      blockers: ['SettlementApproval must be APPROVED before Logo invoice execution.'],
    });
    expect(client.createIntegrationInvoice).not.toHaveBeenCalled();
  });

  it('blocks provider mismatch before Logo create', async () => {
    const client = buildClient();
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({ provider: 'OTHER_PROVIDER' }),
    );

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      blockers: ['SettlementCommissionInvoice provider must be LOGO_ISBASI before Logo execution.'],
    });
    expect(client.createIntegrationInvoice).not.toHaveBeenCalled();
  });

  it('blocks when environment guard fails and prevents Logo create', async () => {
    const client = buildClient();
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(buildRecord());

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv({ LOGO_ISBASI_CREATE_ENABLED: false }),
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      environmentGuard: {
        allowed: false,
      },
      blockers: ['LOGO_ISBASI_CREATE_ENABLED must be true before Logo invoice execution.'],
    });
    expect(client.login).not.toHaveBeenCalled();
    expect(client.createIntegrationInvoice).not.toHaveBeenCalled();
  });

  it('allows FAILED retry, increments retry count, and marks CREATED on success', async () => {
    const failed = buildRecord({
      status: SettlementCommissionInvoiceStatus.FAILED,
      retryCount: 1,
      failureCode: 'LOGO_ISBASI_UPSTREAM_NON_2XX',
    });
    prismaMock.settlementCommissionInvoice.findUnique
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed);
    prismaMock.settlementCommissionInvoice.update
      .mockResolvedValueOnce(buildRecord({
        status: SettlementCommissionInvoiceStatus.FAILED,
        retryCount: 2,
        lastRetriedAt: new Date('2026-06-12T10:08:00.000Z'),
      }))
      .mockResolvedValueOnce(buildRecord({
        status: SettlementCommissionInvoiceStatus.CREATED,
        retryCount: 2,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
      }));
    const client = buildClient();

    const result = await executeSettlementLogoCommissionInvoiceCreate('settlement-invoice-1', {
      env: buildEnv(),
      client,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'created',
      record: {
        status: 'created',
        retryCount: 2,
      },
    });
    expect(client.createIntegrationInvoice).toHaveBeenCalledTimes(1);
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'settlement-invoice-1' },
      data: {
        retryCount: {
          increment: 1,
        },
        lastRetriedAt: expect.any(Date),
      },
    });
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.CREATED,
      }),
    });
  });
});
