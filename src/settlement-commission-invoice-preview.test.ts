import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  settlementApproval: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  settlementApprovalLine: {
    create: vi.fn(),
    update: vi.fn(),
  },
  vendorBillingProfile: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  invoiceExecution: {
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { previewSettlementLogoCommissionInvoice } = await import(
  '../backend/src/modules/finance/settlement-commission-invoice-preview.service.js'
);

function buildApproval(input: {
  status?: 'DRAFT' | 'APPROVED' | 'CANCELLED';
  commissionMinor?: number;
  commissionVatMinor?: number;
  netPayableMinor?: number;
}) {
  return {
    id: 'approval-1',
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    vendorId: 'vendor-a',
    periodStart: new Date('2026-06-01T00:00:00.000Z'),
    periodEnd: new Date('2026-06-30T23:59:59.000Z'),
    status: input.status ?? 'APPROVED',
    currency: 'TRY',
    grossSalesMinor: 100000,
    refundTotalMinor: 10000,
    commissionMinor: input.commissionMinor ?? 10000,
    commissionVatMinor: input.commissionVatMinor ?? 2000,
    netPayableMinor: input.netPayableMinor ?? 123456,
    approvedBy: 'admin-1',
    approvedAt: new Date('2026-06-01T12:00:00.000Z'),
    cancelledBy: null,
    cancelledAt: null,
    notes: null,
    sourceSnapshotJson: {},
    lines: [
      {
        id: 'line-1',
        settlementApprovalId: 'approval-1',
        financeLedgerEntryId: 'ledger-1',
        lineType: 'SALE',
        amountMinor: 100000,
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        payableImpactMinor: 88000,
        sourceSnapshotJson: {
          sourceShopifyOrderId: 'gid://shopify/Order/1001',
          sourceShopifyOrderNumber: '#1001',
        },
      },
    ],
  };
}

function buildBillingProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'billing-1',
    vendorId: 'vendor-a',
    legalCompanyName: 'Yali Spor A.S.',
    taxNumber: '1234567890',
    taxOffice: 'Kadikoy',
    billingAddress: 'Billing address',
    billingCity: 'Istanbul',
    billingDistrict: 'Kadikoy',
    iban: null,
    authorizedPerson: 'Authorized Person',
    billingEmail: 'billing@yali.test',
    billingPhone: '+905551112233',
    legalEntityType: 'limited_company',
    logoIsbasiCustomerCode: 'LOGO-CODE-1',
    logoIsbasiCustomerId: 'LOGO-ID-1',
    logoIsbasiEinvoiceEligible: true,
    logoIsbasiLastCheckedAt: new Date('2026-06-01T09:00:00.000Z'),
    createdAt: new Date('2026-06-01T09:00:00.000Z'),
    updatedAt: new Date('2026-06-01T09:00:00.000Z'),
    ...overrides,
  };
}

