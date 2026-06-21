import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  settlementApproval: {
    findUnique: vi.fn(),
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
  settlementCommissionInvoice: {
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { buildSettlementLogoCommissionInvoiceRequestSnapshot } = await import(
  '../backend/src/modules/finance/settlement-logo-request-snapshot-builder.service.js'
);

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

function buildLine(input: {
  id: string;
  lineType?: 'SALE' | 'REFUND';
  commissionMinor?: number;
  commissionVatMinor?: number;
  vatRate?: string | null;
  ledgerCreatedAt?: Date | null;
  ledgerVoidedAt?: Date | null;
  sourceSnapshotOverrides?: Record<string, unknown>;
}) {
  const lineType = input.lineType ?? 'SALE';
  const sourceSnapshotJson = {
    financeLedgerEntryId: `ledger-${input.id}`,
    entryType: lineType.toLowerCase(),
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
    ...input.sourceSnapshotOverrides,
  };
  return {
    id: `line-${input.id}`,
    settlementApprovalId: 'approval-1',
    financeLedgerEntryId: `ledger-${input.id}`,
    lineType,
    amountMinor: lineType === 'SALE' ? 100000 : 10000,
    commissionMinor: input.commissionMinor ?? (lineType === 'SALE' ? 10000 : 0),
    commissionVatMinor: input.commissionVatMinor ?? (lineType === 'SALE' ? 2000 : 0),
    payableImpactMinor: lineType === 'SALE' ? 88000 : -10000,
    sourceSnapshotJson,
    financeLedgerEntry: (
      (input.ledgerCreatedAt === undefined || input.ledgerCreatedAt === null) &&
      input.ledgerVoidedAt === undefined
    )
      ? null
      : {
          createdAt: input.ledgerCreatedAt ?? new Date('2026-06-01T10:00:00.000Z'),
          voidedAt: input.ledgerVoidedAt ?? null,
          voidReason: input.ledgerVoidedAt ? 'economic transfer superseded source ledger' : null,
          supersededByLedgerId: input.ledgerVoidedAt ? `replacement-ledger-${input.id}` : null,
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
    vendor: {
      name: 'Yali Spor',
    },
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

describe('immutable settlement Logo request snapshot builder', () => {
  beforeEach(() => {
    prismaMock.settlementApproval.findUnique.mockReset();
    prismaMock.vendorBillingProfile.findUnique.mockReset();
    prismaMock.vendorFinancialProfile.findFirst.mockReset();
    prismaMock.financeLedgerEntry.findUnique.mockReset();
    prismaMock.financeLedgerEntry.findFirst.mockReset();
    prismaMock.settlementCommissionInvoice.create.mockReset();
  });

  it('builds an immutable request snapshot from settlement approval, line, and billing snapshots only', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval());

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot(
      'approval-1',
      '2026-06-15',
    );

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      provider: 'LOGO_ISBASI',
      status: 'READY',
      payloadBuilderVersion: 'settlement-logo-request-v1',
      blockers: [],
      diagnostics: {
        status: 'READY',
        requestSnapshotPresent: true,
      },
    });
    expect(result.requestSnapshotJson).toMatchObject({
      provider: 'LOGO_ISBASI',
      settlementApprovalId: 'approval-1',
      vendorId: 'vendor-a',
      payloadBuilderVersion: 'settlement-logo-request-v1',
      settlementApprovalSnapshot: {
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        netPayableMinor: 88000,
        humanReadableReference: 'SET-20260601-VENDOR-A-APPROVAL',
      },
      settlementBillingSnapshot: {
        legalCompanyName: 'Snapshot Vendor A.S.',
        taxNumber: '1111111111',
        logoIsbasiCustomerCode: 'SNAPSHOT-CUSTOMER',
      },
      settlementLineSnapshotSummary: {
        detectedCommissionVatRates: [20],
        sourceOrderIds: ['gid://shopify/Order/1001'],
      },
      logoPayload: {
        invoiceDate: '2026-06-15 00:00:00',
        currency: 'TRY',
        description: [
          'Sporgym Pazaryeri Komisyon Hizmeti',
          'Dönem: 2026-06-01 - 2026-06-30',
          'Vendor: Yali Spor',
          'Referans: SET-20260601-VENDOR-A-APPROVAL',
        ].join('\n'),
        sourcePeriod: '2026-06-01..2026-06-30',
        customer: {
          code: 'SNAPSHOT-CUSTOMER',
          name: 'Snapshot Vendor A.S.',
          tcknVkn: '1111111111',
        },
        salesInvoiceDetails: [
          {
            price: 100,
            taxRate: 20,
            description: [
              'Sporgym Pazaryeri Komisyon Hizmeti',
              'Dönem: 2026-06-01 - 2026-06-30',
              'Vendor: Yali Spor',
              'Referans: SET-20260601-VENDOR-A-APPROVAL',
            ].join('\n'),
            productDetail: {
              itemCode: 'SPORGYM-COMMISSION',
              itemType: 2,
            },
          },
        ],
      },
    });
    expect(prismaMock.settlementApproval.findUnique).toHaveBeenCalledWith({
      where: { id: 'approval-1' },
      include: {
        vendor: {
          select: {
            name: true,
          },
        },
        lines: {
          include: {
            financeLedgerEntry: {
              select: {
                createdAt: true,
                voidedAt: true,
                voidReason: true,
                supersededByLedgerId: true,
              },
            },
          },
        },
      },
    });
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.vendorFinancialProfile.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.settlementCommissionInvoice.create).not.toHaveBeenCalled();
    const logoPayload = result.requestSnapshotJson?.logoPayload as Record<string, unknown>;
    expect(String(logoPayload.description)).not.toContain('SettlementApproval approval-1');
  });

  it('blocks request snapshot creation when an approval line references a voided ledger', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({
      lines: [
        buildLine({
          id: '1001',
          ledgerCreatedAt: new Date('2026-06-01T10:00:00.000Z'),
          ledgerVoidedAt: new Date('2026-06-21T10:00:00.000Z'),
        }),
      ],
    }));

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot(
      'approval-1',
      '2026-06-15',
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'BLOCKED',
      blockers: [
        expect.stringContaining('references a voided or superseded ledger row'),
      ],
    });
    expect(result.requestSnapshotJson).toBeNull();
  });

  it('omits the visible period line when no reliable period or line date exists', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        periodStart: null,
        periodEnd: null,
        sourceSnapshotJson: {
          vendorId: 'vendor-a',
          generatedAt: '2026-06-01T10:00:00.000Z',
          settlementBillingSnapshot: buildBillingSnapshot(),
        },
        lines: [buildLine({ id: '1001', ledgerCreatedAt: null })],
      }),
    );

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-15');
    const logoPayload = result.requestSnapshotJson?.logoPayload as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(String(logoPayload.description)).toContain('Sporgym Pazaryeri Komisyon Hizmeti');
    expect(String(logoPayload.description)).toContain('Vendor: Yali Spor');
    expect(String(logoPayload.description)).toContain('Referans: SET-20260601-VENDOR-A-APPROVAL');
    expect(String(logoPayload.description)).not.toContain('Dönem:');
    expect(logoPayload).not.toHaveProperty('sourcePeriod');
  });

  it('uses included ledger createdAt dates as the period fallback', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        periodStart: null,
        periodEnd: null,
        sourceSnapshotJson: {
          vendorId: 'vendor-a',
          generatedAt: '2026-06-01T10:00:00.000Z',
          settlementBillingSnapshot: buildBillingSnapshot(),
        },
        lines: [
          buildLine({ id: '1001', ledgerCreatedAt: new Date('2026-06-03T08:00:00.000Z') }),
          buildLine({ id: '1002', ledgerCreatedAt: new Date('2026-06-08T08:00:00.000Z') }),
        ],
      }),
    );

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-15');
    const logoPayload = result.requestSnapshotJson?.logoPayload as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(logoPayload.description).toContain('Dönem: 2026-06-03 - 2026-06-08');
    expect(logoPayload.sourcePeriod).toBe('2026-06-03..2026-06-08');
  });

  it('blocks when the settlement billing snapshot is missing', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ sourceSnapshotJson: { vendorId: 'vendor-a' } }),
    );

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-15');

    expect(result.ok).toBe(false);
    expect(result.status).toBe('BLOCKED');
    expect(result.requestSnapshotJson).toBeNull();
    expect(result.blockers).toContain(
      'Settlement billing snapshot is missing. Historical invoice execution cannot be guaranteed.',
    );
  });

  it('blocks when commission VAT snapshot is missing', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ lines: [buildLine({ id: '1001', vatRate: null })] }),
    );

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-15');

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('SettlementApprovalLine line-1001 is missing commissionVatPercentSnapshot.');
    expect(result.executionSnapshotGuard.snapshotCompleteness.commissionVatPercentSnapshot.missingLineIds).toEqual(['line-1001']);
  });

  it('blocks when required billing snapshot fields are missing', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        sourceSnapshotJson: {
          settlementBillingSnapshot: buildBillingSnapshot({
            billingCity: null,
            legalEntityType: null,
          }),
        },
      }),
    );

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-15');

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'Settlement billing snapshot is missing required fields: billingCity, legalEntityType.',
    );
  });

  it('blocks mixed VAT rates', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        lines: [
          buildLine({ id: '1001', vatRate: '18' }),
          buildLine({ id: '1002', vatRate: '20' }),
        ],
      }),
    );

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-15');

    expect(result.ok).toBe(false);
    expect(result.executionSnapshotGuard.detectedCommissionVatRates).toEqual([18, 20]);
    expect(result.blockers).toContain(
      'Commission VAT rate is not uniform across settlement lines; Logo invoice creation is blocked until reviewed.',
    );
  });

  it('blocks when Logo customer binding is missing from the settlement billing snapshot', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        sourceSnapshotJson: {
          settlementBillingSnapshot: buildBillingSnapshot({
            logoIsbasiCustomerCode: null,
            logoIsbasiCustomerId: null,
          }),
        },
      }),
    );

    const result = await buildSettlementLogoCommissionInvoiceRequestSnapshot('approval-1', '2026-06-15');

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'Vendor must have logoIsbasiCustomerCode before Logo invoice creation.',
        'Vendor must have logoIsbasiCustomerId before Logo invoice creation.',
      ]),
    );
  });
});
