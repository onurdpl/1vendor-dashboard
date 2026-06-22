import {
  AllocationStatus,
  FinanceEventType,
  PayoutStatus,
  Prisma,
  SettlementCommissionInvoiceStatus,
  SettlementStatus,
  ShipmentExecutionStatus,
  ShippingDeductionMode,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { createEventsIdempotently } from './finance-event.service.js';
import {
  assertNoOpenFinanceIntegrityAlertForMoneyMovement,
  createOrUpdateAlert,
  financeIntegrityAlertDedupeKey,
} from './finance-integrity-alert.service.js';
import {
  evaluateSaleSettlementDelay,
  normalizeSettlementDelayDays,
} from './settlement-delay-eligibility.service.js';

export type TransferAllocationEconomicsInput = {
  vendorAllocationId: string;
  toVendorId: string;
  adminUserId?: string | null;
  reason: string;
  confirmTransfer: true;
};

export type EconomicTransferResult = {
  transferId: string;
  fromVendorId: string;
  toVendorId: string;
  sourceLedgerId: string;
  targetLedgerId: string;
  allocationId: string;
  status: 'COMPLETED';
};

export class EconomicTransferValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'EconomicTransferValidationError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, EconomicTransferValidationError.prototype);
  }
}

type EconomicTransferDb = Pick<
  Prisma.TransactionClient,
  | 'vendor'
  | 'vendorAllocation'
  | 'allocationEconomicTransfer'
  | 'financeLedgerEntry'
  | 'vendorFinancialProfile'
  | 'shipmentShippingCost'
  | 'allocationAssignmentHistory'
  | 'financeEvent'
  | 'financeIntegrityAlert'
> & {
  $transaction?: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
};

const ACTIVE_TRANSFER_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'PROCESSING', 'STARTED']);
const FAILED_TRANSFER_STATUSES = new Set(['FAILED', 'FAILURE', 'ERROR']);
const COMPLETED_TRANSFER_STATUSES = new Set(['COMPLETED']);
const SHIPPED_STATUS_VALUES = new Set(['shipped', 'delivered', 'in transit', 'in_transit', 'label created', 'label_created']);
const FULFILLED_STATUS_VALUES = new Set(['fulfilled', 'partially fulfilled', 'partially_fulfilled']);
const MAX_REASON_LENGTH = 500;

