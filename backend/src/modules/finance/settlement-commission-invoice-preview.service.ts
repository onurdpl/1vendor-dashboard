import { SettlementApprovalStatus, type SettlementApproval, type SettlementApprovalLine, type VendorBillingProfile } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  buildLogoIsbasiCommissionInvoicePreview,
  type LogoIsbasiCommissionInvoicePreview,
} from '../logo-isbasi/logo-isbasi-commission-preview.js';
import type { VendorBillingProfileDto } from '../vendors/vendor-billing-profile.service.js';

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
  };
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

function mapBillingProfile(profile: VendorBillingProfile): VendorBillingProfileDto {
  return {
    id: profile.id,
    vendorId: profile.vendorId,
    legalCompanyName: profile.legalCompanyName,
    taxNumber: profile.taxNumber,
    taxOffice: profile.taxOffice,
    billingAddress: profile.billingAddress,
    billingCity: profile.billingCity,
    billingDistrict: profile.billingDistrict,
    iban: profile.iban,
    authorizedPerson: profile.authorizedPerson,
    billingEmail: profile.billingEmail,
    billingPhone: profile.billingPhone,
    legalEntityType: profile.legalEntityType,
    logoIsbasiCustomerCode: profile.logoIsbasiCustomerCode,
    logoIsbasiCustomerId: profile.logoIsbasiCustomerId,
    logoIsbasiEinvoiceEligible: profile.logoIsbasiEinvoiceEligible,
    logoIsbasiLastCheckedAt: profile.logoIsbasiLastCheckedAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function getMissingBillingFields(profile: VendorBillingProfile | null) {
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
    taxRate: approval.commissionMinor > 0 ? (approval.commissionVatMinor / approval.commissionMinor) * 100 : null,
    vatIncluded: false as const,
  };
}

function buildBlockedResponse(input: {
  settlementApprovalId: string;
  approval?: SettlementApprovalForPreview | null;
  blockers: string[];
  warnings?: string[];
  vendorBillingReadiness?: SettlementCommissionInvoicePreviewDto['vendorBillingReadiness'];
}): SettlementCommissionInvoicePreviewDto {
  return {
    ok: false,
    writesPerformed: false,
    settlementApprovalId: input.settlementApprovalId,
    readiness: {
      canCreateLogoInvoiceLater: false,
      blockers: input.blockers,
      warnings: input.warnings ?? [],
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

  const billingProfile = await prisma.vendorBillingProfile.findUnique({
    where: {
      vendorId: approval.vendorId,
    },
  });
  const missingFields = getMissingBillingFields(billingProfile);
  const vendorBillingReadiness = {
    complete: Boolean(billingProfile) && missingFields.length === 0,
    missingFields,
    logoCustomerCodePresent: Boolean(billingProfile?.logoIsbasiCustomerCode?.trim()),
    logoCustomerIdPresent: Boolean(billingProfile?.logoIsbasiCustomerId?.trim()),
    logoEinvoiceEligible: billingProfile?.logoIsbasiEinvoiceEligible ?? null,
  };

  const amounts = buildAmounts(approval);
  const blockers = [
    ...(!billingProfile ? ['Vendor billing profile is required.'] : []),
    ...(missingFields.length ? [`Vendor billing profile is missing required fields: ${missingFields.join(', ')}.`] : []),
    ...(!vendorBillingReadiness.logoCustomerCodePresent ? ['Vendor must have logoIsbasiCustomerCode before Logo invoice creation.'] : []),
    ...(!vendorBillingReadiness.logoCustomerIdPresent ? ['Vendor must have logoIsbasiCustomerId before Logo invoice creation.'] : []),
    ...(approval.currency !== 'TRY' ? [`SettlementApproval currency must be TRY for Logo commission invoice preview. Current currency: ${approval.currency}.`] : []),
    ...(approval.commissionMinor <= 0
      ? ['Settlement commission amount is zero; accountant confirmation is required before creating a Logo invoice.']
      : []),
  ];
  const warnings = [
    'Read-only preview only. No Logo invoice is created.',
    'Do not use netPayableMinor as invoice amount; preview uses commissionMinor plus commissionVatMinor.',
    ...(!vendorBillingReadiness.logoEinvoiceEligible ? ['Logo e-invoice eligibility is not confirmed for this vendor.'] : []),
  ];

  if (blockers.length || !billingProfile || amounts.taxRate === null) {
    return {
      ok: false,
      writesPerformed: false,
      settlementApprovalId,
      readiness: {
        canCreateLogoInvoiceLater: false,
        blockers,
        warnings,
      },
      amounts,
      vendorBillingReadiness,
      logoPayloadPreview: null,
    };
  }

  const preview: LogoIsbasiCommissionInvoicePreview = buildLogoIsbasiCommissionInvoicePreview({
    vendorBillingProfile: mapBillingProfile(billingProfile),
    commissionAmount: formatDecimal(amounts.commissionAmount),
    vatRate: formatDecimal(amounts.taxRate),
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
    },
    amounts,
    vendorBillingReadiness,
    logoPayloadPreview: useProvenLogoServiceReference(preview.payload),
  };
}
