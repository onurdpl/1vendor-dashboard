import { prisma } from '../../db/prisma.js';
import type { Prisma } from '@prisma/client';
import {
  auditVendorProfileChanges,
  type VendorProfileAuditActor,
} from '../vendors/vendor-profile-audit-log.service.js';
import {
  calculateVendorPayout,
  DEFAULT_VENDOR_FINANCIAL_PROFILE,
  type ShippingMode,
  type VendorFinanceProfileConfig,
} from './payout-calculator.js';
import type {
  FinanceDashboardDto,
  FinanceDashboardSummaryDto,
  FinanceRecordDto,
  ReturnFinanceRecordsResponseDto,
  PayoutBatchDto,
  PayoutBatchReferenceDto,
  PayoutCalculationDto,
  PreparePayoutBatchDto,
  SettlementDto,
  SplitFinanceSummaryDto,
  VendorFinancialProfileDto,
  VendorFinancialProfileUpdateDto,
  ShippingCostDto,
  ShippingCostInputDto,
} from './finance.types.js';
import { logDashboardTiming, startDashboardTimer, withDashboardTiming } from '../../lib/dashboard-timing.js';
import { hasApprovedOpenReturnHold } from './settlement-return-hold.service.js';
import {
  DEFAULT_SETTLEMENT_DELAY_DAYS,
  evaluateSaleSettlementDelay,
  normalizeSettlementDelayDays,
} from './settlement-delay-eligibility.service.js';
import {
  POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON,
  calculateRefundOffsetAmounts,
  classifyPostApprovalRefundRisk,
  getUnsettledRefundOffsetEligibility,
  type RefundOffsetSaleLedgerSnapshot,
} from './refund-offset.service.js';
import {
  calculateVendorDebtOffset,
  createVendorDebtOffsetForPayoutBatch,
  getVendorBalanceSummary,
} from './vendor-balance.service.js';
import { mapLinkedSettlementRefundAdjustments } from './settlement-refund-adjustment.service.js';
import {
  activeFinanceLedgerWhere,
  assertLedgerActiveForMoneyMovement,
  isLedgerVoided,
} from './active-ledger-policy.service.js';
import { findBlockingFinanceIntegrityAlerts } from './finance-integrity-alert.service.js';
import {
  CANCEL_REFUND_REVIEW_HOLD_REASON,
  VENDOR_BLOCKED_FINANCE_HOLD_REASON,
  hasActiveVendorBlockedFinanceHold,
  hasBlockingCancelRefundReviewStatus,
} from './cancel-refund-review-hold.service.js';

const ACTIVE_PAYOUT_BATCH_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'EXECUTION_PENDING', 'PAID_PLACEHOLDER'] as const;
const PAYOUT_BATCH_REVISION_REQUIRED_MESSAGE =
  'Payout batch requires revision because financial facts changed after batch creation.';
const REFUND_OFFSET_REQUIRED_BEFORE_PAYOUT_REASON = 'Refund offset required before payout.';
const DEFAULT_SETTLEMENT_FREQUENCY_TYPE = 'WEEKLY' as const;
const DEFAULT_WEEKLY_SETTLEMENT_DAY = 'WEDNESDAY' as const;
const SUPPORTED_SETTLEMENT_FREQUENCY_TYPES = new Set(['WEEKLY', 'BIWEEKLY']);
const SUPPORTED_SETTLEMENT_WEEKDAYS = new Set(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);

type FinanceDbClient = Pick<
  Prisma.TransactionClient,
  'payoutBatch' | 'vendorFinancialProfile' | 'vendorBalanceEvent' | 'financeIntegrityAlert'
>;
type SettlementCommissionInvoiceReviewSnapshot = {
  id?: string | null;
  status?: string | null;
  invoiceNo?: string | null;
  providerUuid?: string | null;
};
type SettlementApprovalReviewSnapshot = {
  id?: string | null;
  status?: string | null;
  commissionInvoices?: SettlementCommissionInvoiceReviewSnapshot[] | null;
};
type SettlementApprovalLineReviewSnapshot = {
  settlementApproval?: SettlementApprovalReviewSnapshot | null;
};
const splitFinanceEventSelect = {
  id: true,
  sourceAllocationId: true,
  childAllocationId: true,
  reason: true,
  createdAt: true,
  sourceFinanceLedgerEntryId: true,
  remainingFinanceLedgerEntryId: true,
  childFinanceLedgerEntryId: true,
} satisfies Prisma.AllocationSplitEventSelect;
type SplitFinanceEventSnapshot = Prisma.AllocationSplitEventGetPayload<{ select: typeof splitFinanceEventSelect }>;
type SplitFinanceLedgerSnapshot = {
  id: string;
  entryType?: string | null;
  vendorAllocation?: {
    allocationStatus?: string | null;
    cancelRefundReviewStatus?: string | null;
    refundRecords?: Array<{ id?: string | null; sourceShopifyRefundId?: string | null; amount?: unknown }>;
    outboundShopifyRefundAttempts?: Array<{
      status?: string | null;
      resolvedAt?: Date | null;
      mutationResponseJson?: Prisma.JsonValue | null;
    }>;
  } | null;
  sourceAllocationSplitEvents?: SplitFinanceEventSnapshot[];
  remainingAllocationSplitEvents?: SplitFinanceEventSnapshot[];
  childAllocationSplitEvents?: SplitFinanceEventSnapshot[];
};

export type PayoutBatchTransitionBlockerCode =
  | 'refund_arrived_after_batch_creation'
  | 'refund_offset_required_before_payout'
  | 'payout_amount_changed_since_batch_creation'
  | 'approved_return_hold_active'
  | 'cancel_refund_review_active'
  | 'vendor_blocked_finance_hold_active'
  | 'finance_integrity_alert_open'
  | 'ledger_row_voided'
  | 'ledger_row_paid'
  | 'ledger_row_no_longer_eligible'
  | 'ledger_row_missing';

export type PayoutBatchTransitionBlocker = {
  code: PayoutBatchTransitionBlockerCode;
  reason: string;
  payoutBatchLineId: string;
  financeLedgerEntryId: string | null;
  metadata?: Record<string, unknown>;
};

export class PayoutBatchTransitionRevalidationError extends Error {
  blockers: PayoutBatchTransitionBlocker[];

