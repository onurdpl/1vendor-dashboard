import {
  FinanceEventType,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  SettlementStatus,
  ShippingDeductionMode,
  type FinanceLedgerEntry,
  type Prisma,
} from '@prisma/client';
import { createEventsIdempotently } from './finance-event.service.js';
import { assertLedgerActiveForMoneyMovement } from './active-ledger-policy.service.js';
import {
  evaluateSaleSettlementDelay,
  normalizeSettlementDelayDays,
} from './settlement-delay-eligibility.service.js';

type FinanceLedgerTransaction = Prisma.TransactionClient;

const SALE_LEDGER_IMMUTABLE_UPDATE_BLOCKED_RULE_KEY = 'sale_ledger_immutable_update_blocked';
const SALE_LEDGER_IMMUTABILITY_CHECK_FAILED_RULE_KEY = 'sale_ledger_immutability_check_failed';

const INITIAL_PAYOUT_STATUSES = new Set(['', 'PENDING']);
const INITIAL_SETTLEMENT_STATUSES = new Set(['', 'PENDING', 'ACCRUING']);

const PROTECTED_UPDATE_FIELDS = [
  'vendorAllocationId',
  'vendorId',
  'entryType',
  'amount',
  'payoutStatus',
  'settlementStatus',
  'settlementHoldReason',
  'accruedAt',
  'payableAt',
  'settlementEligibleAt',
] as const;

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: number) {
  return Math.round(value * 100);
}

function normalizeStatus(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function comparableValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && 'toISOString' in value && typeof value.toISOString === 'function') {
    return value.toISOString();
  }
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
}

function buildProtectedFieldDiff(
  existingLedger: FinanceLedgerEntry,
  updateData: Prisma.FinanceLedgerEntryUncheckedUpdateInput,
) {
  return PROTECTED_UPDATE_FIELDS.flatMap((field) => {
    if (!(field in updateData)) {
      return [];
    }
    const oldValue = field === 'amount'
      ? toAmountString(toNumber(existingLedger[field]))
      : comparableValue(existingLedger[field]);
    const newValue = field === 'amount'
      ? toAmountString(toNumber(updateData[field as keyof typeof updateData]))
      : comparableValue(updateData[field as keyof typeof updateData]);
    if (oldValue === newValue) {
      return [];
    }
    return [{
      field,
      oldValue,
      newValue,
    }];
  });
}

function hasNonInitialLedgerStatus(ledger: FinanceLedgerEntry) {
  const payoutStatus = normalizeStatus(ledger.payoutStatus);
  const settlementStatus = normalizeStatus(ledger.settlementStatus);

  return (
    !INITIAL_PAYOUT_STATUSES.has(payoutStatus) ||
    !INITIAL_SETTLEMENT_STATUSES.has(settlementStatus) ||
    Boolean(ledger.settlementHoldReason) ||
    Boolean(ledger.settledAt)
  );
}

async function loadSaleLedgerLockingEvidence(
  tx: FinanceLedgerTransaction,
  input: {
    ledger: FinanceLedgerEntry;
    allocationId: string;
  },
) {
  const [
    financeEventCount,
    settlementApprovalLineCount,
    payoutBatchLineCount,
    vendorBalanceEventCount,
    refundRecordCount,
    refundLedgerCount,
  ] = await Promise.all([
    tx.financeEvent.count({
      where: {
        financeLedgerEntryId: input.ledger.id,
      },
    }),
    tx.settlementApprovalLine.count({
      where: {
        financeLedgerEntryId: input.ledger.id,
      },
    }),
    tx.payoutBatchLine.count({
      where: {
        financeLedgerEntryId: input.ledger.id,
      },
    }),
    tx.vendorBalanceEvent.count({
      where: {
        financeLedgerEntryId: input.ledger.id,
      },
    }),
    tx.refundRecord.count({
      where: {
        vendorAllocationId: input.allocationId,
      },
    }),
    tx.financeLedgerEntry.count({
      where: {
        vendorAllocationId: input.allocationId,
        entryType: 'refund',
        voidedAt: null,
      },
    }),
  ]);

  const statusLocked = hasNonInitialLedgerStatus(input.ledger);
  const reasons = [
    financeEventCount > 0 ? 'finance_events_exist' : null,
    settlementApprovalLineCount > 0 ? 'settlement_approval_lines_exist' : null,
    payoutBatchLineCount > 0 ? 'payout_batch_lines_exist' : null,
    vendorBalanceEventCount > 0 ? 'vendor_balance_events_exist' : null,
    refundRecordCount > 0 ? 'refund_records_exist' : null,
    refundLedgerCount > 0 ? 'refund_ledgers_exist' : null,
    statusLocked ? 'ledger_status_is_not_initial' : null,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    locked: reasons.length > 0,
    reasons,
    counts: {
      financeEvents: financeEventCount,
      settlementApprovalLines: settlementApprovalLineCount,
      payoutBatchLines: payoutBatchLineCount,
      vendorBalanceEvents: vendorBalanceEventCount,
      refundRecords: refundRecordCount,
      refundLedgers: refundLedgerCount,
    },
    status: {
      payoutStatus: input.ledger.payoutStatus,
      settlementStatus: input.ledger.settlementStatus,
      settlementHoldReason: input.ledger.settlementHoldReason,
      settledAt: input.ledger.settledAt?.toISOString() ?? null,
    },
  };
}

