import {
  SettlementApprovalStatus,
  type SettlementApproval,
  type SettlementApprovalLine,
  type VendorFinancialProfile,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  buildLogoIsbasiCommissionInvoicePreview,
  type LogoIsbasiCommissionInvoicePreview,
} from '../logo-isbasi/logo-isbasi-commission-preview.js';
import type { VendorBillingProfileDto } from '../vendors/vendor-billing-profile.service.js';
import {
  mapSettlementBillingSnapshotToVendorBillingProfileDto,
  readSettlementBillingSnapshot,
  SETTLEMENT_BILLING_SNAPSHOT_MISSING_BLOCKER,
  SETTLEMENT_BILLING_SNAPSHOT_READINESS_SOURCE,
} from './settlement-billing-snapshot.service.js';
import {
  buildSkippedExecutionSnapshotGuard,
  validateSettlementApprovalExecutionSnapshots,
  type SettlementExecutionSnapshotGuardDto,
} from './settlement-execution-snapshot-guard.service.js';

const REQUIRED_BILLING_FIELDS = [
  'legalCompanyName',
  'taxNumber',
  'taxOffice',
  'billingAddress',
  'billingCity',
  'billingDistrict',
  'billingEmail',
] as const;

const SOURCE_ORDER_ID_SAMPLE_LIMIT = 20;

type RequiredBillingField = (typeof REQUIRED_BILLING_FIELDS)[number];
type SettlementApprovalForPreview = SettlementApproval & { lines: SettlementApprovalLine[] };

export type SettlementCommissionInvoicePreviewDto = {
  ok: boolean;
  writesPerformed: false;
  settlementApprovalId: string;
  readiness: {
    canCreateLogoInvoiceLater: boolean;
    blockers: string[];
    warnings: string[];
    billingSnapshotPresent: boolean;
    billingSnapshotSource: typeof SETTLEMENT_BILLING_SNAPSHOT_READINESS_SOURCE | null;
  };
  amounts: {
    commissionAmount: number;
    commissionVatAmount: number;
    expectedGrossInvoiceAmount: number;
    currency: string;
    taxRate: number | null;
    vatIncluded: false;
  };
  vendorBillingReadiness: {
    complete: boolean;
    missingFields: RequiredBillingField[];
    logoCustomerCodePresent: boolean;
    logoCustomerIdPresent: boolean;
    logoEinvoiceEligible: boolean | null;
    billingSnapshotPresent: boolean;
    billingSnapshotSource: typeof SETTLEMENT_BILLING_SNAPSHOT_READINESS_SOURCE | null;
  };
  vatRateSource: 'settlement_line_snapshots' | 'blocked_mixed_or_missing';
  detectedVatRates: number[];
  configuredVendorCommissionVatPercent: number | null;
  executionSnapshotGuard: SettlementExecutionSnapshotGuardDto;
  logoPayloadPreview: Record<string, unknown> | null;
};

function minorToMajor(value: number) {
  return Math.round(value) / 100;
}

function formatDecimal(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, '');
}

function readSnapshotRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSnapshotString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeVatRate(value: unknown) {
  const numeric = readNumber(value);
  if (numeric === null || numeric < 0 || numeric > 100) {
    return null;
  }

  return Math.round(numeric * 10000) / 10000;
}

function buildSourcePeriod(approval: SettlementApprovalForPreview) {
  if (!approval.periodStart && !approval.periodEnd) {
    return null;
  }
  const start = approval.periodStart?.toISOString().slice(0, 10) ?? 'open-start';
  const end = approval.periodEnd?.toISOString().slice(0, 10) ?? 'open-end';
  return `${start}..${end}`;
}

function buildDescription(approval: SettlementApprovalForPreview) {
  const period = buildSourcePeriod(approval);
  return [
    'Sporgym Pazaryeri Komisyon Hizmeti',
    `SettlementApproval ${approval.id}`,
    period ? `Period ${period}` : null,
  ].filter(Boolean).join(' - ');
}

function getMissingBillingFields(profile: VendorBillingProfileDto | null) {
  if (!profile) {
    return [...REQUIRED_BILLING_FIELDS];
  }
  return REQUIRED_BILLING_FIELDS.filter((field) => {
    const value = profile[field];
    return typeof value !== 'string' || !value.trim();
  });
}

function getSourceOrderIds(lines: SettlementApprovalLine[]) {
  const ids = new Set<string>();
  for (const line of lines) {
    const snapshot = readSnapshotRecord(line.sourceSnapshotJson);
    const orderId = readSnapshotString(snapshot.sourceShopifyOrderId);
    if (orderId) {
      ids.add(orderId);
    }
    if (ids.size >= SOURCE_ORDER_ID_SAMPLE_LIMIT) {
      break;
    }
  }
  return Array.from(ids);
}

