import { prisma } from '../../db/prisma.js';
import {
  calculateVendorPayout,
  DEFAULT_VENDOR_FINANCIAL_PROFILE,
  type ShippingMode,
  type VendorFinanceProfileConfig,
} from './payout-calculator.js';
import type {
  FinanceDashboardDto,
  InvoiceExecutionReferenceDto,
  FinanceRecordDto,
  PayoutBatchDto,
  PayoutBatchReferenceDto,
  PayoutCalculationDto,
  PreparePayoutBatchDto,
  SettlementDto,
  VendorFinancialProfileDto,
  VendorFinancialProfileUpdateDto,
  ShippingCostDto,
  ShippingCostInputDto,
} from './finance.types.js';

const ACTIVE_PAYOUT_BATCH_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'EXECUTION_PENDING', 'PAID_PLACEHOLDER'] as const;

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toPercentString(value: number) {
  return value.toFixed(2);
}

function normalizeType(entryType: string) {
  return entryType.trim().toLowerCase();
}

function mapStatus(status: string) {
  return status.trim().toLowerCase();
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapPayoutBatchStatus(status: string) {
  return status.trim().toLowerCase() as PayoutBatchDto['status'];
}

function mapShippingMode(mode: string): ShippingMode {
  const normalized = mode.trim().toLowerCase();
  if (normalized === 'fixed') {
    return 'fixed';
  }
  if (normalized === 'external_provider') {
    return 'external_provider';
  }
  return 'disabled';
}

function mapProfile(profile: {
  vendorId: string;
  commissionPercent: unknown;
  commissionVatPercent: unknown;
  deductShippingEnabled: boolean;
  shippingMode: string;
  fixedShippingFee: unknown;
  active: boolean;
} | null, vendorId: string): VendorFinancialProfileDto {
  const config = profile
    ? {
        commissionPercent: toNumber(profile.commissionPercent),
        commissionVatPercent: toNumber(profile.commissionVatPercent),
        deductShippingEnabled: profile.deductShippingEnabled,
        shippingMode: mapShippingMode(profile.shippingMode),
        fixedShippingFee: profile.fixedShippingFee === null ? null : toNumber(profile.fixedShippingFee),
        active: profile.active,
        source: 'configured' as const,
      }
    : {
        ...DEFAULT_VENDOR_FINANCIAL_PROFILE,
        active: true,
        source: 'default' as const,
      };

  return {
    vendorId: profile?.vendorId ?? vendorId,
    commissionPercent: toPercentString(config.commissionPercent),
    commissionVatPercent: toPercentString(config.commissionVatPercent),
    deductShippingEnabled: config.deductShippingEnabled,
    shippingMode: config.shippingMode,
    fixedShippingFee: config.fixedShippingFee === null ? null : toAmountString(config.fixedShippingFee),
    active: config.active,
    source: config.source,
  };
}

function profileToCalculationConfig(profile: VendorFinancialProfileDto): VendorFinanceProfileConfig {
  return {
    commissionPercent: toNumber(profile.commissionPercent),
    commissionVatPercent: toNumber(profile.commissionVatPercent),
    deductShippingEnabled: profile.deductShippingEnabled,
    shippingMode: profile.shippingMode,
    fixedShippingFee: profile.fixedShippingFee === null ? null : toNumber(profile.fixedShippingFee),
  };
}

type CalculationProfile = VendorFinanceProfileConfig & {
  source: 'snapshot' | 'current' | 'default';
};

function entrySnapshotToCalculationProfile(entry: {
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
  deductShippingEnabledSnapshot?: boolean | null;
  shippingModeSnapshot?: string | null;
  fixedShippingFeeSnapshot?: unknown;
  shippingCostSnapshot?: unknown;
  shippingVatAmountSnapshot?: unknown;
  shippingCostSourceSnapshot?: string | null;
  shippingCostProviderSnapshot?: string | null;
}): CalculationProfile | null {
  if (entry.commissionPercentSnapshot === null || entry.commissionPercentSnapshot === undefined) {
    return null;
  }

  return {
    commissionPercent: toNumber(entry.commissionPercentSnapshot),
    commissionVatPercent: toNumber(entry.commissionVatPercentSnapshot),
    deductShippingEnabled: entry.deductShippingEnabledSnapshot ?? false,
    shippingMode: mapShippingMode(entry.shippingModeSnapshot ?? 'disabled'),
    fixedShippingFee:
      entry.fixedShippingFeeSnapshot === null || entry.fixedShippingFeeSnapshot === undefined
        ? null
        : toNumber(entry.fixedShippingFeeSnapshot),
    externalProviderShippingCost:
      entry.shippingCostSnapshot === null || entry.shippingCostSnapshot === undefined
        ? null
        : toNumber(entry.shippingCostSnapshot),
    externalProviderShippingVatAmount:
      entry.shippingVatAmountSnapshot === null || entry.shippingVatAmountSnapshot === undefined
        ? null
        : toNumber(entry.shippingVatAmountSnapshot),
    shippingCostSource: entry.shippingCostSourceSnapshot ?? null,
    shippingCostProvider: entry.shippingCostProviderSnapshot ?? null,
    source: 'snapshot',
  };
}

function resolveCalculationProfile(
  entry: {
    commissionPercentSnapshot?: unknown;
    commissionVatPercentSnapshot?: unknown;
    deductShippingEnabledSnapshot?: boolean | null;
    shippingModeSnapshot?: string | null;
    fixedShippingFeeSnapshot?: unknown;
    shippingCostSnapshot?: unknown;
    shippingVatAmountSnapshot?: unknown;
    shippingCostSourceSnapshot?: string | null;
    shippingCostProviderSnapshot?: string | null;
  },
  activeProfile: VendorFinancialProfileDto,
): CalculationProfile {
  const snapshotProfile = entrySnapshotToCalculationProfile(entry);
  if (snapshotProfile) {
    return snapshotProfile;
  }

  return {
    ...profileToCalculationConfig(activeProfile),
    source: activeProfile.source === 'configured' ? 'current' : 'default',
  };
}

function isFulfilledForShipping(allocation: {
  allocationStatus?: string;
  fulfillmentStatus?: string | null;
  shippingStatus?: string | null;
  fulfillment?: { fulfilledAt: Date | null } | null;
} | null | undefined) {
  const lifecycle = [
    allocation?.allocationStatus,
    allocation?.fulfillmentStatus,
    allocation?.shippingStatus,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return Boolean(
    allocation?.fulfillment?.fulfilledAt ||
      lifecycle.includes('fulfilled') ||
      lifecycle.includes('shipped') ||
      lifecycle.includes('in transit') ||
      lifecycle.includes('delivered'),
  );
}

function mapCalculation(
  calculation: ReturnType<typeof calculateVendorPayout>,
  profile: CalculationProfile,
  entry: {
    shippingCostSnapshot?: unknown;
    shippingVatAmountSnapshot?: unknown;
    shippingCostProviderSnapshot?: string | null;
  },
  fulfilled: boolean,
): PayoutCalculationDto {
  const hasShippingCostSnapshot = entry.shippingCostSnapshot !== null && entry.shippingCostSnapshot !== undefined;
  return {
    grossAmount: toAmountString(calculation.grossAmount),
    commission: toAmountString(calculation.commission),
    commissionVat: toAmountString(calculation.commissionVat),
    shippingDeduction: toAmountString(calculation.shippingDeduction),
    shippingVatAmount: toAmountString(calculation.shippingVatAmount),
    shippingDeductionSource: calculation.shippingDeductionSource,
    shippingCostProvider: calculation.shippingCostProvider,
    shippingCostSnapshot: hasShippingCostSnapshot ? toAmountString(toNumber(entry.shippingCostSnapshot)) : null,
    shippingCostStatus:
      hasShippingCostSnapshot
        ? 'snapshot'
        : fulfilled && profile.deductShippingEnabled && profile.shippingMode === 'external_provider'
          ? 'pending_provider_cost'
          : 'not_applicable',
    refundImpact: toAmountString(calculation.refundImpact),
    estimatedPayout: toAmountString(calculation.estimatedPayout),
    shippingApplied: calculation.shippingApplied,
    shippingMode: calculation.shippingMode,
    profileSource: profile.source,
    commissionPercent: toPercentString(profile.commissionPercent),
    commissionVatPercent: toPercentString(profile.commissionVatPercent),
  };
}

function mapShippingCost(cost: {
  id: string;
  vendorId: string;
  allocationId: string;
  sourceShopifyOrderId: string;
  sourceShopifyFulfillmentId: string | null;
  providerName: string;
  providerReference: string | null;
  shippingCost: unknown;
  shippingVatAmount: unknown;
  currency: string;
  status: string;
  sourceType: string;
  createdAt: Date;
  updatedAt: Date;
}): ShippingCostDto {
  return {
    id: cost.id,
    vendorId: cost.vendorId,
    allocationId: cost.allocationId,
    sourceShopifyOrderId: cost.sourceShopifyOrderId,
    sourceShopifyFulfillmentId: cost.sourceShopifyFulfillmentId,
    providerName: cost.providerName,
    providerReference: cost.providerReference,
    shippingCost: toAmountString(toNumber(cost.shippingCost)),
    shippingVatAmount: cost.shippingVatAmount === null ? null : toAmountString(toNumber(cost.shippingVatAmount)),
    currency: cost.currency,
    status: cost.status.trim().toLowerCase() as ShippingCostDto['status'],
    sourceType: cost.sourceType.trim().toLowerCase() as ShippingCostDto['sourceType'],
    createdAt: cost.createdAt.toISOString(),
    updatedAt: cost.updatedAt.toISOString(),
  };
}

function mapRelatedReferences(record: {
  entryType: string;
  vendorAllocation: {
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    returnRecords: Array<{ id: string }>;
    refundRecords: Array<{ id: string; sourceShopifyRefundId: string; amount?: unknown }>;
  } | null;
}) {
  const relatedOrderId = record.vendorAllocation?.sourceShopifyOrderId ?? null;
  const relatedOrderNumber = record.vendorAllocation?.sourceShopifyOrderNumber ?? null;
  const relatedReturnId = record.vendorAllocation?.returnRecords[0]?.id ?? null;
  const relatedRefundId =
    record.vendorAllocation?.refundRecords[0]?.sourceShopifyRefundId ??
    record.vendorAllocation?.refundRecords[0]?.id ??
    null;

  return {
    relatedOrderId,
    relatedOrderNumber,
    relatedReturnId,
    relatedRefundId,
  };
}

function sumRefundImpact(refundRecords: Array<{ amount?: unknown }> | undefined) {
  return (refundRecords ?? []).reduce((sum, refundRecord) => sum + toNumber(refundRecord.amount), 0);
}

function normalizeSettlementStatus(status: string | null | undefined): SettlementDto['status'] {
  const normalized = status?.trim().toLowerCase() ?? 'pending';
  if (
    normalized === 'accruing' ||
    normalized === 'payable' ||
    normalized === 'partially_refunded' ||
    normalized === 'held' ||
    normalized === 'settled' ||
    normalized === 'disputed'
  ) {
    return normalized;
  }
  return 'pending';
}

function getSettlementStatus(entry: {
  entryType: string;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  vendorAllocation?: {
    allocationStatus?: string;
    fulfillmentStatus?: string | null;
    shippingStatus?: string | null;
    fulfillment?: { fulfilledAt: Date | null } | null;
    refundRecords?: Array<{ amount?: unknown }>;
  } | null;
}): SettlementDto['status'] {
  const payoutStatus = mapStatus(entry.payoutStatus ?? '');
  if (payoutStatus === 'hold') {
    return 'held';
  }
  if (payoutStatus === 'paid') {
    return 'settled';
  }

  const storedStatus = normalizeSettlementStatus(entry.settlementStatus);
  if (storedStatus === 'held' || storedStatus === 'settled' || storedStatus === 'disputed') {
    return storedStatus;
  }

  const type = normalizeType(entry.entryType);
  if (type === 'refund' || sumRefundImpact(entry.vendorAllocation?.refundRecords) > 0) {
    return 'partially_refunded';
  }
  if (type === 'sale') {
    return isFulfilledForShipping(entry.vendorAllocation) ? 'payable' : 'accruing';
  }
  return storedStatus;
}

function buildSettlement(entry: {
  entryType: string;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  settlementEligibleAt?: Date | null;
  accruedAt?: Date | null;
  payableAt?: Date | null;
  settledAt?: Date | null;
  settlementHoldReason?: string | null;
  createdAt?: Date;
  vendorAllocation?: {
    allocationStatus?: string;
    fulfillmentStatus?: string | null;
    shippingStatus?: string | null;
    fulfillment?: { fulfilledAt: Date | null } | null;
    refundRecords?: Array<{ amount?: unknown }>;
  } | null;
}): SettlementDto {
  const status = getSettlementStatus(entry);
  const fulfilledAt = entry.vendorAllocation?.fulfillment?.fulfilledAt ?? null;
  const payableAt = entry.payableAt ?? fulfilledAt ?? (status === 'payable' ? entry.createdAt : null) ?? null;
  const accruedAt = entry.accruedAt ?? (normalizeType(entry.entryType) === 'sale' ? entry.createdAt : null) ?? null;
  const eligibleAt = entry.settlementEligibleAt ?? payableAt;
  const payoutReady = status === 'payable' || status === 'partially_refunded';
  const noteByStatus: Record<SettlementDto['status'], string> = {
    pending: 'Awaiting settlement classification.',
    accruing: 'Accruing until fulfillment or shipping evidence is present.',
    payable: 'Fulfilled or shipped sale is payout-ready.',
    partially_refunded: 'Refund impact is reducing the vendor balance.',
    held: entry.settlementHoldReason ?? 'Settlement is held for operator review.',
    settled: 'Marked settled in the operational ledger.',
    disputed: 'Settlement is disputed and requires operator review.',
  };

  return {
    status,
    payoutReady,
    eligibleAt: toIso(eligibleAt),
    accruedAt: toIso(accruedAt),
    payableAt: toIso(payableAt),
    settledAt: toIso(entry.settledAt),
    holdReason: entry.settlementHoldReason ?? null,
    note: noteByStatus[status],
  };
}

function isEntryEligibleForPayoutBatch(entry: {
  entryType: string;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  settlementEligibleAt?: Date | null;
  accruedAt?: Date | null;
  payableAt?: Date | null;
  settledAt?: Date | null;
  settlementHoldReason?: string | null;
  createdAt?: Date;
  payoutBatchLines?: Array<unknown>;
  vendorAllocation?: {
    allocationStatus?: string;
    fulfillmentStatus?: string | null;
    shippingStatus?: string | null;
    fulfillment?: { fulfilledAt: Date | null } | null;
    refundRecords?: Array<{ amount?: unknown }>;
  } | null;
}) {
  const type = normalizeType(entry.entryType);
  if (type !== 'sale' && type !== 'refund') {
    return false;
  }
  if ((entry.payoutBatchLines?.length ?? 0) > 0) {
    return false;
  }
  if (mapStatus(entry.payoutStatus ?? '') === 'paid') {
    return false;
  }

  const settlement = buildSettlement(entry);
  return settlement.status === 'payable' || settlement.status === 'partially_refunded';
}

function calculateEntryBatchAmounts(
  entry: {
    entryType: string;
    amount: unknown;
    commissionPercentSnapshot?: unknown;
    commissionVatPercentSnapshot?: unknown;
    deductShippingEnabledSnapshot?: boolean | null;
    shippingModeSnapshot?: string | null;
    fixedShippingFeeSnapshot?: unknown;
    shippingCostSnapshot?: unknown;
    shippingVatAmountSnapshot?: unknown;
    shippingCostSourceSnapshot?: string | null;
    shippingCostProviderSnapshot?: string | null;
    vendorAllocation?: {
      allocationStatus?: string;
      fulfillmentStatus?: string | null;
      shippingStatus?: string | null;
      fulfillment?: { fulfilledAt: Date | null } | null;
      refundRecords?: Array<{ amount?: unknown }>;
    } | null;
  },
  activeProfile: VendorFinancialProfileDto,
) {
  const type = normalizeType(entry.entryType);
  if (type === 'refund') {
    const refundAmount = toNumber(entry.amount);
    return {
      grossAmount: 0,
      commissionAmount: 0,
      commissionVatAmount: 0,
      shippingDeductionAmount: 0,
      refundAmount,
      netAmount: -refundAmount,
    };
  }

  const entryProfile = resolveCalculationProfile(entry, activeProfile);
  const calculation = calculateVendorPayout({
    grossAmount: toNumber(entry.amount),
    refundAmount: 0,
    fulfilled: isFulfilledForShipping(entry.vendorAllocation),
    profile: entryProfile,
  });

  return {
    grossAmount: calculation.grossAmount,
    commissionAmount: calculation.commission,
    commissionVatAmount: calculation.commissionVat,
    shippingDeductionAmount: calculation.shippingDeduction,
    refundAmount: 0,
    netAmount: calculation.estimatedPayout,
  };
}

function mapPayoutBatch(batch: {
  id: string;
  vendorId: string;
  status: string;
  grossAmount: unknown;
  commissionAmount: unknown;
  commissionVatAmount: unknown;
  shippingDeductionAmount: unknown;
  refundAmount: unknown;
  netAmount: unknown;
  currency: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines?: Array<{
    id: string;
    financeLedgerEntryId: string;
    amountSnapshot: unknown;
    createdAt: Date;
  }>;
  _count?: { lines: number };
}): PayoutBatchDto {
  const lineCount = batch._count?.lines ?? batch.lines?.length ?? 0;
  const netAmount = toNumber(batch.netAmount);

  return {
    id: batch.id,
    vendorId: batch.vendorId,
    status: mapPayoutBatchStatus(batch.status),
    grossAmount: toAmountString(toNumber(batch.grossAmount)),
    commissionAmount: toAmountString(toNumber(batch.commissionAmount)),
    commissionVatAmount: toAmountString(toNumber(batch.commissionVatAmount)),
    shippingDeductionAmount: toAmountString(toNumber(batch.shippingDeductionAmount)),
    refundAmount: toAmountString(toNumber(batch.refundAmount)),
    netAmount: toAmountString(netAmount),
    currency: batch.currency,
    createdByUserId: batch.createdByUserId,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    lineCount,
    warning: netAmount < 0 ? 'Negative payout draft requires operator review.' : null,
    lines: batch.lines?.map((line) => ({
      id: line.id,
      financeLedgerEntryId: line.financeLedgerEntryId,
      amountSnapshot: toAmountString(toNumber(line.amountSnapshot)),
      createdAt: line.createdAt.toISOString(),
    })),
  };
}

function mapPayoutBatchReference(line?: {
  payoutBatch: {
    id: string;
    status: string;
    netAmount: unknown;
    createdAt: Date;
  };
}): PayoutBatchReferenceDto | null {
  if (!line) {
    return null;
  }

  return {
    id: line.payoutBatch.id,
    status: mapPayoutBatchStatus(line.payoutBatch.status),
    netAmount: toAmountString(toNumber(line.payoutBatch.netAmount)),
    createdAt: line.payoutBatch.createdAt.toISOString(),
  };
}

function mapInvoiceExecutionReference(execution?: {
  id: string;
  provider: string;
  status: string;
  providerInvoiceGuid: string | null;
  providerInvoiceNo: string | null;
  providerPdfUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): InvoiceExecutionReferenceDto | null {
  if (!execution) {
    return null;
  }

  return {
    id: execution.id,
    provider: execution.provider.trim().toLowerCase() as InvoiceExecutionReferenceDto['provider'],
    status: execution.status.trim().toLowerCase() as InvoiceExecutionReferenceDto['status'],
    providerInvoiceGuid: execution.providerInvoiceGuid,
    providerInvoiceNo: execution.providerInvoiceNo,
    providerPdfUrl: execution.providerPdfUrl,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };
}

export async function getVendorFinanceDashboard(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<FinanceDashboardDto> {
  const [summaryEntries, entries, storedProfile, latestBatch] = await Promise.all([
    prisma.financeLedgerEntry.findMany({
      where: {
        vendorId,
      },
      select: {
        id: true,
        entryType: true,
        amount: true,
        payoutStatus: true,
        commissionPercentSnapshot: true,
        commissionVatPercentSnapshot: true,
        deductShippingEnabledSnapshot: true,
        shippingModeSnapshot: true,
        fixedShippingFeeSnapshot: true,
        shippingCostSnapshot: true,
        shippingVatAmountSnapshot: true,
        shippingCostSourceSnapshot: true,
        shippingCostProviderSnapshot: true,
        settlementStatus: true,
        settlementEligibleAt: true,
        accruedAt: true,
        payableAt: true,
        settledAt: true,
        settlementHoldReason: true,
        createdAt: true,
        vendorAllocation: {
          select: {
            id: true,
            allocationStatus: true,
            fulfillmentStatus: true,
            shippingStatus: true,
            fulfillment: {
              select: {
                fulfilledAt: true,
              },
            },
            refundRecords: {
              select: {
                amount: true,
              },
            },
          },
        },
        payoutBatchLines: {
          where: {
            payoutBatch: {
              status: {
                in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
              },
            },
          },
          select: {
            id: true,
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
    prisma.financeLedgerEntry.findMany({
      where: {
        vendorId,
      },
      include: {
        vendorAllocation: {
          include: {
            fulfillment: true,
            returnRecords: {
              orderBy: {
                createdAt: 'asc',
              },
              take: 1,
            },
            refundRecords: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
        payoutBatchLines: {
          where: {
            payoutBatch: {
              status: {
                in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
              },
            },
          },
          include: {
            payoutBatch: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        invoiceExecutions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: options.limit ?? 100,
      skip: options.offset ?? 0,
    }),
    prisma.vendorFinancialProfile.findFirst({
      where: {
        vendorId,
        active: true,
      },
    }),
    prisma.payoutBatch.findFirst({
      where: {
        vendorId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            lines: true,
          },
        },
      },
    }),
  ]);
  const profile = mapProfile(storedProfile, vendorId);

  const grossSales = summaryEntries
    .filter((entry) => normalizeType(entry.entryType) === 'sale')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  const refunds = summaryEntries
    .filter((entry) => normalizeType(entry.entryType) === 'refund')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  const netRevenue = grossSales - refunds;
  const saleSummary = summaryEntries
    .filter((entry) => normalizeType(entry.entryType) === 'sale')
    .reduce(
      (summary, entry) => {
        const entryProfile = resolveCalculationProfile(entry, profile);
        const calculation = calculateVendorPayout({
          grossAmount: toNumber(entry.amount),
          refundAmount: 0,
          fulfilled: isFulfilledForShipping(entry.vendorAllocation),
          profile: entryProfile,
        });

        return {
          platformFee: summary.platformFee + calculation.commission,
          commissionVat: summary.commissionVat + calculation.commissionVat,
          shippingDeductions: summary.shippingDeductions + calculation.shippingDeduction,
        };
      },
      {
        platformFee: 0,
        commissionVat: 0,
        shippingDeductions: 0,
      },
    );
  const platformFee = saleSummary.platformFee;
  const commissionVat = saleSummary.commissionVat;
  const shippingDeductions = saleSummary.shippingDeductions;
  const payoutEstimate = grossSales - platformFee - commissionVat - shippingDeductions - refunds;
  const balanceSummary = summaryEntries.reduce(
    (summary, entry) => {
      const type = normalizeType(entry.entryType);
      const settlement = buildSettlement(entry);
      if (type === 'sale') {
        const entryProfile = resolveCalculationProfile(entry, profile);
        const calculation = calculateVendorPayout({
          grossAmount: toNumber(entry.amount),
          refundAmount: 0,
          fulfilled: isFulfilledForShipping(entry.vendorAllocation),
          profile: entryProfile,
        });
        const saleNet = calculation.estimatedPayout;

        if (settlement.status === 'held' || settlement.status === 'disputed') {
          return {
            ...summary,
            heldBalance: summary.heldBalance + saleNet,
            pendingSettlement: summary.pendingSettlement + saleNet,
          };
        }
        if (settlement.status === 'payable' || settlement.status === 'partially_refunded' || settlement.status === 'settled') {
          return {
            ...summary,
            payableBalance: summary.payableBalance + saleNet,
          };
        }

        return {
          ...summary,
          accruedBalance: summary.accruedBalance + saleNet,
          pendingSettlement: summary.pendingSettlement + saleNet,
        };
      }

      if (type === 'refund') {
        const refundAmount = toNumber(entry.amount);
        const refundAppliesToPayable = isFulfilledForShipping(entry.vendorAllocation);

        return {
          ...summary,
          refundedBalance: summary.refundedBalance + refundAmount,
          payableBalance: refundAppliesToPayable ? summary.payableBalance - refundAmount : summary.payableBalance,
          accruedBalance: refundAppliesToPayable ? summary.accruedBalance : summary.accruedBalance - refundAmount,
        };
      }

      return summary;
    },
    {
      accruedBalance: 0,
      payableBalance: 0,
      heldBalance: 0,
      refundedBalance: 0,
      pendingSettlement: 0,
    },
  );
  const payoutStatus = summaryEntries[0]?.payoutStatus?.toLowerCase() ?? 'pending';
  const payoutBatchEligibility = summaryEntries.reduce(
    (summary, entry) => {
      if (!isEntryEligibleForPayoutBatch(entry)) {
        const settlement = buildSettlement(entry);
        const type = normalizeType(entry.entryType);
        return {
          ...summary,
          blockedRowCount:
            type === 'sale' || type === 'refund' || settlement.status === 'held' || settlement.status === 'disputed'
              ? summary.blockedRowCount + 1
              : summary.blockedRowCount,
        };
      }

      const amounts = calculateEntryBatchAmounts(entry, profile);
      return {
        eligibleRowCount: summary.eligibleRowCount + 1,
        eligibleNetAmount: summary.eligibleNetAmount + amounts.netAmount,
        blockedRowCount: summary.blockedRowCount,
      };
    },
    {
      eligibleRowCount: 0,
      eligibleNetAmount: 0,
      blockedRowCount: 0,
    },
  );

  const records: FinanceRecordDto[] = entries.map((entry) => {
    const references = mapRelatedReferences(entry);
    const type = normalizeType(entry.entryType);
    const entryProfile = resolveCalculationProfile(entry, profile);
    const settlement = buildSettlement(entry);
    const fulfilled = isFulfilledForShipping(entry.vendorAllocation);
    const payoutCalculation = calculateVendorPayout({
      grossAmount: type === 'refund' ? 0 : toNumber(entry.amount),
      refundAmount:
        type === 'refund'
          ? toNumber(entry.amount)
          : sumRefundImpact(entry.vendorAllocation?.refundRecords),
      fulfilled,
      profile: entryProfile,
    });

    return {
      id: entry.id,
      type,
      amount: toAmountString(toNumber(entry.amount)),
      status: mapStatus(entry.payoutStatus),
      description: entry.description,
      relatedOrderId: references.relatedOrderId,
      relatedOrderNumber: references.relatedOrderNumber,
      relatedReturnId: references.relatedReturnId,
      relatedRefundId: references.relatedRefundId,
      createdAt: entry.createdAt.toISOString(),
      payoutCalculation: mapCalculation(payoutCalculation, entryProfile, entry, fulfilled),
      settlement,
      payoutBatch: mapPayoutBatchReference(entry.payoutBatchLines?.[0]),
      invoiceExecution: mapInvoiceExecutionReference(entry.invoiceExecutions?.[0]),
    };
  });

  return {
    summary: {
      grossSales: toAmountString(grossSales),
      refunds: toAmountString(refunds),
      netRevenue: toAmountString(netRevenue),
      platformFee: toAmountString(platformFee),
      commissionVat: toAmountString(commissionVat),
      shippingDeductions: toAmountString(shippingDeductions),
      payoutEstimate: toAmountString(payoutEstimate),
      payoutStatus,
      accruedBalance: toAmountString(balanceSummary.accruedBalance),
      payableBalance: toAmountString(balanceSummary.payableBalance),
      heldBalance: toAmountString(balanceSummary.heldBalance),
      refundedBalance: toAmountString(balanceSummary.refundedBalance),
      pendingSettlement: toAmountString(balanceSummary.pendingSettlement),
    },
    profile,
    payoutBatchSummary: {
      eligibleRowCount: payoutBatchEligibility.eligibleRowCount,
      eligibleNetAmount: toAmountString(payoutBatchEligibility.eligibleNetAmount),
      blockedRowCount: payoutBatchEligibility.blockedRowCount,
      latestBatch: latestBatch ? mapPayoutBatch(latestBatch) : null,
    },
    records,
  };
}

export async function getVendorFinancialProfile(vendorId: string): Promise<VendorFinancialProfileDto> {
  const profile = await prisma.vendorFinancialProfile.findFirst({
    where: {
      vendorId,
      active: true,
    },
  });

  return mapProfile(profile, vendorId);
}

function normalizeShippingCostStatus(value: ShippingCostInputDto['status'] | undefined) {
  const normalized = (value ?? 'confirmed').toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DISPUTED' || normalized === 'IGNORED') {
    return normalized as 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'IGNORED';
  }
  throw new Error('Unsupported shipping cost status.');
}

function normalizeShippingCostSourceType(value: ShippingCostInputDto['sourceType'] | undefined) {
  const normalized = (value ?? 'manual').toUpperCase();
  if (normalized === 'MANUAL' || normalized === 'IMPORTED' || normalized === 'EXTERNAL_PROVIDER') {
    return normalized as 'MANUAL' | 'IMPORTED' | 'EXTERNAL_PROVIDER';
  }
  throw new Error('Unsupported shipping cost source type.');
}

function buildShippingCostId(input: {
  vendorId: string;
  allocationId: string;
  providerName: string;
  providerReference?: string | null;
}) {
  const provider = input.providerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
  const reference = (input.providerReference?.trim() || 'manual')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `shipcost-${input.vendorId}-${input.allocationId}-${provider}-${reference}`;
}

export async function upsertShipmentShippingCost(input: ShippingCostInputDto): Promise<ShippingCostDto> {
  if (!input.vendorId || !input.providerName || (!input.allocationId && !input.financeLedgerEntryId)) {
    throw new Error('vendorId, providerName, and allocation or finance ledger reference are required.');
  }
  if (!Number.isFinite(input.shippingCost) || input.shippingCost < 0) {
    throw new Error('shippingCost must be zero or greater.');
  }
  if (input.shippingVatAmount !== undefined && input.shippingVatAmount !== null && (!Number.isFinite(input.shippingVatAmount) || input.shippingVatAmount < 0)) {
    throw new Error('shippingVatAmount must be zero or greater.');
  }

  const ledgerEntry = input.financeLedgerEntryId
    ? await prisma.financeLedgerEntry.findUnique({
        where: {
          id: input.financeLedgerEntryId,
        },
        select: {
          vendorAllocationId: true,
          vendorId: true,
        },
      })
    : null;
  if (ledgerEntry && ledgerEntry.vendorId !== input.vendorId) {
    throw new Error('Finance ledger row does not belong to the selected vendor.');
  }

  const allocationId = input.allocationId ?? ledgerEntry?.vendorAllocationId ?? null;
  const allocation = allocationId
    ? await prisma.vendorAllocation.findUnique({
        where: {
          id: allocationId,
        },
        include: {
          fulfillment: true,
          order: true,
        },
      })
    : null;
  if (!allocation || allocation.assignedVendorId !== input.vendorId) {
    throw new Error('Allocation could not be found for the selected vendor.');
  }

  const costId = buildShippingCostId({
    vendorId: input.vendorId,
    allocationId: allocation.id,
    providerName: input.providerName,
    providerReference: input.providerReference,
  });
  const cost = await prisma.shipmentShippingCost.upsert({
    where: {
      id: costId,
    },
    update: {
      sourceShopifyFulfillmentId: input.sourceShopifyFulfillmentId ?? allocation.fulfillment?.shopifyFulfillmentId ?? null,
      providerName: input.providerName,
      providerReference: input.providerReference ?? null,
      shippingCost: input.shippingCost,
      shippingVatAmount: input.shippingVatAmount ?? null,
      currency: input.currency ?? 'TRY',
      status: normalizeShippingCostStatus(input.status),
      sourceType: normalizeShippingCostSourceType(input.sourceType),
    },
    create: {
      id: costId,
      vendorId: input.vendorId,
      allocationId: allocation.id,
      sourceShopifyOrderId: allocation.sourceShopifyOrderId,
      sourceShopifyFulfillmentId: input.sourceShopifyFulfillmentId ?? allocation.fulfillment?.shopifyFulfillmentId ?? null,
      providerName: input.providerName,
      providerReference: input.providerReference ?? null,
      shippingCost: input.shippingCost,
      shippingVatAmount: input.shippingVatAmount ?? null,
      currency: input.currency ?? 'TRY',
      status: normalizeShippingCostStatus(input.status),
      sourceType: normalizeShippingCostSourceType(input.sourceType),
    },
  });

  return mapShippingCost(cost);
}

export async function listPayoutBatches(vendorId?: string): Promise<PayoutBatchDto[]> {
  const batches = await prisma.payoutBatch.findMany({
    where: vendorId ? { vendorId } : undefined,
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
    include: {
      _count: {
        select: {
          lines: true,
        },
      },
    },
  });

  return batches.map(mapPayoutBatch);
}

export async function getPayoutBatch(batchId: string): Promise<PayoutBatchDto | null> {
  const batch = await prisma.payoutBatch.findUnique({
    where: {
      id: batchId,
    },
    include: {
      lines: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  return batch ? mapPayoutBatch(batch) : null;
}

export async function preparePayoutBatch(
  input: PreparePayoutBatchDto,
  createdByUserId: string | null,
): Promise<PayoutBatchDto> {
  if (!input.vendorId) {
    throw new Error('vendorId is required.');
  }

  return prisma.$transaction(async (tx) => {
    const [storedProfile, entries] = await Promise.all([
      tx.vendorFinancialProfile.findFirst({
        where: {
          vendorId: input.vendorId,
          active: true,
        },
      }),
      tx.financeLedgerEntry.findMany({
        where: {
          vendorId: input.vendorId,
          entryType: {
            in: ['sale', 'refund'],
          },
        },
        include: {
          vendorAllocation: {
            include: {
              fulfillment: true,
              refundRecords: true,
            },
          },
          payoutBatchLines: {
            where: {
              payoutBatch: {
                status: {
                  in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                },
              },
            },
            select: {
              id: true,
            },
            take: 1,
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
    ]);
    const profile = mapProfile(storedProfile, input.vendorId);
    const eligibleEntries = entries.filter(isEntryEligibleForPayoutBatch);

    if (eligibleEntries.length === 0) {
      throw new Error('No eligible payable ledger rows are available for payout batch preparation.');
    }

    const totals = eligibleEntries.reduce(
      (summary, entry) => {
        const amounts = calculateEntryBatchAmounts(entry, profile);
        return {
          grossAmount: summary.grossAmount + amounts.grossAmount,
          commissionAmount: summary.commissionAmount + amounts.commissionAmount,
          commissionVatAmount: summary.commissionVatAmount + amounts.commissionVatAmount,
          shippingDeductionAmount: summary.shippingDeductionAmount + amounts.shippingDeductionAmount,
          refundAmount: summary.refundAmount + amounts.refundAmount,
          netAmount: summary.netAmount + amounts.netAmount,
        };
      },
      {
        grossAmount: 0,
        commissionAmount: 0,
        commissionVatAmount: 0,
        shippingDeductionAmount: 0,
        refundAmount: 0,
        netAmount: 0,
      },
    );

    const batch = await tx.payoutBatch.create({
      data: {
        vendorId: input.vendorId,
        status: 'DRAFT',
        grossAmount: totals.grossAmount,
        commissionAmount: totals.commissionAmount,
        commissionVatAmount: totals.commissionVatAmount,
        shippingDeductionAmount: totals.shippingDeductionAmount,
        refundAmount: totals.refundAmount,
        netAmount: totals.netAmount,
        currency: 'TRY',
        createdByUserId,
        lines: {
          create: eligibleEntries.map((entry) => ({
            financeLedgerEntryId: entry.id,
            amountSnapshot: calculateEntryBatchAmounts(entry, profile).netAmount,
          })),
        },
      },
      include: {
        lines: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    return mapPayoutBatch(batch);
  });
}

export async function cancelPayoutBatch(batchId: string): Promise<PayoutBatchDto> {
  const batch = await prisma.payoutBatch.update({
    where: {
      id: batchId,
    },
    data: {
      status: 'CANCELLED',
    },
    include: {
      lines: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  return mapPayoutBatch(batch);
}

export async function markPayoutBatchReview(batchId: string): Promise<PayoutBatchDto> {
  const batch = await prisma.payoutBatch.update({
    where: {
      id: batchId,
    },
    data: {
      status: 'REVIEW',
    },
    include: {
      lines: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  return mapPayoutBatch(batch);
}

function normalizePercent(value: number | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('Percent values must be between 0 and 100.');
  }

  return Math.round(value * 100) / 100;
}

function normalizeShippingMode(value: VendorFinancialProfileUpdateDto['shippingMode'] | undefined, fallback: ShippingMode) {
  return value ?? fallback;
}

export async function upsertVendorFinancialProfile(
  vendorId: string,
  input: VendorFinancialProfileUpdateDto,
): Promise<VendorFinancialProfileDto> {
  const existing = await getVendorFinancialProfile(vendorId);
  const commissionPercent = normalizePercent(input.commissionPercent, toNumber(existing.commissionPercent));
  const commissionVatPercent = normalizePercent(input.commissionVatPercent, toNumber(existing.commissionVatPercent));
  const shippingMode = normalizeShippingMode(input.shippingMode, existing.shippingMode);
  const fixedShippingFee =
    input.fixedShippingFee === undefined
      ? existing.fixedShippingFee === null
        ? null
        : toNumber(existing.fixedShippingFee)
      : input.fixedShippingFee;

  if (fixedShippingFee !== null && (!Number.isFinite(fixedShippingFee) || fixedShippingFee < 0)) {
    throw new Error('Fixed shipping fee must be zero or greater.');
  }

  const profile = await prisma.vendorFinancialProfile.upsert({
    where: {
      vendorId,
    },
    update: {
      commissionPercent,
      commissionVatPercent,
      deductShippingEnabled: input.deductShippingEnabled ?? existing.deductShippingEnabled,
      shippingMode: shippingMode.toUpperCase() as 'DISABLED' | 'FIXED' | 'EXTERNAL_PROVIDER',
      fixedShippingFee,
      active: input.active ?? true,
    },
    create: {
      vendorId,
      commissionPercent,
      commissionVatPercent,
      deductShippingEnabled: input.deductShippingEnabled ?? existing.deductShippingEnabled,
      shippingMode: shippingMode.toUpperCase() as 'DISABLED' | 'FIXED' | 'EXTERNAL_PROVIDER',
      fixedShippingFee,
      active: input.active ?? true,
    },
  });

  return mapProfile(profile, vendorId);
}
