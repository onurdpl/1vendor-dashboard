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
  vendorFinancialProfile: {
    findFirst: vi.fn(),
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
  lineVatRates?: Array<number | string | null>;
  missingSnapshotFields?: string[];
  billingSnapshot?: Record<string, unknown> | null;
}) {
  const lineVatRates = input.lineVatRates ?? [20];
  const missingSnapshotFields = new Set(input.missingSnapshotFields ?? []);
  const sourceSnapshotJson =
    input.billingSnapshot === null
      ? {}
      : {
          settlementBillingSnapshot: input.billingSnapshot ?? buildBillingSnapshot(),
        };
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
    sourceSnapshotJson,
    lines: lineVatRates.map((lineVatRate, index) => {
      const sourceSnapshotJson: Record<string, unknown> = {
        sourceShopifyOrderId: `gid://shopify/Order/100${index + 1}`,
        sourceShopifyOrderNumber: `#100${index + 1}`,
        commissionPercentSnapshot: '10',
        ...(lineVatRate === null ? {} : { commissionVatPercentSnapshot: String(lineVatRate) }),
        deductShippingEnabledSnapshot: false,
        shippingModeSnapshot: 'DISABLED',
        fixedShippingFeeSnapshot: null,
        shippingCostSnapshot: null,
        shippingVatAmountSnapshot: null,
        shippingCostSourceSnapshot: null,
        shippingCostProviderSnapshot: null,
      };

      for (const field of missingSnapshotFields) {
        delete sourceSnapshotJson[field];
      }

      return {
        id: `line-${index + 1}`,
        settlementApprovalId: 'approval-1',
        financeLedgerEntryId: `ledger-${index + 1}`,
        lineType: 'SALE',
        amountMinor: Math.round(100000 / lineVatRates.length),
        commissionMinor: Math.round((input.commissionMinor ?? 10000) / lineVatRates.length),
        commissionVatMinor: Math.round((input.commissionVatMinor ?? 2000) / lineVatRates.length),
        payableImpactMinor: Math.round(88000 / lineVatRates.length),
        sourceSnapshotJson,
        financeLedgerEntry: null,
      };
    }),
  };
}

function buildBillingSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    source: 'vendor_billing_profile',
    capturedAt: '2026-06-01T09:30:00.000Z',
    vendorId: 'vendor-a',
    vendorBillingProfileId: 'billing-1',
    legalCompanyName: 'Yali Spor A.S.',
    taxNumber: '1234567890',
    taxOffice: 'Kadikoy',
    billingAddress: 'Billing address',
    billingCity: 'Istanbul',
    billingDistrict: 'Kadikoy',
    authorizedPerson: 'Authorized Person',
    billingEmail: 'billing@yali.test',
    billingPhone: '+905551112233',
    legalEntityType: 'limited_company',
    logoIsbasiCustomerCode: 'LOGO-CODE-1',
    logoIsbasiCustomerId: 'LOGO-ID-1',
    logoIsbasiEinvoiceEligible: true,
    logoIsbasiLastCheckedAt: '2026-06-01T09:00:00.000Z',
    ...overrides,
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
    prismaMock.vendorFinancialProfile.findFirst.mockReset();
    prismaMock.vendorFinancialProfile.findFirst.mockResolvedValue({
      id: 'finance-profile-1',
      vendorId: 'vendor-a',
      commissionPercent: '10.00',
      commissionVatPercent: '20.00',
      deductShippingEnabled: false,
      shippingMode: 'DISABLED',
      fixedShippingFee: null,
      active: true,
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
      updatedAt: new Date('2026-06-01T09:00:00.000Z'),
    });
  });

  it('returns a read-only Logo payload preview for an approved settlement', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({}));
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(true);
    expect(preview.writesPerformed).toBe(false);
    expect(preview.readiness.canCreateLogoInvoiceLater).toBe(true);
    expect(preview.readiness).toMatchObject({
      billingSnapshotPresent: true,
      billingSnapshotSource: 'settlement_approval',
    });
    expect(preview.vendorBillingReadiness).toMatchObject({
      billingSnapshotPresent: true,
      billingSnapshotSource: 'settlement_approval',
    });
    expect(preview.amounts).toMatchObject({
      commissionAmount: 100,
      commissionVatAmount: 20,
      expectedGrossInvoiceAmount: 120,
      currency: 'TRY',
      taxRate: 20,
      vatIncluded: false,
    });
    expect(preview.vatRateSource).toBe('settlement_line_snapshots');
    expect(preview.detectedVatRates).toEqual([20]);
    expect(preview.configuredVendorCommissionVatPercent).toBeNull();
    expect(preview.immutableRequestSnapshot).toMatchObject({
      status: 'READY',
      payloadBuilderVersion: 'settlement-logo-request-v1',
      requestSnapshotPresent: true,
      blockers: [],
    });
    expect(preview.executionSnapshotGuard).toMatchObject({
      ok: true,
      detectedCommissionRates: [10],
      detectedCommissionVatRates: [20],
      detectedShippingModes: ['disabled'],
      requiredSnapshotsPresent: true,
    });
    expect(preview.logoPayloadPreview).toMatchObject({
      currency: 'TRY',
      vatIncluded: false,
      sourcePeriod: '2026-06-01..2026-06-30',
      sourceOrderIds: ['gid://shopify/Order/1001'],
    });
    expect(preview.logoPayloadPreview?.description).toContain('Sporgym Pazaryeri Komisyon Hizmeti');
    expect(preview.logoPayloadPreview?.description).toContain('Referans: SET-20260601-VENDOR-A-APPROVAL');
    expect(preview.logoPayloadPreview?.description).not.toContain('SettlementApproval approval-1');
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorBillingProfile.create).not.toHaveBeenCalled();
    expect(prismaMock.vendorBillingProfile.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.vendorFinancialProfile.findFirst).not.toHaveBeenCalled();
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

  it('uses the settlement billing snapshot instead of current VendorBillingProfile data', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        billingSnapshot: buildBillingSnapshot({
          legalCompanyName: 'Snapshot Vendor A.S.',
          taxNumber: '1111111111',
          billingEmail: 'snapshot-billing@example.test',
          logoIsbasiCustomerCode: 'SNAPSHOT-CUSTOMER',
        }),
      }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(
      buildBillingProfile({
        legalCompanyName: 'Changed Vendor A.S.',
        taxNumber: '2222222222',
        billingEmail: 'changed-billing@example.test',
        logoIsbasiCustomerCode: 'CHANGED-CUSTOMER',
      }),
    );

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');
    const customer = preview.logoPayloadPreview?.customer as Record<string, unknown>;

    expect(preview.ok).toBe(true);
    expect(customer).toMatchObject({
      code: 'SNAPSHOT-CUSTOMER',
      name: 'Snapshot Vendor A.S.',
      tcknVkn: '1111111111',
      email: 'snapshot-billing@example.test',
    });
    expect(customer.code).not.toBe('CHANGED-CUSTOMER');
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
  });

  it('returns blockers for missing billing fields and missing Logo binding', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({
        billingSnapshot: buildBillingSnapshot({
          billingCity: null,
          logoIsbasiCustomerCode: null,
          logoIsbasiCustomerId: null,
        }),
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
      billingSnapshotPresent: true,
      billingSnapshotSource: 'settlement_approval',
    });
    expect(preview.vatRateSource).toBe('settlement_line_snapshots');
    expect(preview.detectedVatRates).toEqual([20]);
    expect(preview.executionSnapshotGuard.ok).toBe(true);
    expect(preview.readiness.blockers).toEqual(
      expect.arrayContaining([
        'Settlement billing snapshot is missing required fields: billingCity.',
        'Vendor must have logoIsbasiCustomerCode before Logo invoice creation.',
        'Vendor must have logoIsbasiCustomerId before Logo invoice creation.',
      ]),
    );
  });

  it('blocks Logo readiness when the settlement billing snapshot is missing', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ billingSnapshot: null }));

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(false);
    expect(preview.logoPayloadPreview).toBeNull();
    expect(preview.readiness).toMatchObject({
      canCreateLogoInvoiceLater: false,
      billingSnapshotPresent: false,
      billingSnapshotSource: null,
    });
    expect(preview.vendorBillingReadiness).toMatchObject({
      complete: false,
      billingSnapshotPresent: false,
      billingSnapshotSource: null,
    });
    expect(preview.readiness.blockers).toContain(
      'Settlement billing snapshot is missing. Historical invoice execution cannot be guaranteed.',
    );
    expect(prismaMock.vendorBillingProfile.findUnique).not.toHaveBeenCalled();
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

  it('uses uniform 20% settlement line VAT snapshots for taxRate', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 5000, lineVatRates: [20, 20] }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.amounts.taxRate).toBe(20);
    expect(preview.vatRateSource).toBe('settlement_line_snapshots');
    expect(preview.detectedVatRates).toEqual([20]);
    expect((preview.logoPayloadPreview?.salesInvoiceDetails as Array<Record<string, unknown>>)[0].taxRate).toBe(20);
  });

  it('uses uniform 18% settlement line VAT snapshots without reading current vendor policy', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 4500, lineVatRates: [18, '18.00'] }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(true);
    expect(preview.amounts.taxRate).toBe(18);
    expect(preview.detectedVatRates).toEqual([18]);
    expect(preview.configuredVendorCommissionVatPercent).toBeNull();
    expect(preview.readiness.warnings).not.toContain(
      'Settlement line VAT rate 18% differs from current vendor profile commission VAT rate 20%.',
    );
    expect(prismaMock.vendorFinancialProfile.findFirst).not.toHaveBeenCalled();
  });

  it('blocks mixed 18% and 20% settlement line VAT snapshots', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 4020, lineVatRates: [18, 20] }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(false);
    expect(preview.logoPayloadPreview).toBeNull();
    expect(preview.amounts.taxRate).toBeNull();
    expect(preview.vatRateSource).toBe('blocked_mixed_or_missing');
    expect(preview.detectedVatRates).toEqual([18, 20]);
    expect(preview.executionSnapshotGuard.ok).toBe(false);
    expect(preview.readiness.blockers).toContain(
      'Commission VAT rate is not uniform across settlement lines; Logo invoice creation is blocked until reviewed.',
    );
  });

  it('blocks missing commission execution snapshots', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 5000, missingSnapshotFields: ['commissionPercentSnapshot'] }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(false);
    expect(preview.readiness.canCreateLogoInvoiceLater).toBe(false);
    expect(preview.logoPayloadPreview).toBeNull();
    expect(preview.executionSnapshotGuard.ok).toBe(false);
    expect(preview.executionSnapshotGuard.requiredSnapshotsPresent).toBe(false);
    expect(preview.readiness.blockers).toContain('SettlementApprovalLine line-1 is missing commissionPercentSnapshot.');
    expect(preview.executionSnapshotGuard.snapshotCompleteness.commissionPercentSnapshot.missingLineIds).toEqual(['line-1']);
  });

  it('blocks missing settlement line VAT snapshots', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 5000, lineVatRates: [null] }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(false);
    expect(preview.logoPayloadPreview).toBeNull();
    expect(preview.amounts.taxRate).toBeNull();
    expect(preview.vatRateSource).toBe('blocked_mixed_or_missing');
    expect(preview.detectedVatRates).toEqual([]);
    expect(preview.executionSnapshotGuard.ok).toBe(false);
    expect(preview.readiness.blockers).toContain(
      'SettlementApprovalLine line-1 is missing commissionVatPercentSnapshot.',
    );
  });

  it('does not use current VendorFinancialProfile to rescue missing execution snapshots', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 5000, missingSnapshotFields: ['commissionVatPercentSnapshot'] }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.vendorFinancialProfile.findFirst.mockResolvedValue({
      id: 'finance-profile-2',
      vendorId: 'vendor-a',
      commissionPercent: '10.00',
      commissionVatPercent: '20.00',
      deductShippingEnabled: false,
      shippingMode: 'DISABLED',
      fixedShippingFee: null,
      active: true,
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
      updatedAt: new Date('2026-06-01T09:00:00.000Z'),
    });

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(false);
    expect(preview.amounts.taxRate).toBeNull();
    expect(preview.detectedVatRates).toEqual([]);
    expect(preview.configuredVendorCommissionVatPercent).toBeNull();
    expect(preview.readiness.canCreateLogoInvoiceLater).toBe(false);
    expect(preview.readiness.blockers).toContain('SettlementApprovalLine line-1 is missing commissionVatPercentSnapshot.');
    expect(preview.logoPayloadPreview).toBeNull();
    expect(prismaMock.vendorFinancialProfile.findFirst).not.toHaveBeenCalled();
  });

  it('does not derive taxRate from aggregate commissionVatMinor divided by commissionMinor', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(
      buildApproval({ commissionMinor: 25000, commissionVatMinor: 4020, lineVatRates: [20] }),
    );
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());

    const preview = await previewSettlementLogoCommissionInvoice('approval-1');

    expect(preview.ok).toBe(true);
    expect(preview.amounts.taxRate).toBe(20);
    expect(preview.amounts.taxRate).not.toBeCloseTo(16.08);
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