type LoadedAllocation = Awaited<ReturnType<typeof loadAllocationForTransfer>>;
type LoadedSaleLedger = NonNullable<LoadedAllocation>['financeEntries'][number];

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeStatus(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeTransferStatus(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeReason(reason: string | null | undefined) {
  const trimmed = normalizeText(reason);
  if (!trimmed) {
    throw new EconomicTransferValidationError('Economic transfer reason is required.');
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new EconomicTransferValidationError('Economic transfer reason must be 500 characters or fewer.');
  }
  return trimmed;
}

function assertConfirmed(confirmTransfer: boolean | undefined) {
  if (confirmTransfer !== true) {
    throw new EconomicTransferValidationError('Economic transfer requires explicit confirmation.');
  }
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: unknown) {
  return Math.round(toNumber(value) * 100);
}

function toAmountString(value: unknown) {
  return toNumber(value).toFixed(2);
}

function buildSaleLedgerEntryId(vendorId: string, sourceShopifyOrderId: string) {
  return `fin-${vendorId}-sale-${sourceShopifyOrderId}`;
}

function buildIdempotencyKey(input: {
  vendorAllocationId: string;
  fromVendorId: string;
  toVendorId: string;
}) {
  return `economic-transfer:${input.vendorAllocationId}:${input.fromVendorId}:${input.toVendorId}`;
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

function hasShipmentExecutionEvidence(execution: {
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shipmentStatus: ShipmentExecutionStatus;
}) {
  if (execution.providerShipmentId?.trim() || execution.trackingNumber?.trim() || execution.trackingUrl?.trim()) {
    return true;
  }
  return execution.shipmentStatus !== ShipmentExecutionStatus.FAILED && execution.shipmentStatus !== ShipmentExecutionStatus.CANCELLED;
}

function hasShipmentEvidence(allocation: NonNullable<LoadedAllocation>) {
  if (FULFILLED_STATUS_VALUES.has(normalizeStatus(allocation.fulfillmentStatus))) {
    return true;
  }
  if (SHIPPED_STATUS_VALUES.has(normalizeStatus(allocation.shippingStatus))) {
    return true;
  }
  if (allocation.trackingNumber?.trim() || allocation.carrier?.trim()) {
    return true;
  }
  if (allocation.fulfillment) {
    return true;
  }
  return allocation.shipmentExecutions.some(hasShipmentExecutionEvidence);
}

async function loadAllocationForTransfer(
  db: EconomicTransferDb,
  vendorAllocationId: string,
) {
  return db.vendorAllocation.findUnique({
    where: { id: vendorAllocationId },
    include: {
      order: true,
      lineItems: true,
      fulfillment: true,
      shipmentExecutions: {
        orderBy: {
          createdAt: 'desc',
        },
      },
      returnRecords: true,
      refundRecords: true,
      financeEntries: {
        include: {
          payoutBatchLines: {
            include: {
              payoutBatch: true,
            },
          },
          settlementApprovalLines: {
            include: {
              settlementApproval: {
                include: {
                  commissionInvoices: true,
                },
              },
            },
          },
        },
      },
      economicTransfers: {
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  });
}

function getActiveSaleLedger(allocation: NonNullable<LoadedAllocation>) {
  const activeSaleLedgers = allocation.financeEntries.filter((entry) =>
    normalizeStatus(entry.entryType) === 'sale' && !entry.voidedAt
  );
  if (activeSaleLedgers.length === 0) {
    throw new EconomicTransferValidationError('No active sale ledger found for allocation.', 409);
  }
  if (activeSaleLedgers.length > 1) {
    throw new EconomicTransferValidationError('Multiple active sale ledgers found for allocation.', 409);
  }
  return activeSaleLedgers[0];
}

function assertNoExistingTransfers(
  allocation: NonNullable<LoadedAllocation>,
  currentTransferId: string | null,
) {
  for (const transfer of allocation.economicTransfers) {
    if (currentTransferId && transfer.id === currentTransferId) {
      continue;
    }

    const status = normalizeTransferStatus(transfer.status);
    if (ACTIVE_TRANSFER_STATUSES.has(status)) {
      throw new EconomicTransferValidationError('Economic transfer is already in progress for this allocation.', 409);
    }
    if (COMPLETED_TRANSFER_STATUSES.has(status)) {
      throw new EconomicTransferValidationError('Economic transfer already completed for this allocation.', 409);
    }
    if (FAILED_TRANSFER_STATUSES.has(status)) {
      throw new EconomicTransferValidationError('Previous economic transfer failed and must be resolved first.', 409);
    }
  }
}

function assertLedgerBlockers(sourceLedger: LoadedSaleLedger) {
  if (sourceLedger.payoutStatus === PayoutStatus.PAID) {
    throw new EconomicTransferValidationError('Economic transfer cannot run after vendor payment evidence exists.', 409);
  }
  if (sourceLedger.settlementApprovalLines.some((line) =>
    line.settlementApproval.commissionInvoices.some((invoice) => invoice.status !== SettlementCommissionInvoiceStatus.CANCELLED)
  )) {
    throw new EconomicTransferValidationError('Economic transfer cannot run after commission invoice evidence exists.', 409);
  }
  if (sourceLedger.settlementApprovalLines.length > 0) {
    throw new EconomicTransferValidationError('Economic transfer cannot run after settlement approval evidence exists.', 409);
  }
  if (sourceLedger.payoutBatchLines.some((line) => line.payoutBatch.status !== 'CANCELLED')) {
    throw new EconomicTransferValidationError('Economic transfer cannot run after payout batch evidence exists.', 409);
  }
}

function assertAllocationTransferable(input: {
  allocation: NonNullable<LoadedAllocation>;
  toVendorId: string;
  currentTransferId?: string | null;
}) {
  const { allocation, toVendorId } = input;
  if (allocation.assignedVendorId === toVendorId) {
    throw new EconomicTransferValidationError('Replacement vendor must differ from current vendor.', 409);
  }
  if (allocation.allocationStatus !== AllocationStatus.VENDOR_BLOCKED) {
    throw new EconomicTransferValidationError('Only vendor-blocked allocations can be economically transferred.', 409);
  }
  if (!allocation.reassignmentRequired) {
    throw new EconomicTransferValidationError('Allocation is not marked for reassignment review.', 409);
  }
  if (hasShipmentEvidence(allocation)) {
    throw new EconomicTransferValidationError('Economic transfer cannot run after fulfillment, shipment, carrier, or tracking evidence exists.', 409);
  }
  if (allocation.returnRecords.length > 0) {
    throw new EconomicTransferValidationError('Economic transfer cannot run after return evidence exists.', 409);
  }
  if (allocation.refundRecords.length > 0) {
    throw new EconomicTransferValidationError('Economic transfer cannot run after refund evidence exists.', 409);
  }
  assertNoExistingTransfers(allocation, input.currentTransferId ?? null);
  return getActiveSaleLedger(allocation);
}

function buildPricingSnapshot(input: {
  sourceLedger: LoadedSaleLedger;
  fromVendorId: string;
  toVendorId: string;
}) {
  const { sourceLedger, fromVendorId, toVendorId } = input;
  return {
    sourceLedgerId: sourceLedger.id,
    fromVendorId,
    toVendorId,
    amount: toAmountString(sourceLedger.amount),
    entryType: sourceLedger.entryType,
    payoutStatus: sourceLedger.payoutStatus,
    settlementStatus: sourceLedger.settlementStatus,
    commissionPercentSnapshot: sourceLedger.commissionPercentSnapshot?.toString() ?? null,
    commissionVatPercentSnapshot: sourceLedger.commissionVatPercentSnapshot?.toString() ?? null,
    settlementDelayDaysSnapshot: sourceLedger.settlementDelayDaysSnapshot,
    financialProfileIdSnapshot: sourceLedger.financialProfileIdSnapshot,
  };
}

function buildTransferResult(transfer: {
  id: string;
  fromVendorId: string;
  toVendorId: string;
  fromFinanceLedgerEntryId: string | null;
  toFinanceLedgerEntryId: string | null;
  vendorAllocationId: string;
  status: string;
}): EconomicTransferResult {
  if (
    normalizeTransferStatus(transfer.status) !== 'COMPLETED' ||
    !transfer.fromFinanceLedgerEntryId ||
    !transfer.toFinanceLedgerEntryId
  ) {
    throw new EconomicTransferValidationError('Economic transfer is not complete.', 409);
  }

  return {
    transferId: transfer.id,
    fromVendorId: transfer.fromVendorId,
    toVendorId: transfer.toVendorId,
    sourceLedgerId: transfer.fromFinanceLedgerEntryId,
    targetLedgerId: transfer.toFinanceLedgerEntryId,
    allocationId: transfer.vendorAllocationId,
    status: 'COMPLETED',
  };
}

async function createTargetSaleLedger(input: {
  tx: Prisma.TransactionClient;
  allocation: NonNullable<LoadedAllocation>;
  sourceLedger: LoadedSaleLedger;
  toVendorId: string;
  transferId: string;
  reason: string;
}) {
  const { tx, allocation, sourceLedger, toVendorId, transferId, reason } = input;
  const targetLedgerId = buildSaleLedgerEntryId(toVendorId, allocation.order.sourceShopifyOrderId);
  const existingTarget = await tx.financeLedgerEntry.findUnique({
    where: {
      id: targetLedgerId,
    },
    select: {
      id: true,
    },
  });
  if (existingTarget) {
    throw new EconomicTransferValidationError('Target vendor sale ledger already exists for this allocation.', 409);
  }

  const activeProfile = await tx.vendorFinancialProfile.findFirst({
    where: {
      vendorId: toVendorId,
      active: true,
    },
  });
  const confirmedShippingCost = await tx.shipmentShippingCost.findFirst({
    where: {
      vendorId: toVendorId,
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
    accruedAt: sourceLedger.accruedAt ?? allocation.createdAt,
    payableAt,
    settlementEligibleAt: payableAt,
    settlementHoldReason: null,
    settledAt: null,
  };

  const ledgerEntry = await tx.financeLedgerEntry.create({
    data: {
      id: targetLedgerId,
      vendorAllocationId: allocation.id,
      vendorId: toVendorId,
      entryType: 'sale',
      amount: sourceLedger.amount,
      payoutStatus: PayoutStatus.PENDING,
      description: sourceLedger.description ?? `Allocated sale for Shopify order ${allocation.order.sourceShopifyOrderNumber}`,
      ...profileSnapshot,
      ...settlementFields,
    },
  });

  const grossMinor = toMinorUnits(sourceLedger.amount);
  const commissionPercent = toNumber(profileSnapshot.commissionPercentSnapshot);
  const commissionVatPercent = toNumber(profileSnapshot.commissionVatPercentSnapshot);
  const commissionMinor = Math.round(grossMinor * (Math.max(commissionPercent, 0) / 100));
  const commissionVatMinor = Math.round(commissionMinor * (Math.max(commissionVatPercent, 0) / 100));
  const vendorPayableMinor = grossMinor - commissionMinor - commissionVatMinor;
  const baseEvent = {
    vendorId: toVendorId,
    shopifyOrderId: allocation.order.id,
    financeLedgerEntryId: targetLedgerId,
    currency: allocation.order.currency ?? 'TRY',
    referenceType: 'allocation_economic_transfer',
    referenceId: transferId,
    createdBy: 'system:economic_transfer',
    metadataJson: {
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
      vendorAllocationId: allocation.id,
      financeLedgerEntryId: targetLedgerId,
      sourceFinanceLedgerEntryId: sourceLedger.id,
      allocationEconomicTransferId: transferId,
      transferReason: reason,
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
        idempotencyKey: `${targetLedgerId}:SALE_RECORDED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.COMMISSION_RESERVED,
        amountMinor: commissionMinor,
        idempotencyKey: `${targetLedgerId}:COMMISSION_RESERVED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.COMMISSION_VAT_RESERVED,
        amountMinor: commissionVatMinor,
        idempotencyKey: `${targetLedgerId}:COMMISSION_VAT_RESERVED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.VENDOR_PAYABLE_RESERVED,
        amountMinor: vendorPayableMinor,
        idempotencyKey: `${targetLedgerId}:VENDOR_PAYABLE_RESERVED`,
      },
    ],
    tx,
  );

  return ledgerEntry;
}

async function validatePreflight(input: {
  db: EconomicTransferDb;
  vendorAllocationId: string;
  toVendorId: string;
}) {
  const [toVendor, allocation] = await Promise.all([
    input.db.vendor.findUnique({
      where: {
        id: input.toVendorId,
      },
      select: {
        id: true,
      },
    }),
    loadAllocationForTransfer(input.db, input.vendorAllocationId),
  ]);

  if (!toVendor) {
    throw new EconomicTransferValidationError('Replacement vendor was not found.', 404);
  }
  if (!allocation) {
    throw new EconomicTransferValidationError('Allocation not found.', 404);
  }

  if (allocation.assignedVendorId === input.toVendorId) {
    const completed = allocation.economicTransfers.find((transfer) =>
      transfer.toVendorId === input.toVendorId && normalizeTransferStatus(transfer.status) === 'COMPLETED'
    );
    if (completed) {
      return {
        allocation,
        sourceLedger: getActiveSaleLedger(allocation),
        completedTransfer: completed,
      };
    }
  }

  const sourceLedger = assertAllocationTransferable({
    allocation,
    toVendorId: input.toVendorId,
  });
  assertLedgerBlockers(sourceLedger);
  await assertNoOpenFinanceIntegrityAlertForMoneyMovement({
    vendorAllocationId: allocation.id,
  }, input.db);

  return {
    allocation,
    sourceLedger,
    completedTransfer: null,
  };
}

async function createFailedTransferAlert(input: {
  db: EconomicTransferDb;
  transferId: string;
  vendorAllocationId: string;
  affectedLedgerIds: string[];
  reason: string;
  error: unknown;
}) {
  await createOrUpdateAlert({
    dedupeKey: financeIntegrityAlertDedupeKey({
      category: 'transfer_failed',
      allocationEconomicTransferId: input.transferId,
    }),
    severity: 'critical',
    category: 'transfer_failed',
    vendorAllocationId: input.vendorAllocationId,
    allocationEconomicTransferId: input.transferId,
    affectedLedgerIds: input.affectedLedgerIds,
    reason: `Economic transfer failed: ${input.error instanceof Error ? input.error.message : String(input.error)}`,
    metadataJson: {
      transferReason: input.reason,
    },
  }, input.db);
}

export async function transferAllocationEconomics(
  input: TransferAllocationEconomicsInput,
  db: EconomicTransferDb = prisma,
): Promise<EconomicTransferResult> {
  assertConfirmed(input.confirmTransfer);
  const reason = normalizeReason(input.reason);
  const vendorAllocationId = normalizeText(input.vendorAllocationId);
  const toVendorId = normalizeText(input.toVendorId);
  if (!vendorAllocationId) {
    throw new EconomicTransferValidationError('Vendor allocation id is required.');
  }
  if (!toVendorId) {
    throw new EconomicTransferValidationError('Replacement vendor id is required.');
  }

  const preflight = await validatePreflight({
    db,
    vendorAllocationId,
    toVendorId,
  });

  if (preflight.completedTransfer) {
    return buildTransferResult(preflight.completedTransfer);
  }

  const fromVendorId = preflight.allocation.assignedVendorId;
  const idempotencyKey = buildIdempotencyKey({
    vendorAllocationId,
    fromVendorId,
    toVendorId,
  });
  const existingTransfer = await db.allocationEconomicTransfer.findUnique({
    where: {
      idempotencyKey,
    },
  });
  if (existingTransfer) {
    const status = normalizeTransferStatus(existingTransfer.status);
    if (status === 'COMPLETED') {
      return buildTransferResult(existingTransfer);
    }
    throw new EconomicTransferValidationError(`Economic transfer status ${existingTransfer.status} cannot be executed again.`, 409);
  }

  const transfer = await db.allocationEconomicTransfer.create({
    data: {
      id: randomUUID(),
      vendorAllocationId,
      fromVendorId,
      toVendorId,
      status: 'PENDING',
      reason,
      adminActorUserId: input.adminUserId ?? null,
      idempotencyKey,
      pricingSnapshotJson: buildPricingSnapshot({
        sourceLedger: preflight.sourceLedger,
        fromVendorId,
        toVendorId,
      }),
    },
  });

  const affectedLedgerIds = [preflight.sourceLedger.id];
  try {
    const completed = await db.$transaction?.(async (tx) => {
      const allocation = await loadAllocationForTransfer(tx, vendorAllocationId);
      if (!allocation) {
        throw new EconomicTransferValidationError('Allocation not found.', 404);
      }

      const sourceLedger = assertAllocationTransferable({
        allocation,
        toVendorId,
        currentTransferId: transfer.id,
      });
      if (sourceLedger.id !== preflight.sourceLedger.id) {
        throw new EconomicTransferValidationError('Active sale ledger changed during economic transfer.', 409);
      }
      assertLedgerBlockers(sourceLedger);
      await assertNoOpenFinanceIntegrityAlertForMoneyMovement({
        vendorAllocationId: allocation.id,
        allocationEconomicTransferId: transfer.id,
      }, tx);

      await tx.allocationEconomicTransfer.update({
        where: {
          id: transfer.id,
        },
        data: {
          status: 'IN_PROGRESS',
        },
      });

      const targetLedger = await createTargetSaleLedger({
        tx,
        allocation,
        sourceLedger,
        toVendorId,
        transferId: transfer.id,
        reason,
      });
      affectedLedgerIds.push(targetLedger.id);

      await tx.financeLedgerEntry.update({
        where: {
          id: sourceLedger.id,
        },
        data: {
          voidedAt: new Date(),
          voidReason: `economic_transfer:${transfer.id}`,
          supersededByLedgerId: targetLedger.id,
        },
      });

      await tx.vendorAllocation.update({
        where: {
          id: allocation.id,
        },
        data: {
          assignedVendorId: toVendorId,
          allocationStatus: AllocationStatus.ACTIVE,
          reassignmentRequired: false,
          cancellationReason: null,
        },
      });

      await tx.allocationAssignmentHistory.create({
        data: {
          vendorAllocationId: allocation.id,
          action: 'economic_transfer_completed',
          fromVendorId,
          toVendorId,
          reason,
          actorUserId: input.adminUserId ?? null,
        },
      });

      const updatedTransfer = await tx.allocationEconomicTransfer.update({
        where: {
          id: transfer.id,
        },
        data: {
          status: 'COMPLETED',
          fromFinanceLedgerEntryId: sourceLedger.id,
          toFinanceLedgerEntryId: targetLedger.id,
          completedAt: new Date(),
          failedAt: null,
          failureReason: null,
        },
      });

      return buildTransferResult(updatedTransfer);
    });

    if (!completed) {
      throw new Error('Database transaction support is required for economic transfer.');
    }

    return completed;
  } catch (error) {
    await db.allocationEconomicTransfer.update({
      where: {
        id: transfer.id,
      },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => null);

    await createFailedTransferAlert({
      db,
      transferId: transfer.id,
      vendorAllocationId,
      affectedLedgerIds,
      reason,
      error,
    }).catch(() => null);

    throw error;
  }
}

export const __economicTransferTesting = {
  buildSaleLedgerEntryId,
  buildIdempotencyKey,
  normalizeReason,
};
