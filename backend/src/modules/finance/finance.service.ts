import { prisma } from '../../db/prisma.js';
import {
  calculateVendorPayout,
  DEFAULT_VENDOR_FINANCIAL_PROFILE,
  type ShippingMode,
  type VendorFinanceProfileConfig,
} from './payout-calculator.js';
import type {
  FinanceDashboardDto,
  FinanceRecordDto,
  PayoutCalculationDto,
  VendorFinancialProfileDto,
  VendorFinancialProfileUpdateDto,
} from './finance.types.js';

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
): PayoutCalculationDto {
  return {
    grossAmount: toAmountString(calculation.grossAmount),
    commission: toAmountString(calculation.commission),
    commissionVat: toAmountString(calculation.commissionVat),
    shippingDeduction: toAmountString(calculation.shippingDeduction),
    refundImpact: toAmountString(calculation.refundImpact),
    estimatedPayout: toAmountString(calculation.estimatedPayout),
    shippingApplied: calculation.shippingApplied,
    shippingMode: calculation.shippingMode,
    profileSource: profile.source,
    commissionPercent: toPercentString(profile.commissionPercent),
    commissionVatPercent: toPercentString(profile.commissionVatPercent),
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

export async function getVendorFinanceDashboard(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<FinanceDashboardDto> {
  const [summaryEntries, entries, storedProfile] = await Promise.all([
    prisma.financeLedgerEntry.findMany({
      where: {
        vendorId,
      },
      select: {
        entryType: true,
        amount: true,
        payoutStatus: true,
        commissionPercentSnapshot: true,
        commissionVatPercentSnapshot: true,
        deductShippingEnabledSnapshot: true,
        shippingModeSnapshot: true,
        fixedShippingFeeSnapshot: true,
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
          },
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
  const payoutStatus = summaryEntries[0]?.payoutStatus?.toLowerCase() ?? 'pending';

  const records: FinanceRecordDto[] = entries.map((entry) => {
    const references = mapRelatedReferences(entry);
    const type = normalizeType(entry.entryType);
    const entryProfile = resolveCalculationProfile(entry, profile);
    const payoutCalculation = calculateVendorPayout({
      grossAmount: type === 'refund' ? 0 : toNumber(entry.amount),
      refundAmount:
        type === 'refund'
          ? toNumber(entry.amount)
          : sumRefundImpact(entry.vendorAllocation?.refundRecords),
      fulfilled: isFulfilledForShipping(entry.vendorAllocation),
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
      payoutCalculation: mapCalculation(payoutCalculation, entryProfile),
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
    },
    profile,
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
