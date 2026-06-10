import { beforeEach, describe, expect, it, vi } from 'vitest';

const SettlementCommissionInvoiceProvider = {
  LOGO_ISBASI: 'LOGO_ISBASI',
} as const;

const SettlementCommissionInvoiceStatus = {
  PENDING: 'PENDING',
  CREATED: 'CREATED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

const prismaMock = vi.hoisted(() => ({
  settlementCommissionInvoice: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  assertNoActiveInvoiceForSettlement,
  createPendingRecord,
  findBySettlementApproval,
  getSettlementCommissionInvoiceDiagnostics,
  incrementRetry,
  markCreated,
  markFailed,
} = await import('../backend/src/modules/finance/settlement-commission-invoice-record.service.js');

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

describe('settlement commission invoice record foundation', () => {
  beforeEach(() => {
    prismaMock.settlementCommissionInvoice.findMany.mockReset();
    prismaMock.settlementCommissionInvoice.findUnique.mockReset();
    prismaMock.settlementCommissionInvoice.findFirst.mockReset();
    prismaMock.settlementCommissionInvoice.create.mockReset();
    prismaMock.settlementCommissionInvoice.update.mockReset();
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
      requestSnapshotJson: { amount: 120 },
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
      requestSnapshotJson: { request: 'keep-me' },
      responseSnapshotJson: { ok: true },
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
      requestSnapshotJson: { request: 'keep-me' },
      responseSnapshotJson: { ok: false },
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
            type: 'object',
            topLevelKeys: ['amount', 'nested'],
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
