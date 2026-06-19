import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  settlementApproval: {
    findUnique: vi.fn(),
  },
  settlementCommissionInvoice: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  vendorBillingProfile: {
    findUnique: vi.fn(),
  },
  vendorFinancialProfile: {
    findFirst: vi.fn(),
  },
  financeLedgerEntry: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  assertNoActiveInvoiceForSettlement,
  createPendingRecord,
  createPendingRecordFromImmutableRequestSnapshot,
  findBySettlementApproval,
  getSettlementCommissionInvoiceDiagnostics,
  canRetry,
  incrementRetry,
  markCreated,
  markFailed,
  markUnknown,
  resolveUnknownAsCreated,
  resolveUnknownAsFailed,
} = await import('../backend/src/modules/finance/settlement-commission-invoice-record.service.js');
const { buildSettlementLogoCommissionInvoiceRequestSnapshot } = await import(
  '../backend/src/modules/finance/settlement-logo-request-snapshot-builder.service.js'
);
const { validateLogoExecutionEnvironment } = await import(
  '../backend/src/modules/logo-isbasi/logo-execution-environment-guard.service.js'
);
const { validateLogoExecutionContract } = await import(
  '../backend/src/modules/finance/settlement-logo-execution-contract.service.js'
);

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settlement-invoice-1',
    createdAt: new Date('2026-06-10T10:00:00.000Z'),
    updatedAt: new Date('2026-06-10T10:00:00.000Z'),
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
    requestSnapshotJson: { amount: 120 },
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
    ...overrides,
  };
}

function buildBillingSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    source: 'vendor_billing_profile',
    capturedAt: '2026-06-01T09:30:00.000Z',
    vendorId: 'vendor-a',
    vendorBillingProfileId: 'billing-1',
    legalCompanyName: 'Snapshot Vendor A.S.',
    taxNumber: '1111111111',
    taxOffice: 'Kadikoy',
    billingAddress: 'Snapshot billing address',
    billingCity: 'Istanbul',
    billingDistrict: 'Kadikoy',
    authorizedPerson: 'Snapshot Person',
    billingEmail: 'snapshot-billing@example.test',
    billingPhone: '+905551112233',
    legalEntityType: 'limited_company',
    logoIsbasiCustomerCode: 'SNAPSHOT-CUSTOMER',
    logoIsbasiCustomerId: 'SNAPSHOT-ID',
    logoIsbasiEinvoiceEligible: true,
    logoIsbasiLastCheckedAt: '2026-06-01T09:00:00.000Z',
    ...overrides,
  };
}

function buildLine(input: { id: string; vatRate?: string | null; commissionMinor?: number; commissionVatMinor?: number }) {
  return {
    id: `line-${input.id}`,
    settlementApprovalId: 'approval-1',
    financeLedgerEntryId: `ledger-${input.id}`,
    lineType: 'SALE',
    amountMinor: 100000,
    commissionMinor: input.commissionMinor ?? 10000,
    commissionVatMinor: input.commissionVatMinor ?? 2000,
    payableImpactMinor: 88000,
    sourceSnapshotJson: {
      financeLedgerEntryId: `ledger-${input.id}`,
      sourceShopifyOrderId: `gid://shopify/Order/${input.id}`,
      sourceShopifyOrderNumber: `#${input.id}`,
      commissionPercentSnapshot: '10',
      ...(input.vatRate === null ? {} : { commissionVatPercentSnapshot: input.vatRate ?? '20' }),
      deductShippingEnabledSnapshot: false,
      shippingModeSnapshot: 'DISABLED',
      fixedShippingFeeSnapshot: null,
      shippingCostSnapshot: null,
      shippingVatAmountSnapshot: null,
      shippingCostSourceSnapshot: null,
      shippingCostProviderSnapshot: null,
    },
  };
}

function buildApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval-1',
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    vendorId: 'vendor-a',
    periodStart: new Date('2026-06-01T00:00:00.000Z'),
    periodEnd: new Date('2026-06-30T23:59:59.000Z'),
    status: 'APPROVED',
    currency: 'TRY',
    grossSalesMinor: 100000,
    refundTotalMinor: 0,
    commissionMinor: 10000,
    commissionVatMinor: 2000,
    netPayableMinor: 88000,
    approvedBy: 'admin-1',
    approvedAt: new Date('2026-06-01T12:00:00.000Z'),
    cancelledBy: null,
    cancelledAt: null,
    notes: null,
    sourceSnapshotJson: {
      vendorId: 'vendor-a',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T23:59:59.000Z',
      candidateScope: 'vendor_wide',
      generatedAt: '2026-06-01T10:00:00.000Z',
      settlementBillingSnapshot: buildBillingSnapshot(),
    },
    lines: [buildLine({ id: '1001' })],
    ...overrides,
  };
}

function buildImmutableLogoRequestSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
    settlementApprovalId: 'approval-1',
    vendorId: 'vendor-a',
    requestBuiltAt: '2026-06-12T10:00:00.000Z',
    payloadBuilderVersion: 'settlement-logo-request-v1',
    settlementApprovalSnapshot: {
      id: 'approval-1',
      vendorId: 'vendor-a',
      status: 'APPROVED',
      commissionMinor: 10000,
      commissionVatMinor: 2000,
      currency: 'TRY',
    },
    settlementBillingSnapshot: buildBillingSnapshot(),
    settlementLineSnapshotSummary: {
      lineCount: 1,
      executionLineCount: 1,
      detectedCommissionVatRates: [20],
      totals: {
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        currency: 'TRY',
      },
    },
    executionSnapshotGuard: {
      ok: true,
      blockers: [],
      warnings: [],
      requiredSnapshotsPresent: true,
    },
    logoPayload: {
      invoiceDate: '2026-06-15 00:00:00',
      currency: 'TRY',
      customer: {
        code: 'SNAPSHOT-CUSTOMER',
      },
      salesInvoiceDetails: [
        {
          price: 100,
          taxRate: 20,
          productDetail: {
            itemCode: 'SPORGYM-COMMISSION',
            itemType: 2,
          },
        },
      ],
    },
    ...overrides,
  };
}

function mockPendingCreateFromInput(id = 'snapshot-record-1') {
  prismaMock.settlementCommissionInvoice.create.mockImplementation(async (input: { data: Record<string, unknown> }) =>
    buildRecord({
      id,
      settlementApprovalId: input.data.settlementApprovalId,
      vendorId: input.data.vendorId,
      provider: input.data.provider,
      status: input.data.status,
      requestSnapshotJson: input.data.requestSnapshotJson,
      createdBy: input.data.createdBy,
    }),
  );
}

