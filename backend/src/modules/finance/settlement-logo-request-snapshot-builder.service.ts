import { SettlementApprovalStatus, type Prisma, type SettlementApproval, type SettlementApprovalLine } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  buildLogoIsbasiCommissionInvoicePreview,
  type LogoIsbasiCommissionInvoicePreview,
} from '../logo-isbasi/logo-isbasi-commission-preview.js';
import {
  mapSettlementBillingSnapshotToVendorBillingProfileDto,
  readSettlementBillingSnapshot,
  SETTLEMENT_BILLING_SNAPSHOT_MISSING_BLOCKER,
  type SettlementBillingSnapshot,
} from './settlement-billing-snapshot.service.js';
import type { SettlementExecutionSnapshotGuardDto } from './settlement-execution-snapshot-guard.service.js';

export const SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION = 'settlement-logo-request-v1';

const REQUIRED_BILLING_SNAPSHOT_FIELDS = [
  'legalCompanyName',
  'taxNumber',
  'taxOffice',
  'billingAddress',
  'billingCity',
  'billingDistrict',
  'billingEmail',
  'legalEntityType',
] as const;

const SOURCE_ORDER_ID_SAMPLE_LIMIT = 20;

type RequiredBillingSnapshotField = (typeof REQUIRED_BILLING_SNAPSHOT_FIELDS)[number];
type SettlementApprovalForRequestSnapshot = SettlementApproval & { lines: SettlementApprovalLine[] };
type SnapshotCompletenessItem = SettlementExecutionSnapshotGuardDto['snapshotCompleteness']['commissionPercentSnapshot'];

export type SettlementLogoRequestSnapshotDiagnosticsDto = {
  status: 'READY' | 'BLOCKED';
  payloadBuilderVersion: typeof SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION;
  blockers: string[];
  warnings: string[];
  requestSnapshotPresent: boolean;
};

export type SettlementLogoCommissionInvoiceRequestSnapshotResult = {
  ok: boolean;
  writesPerformed: false;
  provider: 'LOGO_ISBASI';
  settlementApprovalId: string;
  status: 'READY' | 'BLOCKED';
  payloadBuilderVersion: typeof SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION;
  blockers: string[];
  warnings: string[];
  requestSnapshotJson: Prisma.InputJsonObject | null;
  diagnostics: SettlementLogoRequestSnapshotDiagnosticsDto;
  executionSnapshotGuard: SettlementExecutionSnapshotGuardDto;
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function readSnapshotRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSnapshotString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasSnapshotValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePercent(value: unknown) {
  const numeric = toNumber(value);
  if (numeric === null || numeric < 0 || numeric > 100) {
    return null;
  }
  return Math.round(numeric * 10000) / 10000;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
}

function normalizeShippingMode(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'disabled') {
    return 'disabled';
  }
  if (normalized === 'fixed') {
    return 'fixed';
  }
  if (normalized === 'external_provider') {
    return 'external_provider';
  }
  return null;
}

function formatDecimal(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, '');
}

function minorToMajor(value: number) {
  return Math.round(value) / 100;
}

function lineRequiresPolicySnapshots(line: Pick<SettlementApprovalLine, 'lineType' | 'commissionMinor' | 'commissionVatMinor'>) {
  return (
    line.lineType.toUpperCase() === 'SALE' ||
    line.commissionMinor > 0 ||
    line.commissionVatMinor > 0
  );
}

function emptyCompleteness(): SettlementExecutionSnapshotGuardDto['snapshotCompleteness'] {
  const item = (): SnapshotCompletenessItem => ({
    present: true,
    missingLineIds: [],
    resolvedFromLedgerLineIds: [],
  });
  return {
    settlementApprovalFound: false,
    settlementApprovalStatus: null,
    lineCount: 0,
    executionLineCount: 0,
    commissionPercentSnapshot: item(),
    commissionVatPercentSnapshot: item(),
    deductShippingEnabledSnapshot: item(),
    shippingModeSnapshot: item(),
    fixedShippingFeeSnapshot: item(),
    externalShippingCostSnapshot: item(),
    lineAmountSnapshots: item(),
  };
}

function markMissing(item: SnapshotCompletenessItem, lineId: string) {
  item.present = false;
  item.missingLineIds.push(lineId);
}

function sortedNumbers(values: Set<number>) {
  return Array.from(values).sort((a, b) => a - b);
}

function sortedStrings(values: Set<string>) {
  return Array.from(values).sort();
}

function buildSourcePeriod(approval: SettlementApprovalForRequestSnapshot) {
  if (!approval.periodStart && !approval.periodEnd) {
    return null;
  }
  const start = approval.periodStart?.toISOString().slice(0, 10) ?? 'open-start';
  const end = approval.periodEnd?.toISOString().slice(0, 10) ?? 'open-end';
  return `${start}..${end}`;
}