async function upsertSaleLedgerImmutabilitySignal(
  tx: FinanceLedgerTransaction,
  input: {
    ruleKey: typeof SALE_LEDGER_IMMUTABLE_UPDATE_BLOCKED_RULE_KEY | typeof SALE_LEDGER_IMMUTABILITY_CHECK_FAILED_RULE_KEY;
    ledger: FinanceLedgerEntry;
    allocation: {
      id: string;
      assignedVendorId: string;
      order: {
        id: string;
        sourceShopifyOrderId: string;
        sourceShopifyOrderNumber: string;
      };
    };
    attemptedDiff: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
    reason: string;
    evidence?: unknown;
  },
) {
  const triggeredAt = new Date();
  const isCheckFailure = input.ruleKey === SALE_LEDGER_IMMUTABILITY_CHECK_FAILED_RULE_KEY;
  const title = isCheckFailure
    ? 'Sale ledger immutability check failed'
    : 'Sale ledger immutable update blocked';
  const description = isCheckFailure
    ? 'A sale ledger replay could not verify downstream financial evidence, so the existing ledger was preserved.'
    : 'A sale ledger replay attempted to change material financial fields after downstream evidence existed. The existing ledger was preserved.';
  const metadata = {
    reason: input.reason,
    ledgerId: input.ledger.id,
    allocationId: input.allocation.id,
    orderId: input.allocation.order.id,
    sourceShopifyOrderId: input.allocation.order.sourceShopifyOrderId,
    sourceShopifyOrderNumber: input.allocation.order.sourceShopifyOrderNumber,
    attemptedChangedFields: input.attemptedDiff.map((diff) => diff.field),
    attemptedDiff: input.attemptedDiff,
    evidence: input.evidence ?? null,
    checkedAt: triggeredAt.toISOString(),
  } as Prisma.InputJsonObject;

  await tx.operationalSignal.upsert({
    where: {
      id: `finance:${input.ruleKey}:${input.ledger.id}`,
    },
    update: {
      type: 'finance_integrity',
      severity: isCheckFailure ? OperationalSignalSeverity.HIGH : OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.SETTLEMENT,
      vendorId: input.allocation.assignedVendorId,
      allocationId: input.allocation.id,
      financeLedgerEntryId: input.ledger.id,
      title,
      description,
      suggestedAction: 'Review the ledger diff and downstream finance evidence before applying any manual correction.',
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: input.ruleKey,
      triggeredAt,
      resolvedAt: null,
      metadata,
    },
    create: {
      id: `finance:${input.ruleKey}:${input.ledger.id}`,
      type: 'finance_integrity',
      severity: isCheckFailure ? OperationalSignalSeverity.HIGH : OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.SETTLEMENT,
      vendorId: input.allocation.assignedVendorId,
      allocationId: input.allocation.id,
      financeLedgerEntryId: input.ledger.id,
      title,
      description,
      suggestedAction: 'Review the ledger diff and downstream finance evidence before applying any manual correction.',
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: input.ruleKey,
      triggeredAt,
      metadata,
    },
  });
}

