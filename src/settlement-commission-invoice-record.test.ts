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
  invoiceExecution: {
    create: vi.fn(),
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
  incrementRetry,
  markCreated,
  markFailed,
} = await import('../backend/src/modules/finance/settlement-commission-invoice-record.service.js');
const { buildSettlementLogoCommissionInvoiceRequestSnapshot } = await import(
  '../backend/src/modules/finance/settlement-logo-request-snapshot-builder.service.js'
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
    prismaMock.invoiceExecution.create.mockReset();
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
    expect(prismaMock.invoiceExecution.create).not.toHaveBeenCalled();
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
});