describe('settlement commission invoice record foundation', () => {
  beforeEach(() => {
    vi.useRealTimers();
    prismaMock.settlementApproval.findUnique.mockReset();
    prismaMock.settlementCommissionInvoice.findMany.mockReset();
    prismaMock.settlementCommissionInvoice.findUnique.mockReset();
    prismaMock.settlementCommissionInvoice.findFirst.mockReset();
    prismaMock.settlementCommissionInvoice.create.mockReset();
    prismaMock.settlementCommissionInvoice.update.mockReset();
    prismaMock.vendorBillingProfile.findUnique.mockReset();
    prismaMock.vendorFinancialProfile.findFirst.mockReset();
    prismaMock.financeLedgerEntry.findUnique.mockReset();
    prismaMock.financeLedgerEntry.findFirst.mockReset();
  });

  it('allows Logo execution environment without expected tenant and returns skipped warning', () => {
    const result = validateLogoExecutionEnvironment({
      env: {
        LOGO_ISBASI_CREATE_ENABLED: true,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'test',
        LOGO_ISBASI_EXPECTED_TENANT_ID: undefined,
        LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
      } as never,
    });

    expect(result).toMatchObject({
      allowed: true,
      environment: 'test',
      expectedTenantConfigured: false,
      actualTenantPresent: false,
      tenantValidationStatus: 'skipped',
      tenantValidation: {
        expectedTenantConfigured: false,
        expectedTenantIdPresent: false,
        actualTenantPresent: false,
        actualTenantIdPresent: false,
        status: 'skipped',
        tenantValidationStatus: 'skipped',
      },
      blockers: [],
      warnings: ['Tenant validation skipped because LOGO_ISBASI_EXPECTED_TENANT_ID is not configured.'],
    });
  });

  it('blocks Logo execution when create is disabled', () => {
    const result = validateLogoExecutionEnvironment({
      env: {
        LOGO_ISBASI_CREATE_ENABLED: false,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'test',
        LOGO_ISBASI_EXPECTED_TENANT_ID: 'tenant-1',
        LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
      } as never,
      actualTenantId: 'tenant-1',
    });

    expect(result).toMatchObject({
      allowed: false,
      environment: 'test',
      tenantValidationStatus: 'passed',
      tenantValidation: {
        status: 'passed',
      },
      blockers: ['LOGO_ISBASI_CREATE_ENABLED must be true before Logo invoice execution.'],
    });
  });

  it('blocks Logo execution when expected tenant is configured but login returned no tenant id', () => {
    const result = validateLogoExecutionEnvironment({
      env: {
        LOGO_ISBASI_CREATE_ENABLED: true,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'test',
        LOGO_ISBASI_EXPECTED_TENANT_ID: 'tenant-1',
        LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
      } as never,
    });

    expect(result).toMatchObject({
      allowed: false,
      tenantValidationStatus: 'blocked_missing_actual',
      tenantValidation: {
        expectedTenantConfigured: true,
        expectedTenantId: 'tenant-1',
        actualTenantPresent: false,
        actualTenantId: null,
        status: 'blocked_missing_actual',
        tenantValidationStatus: 'blocked_missing_actual',
      },
      blockers: ['Logo tenant id was not returned by login response; cannot validate expected tenant.'],
      warnings: [],
    });
  });

  it('blocks Logo execution when authenticated tenant does not match expected tenant', () => {
    const result = validateLogoExecutionEnvironment({
      env: {
        LOGO_ISBASI_CREATE_ENABLED: true,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'production',
        LOGO_ISBASI_EXPECTED_TENANT_ID: 'tenant-prod-1',
        LOGO_ISBASI_BASE_URL: 'https://logo.example.test',
      } as never,
      actualTenantId: 'tenant-other',
    });

    expect(result.allowed).toBe(false);
    expect(result.tenantValidationStatus).toBe('blocked_mismatch');
    expect(result.tenantValidation).toMatchObject({
      status: 'blocked_mismatch',
      tenantValidationStatus: 'blocked_mismatch',
      expectedTenantId: 'tenant-prod-1',
      actualTenantId: 'tenant-other',
    });
    expect(result.blockers).toContain(
      'Logo tenant mismatch. Authenticated Logo tenant does not match LOGO_ISBASI_EXPECTED_TENANT_ID.',
    );
  });

  it('allows Logo execution environment when explicit create settings and tenant match', () => {
    const result = validateLogoExecutionEnvironment({
      env: {
        LOGO_ISBASI_CREATE_ENABLED: true,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'test',
        LOGO_ISBASI_EXPECTED_TENANT_ID: 'tenant-1',
        LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
      } as never,
      actualTenantId: 'tenant-1',
    });

    expect(result).toEqual({
      allowed: true,
      environment: 'test',
      expectedTenantConfigured: true,
      actualTenantPresent: true,
      tenantValidationStatus: 'passed',
      tenantValidation: {
        expectedTenantConfigured: true,
        expectedTenantIdPresent: true,
        expectedTenantId: 'tenant-1',
        actualTenantPresent: true,
        actualTenantIdPresent: true,
        actualTenantId: 'tenant-1',
        tenantValidationStatus: 'passed',
        status: 'passed',
      },
      blockers: [],
      warnings: [],
    });
  });

  it('blocks Logo execution when create environment is invalid', () => {
    const result = validateLogoExecutionEnvironment({
      env: {
        LOGO_ISBASI_CREATE_ENABLED: true,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'sandbox',
        LOGO_ISBASI_EXPECTED_TENANT_ID: undefined,
        LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
      } as never,
    });

    expect(result).toMatchObject({
      allowed: false,
      environment: null,
      tenantValidationStatus: 'skipped',
      blockers: ['LOGO_ISBASI_CREATE_ENVIRONMENT must be test or production before Logo invoice execution.'],
      warnings: ['Tenant validation skipped because LOGO_ISBASI_EXPECTED_TENANT_ID is not configured.'],
    });
  });

  it('blocks Logo execution when base URL is missing', () => {
    const result = validateLogoExecutionEnvironment({
      env: {
        LOGO_ISBASI_CREATE_ENABLED: true,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'test',
        LOGO_ISBASI_EXPECTED_TENANT_ID: undefined,
        LOGO_ISBASI_BASE_URL: undefined,
      } as never,
    });

    expect(result).toMatchObject({
      allowed: false,
      environment: 'test',
      tenantValidationStatus: 'skipped',
      blockers: ['LOGO_ISBASI_BASE_URL is required before Logo invoice execution.'],
      warnings: ['Tenant validation skipped because LOGO_ISBASI_EXPECTED_TENANT_ID is not configured.'],
    });
  });

  it('can create a pending record for a settlement approval without provider calls', async () => {
    prismaMock.settlementCommissionInvoice.findFirst.mockResolvedValue(null);
    prismaMock.settlementCommissionInvoice.create.mockResolvedValue(buildRecord());

    const record = await createPendingRecord({
      settlementApprovalId: 'approval-1',
      vendorId: 'vendor-a',
      provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
      requestSnapshotJson: { amount: 120 },
      createdBy: 'admin-1',
    });

    expect(record).toMatchObject({
      id: 'settlement-invoice-1',
      settlementApprovalId: 'approval-1',
      vendorId: 'vendor-a',
      provider: 'logo_isbasi',
      status: 'pending',
      requestSnapshot: {
        requestSnapshotPresent: true,
        payloadBuilderVersion: null,
        snapshotSource: null,
      },
      createdBy: 'admin-1',
    });
    expect(prismaMock.settlementCommissionInvoice.create).toHaveBeenCalledWith({
      data: {
        settlementApprovalId: 'approval-1',
        vendorId: 'vendor-a',
        provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
        status: SettlementCommissionInvoiceStatus.PENDING,
        requestSnapshotJson: { amount: 120 },
        createdBy: 'admin-1',
      },
    });
  });

  it('blocks duplicate active invoices for the same settlement and provider', async () => {
    prismaMock.settlementCommissionInvoice.findFirst.mockResolvedValue({
      id: 'existing-1',
      status: SettlementCommissionInvoiceStatus.PENDING,
    });

    await expect(
      assertNoActiveInvoiceForSettlement('approval-1', SettlementCommissionInvoiceProvider.LOGO_ISBASI),
    ).rejects.toThrow('SettlementApproval already has an active LOGO_ISBASI commission invoice record');
    await expect(
      createPendingRecord({
        settlementApprovalId: 'approval-1',
        vendorId: 'vendor-a',
        provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
      }),
    ).rejects.toThrow('SettlementApproval already has an active LOGO_ISBASI commission invoice record');
    expect(prismaMock.settlementCommissionInvoice.create).not.toHaveBeenCalled();
  });

  it('does not treat cancelled invoices as active blockers', async () => {
    prismaMock.settlementCommissionInvoice.findFirst.mockResolvedValue(null);
    prismaMock.settlementCommissionInvoice.create.mockResolvedValue(
      buildRecord({ id: 'new-pending', status: SettlementCommissionInvoiceStatus.PENDING }),
    );

    const record = await createPendingRecord({
      settlementApprovalId: 'approval-1',
      vendorId: 'vendor-a',
      provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
    });

    expect(record.id).toBe('new-pending');
    expect(prismaMock.settlementCommissionInvoice.findFirst).toHaveBeenCalledWith({
      where: {
        settlementApprovalId: 'approval-1',
        provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
        status: {
          not: SettlementCommissionInvoiceStatus.CANCELLED,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
  });

  it('creates a pending record from a complete immutable Logo request snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T10:00:00.000Z'));
    const approval = buildApproval();
    prismaMock.settlementApproval.findUnique.mockResolvedValue(approval);
    prismaMock.settlementCommissionInvoice.findFirst.mockResolvedValue(null);
    mockPendingCreateFromInput();

    const built = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-12');
    prismaMock.settlementApproval.findUnique.mockClear();
    prismaMock.settlementApproval.findUnique.mockResolvedValue(approval);

    const result = await createPendingRecordFromImmutableRequestSnapshot(
      'approval-1',
      SettlementCommissionInvoiceProvider.LOGO_ISBASI,
      { createdBy: 'admin-1', invoiceDate: '2026-06-12' },
    );

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: true,
      settlementApprovalId: 'approval-1',
      provider: 'logo_isbasi',
      status: 'pending',
      blockers: [],
      record: {
        id: 'snapshot-record-1',
        settlementApprovalId: 'approval-1',
        vendorId: 'vendor-a',
        status: 'pending',
        requestSnapshot: {
          requestSnapshotPresent: true,
          payloadBuilderVersion: 'settlement-logo-request-v1',
          requestBuiltAt: '2026-06-12T10:00:00.000Z',
          snapshotSource: 'immutable_settlement_truth',
        },
      },
      requestSnapshot: {
        requestSnapshotPresent: true,
        payloadBuilderVersion: 'settlement-logo-request-v1',
        snapshotSource: 'immutable_settlement_truth',
      },
    });
    expect(prismaMock.settlementCommissionInvoice.create).toHaveBeenCalledWith({
      data: {
        settlementApprovalId: 'approval-1',
        vendorId: 'vendor-a',
        provider: SettlementCommissionInvoiceProvider.LOGO_ISBASI,
        status: SettlementCommissionInvoiceStatus.PENDING,
        requestSnapshotJson: built.requestSnapshotJson,
        createdBy: 'admin-1',
      },
    });
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.vendorFinancialProfile.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.findFirst).not.toHaveBeenCalled();
  });

  it('blocks pending snapshot persistence when the settlement billing snapshot is missing', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ sourceSnapshotJson: { vendorId: 'vendor-a' } }),
    );

    const result = await createPendingRecordFromImmutableRequestSnapshot(
      'approval-1',
      SettlementCommissionInvoiceProvider.LOGO_ISBASI,
      { createdBy: 'admin-1', invoiceDate: '2026-06-12' },
    );

    expect(result).toMatchObject({
      ok: false,
      writesPerformed: false,
      status: 'blocked',
      record: null,
      requestSnapshot: null,
    });
    expect(result.blockers).toContain(
      'Settlement billing snapshot is missing. Historical invoice execution cannot be guaranteed.',
    );
    expect(prismaMock.settlementCommissionInvoice.create).not.toHaveBeenCalled();
  });

  it('blocks pending snapshot persistence when VAT rates are mixed', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        lines: [
          buildLine({ id: '1001', vatRate: '18' }),
          buildLine({ id: '1002', vatRate: '20' }),
        ],
      }),
    );

    const result = await createPendingRecordFromImmutableRequestSnapshot(
      'approval-1',
      SettlementCommissionInvoiceProvider.LOGO_ISBASI,
      { createdBy: 'admin-1', invoiceDate: '2026-06-12' },
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'Commission VAT rate is not uniform across settlement lines; Logo invoice creation is blocked until reviewed.',
    );
    expect(prismaMock.settlementCommissionInvoice.create).not.toHaveBeenCalled();
  });

  it('keeps duplicate protection active when persisting immutable request snapshots', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval());
    prismaMock.settlementCommissionInvoice.findFirst.mockResolvedValue({
      id: 'existing-1',
      status: SettlementCommissionInvoiceStatus.PENDING,
    });

    const result = await createPendingRecordFromImmutableRequestSnapshot(
      'approval-1',
      SettlementCommissionInvoiceProvider.LOGO_ISBASI,
      { createdBy: 'admin-1', invoiceDate: '2026-06-12' },
    );

    expect(result).toMatchObject({
      ok: false,
      writesPerformed: false,
      status: 'blocked',
      record: null,
    });
    expect(result.blockers).toContain(
      'SettlementApproval already has an active LOGO_ISBASI commission invoice record (existing-1, PENDING).',
    );
    expect(prismaMock.settlementCommissionInvoice.create).not.toHaveBeenCalled();
  });

  it('returns existing records for a settlement approval', async () => {
    prismaMock.settlementCommissionInvoice.findMany.mockResolvedValue([
      buildRecord({
        status: SettlementCommissionInvoiceStatus.CREATED,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        invoiceNo: 'ABC202600001',
      }),
    ]);

    const records = await findBySettlementApproval('approval-1');

    expect(records).toEqual([
      expect.objectContaining({
        status: 'created',
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        invoiceNo: 'ABC202600001',
      }),
    ]);
    expect(prismaMock.settlementCommissionInvoice.findMany).toHaveBeenCalledWith({
      where: {
        settlementApprovalId: 'approval-1',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  });

  it('validates Logo execution contract from persisted immutable request snapshot only', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(
      buildRecord({
        requestSnapshotJson: buildImmutableLogoRequestSnapshot(),
      }),
    );

    const result = await validateLogoExecutionContract('settlement-invoice-1');

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      status: 'READY',
      recordStatus: 'PENDING',
      requestSnapshotPresent: true,
      payloadPresent: true,
      snapshotSource: 'immutable_settlement_truth',
      payloadBuilderVersion: 'settlement-logo-request-v1',
      blockers: [],
    });
    expect(prismaMock.settlementCommissionInvoice.findUnique).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
    });
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.vendorFinancialProfile.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.findFirst).not.toHaveBeenCalled();
  });

  it('blocks Logo execution contract when request snapshot is missing', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(
      buildRecord({
        requestSnapshotJson: null,
      }),
    );

    const result = await validateLogoExecutionContract('settlement-invoice-1');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: 'BLOCKED',
      requestSnapshotPresent: false,
      payloadPresent: false,
      snapshotSource: null,
    });
    expect(result.blockers).toContain('SettlementCommissionInvoice requestSnapshotJson is required before Logo execution.');
    expect(result.blockers).toContain('SettlementCommissionInvoice requestSnapshotJson.logoPayload is required before Logo execution.');
  });

  it('blocks Logo execution contract when logoPayload is missing', async () => {
    const snapshotWithoutPayload = { ...buildImmutableLogoRequestSnapshot() };
    delete (snapshotWithoutPayload as Record<string, unknown>).logoPayload;
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(
      buildRecord({
        requestSnapshotJson: snapshotWithoutPayload,
      }),
    );

    const result = await validateLogoExecutionContract('settlement-invoice-1');

    expect(result.ok).toBe(false);
    expect(result.payloadPresent).toBe(false);
    expect(result.snapshotSource).toBeNull();
    expect(result.blockers).toContain('SettlementCommissionInvoice requestSnapshotJson.logoPayload is required before Logo execution.');
    expect(result.blockers).toContain(
      'SettlementCommissionInvoice request snapshot must come from immutable_settlement_truth before Logo execution.',
    );
  });

  it('marks a pending record as created and preserves the request snapshot', async () => {
    const pending = buildRecord({ requestSnapshotJson: { request: 'keep-me' } });
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        ...pending,
        status: SettlementCommissionInvoiceStatus.CREATED,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
        responseSnapshotJson: { ok: true },
      }),
    );

    const record = await markCreated({
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      providerInvoiceId: 'logo-invoice-1',
      providerUuid: 'logo-uuid-1',
      providerEttn: 'logo-ettn-1',
      invoiceNo: 'ABC202600001',
      responseSnapshotJson: { ok: true },
    });

    expect(record).toMatchObject({
      status: 'created',
      providerInvoiceId: 'logo-invoice-1',
      providerUuid: 'logo-uuid-1',
      providerEttn: 'logo-ettn-1',
      invoiceNo: 'ABC202600001',
      requestSnapshot: {
        requestSnapshotPresent: true,
      },
      responseSnapshot: {
        present: true,
      },
    });
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: {
        status: SettlementCommissionInvoiceStatus.CREATED,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
        responseSnapshotJson: { ok: true },
      },
    });
  });

  it('marks a pending record as failed and preserves the request snapshot', async () => {
    const pending = buildRecord({ requestSnapshotJson: { request: 'keep-me' } });
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        ...pending,
        status: SettlementCommissionInvoiceStatus.FAILED,
        failureCode: 'UPSTREAM_502',
        failureMessage: 'Provider failed.',
        failedAt: new Date('2026-06-10T10:05:00.000Z'),
        responseSnapshotJson: { ok: false },
      }),
    );

    const record = await markFailed({
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      failureCode: 'UPSTREAM_502',
      failureMessage: 'Provider failed.',
      responseSnapshotJson: { ok: false },
    });

    expect(record).toMatchObject({
      status: 'failed',
      failureCode: 'UPSTREAM_502',
      failureMessage: 'Provider failed.',
      failedAt: '2026-06-10T10:05:00.000Z',
      requestSnapshot: {
        requestSnapshotPresent: true,
      },
      responseSnapshot: {
        present: true,
      },
    });
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.FAILED,
        failureCode: 'UPSTREAM_502',
        failureMessage: 'Provider failed.',
        responseSnapshotJson: { ok: false },
      }),
    });
    expect(prismaMock.settlementCommissionInvoice.update.mock.calls[0]?.[0].data).not.toHaveProperty('requestSnapshotJson');
  });

  it('marks a pending record as UNKNOWN for ambiguous provider execution outcomes', async () => {
    const pending = buildRecord({
      requestSnapshotJson: buildImmutableLogoRequestSnapshot(),
    });
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        ...pending,
        status: SettlementCommissionInvoiceStatus.UNKNOWN,
        unknownReason: 'provider timeout after request sent',
        unknownAt: new Date('2026-06-10T10:06:00.000Z'),
        responseSnapshotJson: { error: 'timeout' },
      }),
    );

    const record = await markUnknown({
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      unknownReason: 'provider timeout after request sent',
      responseSnapshotJson: { error: 'timeout' },
    });

    expect(record).toMatchObject({
      status: 'unknown',
      unknownReason: 'provider timeout after request sent',
      unknownAt: '2026-06-10T10:06:00.000Z',
      requestSnapshot: {
        requestSnapshotPresent: true,
        snapshotSource: 'immutable_settlement_truth',
      },
    });
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: {
        status: SettlementCommissionInvoiceStatus.UNKNOWN,
        unknownReason: 'provider timeout after request sent',
        unknownAt: expect.any(Date),
        responseSnapshotJson: { error: 'timeout' },
      },
    });
  });

  it('supports provider-created-but-local-failed recovery through UNKNOWN before reconciliation', async () => {
    const pending = buildRecord({
      requestSnapshotJson: buildImmutableLogoRequestSnapshot(),
    });
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(pending);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        ...pending,
        status: SettlementCommissionInvoiceStatus.UNKNOWN,
        unknownReason: 'local persistence ambiguity after provider request sent',
        unknownAt: new Date('2026-06-10T10:06:00.000Z'),
      }),
    );

    const record = await markUnknown({
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      unknownReason: 'local persistence ambiguity after provider request sent',
      responseSnapshotJson: {
        providerRequestSent: true,
        providerResponsePersisted: false,
      },
    });

    expect(record).toMatchObject({
      status: 'unknown',
      unknownReason: 'local persistence ambiguity after provider request sent',
    });
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.UNKNOWN,
        unknownReason: 'local persistence ambiguity after provider request sent',
      }),
    });
  });

  it('resolves UNKNOWN as CREATED only with explicit reconciliation evidence', async () => {
    const unknownRecord = buildRecord({
      status: SettlementCommissionInvoiceStatus.UNKNOWN,
      unknownReason: 'provider timeout after request sent',
      unknownAt: new Date('2026-06-10T10:06:00.000Z'),
      requestSnapshotJson: buildImmutableLogoRequestSnapshot(),
    });
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(unknownRecord);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        ...unknownRecord,
        status: SettlementCommissionInvoiceStatus.CREATED,
        providerInvoiceId: 'logo-invoice-1',
        providerUuid: 'logo-uuid-1',
        providerEttn: 'logo-ettn-1',
        invoiceNo: 'ABC202600001',
        reconciliationStatus: 'resolved_created',
        reconciliationEvidenceJson: { evidence: 'provider status check confirmed invoice' },
        reconciledAt: new Date('2026-06-10T10:20:00.000Z'),
        reconciledBy: 'admin-1',
      }),
    );

    const record = await resolveUnknownAsCreated({
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      providerInvoiceId: 'logo-invoice-1',
      providerUuid: 'logo-uuid-1',
      providerEttn: 'logo-ettn-1',
      invoiceNo: 'ABC202600001',
      reconciliationEvidenceJson: { evidence: 'provider status check confirmed invoice' },
      reconciledBy: 'admin-1',
    });

    expect(record).toMatchObject({
      status: 'created',
      providerInvoiceId: 'logo-invoice-1',
      providerUuid: 'logo-uuid-1',
      providerEttn: 'logo-ettn-1',
      invoiceNo: 'ABC202600001',
      reconciliationStatus: 'resolved_created',
      reconciliationEvidenceSnapshot: {
        present: true,
        topLevelKeys: ['evidence'],
      },
      reconciledAt: '2026-06-10T10:20:00.000Z',
      reconciledBy: 'admin-1',
    });
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.CREATED,
        reconciliationStatus: 'resolved_created',
        reconciliationEvidenceJson: { evidence: 'provider status check confirmed invoice' },
        reconciledAt: expect.any(Date),
        reconciledBy: 'admin-1',
      }),
    });
  });

  it('resolves UNKNOWN as FAILED only with explicit reconciliation evidence', async () => {
    const unknownRecord = buildRecord({
      status: SettlementCommissionInvoiceStatus.UNKNOWN,
      unknownReason: 'network interruption after request sent',
      unknownAt: new Date('2026-06-10T10:06:00.000Z'),
      requestSnapshotJson: buildImmutableLogoRequestSnapshot(),
    });
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(unknownRecord);
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        ...unknownRecord,
        status: SettlementCommissionInvoiceStatus.FAILED,
        failureCode: 'RECONCILED_NO_PROVIDER_INVOICE',
        failureMessage: 'Provider status check found no invoice.',
        failedAt: new Date('2026-06-10T10:20:00.000Z'),
        reconciliationStatus: 'resolved_failed',
        reconciliationEvidenceJson: { evidence: 'provider status check found no invoice' },
        reconciledAt: new Date('2026-06-10T10:20:00.000Z'),
        reconciledBy: 'admin-1',
      }),
    );

    const record = await resolveUnknownAsFailed({
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      failureCode: 'RECONCILED_NO_PROVIDER_INVOICE',
      failureMessage: 'Provider status check found no invoice.',
      reconciliationEvidenceJson: { evidence: 'provider status check found no invoice' },
      reconciledBy: 'admin-1',
    });

    expect(record).toMatchObject({
      status: 'failed',
      failureCode: 'RECONCILED_NO_PROVIDER_INVOICE',
      failureMessage: 'Provider status check found no invoice.',
      reconciliationStatus: 'resolved_failed',
      reconciliationEvidenceSnapshot: {
        present: true,
        topLevelKeys: ['evidence'],
      },
      reconciledAt: '2026-06-10T10:20:00.000Z',
      reconciledBy: 'admin-1',
    });
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: expect.objectContaining({
        status: SettlementCommissionInvoiceStatus.FAILED,
        failureCode: 'RECONCILED_NO_PROVIDER_INVOICE',
        failureMessage: 'Provider status check found no invoice.',
        failedAt: expect.any(Date),
        reconciliationStatus: 'resolved_failed',
        reconciliationEvidenceJson: { evidence: 'provider status check found no invoice' },
      }),
    });
  });

  it('does not allow created records to become failed', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(
      buildRecord({ status: SettlementCommissionInvoiceStatus.CREATED }),
    );

    await expect(
      markFailed({
        settlementCommissionInvoiceId: 'settlement-invoice-1',
        failureCode: 'LATE_FAILURE',
      }),
    ).rejects.toThrow('markFailed is not allowed');
    expect(prismaMock.settlementCommissionInvoice.update).not.toHaveBeenCalled();
  });

  it('does not allow cancelled records to become created', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(
      buildRecord({ status: SettlementCommissionInvoiceStatus.CANCELLED }),
    );

    await expect(
      markCreated({
        settlementCommissionInvoiceId: 'settlement-invoice-1',
        providerInvoiceId: 'logo-invoice-1',
      }),
    ).rejects.toThrow('markCreated is not allowed');
    expect(prismaMock.settlementCommissionInvoice.update).not.toHaveBeenCalled();
  });

  it('allows retry only for failed records and increments retry count', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({ status: SettlementCommissionInvoiceStatus.CREATED }),
    );

    await expect(incrementRetry({ settlementCommissionInvoiceId: 'settlement-invoice-1' })).rejects.toThrow(
      'incrementRetry is not allowed',
    );

    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({ status: SettlementCommissionInvoiceStatus.UNKNOWN }),
    );

    await expect(incrementRetry({ settlementCommissionInvoiceId: 'settlement-invoice-1' })).rejects.toThrow(
      'UNKNOWN execution must be reconciled before retry.',
    );

    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({ status: SettlementCommissionInvoiceStatus.FAILED, retryCount: 1 }),
    );
    prismaMock.settlementCommissionInvoice.update.mockResolvedValue(
      buildRecord({
        status: SettlementCommissionInvoiceStatus.FAILED,
        retryCount: 2,
        lastRetriedAt: new Date('2026-06-10T10:10:00.000Z'),
      }),
    );

    const retried = await incrementRetry({ settlementCommissionInvoiceId: 'settlement-invoice-1' });

    expect(retried.retryCount).toBe(2);
    expect(retried.lastRetriedAt).toBe('2026-06-10T10:10:00.000Z');
    expect(prismaMock.settlementCommissionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'settlement-invoice-1' },
      data: {
        retryCount: {
          increment: 1,
        },
        lastRetriedAt: expect.any(Date),
      },
    });
  });

  it('returns retry decisions that allow FAILED and block UNKNOWN until reconciliation', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({ status: SettlementCommissionInvoiceStatus.FAILED }),
    );

    const failedDecision = await canRetry({ settlementCommissionInvoiceId: 'settlement-invoice-1' });

    expect(failedDecision).toEqual({
      ok: true,
      writesPerformed: false,
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      status: 'failed',
      canRetry: true,
      blockers: [],
    });

    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValueOnce(
      buildRecord({ status: SettlementCommissionInvoiceStatus.UNKNOWN }),
    );

    const unknownDecision = await canRetry({ settlementCommissionInvoiceId: 'settlement-invoice-1' });

    expect(unknownDecision).toEqual({
      ok: true,
      writesPerformed: false,
      settlementCommissionInvoiceId: 'settlement-invoice-1',
      status: 'unknown',
      canRetry: false,
      blockers: ['UNKNOWN execution must be reconciled before retry.'],
    });
  });

  it('returns diagnostics metadata without raw snapshot payloads', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(
      buildRecord({
        status: SettlementCommissionInvoiceStatus.FAILED,
        requestSnapshotJson: { amount: 120, nested: { hidden: true } },
        responseSnapshotJson: { providerError: 'Bad gateway' },
        documentSnapshotJson: ['large', 'document'],
        retryCount: 2,
        failureCode: 'UPSTREAM_502',
        failureMessage: 'Provider failed.',
        failedAt: new Date('2026-06-10T10:05:00.000Z'),
      }),
    );

    const diagnostics = await getSettlementCommissionInvoiceDiagnostics('settlement-invoice-1');

    expect(diagnostics).toMatchObject({
      ok: true,
      writesPerformed: false,
      record: {
        id: 'settlement-invoice-1',
        status: 'failed',
        retryCount: 2,
        snapshots: {
          request: {
            present: true,
            requestSnapshotPresent: true,
            type: 'object',
            topLevelKeys: ['amount', 'nested'],
            payloadBuilderVersion: null,
            requestBuiltAt: null,
            snapshotSource: null,
          },
          response: {
            present: true,
            type: 'object',
            topLevelKeys: ['providerError'],
          },
          document: {
            present: true,
            type: 'array',
            topLevelKeys: [],
          },
        },
        failure: {
          failureCode: 'UPSTREAM_502',
          failureMessage: 'Provider failed.',
        },
      },
    });
    expect(JSON.stringify(diagnostics)).not.toContain('Bad gateway');
    expect(JSON.stringify(diagnostics)).not.toContain('hidden');
  });

  it('returns environment, execution contract, and UNKNOWN diagnostics without payload bodies', async () => {
    prismaMock.settlementCommissionInvoice.findUnique.mockResolvedValue(
      buildRecord({
        status: SettlementCommissionInvoiceStatus.UNKNOWN,
        requestSnapshotJson: buildImmutableLogoRequestSnapshot(),
        unknownReason: 'provider timeout after request sent',
        unknownAt: new Date('2026-06-10T10:06:00.000Z'),
        reconciliationStatus: null,
      }),
    );

    const diagnostics = await getSettlementCommissionInvoiceDiagnostics('settlement-invoice-1', {
      env: {
        LOGO_ISBASI_CREATE_ENABLED: false,
        LOGO_ISBASI_CREATE_ENVIRONMENT: 'test',
        LOGO_ISBASI_EXPECTED_TENANT_ID: 'tenant-1',
        LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
      } as never,
    });

    expect(diagnostics).toMatchObject({
      ok: true,
      writesPerformed: false,
      record: {
        status: 'unknown',
        environmentGuard: {
          allowed: false,
          environment: 'test',
          tenantValidationStatus: 'blocked_missing_actual',
          tenantValidation: {
            status: 'blocked_missing_actual',
          },
          blockers: [
            'LOGO_ISBASI_CREATE_ENABLED must be true before Logo invoice execution.',
            'Logo tenant id was not returned by login response; cannot validate expected tenant.',
          ],
          warnings: [],
        },
        executionContract: {
          ok: false,
          status: 'BLOCKED',
          requestSnapshotPresent: true,
          payloadPresent: true,
          snapshotSource: 'immutable_settlement_truth',
          blockers: ['SettlementCommissionInvoice status must be PENDING or FAILED before Logo execution. Current status: UNKNOWN.'],
        },
        unknown: {
          reason: 'provider timeout after request sent',
          unknownAt: '2026-06-10T10:06:00.000Z',
          reconciliationState: null,
          reconciliationEvidence: {
            present: false,
          },
        },
      },
    });
    expect(JSON.stringify(diagnostics)).not.toContain('salesInvoiceDetails');
    expect(JSON.stringify(diagnostics)).not.toContain('SNAPSHOT-CUSTOMER');
  });
});
