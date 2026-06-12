import { SettlementApprovalStatus, type SettlementApproval, type SettlementApprovalLine } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  readSettlementBillingSnapshot,
  SETTLEMENT_BILLING_SNAPSHOT_READINESS_SOURCE,
} from './settlement-billing-snapshot.service.js';
import {
  buildSkippedExecutionSnapshotGuard,
  type SettlementExecutionSnapshotGuardDto,
} from './settlement-execution-snapshot-guard.service.js';
import {
  buildSettlementLogoCommissionInvoiceRequestSnapshot,
  SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION,
  type SettlementLogoRequestSnapshotDiagnosticsDto,
} from './settlement-logo-request-snapshot-builder.service.js';

const REQUIRED_BILLING_FIELDS = [
  'legalCompanyName',
  'taxNumber',
  'taxOffice',
  'billingAddress',
  'billingCity',
  'billingDistrict',
  'billingEmail',
  'legalEntityType',
] as const;

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
  immutableRequestSnapshot: SettlementLogoRequestSnapshotDiagnosticsDto;
  logoPayloadPreview: Record<string, unknown> | null;
};

function minorToMajor(value: number) {
  return Math.round(value) / 100;
}

function emptyImmutableRequestSnapshot(blockers: string[]): SettlementLogoRequestSnapshotDiagnosticsDto {
  return {
    status: 'BLOCKED',
    payloadBuilderVersion: SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION,
    blockers,
    warnings: [],
    requestSnapshotPresent: false,
  };
}

function getMissingBillingFields(snapshot: ReturnType<typeof readSettlementBillingSnapshot>) {
  if (!snapshot) {
    return [...REQUIRED_BILLING_FIELDS];
  }
  return REQUIRED_BILLING_FIELDS.filter((field) => {
    const value = snapshot[field];
    return typeof value !== 'string' || !value.trim();
  });
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
  immutableRequestSnapshot?: SettlementLogoRequestSnapshotDiagnosticsDto;
}): SettlementCommissionInvoicePreviewDto {
  const immutableRequestSnapshot = input.immutableRequestSnapshot ?? emptyImmutableRequestSnapshot(input.blockers);
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
    immutableRequestSnapshot,
    logoPayloadPreview: null,
  };
}

function readLogoPayloadPreview(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const logoPayload = (value as Record<string, unknown>).logoPayload;
  return logoPayload && typeof logoPayload === 'object' && !Array.isArray(logoPayload)
    ? (logoPayload as Record<string, unknown>)
    : null;
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

  const requestSnapshotResult = await buildSettlementLogoCommissionInvoiceRequestSnapshot(settlementApprovalId, new Date());
  const settlementBillingSnapshot = readSettlementBillingSnapshot(approval.sourceSnapshotJson);
  const missingFields = getMissingBillingFields(settlementBillingSnapshot);
  const vendorBillingReadiness = {
    complete: Boolean(settlementBillingSnapshot) && missingFields.length === 0,
    missingFields,
    logoCustomerCodePresent: Boolean(settlementBillingSnapshot?.logoIsbasiCustomerCode?.trim()),
    logoCustomerIdPresent: Boolean(settlementBillingSnapshot?.logoIsbasiCustomerId?.trim()),
    logoEinvoiceEligible: settlementBillingSnapshot?.logoIsbasiEinvoiceEligible ?? null,
    billingSnapshotPresent: Boolean(settlementBillingSnapshot),
    billingSnapshotSource: settlementBillingSnapshot ? SETTLEMENT_BILLING_SNAPSHOT_READINESS_SOURCE : null,
  };

  const amounts = buildAmounts(approval);
  const executionSnapshotGuard = requestSnapshotResult.executionSnapshotGuard;
  const detectedVatRates = executionSnapshotGuard.detectedCommissionVatRates;
  const snapshotTaxRate =
    approval.commissionMinor > 0 && executionSnapshotGuard.ok && detectedVatRates.length === 1
      ? detectedVatRates[0]
      : null;
  const vatRateSource: SettlementCommissionInvoicePreviewDto['vatRateSource'] =
    snapshotTaxRate === null ? 'blocked_mixed_or_missing' : 'settlement_line_snapshots';
  const configuredVendorCommissionVatPercent = null;
  const blockers = requestSnapshotResult.blockers;
  const warnings = [
    'Read-only preview only. No Logo invoice is created.',
    'Do not use netPayableMinor as invoice amount; preview uses commissionMinor plus commissionVatMinor.',
    ...requestSnapshotResult.warnings,
  ];
  amounts.taxRate = snapshotTaxRate;

  const invoiceTaxRate = amounts.taxRate;
  const logoPayloadPreview = readLogoPayloadPreview(requestSnapshotResult.requestSnapshotJson);
  if (blockers.length || !requestSnapshotResult.ok || invoiceTaxRate === null) {
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
      immutableRequestSnapshot: requestSnapshotResult.diagnostics,
      logoPayloadPreview: null,
    };
  }

  return {
    ok: true,
    writesPerformed: false,
    settlementApprovalId,
    readiness: {
      canCreateLogoInvoiceLater: true,
      blockers: [],
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
    immutableRequestSnapshot: requestSnapshotResult.diagnostics,
    logoPayloadPreview,
  };
}