export function buildSaleLedgerEntryId(vendorId: string, sourceShopifyOrderId: string, vendorAllocationId: string) {
  return `fin-${vendorId}-sale-${sourceShopifyOrderId}-${vendorAllocationId}`;
}

function mapShippingModeSnapshot(mode: string | null | undefined) {
  const normalized = mode?.trim().toUpperCase();
  if (normalized === 'FIXED') {
    return ShippingDeductionMode.FIXED;
  }
  if (normalized === 'EXTERNAL_PROVIDER') {
    return ShippingDeductionMode.EXTERNAL_PROVIDER;
  }
  return ShippingDeductionMode.DISABLED;
}

function isFulfilledForSettlement(allocation: {
  shippingStatus?: string | null;
}) {
  return Boolean(allocation.shippingStatus?.trim().toLowerCase().includes('delivered'));
}

export async function upsertSaleLedgerForAllocation(
  tx: FinanceLedgerTransaction,
  allocationId: string,
) {
  const allocation = await tx.vendorAllocation.findUnique({
    where: {
      id: allocationId,
    },
    include: {
      order: true,
      lineItems: true,
      fulfillment: true,
    },
  });

  if (!allocation) {
    throw new Error(`Cannot create sale ledger entry for missing allocation ${allocationId}.`);
  }

  const amount = allocation.lineItems.reduce((sum, lineItem) => sum + toNumber(lineItem.lineAmount), 0);
  const ledgerId = buildSaleLedgerEntryId(allocation.assignedVendorId, allocation.order.sourceShopifyOrderId, allocation.id);
  const existingLedgerEntry = await tx.financeLedgerEntry.findUnique({
    where: {
      id: ledgerId,
    },
  });
  assertLedgerActiveForMoneyMovement(
    existingLedgerEntry,
    `Sale ledger ${ledgerId} has been voided or superseded and cannot be repaired by order replay.`,
  );
  const activeProfile = await tx.vendorFinancialProfile.findFirst({
    where: {
      vendorId: allocation.assignedVendorId,
      active: true,
    },
  });
  const confirmedShippingCost = await tx.shipmentShippingCost.findFirst({
    where: {
      vendorId: allocation.assignedVendorId,
      allocationId: allocation.id,
      status: 'CONFIRMED',
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
  const profileSnapshot = {
    commissionPercentSnapshot: activeProfile?.commissionPercent ?? '10.00',
    commissionVatPercentSnapshot: activeProfile?.commissionVatPercent ?? '0.00',
    deductShippingEnabledSnapshot: activeProfile?.deductShippingEnabled ?? false,
    shippingModeSnapshot: mapShippingModeSnapshot(activeProfile?.shippingMode),
    fixedShippingFeeSnapshot: activeProfile?.fixedShippingFee ?? null,
    shippingCostSnapshot: confirmedShippingCost?.shippingCost ?? null,
    shippingVatAmountSnapshot: confirmedShippingCost?.shippingVatAmount ?? null,
    shippingCostSourceSnapshot: confirmedShippingCost?.sourceType ?? null,
    shippingCostProviderSnapshot: confirmedShippingCost?.providerName ?? null,
    shippingCostIdSnapshot: confirmedShippingCost?.id ?? null,
    financialProfileIdSnapshot: activeProfile?.id ?? null,
    settlementDelayDaysSnapshot: normalizeSettlementDelayDays(activeProfile?.settlementDelayDays),
  };
  const fulfilled = isFulfilledForSettlement(allocation);
  const settlementTiming = evaluateSaleSettlementDelay({
    entryType: 'sale',
    settlementDelayDaysSnapshot: profileSnapshot.settlementDelayDaysSnapshot,
    vendorAllocation: allocation,
  });
  const payableAt = fulfilled ? settlementTiming.eligibleAt : null;
  const settlementFields = {
    settlementStatus: fulfilled && settlementTiming.eligible ? SettlementStatus.PAYABLE : SettlementStatus.ACCRUING,
    accruedAt: allocation.createdAt,
    payableAt,
    settlementEligibleAt: payableAt,
  };
  const ledgerUpdateData = {
    vendorAllocationId: allocation.id,
    vendorId: allocation.assignedVendorId,
    entryType: 'sale',
    amount: toAmountString(amount),
    payoutStatus: 'PENDING',
    description: `Allocated sale for Shopify order ${allocation.order.sourceShopifyOrderNumber}`,
    ...settlementFields,
  } satisfies Prisma.FinanceLedgerEntryUncheckedUpdateInput;

  if (existingLedgerEntry) {
    const attemptedDiff = buildProtectedFieldDiff(existingLedgerEntry, ledgerUpdateData);
    if (attemptedDiff.length === 0) {
      return existingLedgerEntry;
    }

    let evidence: Awaited<ReturnType<typeof loadSaleLedgerLockingEvidence>>;
    try {
      evidence = await loadSaleLedgerLockingEvidence(tx, {
        ledger: existingLedgerEntry,
        allocationId: allocation.id,
      });
    } catch (error) {
      await upsertSaleLedgerImmutabilitySignal(tx, {
        ruleKey: SALE_LEDGER_IMMUTABILITY_CHECK_FAILED_RULE_KEY,
        ledger: existingLedgerEntry,
        allocation,
        attemptedDiff,
        reason: error instanceof Error ? error.message : 'Sale ledger downstream evidence check failed.',
      });
      return existingLedgerEntry;
    }

    if (evidence.locked) {
      await upsertSaleLedgerImmutabilitySignal(tx, {
        ruleKey: SALE_LEDGER_IMMUTABLE_UPDATE_BLOCKED_RULE_KEY,
        ledger: existingLedgerEntry,
        allocation,
        attemptedDiff,
        reason: 'downstream_financial_evidence_exists',
        evidence,
      });
      return existingLedgerEntry;
    }

    return tx.financeLedgerEntry.update({
      where: {
        id: ledgerId,
      },
      data: ledgerUpdateData,
    });
  }

  const ledgerEntry = await tx.financeLedgerEntry.create({
    data: {
      id: ledgerId,
      vendorAllocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      entryType: 'sale',
      amount: toAmountString(amount),
      payoutStatus: 'PENDING',
      description: `Allocated sale for Shopify order ${allocation.order.sourceShopifyOrderNumber}`,
      ...profileSnapshot,
      ...settlementFields,
    },
  });

  const grossMinor = toMinorUnits(amount);
  const commissionPercent = toNumber(profileSnapshot.commissionPercentSnapshot);
  const commissionVatPercent = toNumber(profileSnapshot.commissionVatPercentSnapshot);
  const commissionMinor = Math.round(grossMinor * (Math.max(commissionPercent, 0) / 100));
  const commissionVatMinor = Math.round(commissionMinor * (Math.max(commissionVatPercent, 0) / 100));
  const vendorPayableMinor = grossMinor - commissionMinor - commissionVatMinor;
  const baseEvent = {
    vendorId: allocation.assignedVendorId,
    shopifyOrderId: allocation.order.id,
    financeLedgerEntryId: ledgerId,
    currency: allocation.order.currency ?? 'TRY',
    referenceType: 'shopify_order_allocation',
    referenceId: allocation.id,
    createdBy: 'system:shopify_orders_create',
    metadataJson: {
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
      vendorAllocationId: allocation.id,
      financeLedgerEntryId: ledgerId,
      commissionPercentSnapshot: commissionPercent,
      commissionVatPercentSnapshot: commissionVatPercent,
    },
  };

  await createEventsIdempotently(
    [
      {
        ...baseEvent,
        eventType: FinanceEventType.SALE_RECORDED,
        amountMinor: grossMinor,
        idempotencyKey: `${ledgerId}:SALE_RECORDED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.COMMISSION_RESERVED,
        amountMinor: commissionMinor,
        idempotencyKey: `${ledgerId}:COMMISSION_RESERVED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.COMMISSION_VAT_RESERVED,
        amountMinor: commissionVatMinor,
        idempotencyKey: `${ledgerId}:COMMISSION_VAT_RESERVED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.VENDOR_PAYABLE_RESERVED,
        amountMinor: vendorPayableMinor,
        idempotencyKey: `${ledgerId}:VENDOR_PAYABLE_RESERVED`,
      },
    ],
    tx,
  );

  return ledgerEntry;
}

export const __saleLedgerTesting = {
  buildSaleLedgerEntryId,
};