function useProvenLogoServiceReference(payload: Record<string, unknown>) {
  const details = Array.isArray(payload.salesInvoiceDetails)
    ? payload.salesInvoiceDetails.map((detail) => {
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
          return detail;
        }
        const record = detail as Record<string, unknown>;
        const productDetail = readSnapshotRecord(record.productDetail);
        return {
          ...record,
          productDetail: {
            itemCode: readSnapshotString(productDetail.itemCode) ?? 'SPORGYM-COMMISSION',
            itemType: typeof productDetail.itemType === 'number' ? productDetail.itemType : 2,
          },
        };
      })
    : payload.salesInvoiceDetails;

  return {
    ...payload,
    salesInvoiceDetails: details,
  };
}

function emptyBillingReadiness(): SettlementCommissionInvoicePreviewDto['vendorBillingReadiness'] {
  return {
    complete: false,
    missingFields: [...REQUIRED_BILLING_FIELDS],
    logoCustomerCodePresent: false,
    logoCustomerIdPresent: false,
    logoEinvoiceEligible: null,
    billingSnapshotPresent: false,
    billingSnapshotSource: null,
  };
}

function buildAmounts(approval: Pick<SettlementApproval, 'commissionMinor' | 'commissionVatMinor' | 'currency'>) {
  const commissionAmount = minorToMajor(approval.commissionMinor);
  const commissionVatAmount = minorToMajor(approval.commissionVatMinor);
  return {
    commissionAmount,
    commissionVatAmount,
    expectedGrossInvoiceAmount: minorToMajor(approval.commissionMinor + approval.commissionVatMinor),
    currency: approval.currency,
    taxRate: null as number | null,
    vatIncluded: false as const,
  };
}

function resolveConfiguredCommissionVatPercent(profile: VendorFinancialProfile | null) {
  return normalizeVatRate(profile?.commissionVatPercent);
}

function buildBlockedResponse(input: {
  settlementApprovalId: string;
  approval?: SettlementApprovalForPreview | null;
  blockers: string[];
  warnings?: string[];
  vendorBillingReadiness?: SettlementCommissionInvoicePreviewDto['vendorBillingReadiness'];
  vatRateSource?: SettlementCommissionInvoicePreviewDto['vatRateSource'];
  detectedVatRates?: number[];
  configuredVendorCommissionVatPercent?: number | null;
  executionSnapshotGuard?: SettlementExecutionSnapshotGuardDto;
}): SettlementCommissionInvoicePreviewDto {
  return {
    ok: false,
    writesPerformed: false,
    settlementApprovalId: input.settlementApprovalId,
    readiness: {
      canCreateLogoInvoiceLater: false,
      blockers: input.blockers,
      warnings: input.warnings ?? [],
      billingSnapshotPresent: Boolean(input.vendorBillingReadiness?.billingSnapshotPresent),
      billingSnapshotSource: input.vendorBillingReadiness?.billingSnapshotSource ?? null,
    },
    amounts: input.approval
      ? buildAmounts(input.approval)
      : {
          commissionAmount: 0,
          commissionVatAmount: 0,
          expectedGrossInvoiceAmount: 0,
          currency: 'TRY',
          taxRate: null,
          vatIncluded: false,
        },
    vendorBillingReadiness: input.vendorBillingReadiness ?? emptyBillingReadiness(),
    vatRateSource: input.vatRateSource ?? 'blocked_mixed_or_missing',
    detectedVatRates: input.detectedVatRates ?? [],
    configuredVendorCommissionVatPercent: input.configuredVendorCommissionVatPercent ?? null,
    executionSnapshotGuard:
      input.executionSnapshotGuard ??
      buildSkippedExecutionSnapshotGuard(input.blockers[0] ?? 'Execution snapshot guard was not evaluated.'),
    logoPayloadPreview: null,
  };
}