function buildDescription(approval: SettlementApprovalForRequestSnapshot) {
  const period = buildSourcePeriod(approval);
  return [
    'Sporgym Pazaryeri Komisyon Hizmeti',
    `SettlementApproval ${approval.id}`,
    period ? `Period ${period}` : null,
  ].filter(Boolean).join(' - ');
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

function buildStrictExecutionSnapshotGuard(
  approval: SettlementApprovalForRequestSnapshot | null,
): SettlementExecutionSnapshotGuardDto {
  const blockers: string[] = [];
  const completeness = emptyCompleteness();
  const commissionRates = new Set<number>();
  const commissionVatRates = new Set<number>();
  const shippingModes = new Set<string>();

  if (!approval) {
    blockers.push('SettlementApproval must exist before financial execution.');
    return {
      ok: false,
      blockers,
      warnings: [],
      snapshotCompleteness: completeness,
      detectedCommissionRates: [],
      detectedCommissionVatRates: [],
      detectedShippingModes: [],
      requiredSnapshotsPresent: false,
    };
  }

  completeness.settlementApprovalFound = true;
  completeness.settlementApprovalStatus = approval.status;
  completeness.lineCount = approval.lines.length;

  if (approval.status !== SettlementApprovalStatus.APPROVED) {
    blockers.push(`SettlementApproval status must be APPROVED before financial execution. Current status: ${approval.status}.`);
  }

  const executionLines = approval.lines.filter(lineRequiresPolicySnapshots);
  completeness.executionLineCount = executionLines.length;

  for (const line of approval.lines) {
    const lineAmountsPresent = [
      line.amountMinor,
      line.commissionMinor,
      line.commissionVatMinor,
      line.payableImpactMinor,
    ].every((value) => Number.isFinite(Number(value)));
    if (!lineAmountsPresent) {
      markMissing(completeness.lineAmountSnapshots, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing required line amount snapshots.`);
    }

    if (!lineRequiresPolicySnapshots(line)) {
      continue;
    }

    const snapshot = readSnapshotRecord(line.sourceSnapshotJson);
    const commissionPercent = normalizePercent(snapshot.commissionPercentSnapshot);
    if (commissionPercent === null) {
      markMissing(completeness.commissionPercentSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing commissionPercentSnapshot.`);
    } else {
      commissionRates.add(commissionPercent);
    }

    const commissionVatPercent = normalizePercent(snapshot.commissionVatPercentSnapshot);
    if (commissionVatPercent === null) {
      markMissing(completeness.commissionVatPercentSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing commissionVatPercentSnapshot.`);
    } else {
      commissionVatRates.add(commissionVatPercent);
    }

    const deductShippingEnabled = normalizeBoolean(snapshot.deductShippingEnabledSnapshot);
    if (deductShippingEnabled === null) {
      markMissing(completeness.deductShippingEnabledSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing deductShippingEnabledSnapshot.`);
    }

    const shippingMode = normalizeShippingMode(snapshot.shippingModeSnapshot);
    if (!shippingMode) {
      markMissing(completeness.shippingModeSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing shippingModeSnapshot.`);
    } else {
      shippingModes.add(shippingMode);
    }

    if (deductShippingEnabled && shippingMode === 'fixed' && toNumber(snapshot.fixedShippingFeeSnapshot) === null) {
      markMissing(completeness.fixedShippingFeeSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing fixedShippingFeeSnapshot for fixed shipping deduction.`);
    }

    if (deductShippingEnabled && shippingMode === 'external_provider') {
      const providerEvidence = [
        snapshot.shippingCostIdSnapshot,
        snapshot.shippingCostProviderSnapshot,
        snapshot.shippingCostSourceSnapshot,
      ].some(hasSnapshotValue);
      if (toNumber(snapshot.shippingCostSnapshot) === null || !providerEvidence) {
        markMissing(completeness.externalShippingCostSnapshot, line.id);
        blockers.push(`SettlementApprovalLine ${line.id} is missing external provider shipping cost snapshot or provider evidence.`);
      }
    }
  }

  const detectedCommissionVatRates = sortedNumbers(commissionVatRates);
  if (detectedCommissionVatRates.length > 1) {
    blockers.push('Commission VAT rate is not uniform across settlement lines; Logo invoice creation is blocked until reviewed.');
  }

  const uniqueBlockers = Array.from(new Set(blockers));
  return {
    ok: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings: [],
    snapshotCompleteness: completeness,
    detectedCommissionRates: sortedNumbers(commissionRates),
    detectedCommissionVatRates,
    detectedShippingModes: sortedStrings(shippingModes),
    requiredSnapshotsPresent: uniqueBlockers.length === 0,
  };
}

function getMissingBillingFields(snapshot: SettlementBillingSnapshot | null): RequiredBillingSnapshotField[] {
  if (!snapshot) {
    return [...REQUIRED_BILLING_SNAPSHOT_FIELDS];
  }
  return REQUIRED_BILLING_SNAPSHOT_FIELDS.filter((field) => {
    const value = snapshot[field];
    return typeof value !== 'string' || !value.trim();
  });
}

function buildBlockedResult(input: {
  settlementApprovalId: string;
  blockers: string[];
  warnings?: string[];
  executionSnapshotGuard: SettlementExecutionSnapshotGuardDto;
}): SettlementLogoCommissionInvoiceRequestSnapshotResult {
  const blockers = Array.from(new Set(input.blockers));
  const warnings = Array.from(new Set(input.warnings ?? []));
  return {
    ok: false,
    writesPerformed: false,
    provider: 'LOGO_ISBASI',
    settlementApprovalId: input.settlementApprovalId,
    status: 'BLOCKED',
    payloadBuilderVersion: SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION,
    blockers,
    warnings,
    requestSnapshotJson: null,
    diagnostics: {
      status: 'BLOCKED',
      payloadBuilderVersion: SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION,
      blockers,
      warnings,
      requestSnapshotPresent: false,
    },
    executionSnapshotGuard: input.executionSnapshotGuard,
  };
}

function buildSettlementApprovalSnapshot(approval: SettlementApprovalForRequestSnapshot) {
  const sourceSnapshot = readSnapshotRecord(approval.sourceSnapshotJson);
  return {
    id: approval.id,
    vendorId: approval.vendorId,
    status: approval.status,
    periodStart: toIso(approval.periodStart),
    periodEnd: toIso(approval.periodEnd),
    currency: approval.currency,
    grossSalesMinor: approval.grossSalesMinor,
    refundTotalMinor: approval.refundTotalMinor,
    commissionMinor: approval.commissionMinor,
    commissionVatMinor: approval.commissionVatMinor,
    netPayableMinor: approval.netPayableMinor,
    approvedBy: approval.approvedBy,
    approvedAt: toIso(approval.approvedAt),
    sourceSnapshot: {
      vendorId: sourceSnapshot.vendorId ?? approval.vendorId,
      periodStart: sourceSnapshot.periodStart ?? toIso(approval.periodStart),
      periodEnd: sourceSnapshot.periodEnd ?? toIso(approval.periodEnd),
      candidateScope: sourceSnapshot.candidateScope ?? null,
      candidateSelectionSummary: sourceSnapshot.candidateSelectionSummary ?? null,
      generatedAt: sourceSnapshot.generatedAt ?? null,
      eligibleRowCount: sourceSnapshot.eligibleRowCount ?? null,
      excludedActiveApprovalRowCount: sourceSnapshot.excludedActiveApprovalRowCount ?? null,
    },
  };
}

function buildSettlementLineSnapshotSummary(approval: SettlementApprovalForRequestSnapshot, guard: SettlementExecutionSnapshotGuardDto) {
  return {
    lineCount: approval.lines.length,
    executionLineCount: guard.snapshotCompleteness.executionLineCount,
    sourceOrderIds: getSourceOrderIds(approval.lines),
    sourcePeriod: buildSourcePeriod(approval),
    detectedCommissionRates: guard.detectedCommissionRates,
    detectedCommissionVatRates: guard.detectedCommissionVatRates,
    detectedShippingModes: guard.detectedShippingModes,
    totals: {
      grossSalesMinor: approval.grossSalesMinor,
      refundTotalMinor: approval.refundTotalMinor,
      commissionMinor: approval.commissionMinor,
      commissionVatMinor: approval.commissionVatMinor,
      netPayableMinor: approval.netPayableMinor,
      currency: approval.currency,
    },
    lines: approval.lines.map((line) => ({
      id: line.id,
      financeLedgerEntryId: line.financeLedgerEntryId,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      commissionMinor: line.commissionMinor,
      commissionVatMinor: line.commissionVatMinor,
      payableImpactMinor: line.payableImpactMinor,
      sourceSnapshotJson: line.sourceSnapshotJson as Prisma.InputJsonValue,
    })),
  };
}

export async function buildSettlementLogoCommissionInvoiceRequestSnapshot(
  settlementApprovalId: string,
  invoiceDate: string | Date,
): Promise<SettlementLogoCommissionInvoiceRequestSnapshotResult> {
  const requestBuiltAt = new Date().toISOString();
  const approval = await prisma.settlementApproval.findUnique({
    where: {
      id: settlementApprovalId,
    },
    include: {
      lines: true,
    },
  });
  const executionSnapshotGuard = buildStrictExecutionSnapshotGuard(approval);

  if (!approval) {
    return buildBlockedResult({
      settlementApprovalId,
      blockers: ['SettlementApproval must exist.'],
      executionSnapshotGuard,
    });
  }

  const settlementBillingSnapshot = readSettlementBillingSnapshot(approval.sourceSnapshotJson);
  const missingBillingFields = getMissingBillingFields(settlementBillingSnapshot);
  const blockers = [
    ...(approval.status !== SettlementApprovalStatus.APPROVED
      ? [`SettlementApproval status must be APPROVED before Logo commission invoice request snapshot. Current status: ${approval.status}.`]
      : []),
    ...(!settlementBillingSnapshot ? [SETTLEMENT_BILLING_SNAPSHOT_MISSING_BLOCKER] : []),
    ...(settlementBillingSnapshot && missingBillingFields.length
      ? [`Settlement billing snapshot is missing required fields: ${missingBillingFields.join(', ')}.`]
      : []),
    ...(settlementBillingSnapshot && !settlementBillingSnapshot.logoIsbasiCustomerCode?.trim()
      ? ['Vendor must have logoIsbasiCustomerCode before Logo invoice creation.']
      : []),
    ...(settlementBillingSnapshot && !settlementBillingSnapshot.logoIsbasiCustomerId?.trim()
      ? ['Vendor must have logoIsbasiCustomerId before Logo invoice creation.']
      : []),
    ...(approval.currency !== 'TRY' ? [`SettlementApproval currency must be TRY for Logo commission invoice request snapshot. Current currency: ${approval.currency}.`] : []),
    ...(approval.commissionMinor <= 0
      ? ['Settlement commission amount is zero; accountant confirmation is required before creating a Logo invoice.']
      : []),
    ...executionSnapshotGuard.blockers,
  ];
  const warnings = [
    ...(settlementBillingSnapshot && !settlementBillingSnapshot.logoIsbasiEinvoiceEligible
      ? ['Logo e-invoice eligibility is not confirmed for this settlement billing snapshot.']
      : []),
  ];

  if (blockers.length || !settlementBillingSnapshot || executionSnapshotGuard.detectedCommissionVatRates.length !== 1) {
    return buildBlockedResult({
      settlementApprovalId,
      blockers,
      warnings,
      executionSnapshotGuard,
    });
  }

  const invoiceTaxRate = executionSnapshotGuard.detectedCommissionVatRates[0];
  const preview: LogoIsbasiCommissionInvoicePreview = buildLogoIsbasiCommissionInvoicePreview({
    vendorBillingProfile: mapSettlementBillingSnapshotToVendorBillingProfileDto(settlementBillingSnapshot),
    commissionAmount: formatDecimal(minorToMajor(approval.commissionMinor)),
    vatRate: formatDecimal(invoiceTaxRate),
    currency: approval.currency,
    description: buildDescription(approval),
    invoiceDate,
    sourceOrderIds: getSourceOrderIds(approval.lines),
    sourcePeriod: buildSourcePeriod(approval),
  });
  const allWarnings = Array.from(new Set([...warnings, ...preview.warnings]));
  const logoPayload = useProvenLogoServiceReference(preview.payload) as Prisma.InputJsonObject;
  const requestSnapshotJson: Prisma.InputJsonObject = {
    provider: 'LOGO_ISBASI',
    settlementApprovalId: approval.id,
    vendorId: approval.vendorId,
    requestBuiltAt,
    payloadBuilderVersion: SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION,
    settlementApprovalSnapshot: buildSettlementApprovalSnapshot(approval),
    settlementBillingSnapshot: settlementBillingSnapshot as unknown as Prisma.InputJsonObject,
    settlementLineSnapshotSummary: buildSettlementLineSnapshotSummary(approval, executionSnapshotGuard),
    executionSnapshotGuard: executionSnapshotGuard as unknown as Prisma.InputJsonObject,
    logoPayload,
  };

  return {
    ok: true,
    writesPerformed: false,
    provider: 'LOGO_ISBASI',
    settlementApprovalId: approval.id,
    status: 'READY',
    payloadBuilderVersion: SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION,
    blockers: [],
    warnings: allWarnings,
    requestSnapshotJson,
    diagnostics: {
      status: 'READY',
      payloadBuilderVersion: SETTLEMENT_LOGO_REQUEST_PAYLOAD_BUILDER_VERSION,
      blockers: [],
      warnings: allWarnings,
      requestSnapshotPresent: true,
    },
    executionSnapshotGuard,
  };
}

export const __settlementLogoRequestSnapshotBuilderTesting = {
  buildStrictExecutionSnapshotGuard,
  useProvenLogoServiceReference,
};