describe('settlement Logo commission invoice preview', () => {
  beforeEach(() => {
    prismaMock.settlementApproval.findUnique.mockReset();
    prismaMock.settlementApproval.create.mockReset();
    prismaMock.settlementApproval.update.mockReset();
    prismaMock.settlementApprovalLine.create.mockReset();
    prismaMock.settlementApprovalLine.update.mockReset();
    prismaMock.vendorBillingProfile.findUnique.mockReset();
    prismaMock.vendorBillingProfile.create.mockReset();
    prismaMock.vendorBillingProfile.update.mockReset();
    prismaMock.invoiceExecution.create.mockReset();
  });

  it('returns a read-only Logo payload preview for an approved settlement', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({}));
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(true);
    expect(preview.writesPerformed).toBe(false);
    expect(preview.readiness.canCreateLogoInvoiceLater).toBe(true);
    expect(preview.amounts).toMatchObject({
      commissionAmount: 100,
      commissionVatAmount: 20,
      expectedGrossInvoiceAmount: 120,
      currency: 'TRY',
      taxRate: 20,
      vatIncluded: false,
    });
    expect(preview.logoPayloadPreview).toMatchObject({
      currency: 'TRY',
      vatIncluded: false,
      sourcePeriod: '2026-06-01..2026-06-30',
      sourceOrderIds: ['gid://shopify/Order/1001'],
    });
    expect(preview.logoPayloadPreview?.description).toContain('Sporgym Pazaryeri Komisyon Hizmeti');
    expect(preview.logoPayloadPreview?.description).toContain('approval-1');
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorBillingProfile.create).not.toHaveBeenCalled();
    expect(prismaMock.vendorBillingProfile.update).not.toHaveBeenCalled();
    expect(prismaMock.invoiceExecution.create).not.toHaveBeenCalled();
  });

  it('returns blockers for draft and cancelled settlements without building a final-ready payload', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValueOnce(buildApproval({ status: 'DRAFT' }));

    const draft = await previewSettlementLogoCommissionInvoice('approval-1');

    prismaMock.settlementApproval.findUnique.mockResolvedValueOnce(buildApproval({ status: 'CANCELLED' }));

    const cancelled = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(draft.ok).toBe(false);
    expect(draft.logoPayloadPreview).toBeNull();
    expect(draft.readiness.blockers).toContain(
      'SettlementApproval status must be APPROVED before Logo commission invoice preview. Current status: DRAFT.',
    );
    expect(cancelled.ok).toBe(false);
    expect(cancelled.logoPayloadPreview).toBeNull();
    expect(cancelled.readiness.blockers).toContain(
      'SettlementApproval status must be APPROVED before Logo commission invoice preview. Current status: CANCELLED.',
    );
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
  });

  it('returns blockers for missing billing fields and missing Logo binding', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({}));
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(
      buildBillingProfile({
        billingCity: null,
        logoIsbasiCustomerCode: null,
        logoIsbasiCustomerId: null,
      }),
    );

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(false);
    expect(preview.logoPayloadPreview).toBeNull();
    expect(preview.vendorBillingReadiness).toMatchObject({
      complete: false,
      missingFields: ['billingCity'],
      logoCustomerCodePresent: false,
      logoCustomerIdPresent: false,
    });
    expect(preview.readiness.blockers).toEqual(
      expect.arrayContaining([
        'Vendor billing profile is missing required fields: billingCity.',
        'Vendor must have logoIsbasiCustomerCode before Logo invoice creation.',
        'Vendor must have logoIsbasiCustomerId before Logo invoice creation.',
      ]),
    );
  });

  it('uses commissionMinor for invoice amount instead of netPayableMinor', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 3456, commissionVatMinor: 691, netPayableMinor: 999999 }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');
    const details = preview.logoPayloadPreview?.salesInvoiceDetails as Array<Record<string, unknown>>;

    expect(preview.amounts.commissionAmount).toBe(34.56);
    expect(preview.amounts.expectedGrossInvoiceAmount).toBe(41.47);
    expect(details[0].price).toBe(34.56);
    expect(details[0].price).not.toBe(9999.99);
  });

  it('derives taxRate from commissionVatMinor divided by commissionMinor', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 5000 }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.amounts.taxRate).toBe(20);
    expect((preview.logoPayloadPreview?.salesInvoiceDetails as Array<Record<string, unknown>>)[0].taxRate).toBe(20);
  });

  it('returns a blocker for zero commission requiring accountant confirmation', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 0, commissionVatMinor: 0 }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(false);
    expect(preview.amounts.taxRate).toBeNull();
    expect(preview.logoPayloadPreview).toBeNull();
    expect(preview.readiness.blockers).toContain(
      'Settlement commission amount is zero; accountant confirmation is required before creating a Logo invoice.',
    );
  });

  it('uses only productDetail itemCode and itemType for the proven Logo service reference', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({}));
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');
    const details = preview.logoPayloadPreview?.salesInvoiceDetails as Array<Record<string, Record<string, unknown>>>;

    expect(details[0].productDetail).toEqual({
      itemCode: 'SPORGYM-COMMISSION',
      itemType: 2,
    });
  });
});