export async function previewSettlementLogoCommissionInvoice(
  settlementApprovalId: string,
): Promise<SettlementCommissionInvoicePreviewDto> {
  const approval = await prisma.settlementApproval.findUnique({
    where: {
      id: settlementApprovalId,
    },
    include: {
      lines: true,
    },
  });

  if (!approval) {
    return buildBlockedResponse({
      settlementApprovalId,
      approval: null,
      blockers: ['SettlementApproval must exist.'],
    });
  }

  if (approval.status !== SettlementApprovalStatus.APPROVED) {
    return buildBlockedResponse({
      settlementApprovalId,
      approval,
      blockers: [`SettlementApproval status must be APPROVED before Logo commission invoice preview. Current status: ${approval.status}.`],
    });
  }

  const financialProfile = await prisma.vendorFinancialProfile.findFirst({
    where: {
      vendorId: approval.vendorId,
      active: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
  const settlementBillingSnapshot = readSettlementBillingSnapshot(approval.sourceSnapshotJson);
  const billingProfile = settlementBillingSnapshot
    ? mapSettlementBillingSnapshotToVendorBillingProfileDto(settlementBillingSnapshot)
    : null;
  const missingFields = getMissingBillingFields(billingProfile);
  const vendorBillingReadiness = {
    complete: Boolean(settlementBillingSnapshot) && Boolean(billingProfile) && missingFields.length === 0,
    missingFields,
    logoCustomerCodePresent: Boolean(billingProfile?.logoIsbasiCustomerCode?.trim()),
    logoCustomerIdPresent: Boolean(billingProfile?.logoIsbasiCustomerId?.trim()),
    logoEinvoiceEligible: billingProfile?.logoIsbasiEinvoiceEligible ?? null,
    billingSnapshotPresent: Boolean(settlementBillingSnapshot),
    billingSnapshotSource: settlementBillingSnapshot ? SETTLEMENT_BILLING_SNAPSHOT_READINESS_SOURCE : null,
  };

  const amounts = buildAmounts(approval);
  const executionSnapshotGuard = await validateSettlementApprovalExecutionSnapshots(settlementApprovalId);
  const detectedVatRates = executionSnapshotGuard.detectedCommissionVatRates;
  const snapshotTaxRate =
    approval.commissionMinor > 0 && executionSnapshotGuard.ok && detectedVatRates.length === 1
      ? detectedVatRates[0]
      : null;
  const vatRateSource: SettlementCommissionInvoicePreviewDto['vatRateSource'] =
    snapshotTaxRate === null ? 'blocked_mixed_or_missing' : 'settlement_line_snapshots';
  const configuredVendorCommissionVatPercent = resolveConfiguredCommissionVatPercent(financialProfile);
  const blockers = [
    ...(!settlementBillingSnapshot ? [SETTLEMENT_BILLING_SNAPSHOT_MISSING_BLOCKER] : []),
    ...(settlementBillingSnapshot && missingFields.length
      ? [`Settlement billing snapshot is missing required fields: ${missingFields.join(', ')}.`]
      : []),
    ...(settlementBillingSnapshot && !vendorBillingReadiness.logoCustomerCodePresent
      ? ['Vendor must have logoIsbasiCustomerCode before Logo invoice creation.']
      : []),
    ...(settlementBillingSnapshot && !vendorBillingReadiness.logoCustomerIdPresent
      ? ['Vendor must have logoIsbasiCustomerId before Logo invoice creation.']
      : []),
    ...(approval.currency !== 'TRY' ? [`SettlementApproval currency must be TRY for Logo commission invoice preview. Current currency: ${approval.currency}.`] : []),
    ...executionSnapshotGuard.blockers,
    ...(approval.commissionMinor <= 0
      ? ['Settlement commission amount is zero; accountant confirmation is required before creating a Logo invoice.']
      : []),
  ];
  const warnings = [
    'Read-only preview only. No Logo invoice is created.',
    'Do not use netPayableMinor as invoice amount; preview uses commissionMinor plus commissionVatMinor.',
    ...executionSnapshotGuard.warnings,
    ...(snapshotTaxRate !== null &&
    configuredVendorCommissionVatPercent !== null &&
    snapshotTaxRate !== configuredVendorCommissionVatPercent
      ? [
          `Settlement line VAT rate ${formatDecimal(snapshotTaxRate)}% differs from current vendor profile commission VAT rate ${formatDecimal(configuredVendorCommissionVatPercent)}%.`,
        ]
      : []),
    ...(settlementBillingSnapshot && !vendorBillingReadiness.logoEinvoiceEligible
      ? ['Logo e-invoice eligibility is not confirmed for this vendor.']
      : []),
  ];
  amounts.taxRate = snapshotTaxRate;

  const invoiceTaxRate = amounts.taxRate;
  if (blockers.length || !billingProfile || invoiceTaxRate === null) {
    return {
      ok: false,
      writesPerformed: false,
      settlementApprovalId,
      readiness: {
        canCreateLogoInvoiceLater: false,
        blockers,
        warnings,
        billingSnapshotPresent: vendorBillingReadiness.billingSnapshotPresent,
        billingSnapshotSource: vendorBillingReadiness.billingSnapshotSource,
      },
      amounts,
      vendorBillingReadiness,
      vatRateSource,
      detectedVatRates,
      configuredVendorCommissionVatPercent,
      executionSnapshotGuard,
      logoPayloadPreview: null,
    };
  }

  const preview: LogoIsbasiCommissionInvoicePreview = buildLogoIsbasiCommissionInvoicePreview({
    vendorBillingProfile: billingProfile,
    commissionAmount: formatDecimal(amounts.commissionAmount),
    vatRate: formatDecimal(invoiceTaxRate),
    currency: approval.currency,
    description: buildDescription(approval),
    invoiceDate: new Date(),
    sourceOrderIds: getSourceOrderIds(approval.lines),
    sourcePeriod: buildSourcePeriod(approval),
  });

  return {
    ok: true,
    writesPerformed: false,
    settlementApprovalId,
    readiness: {
      canCreateLogoInvoiceLater: true,
      blockers: [],
      warnings: [...warnings, ...preview.warnings],
      billingSnapshotPresent: vendorBillingReadiness.billingSnapshotPresent,
      billingSnapshotSource: vendorBillingReadiness.billingSnapshotSource,
    },
    amounts,
    vendorBillingReadiness,
    vatRateSource,
    detectedVatRates,
    configuredVendorCommissionVatPercent,
    executionSnapshotGuard,
    logoPayloadPreview: useProvenLogoServiceReference(preview.payload),
  };
}
