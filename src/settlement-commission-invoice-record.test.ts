import { beforeEach, describe, expect, it, vi } from 'vitest';

const SettlementCommissionInvoiceProvider = {
  LOGO_ISBASI: 'LOGO_ISBASI',
} as const;

const SettlementCommissionInvoiceStatus = {
  PENDING: 'PENDING',
  CREATED: 'CREATED',
  CANCELLED: 'CANCELLED',
} as const;

const prismaMock = vi.hoisted(() => ({
  settlementCommissionInvoice: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  assertNoActiveInvoiceForSettlement,
  createPendingRecord,
  findBySettlementApproval,
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
    prismaMock.settlementCommissionInvoice.findFirst.mockReset();
    prismaMock.settlementCommissionInvoice.create.mockReset();
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
});