  constructor(blockers: PayoutBatchTransitionBlocker[]) {
    super(PAYOUT_BATCH_REVISION_REQUIRED_MESSAGE);
    this.name = 'PayoutBatchTransitionRevalidationError';
    this.blockers = blockers;
  }
}

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: unknown) {
  return Math.round(toNumber(value) * 100);
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

function normalizeFinanceToken(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? '';
}

function hasPostRefundFulfillmentCheckPassed(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const mutationResponse = value as Record<string, unknown>;
  const postCheck = mutationResponse.postRefundFulfillmentCheck;
  if (!postCheck || typeof postCheck !== 'object' || Array.isArray(postCheck)) {
    return false;
  }
  return normalizeFinanceToken((postCheck as Record<string, unknown>).status as string | null | undefined) === 'PASSED';
}

function isRefundedSplitChildSaleBasis(entry: SplitFinanceLedgerSnapshot) {
  const allocation = entry.vendorAllocation;
  if (
    normalizeType(entry.entryType ?? '') !== 'sale' ||
    !entry.childAllocationSplitEvents?.length ||
    normalizeFinanceToken(allocation?.allocationStatus) !== 'VENDOR_BLOCKED' ||
    normalizeFinanceToken(allocation?.cancelRefundReviewStatus) !== 'RESOLVED' ||
    !(allocation?.refundRecords?.length ?? 0)
  ) {
    return false;
  }

  return (allocation?.outboundShopifyRefundAttempts ?? []).some((attempt) =>
    normalizeFinanceToken(attempt.status) === 'RESOLVED' &&
    Boolean(attempt.resolvedAt) &&
    hasPostRefundFulfillmentCheckPassed(attempt.mutationResponseJson)
  );
}

function mapSplitFinanceSummary(entry: SplitFinanceLedgerSnapshot): SplitFinanceSummaryDto | null {
  const sourceEvent = entry.sourceAllocationSplitEvents?.[0] ?? null;
  const remainingEvent = entry.remainingAllocationSplitEvents?.[0] ?? null;
  const childEvent = entry.childAllocationSplitEvents?.[0] ?? null;
  const event = childEvent ?? remainingEvent ?? sourceEvent;
  if (!event) {
    return null;
  }

  return {
    splitEventId: event.id,
    sourceAllocationId: event.sourceAllocationId,
    childAllocationId: event.childAllocationId,
    sourceFinanceLedgerEntryId: event.sourceFinanceLedgerEntryId ?? null,
    remainingFinanceLedgerEntryId: event.remainingFinanceLedgerEntryId ?? null,
    childFinanceLedgerEntryId: event.childFinanceLedgerEntryId ?? null,
    lineageRole: childEvent ? 'child' : 'source',
    splitReason: event.reason,
    splitCreatedAt: event.createdAt.toISOString(),
    ...(isRefundedSplitChildSaleBasis(entry)
      ? {
          refundedChildSaleBasis: true,
          refundOffsetStatus: 'settlement_review_pending' as const,
        }
      : {}),
  };
}

function normalizeApprovalStatus(status: string | null | undefined) {
  const normalized = mapStatus(status ?? '');
  return normalized === 'draft' || normalized === 'approved' ? normalized : null;
}

function isActiveSettlementApprovalLine(line: SettlementApprovalLineReviewSnapshot) {
  return normalizeApprovalStatus(line.settlementApproval?.status) !== null;
}

function getActiveSettlementReview(entry: {
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
}): SettlementDto['review'] {
  const activeLines = (entry.settlementApprovalLines ?? [])
    .filter(isActiveSettlementApprovalLine)
    .sort((left, right) => {
      const leftStatus = normalizeApprovalStatus(left.settlementApproval?.status);
      const rightStatus = normalizeApprovalStatus(right.settlementApproval?.status);
      if (leftStatus === rightStatus) {
        return 0;
      }
      return leftStatus === 'approved' ? -1 : 1;
    });
  const approval = activeLines[0]?.settlementApproval ?? null;
  const approvalStatus = normalizeApprovalStatus(approval?.status);
  if (!approval?.id || !approvalStatus) {
    return null;
  }
  const commissionInvoice =
    (approval.commissionInvoices ?? []).find((invoice) => mapStatus(invoice.status ?? '') !== 'cancelled') ?? null;

  return {
    approvalId: approval.id,
    approvalStatus,
    commissionInvoiceId: commissionInvoice?.id ?? null,
    commissionInvoiceStatus: commissionInvoice?.status ? mapStatus(commissionInvoice.status) : null,
    invoiceNo: commissionInvoice?.invoiceNo ?? null,
    providerUuid: commissionInvoice?.providerUuid ?? null,
  };
}

function hasActiveSettlementReview(entry: {
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
}) {
  return getActiveSettlementReview(entry) !== null;
}

function hasDraftSettlementReview(entry: {
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
}) {
  return getActiveSettlementReview(entry)?.approvalStatus === 'draft';
}

function getSettlementReviewNote(review: NonNullable<SettlementDto['review']>) {
  if (review.commissionInvoiceStatus === 'created') {
    return 'Settlement approval is locked and the Logo commission invoice has been created.';
  }
  if (review.approvalStatus === 'approved') {
    return 'Settlement approval is locked for invoice and payout workflow.';
  }
  return 'Settlement row is locked in a draft settlement approval.';
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

function mapSettlementFrequencyType(value: unknown): VendorFinancialProfileDto['settlementFrequencyType'] {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'BIWEEKLY') {
    return normalized;
  }
  return DEFAULT_SETTLEMENT_FREQUENCY_TYPE;
}

function mapSettlementWeekday(value: unknown): VendorFinancialProfileDto['weeklySettlementDay'] {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (SUPPORTED_SETTLEMENT_WEEKDAYS.has(normalized)) {
    return normalized as VendorFinancialProfileDto['weeklySettlementDay'];
  }
  return DEFAULT_WEEKLY_SETTLEMENT_DAY;
}

function mapProfile(profile: {
  vendorId: string;
  commissionPercent: unknown;
  commissionVatPercent: unknown;
  deductShippingEnabled: boolean;
  shippingMode: string;
  fixedShippingFee: unknown;
  settlementDelayDays?: unknown;
  settlementFrequencyType?: unknown;
  weeklySettlementDay?: unknown;
  autoSettlementDraftEnabled?: boolean;
  autoSettlementApproveEnabled?: boolean;
  autoSettlementInvoiceEnabled?: boolean;
  active: boolean;
} | null, vendorId: string): VendorFinancialProfileDto {
  const config = profile
    ? {
        commissionPercent: toNumber(profile.commissionPercent),
        commissionVatPercent: toNumber(profile.commissionVatPercent),
        deductShippingEnabled: profile.deductShippingEnabled,
        shippingMode: mapShippingMode(profile.shippingMode),
        fixedShippingFee: profile.fixedShippingFee === null ? null : toNumber(profile.fixedShippingFee),
        settlementDelayDays: normalizeSettlementDelayDays(profile.settlementDelayDays),
        settlementFrequencyType: mapSettlementFrequencyType(profile.settlementFrequencyType),
        weeklySettlementDay: mapSettlementWeekday(profile.weeklySettlementDay),
        autoSettlementDraftEnabled: profile.autoSettlementDraftEnabled ?? false,
        autoSettlementApproveEnabled: profile.autoSettlementApproveEnabled ?? false,
        autoSettlementInvoiceEnabled: profile.autoSettlementInvoiceEnabled ?? false,
        active: profile.active,
        source: 'configured' as const,
      }
    : {
        ...DEFAULT_VENDOR_FINANCIAL_PROFILE,
        settlementFrequencyType: DEFAULT_SETTLEMENT_FREQUENCY_TYPE,
        weeklySettlementDay: DEFAULT_WEEKLY_SETTLEMENT_DAY,
        autoSettlementDraftEnabled: false,
        autoSettlementApproveEnabled: false,
        autoSettlementInvoiceEnabled: false,
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
    settlementDelayDays: config.settlementDelayDays,
    settlementFrequencyType: config.settlementFrequencyType,
    weeklySettlementDay: config.weeklySettlementDay,
    autoSettlementDraftEnabled: config.autoSettlementDraftEnabled,
    autoSettlementApproveEnabled: config.autoSettlementApproveEnabled,
    autoSettlementInvoiceEnabled: config.autoSettlementInvoiceEnabled,
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
    settlementDelayDays: profile.settlementDelayDays,
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
  settlementDelayDaysSnapshot?: unknown;
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
    settlementDelayDays: normalizeSettlementDelayDays(entry.settlementDelayDaysSnapshot),
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
    settlementDelayDaysSnapshot?: unknown;
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

type FinanceSummaryCalculationEntry = {
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
    cancelRefundReviewStatus?: string | null;
    fulfillmentStatus?: string | null;
    shippingStatus?: string | null;
    fulfillment?: { fulfilledAt: Date | null } | null;
  } | null;
};

function calculateFinanceSummaryAmounts(
  summaryEntries: FinanceSummaryCalculationEntry[],
  profile: VendorFinancialProfileDto,
) {
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

  return {
    grossSales,
    refunds,
    netRevenue,
    platformFee,
    commissionVat,
    shippingDeductions,
    payoutEstimate,
  };
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
  const relatedReturnId = record.vendorAllocation?.returnRecords?.[0]?.id ?? null;
  const relatedRefundId =
    record.vendorAllocation?.refundRecords?.[0]?.sourceShopifyRefundId ??
    record.vendorAllocation?.refundRecords?.[0]?.id ??
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

function getValidRefundRecord(entry: {
  vendorAllocation?: {
    refundRecords?: Array<{ id?: string | null; sourceShopifyRefundId?: string | null; amount?: unknown }>;
  } | null;
}) {
  return entry.vendorAllocation?.refundRecords?.find((refund) => refund.sourceShopifyRefundId || refund.id) ?? null;
}

function getRelatedSaleLedgerEntry(entry: {
  id?: string | null;
  entryType?: string | null;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
  payoutBatchLines?: Array<{ payoutBatch?: { status?: string | null } | null }>;
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
  vendorAllocation?: {
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
  } | null;
}) {
  if (normalizeType(entry.entryType ?? '') === 'sale') {
    return entry;
  }

  return entry.vendorAllocation?.financeEntries?.find((ledgerEntry) =>
    normalizeType(ledgerEntry.entryType ?? '') === 'sale' && ledgerEntry.id !== entry.id
  ) ?? null;
}

function getRefundOffsetEligibility(entry: {
  id?: string | null;
  entryType?: string | null;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
  payoutBatchLines?: Array<{ payoutBatch?: { status?: string | null } | null }>;
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
  vendorAllocation?: {
    refundRecords?: Array<{ id?: string | null; sourceShopifyRefundId?: string | null; amount?: unknown }>;
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
  } | null;
}) {
  return getUnsettledRefundOffsetEligibility({
    refundRecord: getValidRefundRecord(entry),
    relatedSaleLedgerEntry: getRelatedSaleLedgerEntry(entry),
  });
}

function getPostApprovalRefundRisk(entry: {
  id?: string | null;
  entryType?: string | null;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
  payoutBatchLines?: Array<{ payoutBatch?: { status?: string | null } | null }>;
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
  vendorAllocation?: {
    refundRecords?: Array<{ id?: string | null; sourceShopifyRefundId?: string | null; amount?: unknown }>;
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
  } | null;
}) {
  const type = normalizeType(entry.entryType ?? '');
  const refundLedgerEntry =
    type === 'refund'
      ? entry
      : entry.vendorAllocation?.financeEntries?.find((ledgerEntry) => normalizeType(ledgerEntry.entryType ?? '') === 'refund') ?? null;

  return classifyPostApprovalRefundRisk({
    refundRecord: getValidRefundRecord(entry),
    relatedSaleLedgerEntry: getRelatedSaleLedgerEntry(entry),
    refundLedgerEntry,
    siblingLedgerEntries: entry.vendorAllocation?.financeEntries ?? [],
  });
}

function refundEntryIsRepresentedByApprovedSettlement(entry: {
  entryType?: string | null;
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
}) {
  return normalizeType(entry.entryType ?? '') === 'refund' && (entry.settlementApprovalLines ?? []).some(
    (line) => mapStatus(line.settlementApproval?.status ?? '') === 'approved',
  );
}

function resolveRefundCommissionSnapshot(entry: {
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
  vendorAllocation?: {
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
  } | null;
}) {
  const relatedSale = getRelatedSaleLedgerEntry(entry);
  return {
    commissionPercentSnapshot: entry.commissionPercentSnapshot ?? relatedSale?.commissionPercentSnapshot ?? null,
    commissionVatPercentSnapshot: entry.commissionVatPercentSnapshot ?? relatedSale?.commissionVatPercentSnapshot ?? null,
  };
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
  id?: string | null;
  entryType: string;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  payoutBatchLines?: Array<{ payoutBatch?: { status?: string | null } | null }>;
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
  settlementDelayDaysSnapshot?: unknown;
  vendorAllocation?: {
    allocationStatus?: string;
    cancelRefundReviewStatus?: string | null;
    fulfillmentStatus?: string | null;
    shippingStatus?: string | null;
    fulfillment?: { fulfilledAt: Date | null; shipmentUpdatedAt?: Date | null } | null;
    refundRecords?: Array<{ amount?: unknown }>;
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
    returnRecords?: Array<{
      status?: string | null;
      returnLifecycleStatus?: string | null;
      sourceShopifyRefundId?: string | null;
    }>;
  } | null;
}): SettlementDto['status'] {
  const type = normalizeType(entry.entryType);
  if (getPostApprovalRefundRisk(entry).state === 'approved_settlement_adjustment_required') {
    return 'held';
  }

  const payoutStatus = mapStatus(entry.payoutStatus ?? '');
  if (payoutStatus === 'paid') {
    return 'settled';
  }
  if (type === 'refund' && getRefundOffsetEligibility(entry).eligible) {
    return 'partially_refunded';
  }
  if (payoutStatus === 'hold') {
    return 'held';
  }
  if (hasActiveVendorBlockedFinanceHold(entry.vendorAllocation)) {
    return 'held';
  }
  if (hasBlockingCancelRefundReviewStatus(entry.vendorAllocation)) {
    return 'held';
  }

  const storedStatus = normalizeSettlementStatus(entry.settlementStatus);
  if (storedStatus === 'held' || storedStatus === 'settled' || storedStatus === 'disputed') {
    return storedStatus;
  }

  if (type === 'refund' || sumRefundImpact(entry.vendorAllocation?.refundRecords) > 0) {
    return 'partially_refunded';
  }
  if (hasApprovedOpenReturnHold(entry)) {
    return 'held';
  }
  if (type === 'sale') {
    return evaluateSaleSettlementDelay(entry).eligible ? 'payable' : 'accruing';
  }
  return storedStatus;
}

function buildSettlement(entry: {
  id?: string | null;
  entryType: string;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  settlementEligibleAt?: Date | null;
  accruedAt?: Date | null;
  payableAt?: Date | null;
  settledAt?: Date | null;
  settlementHoldReason?: string | null;
  createdAt?: Date;
  settlementDelayDaysSnapshot?: unknown;
  payoutBatchLines?: Array<{ payoutBatch?: { status?: string | null } | null }>;
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
  vendorAllocation?: {
    allocationStatus?: string;
    cancelRefundReviewStatus?: string | null;
    fulfillmentStatus?: string | null;
    shippingStatus?: string | null;
    fulfillment?: { fulfilledAt: Date | null; shipmentUpdatedAt?: Date | null } | null;
    refundRecords?: Array<{ amount?: unknown }>;
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
    returnRecords?: Array<{
      status?: string | null;
      returnLifecycleStatus?: string | null;
      sourceShopifyRefundId?: string | null;
    }>;
  } | null;
}): SettlementDto {
  const status = getSettlementStatus(entry);
  const review = getActiveSettlementReview(entry);
  const postApprovalRefundRisk = getPostApprovalRefundRisk(entry);
  const cancelRefundReviewActive = hasBlockingCancelRefundReviewStatus(entry.vendorAllocation);
  const saleDelay = evaluateSaleSettlementDelay(entry);
  const payableAt =
    saleDelay.applies
      ? saleDelay.eligibleAt
      : entry.payableAt ?? entry.vendorAllocation?.fulfillment?.fulfilledAt ?? (status === 'payable' ? entry.createdAt : null) ?? null;
  const accruedAt = entry.accruedAt ?? (normalizeType(entry.entryType) === 'sale' ? entry.createdAt : null) ?? null;
  const eligibleAt = saleDelay.applies ? saleDelay.eligibleAt : entry.settlementEligibleAt ?? payableAt;
  const payoutReady = !review && (status === 'payable' || status === 'partially_refunded');
  const noteByStatus: Record<SettlementDto['status'], string> = {
    pending: 'Awaiting settlement classification.',
    accruing: 'Accruing until delivery evidence and settlement delay are satisfied.',
    payable: 'Delivered sale has satisfied the vendor settlement delay.',
    partially_refunded: 'Refund impact is reducing the vendor balance.',
    held:
      postApprovalRefundRisk.state === 'approved_settlement_adjustment_required'
        ? POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON
        : hasActiveVendorBlockedFinanceHold(entry.vendorAllocation)
          ? VENDOR_BLOCKED_FINANCE_HOLD_REASON
        : cancelRefundReviewActive
          ? CANCEL_REFUND_REVIEW_HOLD_REASON
        : entry.settlementHoldReason ?? 'Settlement is held for operator review.',
    settled: 'Marked settled in the operational ledger.',
    disputed: 'Settlement is disputed and requires operator review.',
  };
  const reviewNote = review ? getSettlementReviewNote(review) : null;

  return {
    status,
    payoutReady,
    eligibleAt: toIso(eligibleAt),
    accruedAt: toIso(accruedAt),
    payableAt: toIso(payableAt),
    settledAt: toIso(entry.settledAt),
    holdReason:
      postApprovalRefundRisk.state === 'approved_settlement_adjustment_required'
        ? POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON
        : hasActiveVendorBlockedFinanceHold(entry.vendorAllocation)
          ? VENDOR_BLOCKED_FINANCE_HOLD_REASON
        : cancelRefundReviewActive
          ? CANCEL_REFUND_REVIEW_HOLD_REASON
        : entry.settlementHoldReason ?? null,
    note: status === 'held' || status === 'disputed' ? noteByStatus[status] : reviewNote ?? noteByStatus[status],
    review,
  };
}

function isEntryEligibleForPayoutBatch(entry: {
  id?: string | null;
  entryType: string;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  settlementEligibleAt?: Date | null;
  accruedAt?: Date | null;
  payableAt?: Date | null;
  settledAt?: Date | null;
  settlementHoldReason?: string | null;
  createdAt?: Date;
  settlementDelayDaysSnapshot?: unknown;
  payoutBatchLines?: Array<{ payoutBatch?: { status?: string | null } | null }>;
  settlementApprovalLines?: SettlementApprovalLineReviewSnapshot[];
  vendorAllocation?: {
    allocationStatus?: string;
    cancelRefundReviewStatus?: string | null;
    fulfillmentStatus?: string | null;
    shippingStatus?: string | null;
    fulfillment?: { fulfilledAt: Date | null; shipmentUpdatedAt?: Date | null } | null;
    refundRecords?: Array<{ amount?: unknown }>;
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
    returnRecords?: Array<{
      status?: string | null;
      returnLifecycleStatus?: string | null;
      sourceShopifyRefundId?: string | null;
    }>;
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
  if (hasDraftSettlementReview(entry)) {
    return false;
  }
  if (hasActiveVendorBlockedFinanceHold(entry.vendorAllocation)) {
    return false;
  }
  if (hasBlockingCancelRefundReviewStatus(entry.vendorAllocation)) {
    return false;
  }
  if (getPostApprovalRefundRisk(entry).state === 'approved_settlement_adjustment_required') {
    return false;
  }
  if (type === 'refund' && !getRefundOffsetEligibility(entry).eligible && !refundEntryIsRepresentedByApprovedSettlement(entry)) {
    return false;
  }

  const settlement = buildSettlement(entry);
  return settlement.status === 'payable' || settlement.status === 'partially_refunded';
}

function calculateEntryBatchAmounts(
  entry: {
    id?: string | null;
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
    settlementDelayDaysSnapshot?: unknown;
    vendorAllocation?: {
      allocationStatus?: string;
      fulfillmentStatus?: string | null;
      shippingStatus?: string | null;
      fulfillment?: { fulfilledAt: Date | null } | null;
      refundRecords?: Array<{ amount?: unknown }>;
      financeEntries?: RefundOffsetSaleLedgerSnapshot[];
    } | null;
  },
  activeProfile: VendorFinancialProfileDto,
) {
  const type = normalizeType(entry.entryType);
  if (type === 'refund') {
    const snapshots = resolveRefundCommissionSnapshot(entry);
    const refundOffset = calculateRefundOffsetAmounts({
      refundAmount: entry.amount,
      ...snapshots,
    });
    const refundAmount = refundOffset.refundMinor / 100;
    const commissionAmount = -(refundOffset.commissionReversalMinor / 100);
    const commissionVatAmount = -(refundOffset.commissionVatReversalMinor / 100);
    const vendorPayableReversalAmount = refundOffset.vendorPayableReversalMinor / 100;
    return {
      grossAmount: 0,
      commissionAmount,
      commissionVatAmount,
      shippingDeductionAmount: 0,
      refundAmount,
      netAmount: -vendorPayableReversalAmount,
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
  vendorBalanceEvents?: Array<{
    type: string;
    amountMinor: number;
    metadataJson: Prisma.JsonValue | null;
  }>;
  lines?: Array<{
    id: string;
    financeLedgerEntryId: string;
    amountSnapshot: unknown;
    createdAt: Date;
  }>;
  _count?: { lines: number };
}): PayoutBatchDto {
  const lineCount = batch._count?.lines ?? batch.lines?.length ?? 0;
  const debtOffsetEvents = (batch.vendorBalanceEvents ?? []).filter((event) =>
    event.type === 'VENDOR_DEBT_OFFSET'
  );
  const debtOffsetMinor = debtOffsetEvents.reduce((sum, event) => sum + event.amountMinor, 0);
  const firstDebtOffsetMetadata = debtOffsetEvents.find((event) => event.metadataJson)?.metadataJson;
  const metadata = firstDebtOffsetMetadata && typeof firstDebtOffsetMetadata === 'object' && !Array.isArray(firstDebtOffsetMetadata)
    ? firstDebtOffsetMetadata as Record<string, unknown>
    : {};
  const netAmount = toNumber(batch.netAmount);
  const netAmountMinor = toMinorUnits(netAmount);
  const payableBeforeDebtOffsetMinor = Number.isFinite(Number(metadata.grossPayableMinor))
    ? Number(metadata.grossPayableMinor)
    : netAmountMinor + debtOffsetMinor;
  const outstandingDebtMinor = Number.isFinite(Number(metadata.outstandingDebtMinor))
    ? Number(metadata.outstandingDebtMinor)
    : 0;
  const remainingDebtMinor = Number.isFinite(Number(metadata.remainingDebtMinor))
    ? Number(metadata.remainingDebtMinor)
    : Math.max(outstandingDebtMinor - debtOffsetMinor, 0);

  return {
    id: batch.id,
    vendorId: batch.vendorId,
    status: mapPayoutBatchStatus(batch.status),
    grossAmount: toAmountString(toNumber(batch.grossAmount)),
    commissionAmount: toAmountString(toNumber(batch.commissionAmount)),
    commissionVatAmount: toAmountString(toNumber(batch.commissionVatAmount)),
    shippingDeductionAmount: toAmountString(toNumber(batch.shippingDeductionAmount)),
    refundAmount: toAmountString(toNumber(batch.refundAmount)),
    payableBeforeDebtOffset: toAmountString(payableBeforeDebtOffsetMinor / 100),
    outstandingDebtAmount: toAmountString(outstandingDebtMinor / 100),
    debtOffsetAmount: toAmountString(debtOffsetMinor / 100),
    netAmount: toAmountString(netAmount),
    remainingDebtAmount: toAmountString(remainingDebtMinor / 100),
    currency: batch.currency,
    createdByUserId: batch.createdByUserId,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    lineCount,
    warning:
      remainingDebtMinor > 0
        ? 'Vendor debt remains after this payout draft.'
        : netAmount < 0
          ? 'Negative payout draft requires operator review.'
          : null,
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

export async function getVendorFinanceDashboard(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<FinanceDashboardDto> {
  const [summaryEntries, entries, storedProfile, latestBatch, vendorBalance] = await Promise.all([
    withDashboardTiming('finance.summary_entries_fetch', () => prisma.financeLedgerEntry.findMany({
      where: {
        vendorId,
        ...activeFinanceLedgerWhere,
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
        settlementDelayDaysSnapshot: true,
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
            cancelRefundReviewStatus: true,
            fulfillmentStatus: true,
            shippingStatus: true,
            fulfillment: {
              select: {
                fulfilledAt: true,
                shipmentUpdatedAt: true,
              },
            },
            refundRecords: {
              select: {
                id: true,
                sourceShopifyRefundId: true,
                amount: true,
              },
            },
            financeEntries: {
              where: activeFinanceLedgerWhere,
              select: {
                id: true,
                entryType: true,
                payoutStatus: true,
                settlementStatus: true,
                commissionPercentSnapshot: true,
                commissionVatPercentSnapshot: true,
                payoutBatchLines: {
                  where: {
                    payoutBatch: {
                      status: {
                        in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                      },
                    },
                  },
                  select: {
                    payoutBatch: {
                      select: {
                        status: true,
                      },
                    },
                  },
                },
                settlementApprovalLines: {
                  where: {
                    settlementApproval: {
                      status: {
                        in: ['DRAFT', 'APPROVED'],
                      },
                    },
                  },
                  select: {
                    settlementApproval: {
                      select: {
                        id: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            },
            returnRecords: {
              select: {
                id: true,
                status: true,
                returnLifecycleStatus: true,
                sourceShopifyRefundId: true,
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
            payoutBatch: {
              select: {
                status: true,
              },
            },
          },
          take: 1,
        },
        settlementApprovalLines: {
          where: {
            settlementApproval: {
              status: {
                in: ['DRAFT', 'APPROVED'],
              },
            },
          },
          select: {
            settlementApproval: {
              select: {
                id: true,
                status: true,
                commissionInvoices: {
                  where: {
                    status: {
                      not: 'CANCELLED',
                    },
                  },
                  select: {
                    id: true,
                    status: true,
                    invoiceNo: true,
                    providerUuid: true,
                  },
                  orderBy: {
                    createdAt: 'desc',
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })),
    withDashboardTiming('finance.records_fetch', () => prisma.financeLedgerEntry.findMany({
      where: {
        vendorId,
        ...activeFinanceLedgerWhere,
      },
      select: {
        id: true,
        entryType: true,
        amount: true,
        payoutStatus: true,
        description: true,
        commissionPercentSnapshot: true,
        commissionVatPercentSnapshot: true,
        deductShippingEnabledSnapshot: true,
        shippingModeSnapshot: true,
        fixedShippingFeeSnapshot: true,
        shippingCostSnapshot: true,
        shippingVatAmountSnapshot: true,
        shippingCostSourceSnapshot: true,
        shippingCostProviderSnapshot: true,
        settlementDelayDaysSnapshot: true,
        settlementStatus: true,
        settlementEligibleAt: true,
        accruedAt: true,
        payableAt: true,
        settledAt: true,
        settlementHoldReason: true,
        createdAt: true,
        vendorAllocation: {
          select: {
            sourceShopifyOrderId: true,
            sourceShopifyOrderNumber: true,
            allocationStatus: true,
            cancelRefundReviewStatus: true,
            fulfillmentStatus: true,
            shippingStatus: true,
            fulfillment: {
              select: {
                fulfilledAt: true,
                shipmentUpdatedAt: true,
              },
            },
            returnRecords: {
              select: {
                id: true,
                status: true,
                returnLifecycleStatus: true,
                sourceShopifyRefundId: true,
              },
              orderBy: {
                createdAt: 'asc',
              },
              take: 1,
            },
            refundRecords: {
              select: {
                id: true,
                sourceShopifyRefundId: true,
                amount: true,
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
            outboundShopifyRefundAttempts: {
              select: {
                status: true,
                resolvedAt: true,
                mutationResponseJson: true,
              },
              orderBy: {
                updatedAt: 'desc',
              },
              take: 1,
            },
            financeEntries: {
              where: activeFinanceLedgerWhere,
              select: {
                id: true,
                entryType: true,
                payoutStatus: true,
                settlementStatus: true,
                commissionPercentSnapshot: true,
                commissionVatPercentSnapshot: true,
                payoutBatchLines: {
                  where: {
                    payoutBatch: {
                      status: {
                        in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                      },
                    },
                  },
                  select: {
                    payoutBatch: {
                      select: {
                        status: true,
                      },
                    },
                  },
                },
                settlementApprovalLines: {
                  where: {
                    settlementApproval: {
                      status: {
                        in: ['DRAFT', 'APPROVED'],
                      },
                    },
                  },
                  select: {
                    settlementApproval: {
                      select: {
                        id: true,
                        status: true,
                      },
                    },
                  },
                },
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
            payoutBatch: {
              select: {
                id: true,
                status: true,
                netAmount: true,
                createdAt: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        settlementApprovalLines: {
          where: {
            settlementApproval: {
              status: {
                in: ['DRAFT', 'APPROVED'],
              },
            },
          },
          select: {
            settlementApproval: {
              select: {
                id: true,
                status: true,
                commissionInvoices: {
                  where: {
                    status: {
                      not: 'CANCELLED',
                    },
                  },
                  select: {
                    id: true,
                    status: true,
                    invoiceNo: true,
                    providerUuid: true,
                  },
                  orderBy: {
                    createdAt: 'desc',
                  },
                  take: 1,
                },
              },
            },
          },
        },
        refundAdjustments: {
          select: {
            id: true,
            status: true,
            amountMinor: true,
            originalOrderId: true,
            originalAmountMinor: true,
            appliedAmountMinor: true,
            remainingAmountMinor: true,
            currencyCode: true,
            reason: true,
            originalSettlementApprovalId: true,
            originalSettlementApprovalLineId: true,
            originalSettlementCommissionInvoiceId: true,
            appliedSettlementApprovalId: true,
            appliedSettlementApprovalLineId: true,
            blockedReason: true,
            createdAt: true,
            updatedAt: true,
            applications: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                settlementApprovalId: true,
                settlementApprovalLineId: true,
                amountMinor: true,
                currencyCode: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            events: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                eventType: true,
                createdAt: true,
                metadataJson: true,
              },
            },
            originalOrder: {
              select: { sourceShopifyOrderNumber: true },
            },
            refundRecord: {
              select: {
                sourceShopifyRefundId: true,
                sourceShopifyOrderNumber: true,
              },
            },
            originalSettlementApproval: {
              select: {
                id: true,
                createdAt: true,
                sourceSnapshotJson: true,
              },
            },
            originalSettlementCommissionInvoice: {
              select: {
                id: true,
                invoiceNo: true,
                providerInvoiceId: true,
                providerUuid: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        sourceAllocationSplitEvents: {
          select: splitFinanceEventSelect,
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        remainingAllocationSplitEvents: {
          select: splitFinanceEventSelect,
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        childAllocationSplitEvents: {
          select: splitFinanceEventSelect,
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
    })),
    withDashboardTiming('finance.vendor_profile_fetch', () => prisma.vendorFinancialProfile.findFirst({
      where: {
        vendorId,
        active: true,
      },
    })),
    withDashboardTiming('finance.latest_payout_batch_fetch', () => prisma.payoutBatch.findFirst({
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
        vendorBalanceEvents: true,
      },
    })),
    withDashboardTiming('finance.vendor_balance_fetch', () => getVendorBalanceSummary(prisma, vendorId, 'TRY')),
  ]);
  const aggregationStartedAt = startDashboardTimer();
  const profile = mapProfile(storedProfile, vendorId);

  const {
    grossSales,
    refunds,
    netRevenue,
    platformFee,
    commissionVat,
    shippingDeductions,
    payoutEstimate,
  } = calculateFinanceSummaryAmounts(summaryEntries, profile);
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
  const pendingReviewBalance = summaryEntries.reduce((sum, entry) => {
    const settlement = buildSettlement(entry);
    if (!settlement.payoutReady) {
      return sum;
    }
    return sum + calculateEntryBatchAmounts(entry, profile).netAmount;
  }, 0);
  const payoutStatus = summaryEntries[0]?.payoutStatus?.toLowerCase() ?? 'pending';
  const payoutBatchEligibility = summaryEntries.reduce(
    (summary, entry) => {
      if (hasDraftSettlementReview(entry)) {
        return summary;
      }
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
  const debtPreview = calculateVendorDebtOffset({
    grossPayableMinor: Math.max(toMinorUnits(payoutBatchEligibility.eligibleNetAmount), 0),
    outstandingDebtMinor: vendorBalance.outstandingDebtMinor,
  });

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
      settlementRefundAdjustments: mapLinkedSettlementRefundAdjustments(entry.refundAdjustments),
      splitFinanceSummary: mapSplitFinanceSummary(entry),
    };
  });

  const dashboard: FinanceDashboardDto = {
    summary: {
      grossSales: toAmountString(grossSales),
      refunds: toAmountString(refunds),
      netRevenue: toAmountString(netRevenue),
      platformFee: toAmountString(platformFee),
      commissionVat: toAmountString(commissionVat),
      shippingDeductions: toAmountString(shippingDeductions),
      payoutEstimate: toAmountString(payoutEstimate),
      payoutStatus,
      pendingReviewBalance: toAmountString(pendingReviewBalance),
      accruedBalance: toAmountString(balanceSummary.accruedBalance),
      payableBalance: toAmountString(balanceSummary.payableBalance),
      heldBalance: toAmountString(balanceSummary.heldBalance),
      refundedBalance: toAmountString(balanceSummary.refundedBalance),
      pendingSettlement: toAmountString(balanceSummary.pendingSettlement),
      vendorBalance: toAmountString(vendorBalance.balanceMinor / 100),
      outstandingVendorDebt: toAmountString(vendorBalance.outstandingDebtMinor / 100),
      netPayableAfterDebt: toAmountString(
        (payoutBatchEligibility.eligibleNetAmount > 0
          ? debtPreview.netPayableMinor
          : toMinorUnits(payoutBatchEligibility.eligibleNetAmount)) / 100,
      ),
    },
    profile,
    payoutBatchSummary: {
      eligibleRowCount: payoutBatchEligibility.eligibleRowCount,
      eligibleNetAmount: toAmountString(payoutBatchEligibility.eligibleNetAmount),
      blockedRowCount: payoutBatchEligibility.blockedRowCount,
      outstandingDebtAmount: toAmountString(vendorBalance.outstandingDebtMinor / 100),
      debtOffsetPreviewAmount: toAmountString(debtPreview.debtOffsetMinor / 100),
      netEligibleAfterDebtOffset: toAmountString(
        (payoutBatchEligibility.eligibleNetAmount > 0
          ? debtPreview.netPayableMinor
          : toMinorUnits(payoutBatchEligibility.eligibleNetAmount)) / 100,
      ),
      remainingDebtAfterPreview: toAmountString(debtPreview.remainingDebtMinor / 100),
      latestBatch: latestBatch ? mapPayoutBatch(latestBatch) : null,
    },
    records,
  };
  logDashboardTiming('finance.metrics_aggregation', aggregationStartedAt);
  return dashboard;
}

export async function getVendorFinanceSummary(vendorId: string): Promise<FinanceDashboardSummaryDto> {
  const summaryEntries = await withDashboardTiming('finance.summary_entries_fetch', () => prisma.financeLedgerEntry.findMany({
    where: {
      vendorId,
      ...activeFinanceLedgerWhere,
    },
    select: {
      entryType: true,
      amount: true,
      commissionPercentSnapshot: true,
      commissionVatPercentSnapshot: true,
      deductShippingEnabledSnapshot: true,
      shippingModeSnapshot: true,
      fixedShippingFeeSnapshot: true,
      shippingCostSnapshot: true,
      shippingVatAmountSnapshot: true,
      shippingCostSourceSnapshot: true,
      shippingCostProviderSnapshot: true,
      settlementDelayDaysSnapshot: true,
      vendorAllocation: {
        select: {
          allocationStatus: true,
          cancelRefundReviewStatus: true,
          fulfillmentStatus: true,
          shippingStatus: true,
          fulfillment: {
            select: {
              fulfilledAt: true,
              shipmentUpdatedAt: true,
            },
          },
        },
      },
    },
  }));
  const defaultProfile = mapProfile(null, vendorId);
  const { grossSales, refunds, netRevenue, payoutEstimate } = calculateFinanceSummaryAmounts(
    summaryEntries,
    defaultProfile,
  );

  return {
    summary: {
      grossSales: toAmountString(grossSales),
      refunds: toAmountString(refunds),
      netRevenue: toAmountString(netRevenue),
      payoutEstimate: toAmountString(payoutEstimate),
    },
  };
}

export async function getVendorReturnFinanceRecords(
  vendorId: string,
  input: { shopifyRefundId?: string | null; shopifyOrderNumber?: string | null },
): Promise<ReturnFinanceRecordsResponseDto> {
  const shopifyRefundId = input.shopifyRefundId?.trim();
  const shopifyOrderNumber = input.shopifyOrderNumber?.trim();
  const referenceFilters = [
    shopifyRefundId
      ? {
          vendorAllocation: {
            is: {
              refundRecords: {
                some: {
                  OR: [
                    { sourceShopifyRefundId: shopifyRefundId },
                    { id: shopifyRefundId },
                  ],
                },
              },
            },
          },
        }
      : null,
    shopifyOrderNumber
      ? {
          vendorAllocation: {
            is: {
              sourceShopifyOrderNumber: shopifyOrderNumber,
            },
          },
        }
      : null,
  ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));

  if (!referenceFilters.length) {
    return { records: [] };
  }

  const entries = await withDashboardTiming('finance.return_records_fetch', () => prisma.financeLedgerEntry.findMany({
    where: {
      vendorId,
      OR: referenceFilters,
    },
      select: {
        id: true,
        entryType: true,
        amount: true,
        payoutStatus: true,
        createdAt: true,
        refundAdjustments: {
          select: {
            id: true,
            status: true,
            amountMinor: true,
            originalOrderId: true,
            originalAmountMinor: true,
            appliedAmountMinor: true,
            remainingAmountMinor: true,
            currencyCode: true,
            reason: true,
            originalSettlementApprovalId: true,
            originalSettlementApprovalLineId: true,
            originalSettlementCommissionInvoiceId: true,
            appliedSettlementApprovalId: true,
            appliedSettlementApprovalLineId: true,
            blockedReason: true,
            createdAt: true,
            updatedAt: true,
            applications: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                settlementApprovalId: true,
                settlementApprovalLineId: true,
                amountMinor: true,
                currencyCode: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            events: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                eventType: true,
                createdAt: true,
                metadataJson: true,
              },
            },
            originalOrder: {
              select: { sourceShopifyOrderNumber: true },
            },
            refundRecord: {
              select: {
                sourceShopifyRefundId: true,
                sourceShopifyOrderNumber: true,
              },
            },
            originalSettlementApproval: {
              select: {
                id: true,
                createdAt: true,
                sourceSnapshotJson: true,
              },
            },
            originalSettlementCommissionInvoice: {
              select: {
                id: true,
                invoiceNo: true,
                providerInvoiceId: true,
                providerUuid: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    orderBy: {
      createdAt: 'desc',
    },
  }));

  return {
    records: entries.map((entry) => ({
      id: entry.id,
      category: normalizeType(entry.entryType),
      amount: toNumber(entry.amount),
      status: mapStatus(entry.payoutStatus),
      date: entry.createdAt.toISOString(),
      settlementRefundAdjustments: mapLinkedSettlementRefundAdjustments(entry.refundAdjustments),
    })),
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
          voidedAt: true,
          voidReason: true,
          supersededByLedgerId: true,
        },
      })
    : null;
  assertLedgerActiveForMoneyMovement(
    ledgerEntry,
    'Finance ledger row has been voided or superseded and cannot receive shipping cost.',
  );
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
      vendorBalanceEvents: true,
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
      vendorBalanceEvents: true,
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
    const [storedProfile, entries, vendorBalance] = await Promise.all([
      tx.vendorFinancialProfile.findFirst({
        where: {
          vendorId: input.vendorId,
          active: true,
        },
      }),
      tx.financeLedgerEntry.findMany({
        where: {
          vendorId: input.vendorId,
          ...activeFinanceLedgerWhere,
          entryType: {
            in: ['sale', 'refund'],
          },
        },
        include: {
          vendorAllocation: {
            include: {
              fulfillment: true,
              refundRecords: true,
              financeEntries: {
                where: activeFinanceLedgerWhere,
                select: {
                  id: true,
                  entryType: true,
                  payoutStatus: true,
                  settlementStatus: true,
                  commissionPercentSnapshot: true,
                  commissionVatPercentSnapshot: true,
                  voidedAt: true,
                  payoutBatchLines: {
                    where: {
                      payoutBatch: {
                        status: {
                          in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                        },
                      },
                    },
                    select: {
                      payoutBatch: {
                        select: {
                          status: true,
                        },
                      },
                    },
                  },
                  settlementApprovalLines: {
                    where: {
                      settlementApproval: {
                        status: {
                          in: ['DRAFT', 'APPROVED'],
                        },
                      },
                    },
                    select: {
                      settlementApproval: {
                        select: {
                          id: true,
                          status: true,
                        },
                      },
                    },
                  },
                },
              },
              returnRecords: {
                select: {
                  id: true,
                  status: true,
                  returnLifecycleStatus: true,
                  sourceShopifyRefundId: true,
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
              payoutBatch: {
                select: {
                  status: true,
                },
              },
            },
            take: 1,
          },
          settlementApprovalLines: {
            where: {
              settlementApproval: {
                status: {
                  in: ['DRAFT', 'APPROVED'],
                },
              },
            },
            select: {
              settlementApproval: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
      getVendorBalanceSummary(tx, input.vendorId, 'TRY'),
    ]);
    const profile = mapProfile(storedProfile, input.vendorId);
    const eligibleEntries = entries.filter(isEntryEligibleForPayoutBatch);
    const adjustmentRequiredEntries = entries.filter(
      (entry) => getPostApprovalRefundRisk(entry).state === 'approved_settlement_adjustment_required',
    );

    if (eligibleEntries.length === 0) {
      if (adjustmentRequiredEntries.length > 0) {
        throw new Error(POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON);
      }
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
    const debtOffset = calculateVendorDebtOffset({
      grossPayableMinor: Math.max(toMinorUnits(totals.netAmount), 0),
      outstandingDebtMinor: vendorBalance.outstandingDebtMinor,
    });
    const netAmountAfterDebtOffset =
      totals.netAmount > 0
        ? debtOffset.netPayableMinor / 100
        : totals.netAmount;

    const batch = await tx.payoutBatch.create({
      data: {
        vendorId: input.vendorId,
        status: 'DRAFT',
        grossAmount: totals.grossAmount,
        commissionAmount: totals.commissionAmount,
        commissionVatAmount: totals.commissionVatAmount,
        shippingDeductionAmount: totals.shippingDeductionAmount,
        refundAmount: totals.refundAmount,
        netAmount: netAmountAfterDebtOffset,
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
        vendorBalanceEvents: true,
        lines: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    const debtOffsetEvent = await createVendorDebtOffsetForPayoutBatch(tx, {
      vendorId: input.vendorId,
      payoutBatchId: batch.id,
      debtOffsetMinor: debtOffset.debtOffsetMinor,
      grossPayableMinor: debtOffset.grossPayableMinor,
      outstandingDebtMinor: debtOffset.outstandingDebtMinor,
      remainingDebtMinor: debtOffset.remainingDebtMinor,
      currency: batch.currency,
      createdByUserId,
    });

    return mapPayoutBatch({
      ...batch,
      vendorBalanceEvents: debtOffsetEvent ? [debtOffsetEvent] : [],
    });
  });
}

function buildPayoutBatchTransitionBlocker(input: {
  code: PayoutBatchTransitionBlockerCode;
  reason: string;
  payoutBatchLineId: string;
  financeLedgerEntryId: string | null;
  metadata?: Record<string, unknown>;
}): PayoutBatchTransitionBlocker {
  return {
    code: input.code,
    reason: input.reason,
    payoutBatchLineId: input.payoutBatchLineId,
    financeLedgerEntryId: input.financeLedgerEntryId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function isCurrentPayoutBatchLine(
  line: { payoutBatch?: { id?: string | null; status?: string | null } | null },
  payoutBatchId: string,
) {
  return line.payoutBatch?.id === payoutBatchId;
}

function stripCurrentPayoutBatchEvidence<T extends {
  payoutBatchLines?: Array<{ payoutBatch?: { id?: string | null; status?: string | null } | null }>;
  vendorAllocation?: {
    financeEntries?: Array<RefundOffsetSaleLedgerSnapshot & {
      payoutBatchLines?: Array<{ payoutBatch?: { id?: string | null; status?: string | null } | null }>;
    }>;
  } | null;
}>(entry: T, payoutBatchId: string) {
  return {
    ...entry,
    payoutBatchLines: (entry.payoutBatchLines ?? []).filter((line) => !isCurrentPayoutBatchLine(line, payoutBatchId)),
    vendorAllocation: entry.vendorAllocation
      ? {
          ...entry.vendorAllocation,
          financeEntries: (entry.vendorAllocation.financeEntries ?? []).map((ledgerEntry) => ({
            ...ledgerEntry,
            payoutBatchLines: (ledgerEntry.payoutBatchLines ?? []).filter(
              (line) => !isCurrentPayoutBatchLine(line, payoutBatchId),
            ),
          })),
        }
      : entry.vendorAllocation,
  };
}

function hasRefundRecordCreatedAfterBatch(entry: {
  vendorAllocation?: {
    refundRecords?: Array<{ id?: string | null; sourceShopifyRefundId?: string | null; createdAt?: Date | null }>;
  } | null;
}, batchCreatedAt: Date) {
  return (entry.vendorAllocation?.refundRecords ?? []).filter((refundRecord) =>
    refundRecord.createdAt ? refundRecord.createdAt.getTime() > batchCreatedAt.getTime() : false
  );
}

function getRefundOffsetRequiredLedgerEntries(entry: {
  id?: string | null;
  entryType?: string | null;
  payoutStatus?: string | null;
  settlementHoldReason?: string | null;
  vendorAllocation?: {
    financeEntries?: Array<{
      id?: string | null;
      entryType?: string | null;
      payoutStatus?: string | null;
      settlementHoldReason?: string | null;
    }>;
  } | null;
}) {
  const entries = [
    entry,
    ...(entry.vendorAllocation?.financeEntries ?? []),
  ];

  return entries.filter((ledgerEntry) =>
    normalizeType(ledgerEntry.entryType ?? '') === 'refund' &&
    mapStatus(ledgerEntry.payoutStatus ?? '') === 'hold' &&
    ledgerEntry.settlementHoldReason === REFUND_OFFSET_REQUIRED_BEFORE_PAYOUT_REASON
  );
}

function allocationIsCancelled(entry: {
  vendorAllocation?: {
    allocationStatus?: string | null;
  } | null;
}) {
  const status = mapStatus(entry.vendorAllocation?.allocationStatus ?? '');
  return status === 'cancelled' || status === 'canceled';
}

function addPayoutAmountChangedBlocker(input: {
  blockers: PayoutBatchTransitionBlocker[];
  payoutBatchLineId: string;
  financeLedgerEntryId: string;
  expectedAmount: number;
  amountSnapshot: unknown;
}) {
  const expectedMinor = toMinorUnits(input.expectedAmount);
  const snapshotMinor = toMinorUnits(input.amountSnapshot);
  if (expectedMinor === snapshotMinor) {
    return;
  }

  input.blockers.push(buildPayoutBatchTransitionBlocker({
    code: 'payout_amount_changed_since_batch_creation',
    reason: 'Payout amount changed since batch creation.',
    payoutBatchLineId: input.payoutBatchLineId,
    financeLedgerEntryId: input.financeLedgerEntryId,
    metadata: {
      expectedAmount: toAmountString(expectedMinor / 100),
      amountSnapshot: toAmountString(snapshotMinor / 100),
    },
  }));
}

async function validatePayoutBatchBeforeTransitionWithClient(
  db: FinanceDbClient,
  payoutBatchId: string,
): Promise<void> {
  const batch = await db.payoutBatch.findUnique({
    where: {
      id: payoutBatchId,
    },
    include: {
      lines: {
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          financeLedgerEntry: {
            include: {
              vendorAllocation: {
                include: {
                  fulfillment: true,
                  refundRecords: true,
                  returnRecords: {
                    select: {
                      id: true,
                      status: true,
                      returnLifecycleStatus: true,
                      sourceShopifyRefundId: true,
                    },
                  },
                  financeEntries: {
                    where: activeFinanceLedgerWhere,
                    select: {
                      id: true,
                      entryType: true,
                      payoutStatus: true,
                      settlementStatus: true,
                      settlementHoldReason: true,
                      commissionPercentSnapshot: true,
                      commissionVatPercentSnapshot: true,
                      payoutBatchLines: {
                        where: {
                          payoutBatch: {
                            status: {
                              in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                            },
                          },
                        },
                        select: {
                          payoutBatch: {
                            select: {
                              id: true,
                              status: true,
                            },
                          },
                        },
                      },
                      settlementApprovalLines: {
                        where: {
                          settlementApproval: {
                            status: {
                              in: ['DRAFT', 'APPROVED'],
                            },
                          },
                        },
                        select: {
                          settlementApproval: {
                            select: {
                              id: true,
                              status: true,
                            },
                          },
                        },
                      },
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
                  payoutBatch: {
                    select: {
                      id: true,
                      status: true,
                    },
                  },
                },
              },
              settlementApprovalLines: {
                where: {
                  settlementApproval: {
                    status: {
                      in: ['DRAFT', 'APPROVED'],
                    },
                  },
                },
                select: {
                  settlementApproval: {
                    select: {
                      id: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!batch) {
    throw new Error('Payout batch not found.');
  }

  const storedProfile = await db.vendorFinancialProfile.findFirst({
    where: {
      vendorId: batch.vendorId,
      active: true,
    },
  });
  const profile = mapProfile(storedProfile, batch.vendorId);
  const blockers: PayoutBatchTransitionBlocker[] = [];

  for (const line of batch.lines) {
    const ledgerEntry = line.financeLedgerEntry;
    if (!ledgerEntry) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'ledger_row_missing',
        reason: 'Ledger row no longer exists.',
        payoutBatchLineId: line.id,
        financeLedgerEntryId: line.financeLedgerEntryId,
      }));
      continue;
    }

    const transitionEntry = stripCurrentPayoutBatchEvidence(ledgerEntry, batch.id);
    const ledgerEntryId = ledgerEntry.id;
    const type = normalizeType(transitionEntry.entryType);
    const payoutStatus = mapStatus(transitionEntry.payoutStatus ?? '');
    const vendorAllocationId = ledgerEntry.vendorAllocation?.id ?? ledgerEntry.vendorAllocationId ?? null;

    if (vendorAllocationId) {
      const blockingAlerts = await findBlockingFinanceIntegrityAlerts({ vendorAllocationId }, db);
      for (const alert of blockingAlerts) {
        blockers.push(buildPayoutBatchTransitionBlocker({
          code: 'finance_integrity_alert_open',
          reason: `Money movement blocked by blocking finance integrity alert: ${alert.category}.`,
          payoutBatchLineId: line.id,
          financeLedgerEntryId: ledgerEntryId,
          metadata: {
            alertCategory: alert.category,
            alertSeverity: alert.severity,
            alertReason: alert.reason,
            dedupeKey: alert.dedupeKey,
            vendorAllocationId: alert.vendorAllocationId,
            allocationEconomicTransferId: alert.allocationEconomicTransferId,
          },
        }));
      }
    }

    if (isLedgerVoided(ledgerEntry)) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'ledger_row_voided',
        reason: 'Ledger row has been voided or superseded and cannot move through payout.',
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
        metadata: {
          voidedAt: ledgerEntry.voidedAt?.toISOString?.() ?? String(ledgerEntry.voidedAt),
          voidReason: ledgerEntry.voidReason,
          supersededByLedgerId: ledgerEntry.supersededByLedgerId,
        },
      }));
    }

    if (payoutStatus === 'paid') {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'ledger_row_paid',
        reason: 'Ledger row already paid.',
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
      }));
    }

    const lateRefundRecords = hasRefundRecordCreatedAfterBatch(transitionEntry, batch.createdAt);
    if (lateRefundRecords.length > 0) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'refund_arrived_after_batch_creation',
        reason: 'Refund arrived after payout batch creation.',
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
        metadata: {
          refundRecordIds: lateRefundRecords.map((refundRecord) => refundRecord.sourceShopifyRefundId ?? refundRecord.id),
        },
      }));
    }

    const refundHoldEntries = getRefundOffsetRequiredLedgerEntries(transitionEntry);
    if (refundHoldEntries.length > 0) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'refund_offset_required_before_payout',
        reason: REFUND_OFFSET_REQUIRED_BEFORE_PAYOUT_REASON,
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
        metadata: {
          refundLedgerEntryIds: refundHoldEntries.map((refundEntry) => refundEntry.id).filter(Boolean),
        },
      }));
    }

    if (hasApprovedOpenReturnHold(transitionEntry)) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'approved_return_hold_active',
        reason: 'Approved return hold is active.',
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
      }));
    }

    if (hasActiveVendorBlockedFinanceHold(transitionEntry.vendorAllocation)) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'vendor_blocked_finance_hold_active',
        reason: VENDOR_BLOCKED_FINANCE_HOLD_REASON,
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
        metadata: {
          allocationStatus: transitionEntry.vendorAllocation?.allocationStatus ?? null,
        },
      }));
    }

    const cancelRefundReviewActive = hasBlockingCancelRefundReviewStatus(transitionEntry.vendorAllocation);
    if (cancelRefundReviewActive) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'cancel_refund_review_active',
        reason: CANCEL_REFUND_REVIEW_HOLD_REASON,
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
        metadata: {
          cancelRefundReviewStatus: transitionEntry.vendorAllocation?.cancelRefundReviewStatus ?? null,
        },
      }));
    }

    if (
      (type !== 'sale' && type !== 'refund') ||
      allocationIsCancelled(transitionEntry) ||
      (payoutStatus === 'hold' && transitionEntry.settlementHoldReason !== REFUND_OFFSET_REQUIRED_BEFORE_PAYOUT_REASON) ||
      (!cancelRefundReviewActive && !isEntryEligibleForPayoutBatch(transitionEntry))
    ) {
      blockers.push(buildPayoutBatchTransitionBlocker({
        code: 'ledger_row_no_longer_eligible',
        reason: 'Ledger row is no longer eligible for payout.',
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
        metadata: {
          entryType: transitionEntry.entryType,
          payoutStatus: transitionEntry.payoutStatus,
          settlementStatus: transitionEntry.settlementStatus,
          settlementHoldReason: transitionEntry.settlementHoldReason,
        },
      }));
    }

    if (type === 'sale' || type === 'refund') {
      addPayoutAmountChangedBlocker({
        blockers,
        payoutBatchLineId: line.id,
        financeLedgerEntryId: ledgerEntryId,
        expectedAmount: calculateEntryBatchAmounts(transitionEntry, profile).netAmount,
        amountSnapshot: line.amountSnapshot,
      });
    }
  }

  if (blockers.length > 0) {
    throw new PayoutBatchTransitionRevalidationError(blockers);
  }
}

export async function validatePayoutBatchBeforeTransition(payoutBatchId: string): Promise<void> {
  return prisma.$transaction(async (tx) => validatePayoutBatchBeforeTransitionWithClient(tx, payoutBatchId));
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
  return prisma.$transaction(async (tx) => {
    await validatePayoutBatchBeforeTransitionWithClient(tx, batchId);

    const batch = await tx.payoutBatch.update({
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
  });
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

function normalizeSettlementDelayDaysInput(value: number | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 0 || value > 365) {
    throw new Error('Settlement delay days must be between 0 and 365.');
  }
  return Math.round(value);
}

function normalizeSettlementFrequencyTypeInput(
  value: VendorFinancialProfileUpdateDto['settlementFrequencyType'],
  fallback: VendorFinancialProfileDto['settlementFrequencyType'],
) {
  if (value === undefined) {
    return fallback;
  }
  if (!SUPPORTED_SETTLEMENT_FREQUENCY_TYPES.has(value)) {
    throw new Error('settlementFrequencyType must be WEEKLY or BIWEEKLY.');
  }
  return value;
}

function normalizeWeeklySettlementDayInput(
  value: VendorFinancialProfileUpdateDto['weeklySettlementDay'],
  fallback: VendorFinancialProfileDto['weeklySettlementDay'],
) {
  if (value === undefined) {
    return fallback;
  }
  if (!SUPPORTED_SETTLEMENT_WEEKDAYS.has(value)) {
    throw new Error('weeklySettlementDay must be MONDAY, TUESDAY, WEDNESDAY, THURSDAY, or FRIDAY.');
  }
  return value;
}

export async function upsertVendorFinancialProfile(
  vendorId: string,
  input: VendorFinancialProfileUpdateDto,
  auditContext: {
    actor?: VendorProfileAuditActor | null;
    reason?: string | null;
    source?: string;
  } = {},
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
  const settlementDelayDays = normalizeSettlementDelayDaysInput(
    input.settlementDelayDays,
    existing.settlementDelayDays ?? DEFAULT_SETTLEMENT_DELAY_DAYS,
  );
  const settlementFrequencyType = normalizeSettlementFrequencyTypeInput(
    input.settlementFrequencyType,
    existing.settlementFrequencyType ?? DEFAULT_SETTLEMENT_FREQUENCY_TYPE,
  );
  const weeklySettlementDay = normalizeWeeklySettlementDayInput(
    input.weeklySettlementDay,
    existing.weeklySettlementDay ?? DEFAULT_WEEKLY_SETTLEMENT_DAY,
  );

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
      settlementDelayDays,
      settlementFrequencyType,
      weeklySettlementDay,
      autoSettlementDraftEnabled: input.autoSettlementDraftEnabled ?? existing.autoSettlementDraftEnabled,
      autoSettlementApproveEnabled: input.autoSettlementApproveEnabled ?? existing.autoSettlementApproveEnabled,
      autoSettlementInvoiceEnabled: input.autoSettlementInvoiceEnabled ?? existing.autoSettlementInvoiceEnabled,
      active: input.active ?? true,
    },
    create: {
      vendorId,
      commissionPercent,
      commissionVatPercent,
      deductShippingEnabled: input.deductShippingEnabled ?? existing.deductShippingEnabled,
      shippingMode: shippingMode.toUpperCase() as 'DISABLED' | 'FIXED' | 'EXTERNAL_PROVIDER',
      fixedShippingFee,
      settlementDelayDays,
      settlementFrequencyType,
      weeklySettlementDay,
      autoSettlementDraftEnabled: input.autoSettlementDraftEnabled ?? existing.autoSettlementDraftEnabled,
      autoSettlementApproveEnabled: input.autoSettlementApproveEnabled ?? existing.autoSettlementApproveEnabled,
      autoSettlementInvoiceEnabled: input.autoSettlementInvoiceEnabled ?? existing.autoSettlementInvoiceEnabled,
      active: input.active ?? true,
    },
  });

  const mappedProfile = mapProfile(profile, vendorId);
  await auditVendorProfileChanges({
    vendorId,
    section: 'finance_policy',
    before: existing as unknown as Record<string, unknown>,
    after: mappedProfile as unknown as Record<string, unknown>,
    fields: [
      'commissionPercent',
      'commissionVatPercent',
      'deductShippingEnabled',
      'shippingMode',
      'fixedShippingFee',
      'settlementDelayDays',
      'settlementFrequencyType',
      'weeklySettlementDay',
      'autoSettlementDraftEnabled',
      'autoSettlementApproveEnabled',
      'autoSettlementInvoiceEnabled',
      'active',
    ],
    actor: auditContext.actor,
    reason: auditContext.reason,
    source: auditContext.source ?? 'admin_finance_policy_update',
  });

  return mappedProfile;
}
