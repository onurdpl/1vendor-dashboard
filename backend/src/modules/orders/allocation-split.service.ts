import {
  AllocationStatus,
  CancellationReason,
  FinanceEventType,
  PayoutStatus,
  Prisma,
  SettlementStatus,
  type FinanceLedgerEntry,
  type VendorAllocation,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { createEventsIdempotently } from '../finance/finance-event.service.js';
import { buildSaleLedgerEntryId } from '../finance/sale-ledger.service.js';
import {
  buildAllocationSplitSelectedLineHash,
  buildDeterministicChildAllocationId,
  planAllocationSplitForLineItemReject,
} from './allocation-split-planner.service.js';

export type SplitAllocationForLineItemRejectInput = {
  vendorAllocationId: string;
  selectedVendorAllocationLineItemIds?: string[];
  selectedShopifyLineItemIds?: string[];
  actorVendorId?: string;
  actorUserId?: string;
  reason: string;
  note?: string;
  confirmSplit: true;
};

export type AllocationSplitServiceResult = {
  splitEventId: string;
  sourceAllocationId: string;
  childAllocationId: string;
  movedVendorAllocationLineItemIds: string[];
  movedShopifyLineItemIds: string[];
  sourceSaleLedgerId: string;
  remainingSaleLedgerId: string;
  childSaleLedgerId: string;
  amountPlan: {
    originalAmount: number;
    selectedAmount: number;
    remainingAmount: number;
  };
  idempotent: boolean;
};

export class AllocationSplitValidationError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 409) {
    super(message);
    this.name = 'AllocationSplitValidationError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AllocationSplitValidationError.prototype);
  }
}

type AllocationSplitDb = Pick<
  Prisma.TransactionClient,
  | 'vendorAllocation'
  | 'vendorAllocationLineItem'
  | 'financeLedgerEntry'
  | 'allocationSplitEvent'
  | 'allocationAssignmentHistory'
  | 'financeEvent'
> & {
  $transaction?: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
};

type LoadedSourceAllocation = NonNullable<Awaited<ReturnType<typeof loadSourceAllocationForWrite>>>;
type LoadedLedger = LoadedSourceAllocation['financeEntries'][number];

const MAX_NOTE_LENGTH = 1000;

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeReason(reason: string | null | undefined): CancellationReason {
  const normalized = reason?.trim().toUpperCase();
  if (!normalized || !Object.values(CancellationReason).includes(normalized as CancellationReason)) {
    throw new AllocationSplitValidationError('invalid_reason', 'Allocation split reason is required.', 400);
  }
  return normalized as CancellationReason;
}

function normalizeNote(note: string | null | undefined) {
  const normalized = note?.trim() ?? '';
  if (normalized.length > MAX_NOTE_LENGTH) {
    throw new AllocationSplitValidationError('note_too_long', 'Allocation split note must be 1000 characters or fewer.', 400);
  }
  return normalized;
}

function assertConfirmed(confirmSplit: boolean | undefined) {
  if (confirmSplit !== true) {
    throw new AllocationSplitValidationError('confirm_split_required', 'Allocation split requires explicit confirmation.', 400);
  }
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toAmountString(value: unknown) {
  return toNumber(value).toFixed(2);
}

function toMinorUnits(value: unknown) {
  return Math.round(toNumber(value) * 100);
}

function normalizeEntryType(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function isActiveSaleLedger(entry: LoadedLedger | FinanceLedgerEntry) {
  return normalizeEntryType(entry.entryType) === 'sale' && !entry.voidedAt && !entry.supersededByLedgerId;
}

function buildSplitEventId(childAllocationId: string) {
  return `split-event-${childAllocationId}`;
}

function buildRemainingReplacementLedgerId(input: {
  vendorId: string;
  sourceShopifyOrderId: string;
  sourceAllocationId: string;
  selectedLineHash: string;
}) {
  return `fin-${input.vendorId}-sale-${input.sourceShopifyOrderId}-${input.sourceAllocationId}-split-rem-${input.selectedLineHash}`;
}

function buildLineReason(reason: CancellationReason, note: string) {
  return note ? `${reason}: ${note}` : reason;
}

async function loadSourceAllocationForWrite(db: AllocationSplitDb, vendorAllocationId: string) {
  return db.vendorAllocation.findUnique({
    where: {
      id: vendorAllocationId,
    },
    include: {
      order: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
      fulfillment: true,
      shipmentExecutions: true,
      returnRecords: true,
      refundRecords: true,
      economicTransfers: true,
      financeIntegrityAlerts: true,
      financeEntries: {
        include: {
          payoutBatchLines: true,
          settlementApprovalLines: true,
        },
      },
    },
  });
}

function getActiveSourceSaleLedger(allocation: LoadedSourceAllocation) {
  const activeSaleLedgers = allocation.financeEntries.filter(isActiveSaleLedger);
  if (activeSaleLedgers.length !== 1) {
    throw new AllocationSplitValidationError(
      activeSaleLedgers.length === 0 ? 'source_sale_ledger_missing' : 'multiple_active_sale_ledgers',
      activeSaleLedgers.length === 0
        ? 'Allocation has no active source sale ledger.'
        : 'Allocation has multiple active source sale ledgers.',
    );
  }
  return activeSaleLedgers[0];
}

function assertMinorAmountIntegrity(input: {
  selectedAmount: number;
  remainingAmount: number;
  sourceLedgerAmount: unknown;
}) {
  const selectedMinor = toMinorUnits(input.selectedAmount);
  const remainingMinor = toMinorUnits(input.remainingAmount);
  const sourceMinor = toMinorUnits(input.sourceLedgerAmount);
  if (selectedMinor + remainingMinor !== sourceMinor) {
    throw new AllocationSplitValidationError(
      'amount_plan_mismatch',
      'Selected and remaining line amounts must exactly equal the source sale ledger amount.',
    );
  }
}

function assertLineSetStillMatches(input: {
  selectedLineIds: string[];
  remainingLineIds: string[];
  sourceAllocation: LoadedSourceAllocation;
}) {
  const currentLineIds = new Set(input.sourceAllocation.lineItems.map((line) => line.id));
  const expectedLineIds = new Set([...input.selectedLineIds, ...input.remainingLineIds]);
  if (currentLineIds.size !== expectedLineIds.size || [...expectedLineIds].some((id) => !currentLineIds.has(id))) {
    throw new AllocationSplitValidationError(
      'source_line_set_changed',
      'Source allocation line item set changed during allocation split.',
    );
  }
}

async function loadExistingSplitArtifacts(input: {
  db: AllocationSplitDb;
  sourceAllocationId: string;
  childAllocationId: string;
  splitEventId: string;
  remainingLedgerId: string;
  childLedgerId: string;
  normalSourceLedgerId: string;
}) {
  const [sourceAllocation, childAllocation, splitEvent, ledgers] = await Promise.all([
    input.db.vendorAllocation.findUnique({
      where: { id: input.sourceAllocationId },
      include: {
        lineItems: true,
      },
    }),
    input.db.vendorAllocation.findUnique({
      where: { id: input.childAllocationId },
      include: {
        lineItems: true,
      },
    }),
    input.db.allocationSplitEvent.findUnique({
      where: { id: input.splitEventId },
    }),
    input.db.financeLedgerEntry.findMany({
      where: {
        id: {
          in: [input.normalSourceLedgerId, input.remainingLedgerId, input.childLedgerId],
        },
      },
    }),
  ]);

  return {
    sourceAllocation,
    childAllocation,
    splitEvent,
    sourceLedger: ledgers.find((ledger) => ledger.id === input.normalSourceLedgerId) ?? null,
    remainingLedger: ledgers.find((ledger) => ledger.id === input.remainingLedgerId) ?? null,
    childLedger: ledgers.find((ledger) => ledger.id === input.childLedgerId) ?? null,
  };
}

function buildResult(input: {
  splitEventId: string;
  sourceAllocationId: string;
  childAllocationId: string;
  movedVendorAllocationLineItemIds: string[];
  movedShopifyLineItemIds: string[];
  sourceSaleLedgerId: string;
  remainingSaleLedgerId: string;
  childSaleLedgerId: string;
  amountPlan: AllocationSplitServiceResult['amountPlan'];
  idempotent: boolean;
}): AllocationSplitServiceResult {
  return input;
}

function isCompleteExistingSplit(input: {
  artifacts: Awaited<ReturnType<typeof loadExistingSplitArtifacts>>;
  sourceAllocationId: string;
  childAllocationId: string;
  splitEventId: string;
  selectedLineIds: string[];
  remainingLedgerId: string;
  childLedgerId: string;
}) {
  const {
    artifacts,
    sourceAllocationId,
    childAllocationId,
    splitEventId,
    selectedLineIds,
    remainingLedgerId,
    childLedgerId,
  } = input;
  if (!artifacts.sourceAllocation || !artifacts.childAllocation || !artifacts.splitEvent) {
    return false;
  }
  if (artifacts.splitEvent.id !== splitEventId ||
    artifacts.splitEvent.sourceAllocationId !== sourceAllocationId ||
    artifacts.splitEvent.childAllocationId !== childAllocationId ||
    artifacts.splitEvent.remainingFinanceLedgerEntryId !== remainingLedgerId ||
    artifacts.splitEvent.childFinanceLedgerEntryId !== childLedgerId) {
    return false;
  }
  if (!artifacts.sourceLedger?.voidedAt ||
    artifacts.sourceLedger.voidReason !== `allocation_split:${splitEventId}` ||
    artifacts.sourceLedger.supersededByLedgerId !== remainingLedgerId) {
    return false;
  }
  if (!artifacts.remainingLedger || !isActiveSaleLedger(artifacts.remainingLedger) || artifacts.remainingLedger.vendorAllocationId !== sourceAllocationId) {
    return false;
  }
  if (!artifacts.childLedger || !isActiveSaleLedger(artifacts.childLedger) || artifacts.childLedger.vendorAllocationId !== childAllocationId) {
    return false;
  }
  const childLineIds = new Set(artifacts.childAllocation.lineItems.map((line) => line.id));
  return selectedLineIds.every((id) => childLineIds.has(id)) && artifacts.sourceAllocation.lineItems.length > 0;
}

function assertNoInconsistentExistingSplit(input: {
  artifacts: Awaited<ReturnType<typeof loadExistingSplitArtifacts>>;
  childAllocationId: string;
  splitEventId: string;
  remainingLedgerId: string;
  childLedgerId: string;
}) {
  const { artifacts } = input;
  if (artifacts.childAllocation || artifacts.splitEvent || artifacts.remainingLedger || artifacts.childLedger) {
    if (artifacts.childAllocation && !artifacts.splitEvent) {
      throw new AllocationSplitValidationError(
        'allocation_split_inconsistent_existing_child',
        'Split child allocation already exists without a complete matching split event.',
      );
    }
    if (artifacts.remainingLedger || artifacts.childLedger || artifacts.splitEvent) {
      throw new AllocationSplitValidationError(
        'allocation_split_inconsistent_replacement_ledger',
        'Allocation split replacement ledger or event already exists without a complete matching split.',
      );
    }
  }
  if (artifacts.sourceLedger?.voidedAt) {
    throw new AllocationSplitValidationError(
      'allocation_split_inconsistent_voided_source_ledger',
      'Source sale ledger is already voided without a complete matching split.',
    );
  }
}

async function createSplitSaleLedger(input: {
  tx: AllocationSplitDb;
  ledgerId: string;
  allocation: Pick<VendorAllocation, 'id' | 'assignedVendorId' | 'createdAt' | 'shippingStatus'> & {
    order: { id: string; sourceShopifyOrderId: string; sourceShopifyOrderNumber: string; currency: string | null };
  };
  sourceLedger: LoadedLedger;
  amount: number;
  splitEventId: string;
  sourceAllocationId: string;
  ledgerRole: 'remaining_source' | 'child_blocked';
  movedLineIds: string[];
}) {
  const amountString = toAmountString(input.amount);
  const ledger = await input.tx.financeLedgerEntry.create({
    data: {
      id: input.ledgerId,
      vendorAllocationId: input.allocation.id,
      vendorId: input.allocation.assignedVendorId,
      entryType: 'sale',
      amount: amountString,
      payoutStatus: PayoutStatus.PENDING,
      description: `Allocated sale for Shopify order ${input.allocation.order.sourceShopifyOrderNumber}`,
      commissionPercentSnapshot: input.sourceLedger.commissionPercentSnapshot,
      commissionVatPercentSnapshot: input.sourceLedger.commissionVatPercentSnapshot,
      deductShippingEnabledSnapshot: input.sourceLedger.deductShippingEnabledSnapshot,
      shippingModeSnapshot: input.sourceLedger.shippingModeSnapshot,
      fixedShippingFeeSnapshot: input.sourceLedger.fixedShippingFeeSnapshot,
      shippingCostSnapshot: input.sourceLedger.shippingCostSnapshot,
      shippingVatAmountSnapshot: input.sourceLedger.shippingVatAmountSnapshot,
      shippingCostSourceSnapshot: input.sourceLedger.shippingCostSourceSnapshot,
      shippingCostProviderSnapshot: input.sourceLedger.shippingCostProviderSnapshot,
      shippingCostIdSnapshot: input.sourceLedger.shippingCostIdSnapshot,
      financialProfileIdSnapshot: input.sourceLedger.financialProfileIdSnapshot,
      settlementDelayDaysSnapshot: input.sourceLedger.settlementDelayDaysSnapshot,
      settlementStatus: SettlementStatus.ACCRUING,
      accruedAt: input.allocation.createdAt,
      payableAt: null,
      settlementEligibleAt: null,
    },
  });

  const grossMinor = toMinorUnits(input.amount);
  const commissionPercent = toNumber(input.sourceLedger.commissionPercentSnapshot);
  const commissionVatPercent = toNumber(input.sourceLedger.commissionVatPercentSnapshot);
  const commissionMinor = Math.round(grossMinor * (Math.max(commissionPercent, 0) / 100));
  const commissionVatMinor = Math.round(commissionMinor * (Math.max(commissionVatPercent, 0) / 100));
  const vendorPayableMinor = grossMinor - commissionMinor - commissionVatMinor;
  const baseEvent = {
    vendorId: input.allocation.assignedVendorId,
    shopifyOrderId: input.allocation.order.id,
    financeLedgerEntryId: input.ledgerId,
    currency: input.allocation.order.currency ?? 'TRY',
    referenceType: 'allocation_split',
    referenceId: input.splitEventId,
    createdBy: 'system:allocation_split',
    metadataJson: {
      sourceShopifyOrderId: input.allocation.order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: input.allocation.order.sourceShopifyOrderNumber,
      sourceVendorAllocationId: input.sourceAllocationId,
      vendorAllocationId: input.allocation.id,
      financeLedgerEntryId: input.ledgerId,
      sourceFinanceLedgerEntryId: input.sourceLedger.id,
      allocationSplitEventId: input.splitEventId,
      allocationSplitLedgerRole: input.ledgerRole,
      movedVendorAllocationLineItemIds: input.movedLineIds,
      commissionPercentSnapshot: commissionPercent,
      commissionVatPercentSnapshot: commissionVatPercent,
    } satisfies Prisma.InputJsonValue,
  };

  await createEventsIdempotently(
    [
      {
        ...baseEvent,
        eventType: FinanceEventType.SALE_RECORDED,
        amountMinor: grossMinor,
        idempotencyKey: `${input.ledgerId}:SALE_RECORDED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.COMMISSION_RESERVED,
        amountMinor: commissionMinor,
        idempotencyKey: `${input.ledgerId}:COMMISSION_RESERVED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.COMMISSION_VAT_RESERVED,
        amountMinor: commissionVatMinor,
        idempotencyKey: `${input.ledgerId}:COMMISSION_VAT_RESERVED`,
      },
      {
        ...baseEvent,
        eventType: FinanceEventType.VENDOR_PAYABLE_RESERVED,
        amountMinor: vendorPayableMinor,
        idempotencyKey: `${input.ledgerId}:VENDOR_PAYABLE_RESERVED`,
      },
    ],
    input.tx as Prisma.TransactionClient,
  );

  return ledger;
}

export async function splitAllocationForLineItemReject(
  input: SplitAllocationForLineItemRejectInput,
  db: AllocationSplitDb = prisma,
): Promise<AllocationSplitServiceResult> {
  assertConfirmed(input.confirmSplit);
  const vendorAllocationId = normalizeText(input.vendorAllocationId);
  if (!vendorAllocationId) {
    throw new AllocationSplitValidationError('allocation_missing', 'Vendor allocation id is required.', 400);
  }
  const reason = normalizeReason(input.reason);
  const note = normalizeNote(input.note);
  const selectedInputLineIds = (input.selectedVendorAllocationLineItemIds ?? []).map(normalizeText).filter(Boolean);

  const run = async (tx: Prisma.TransactionClient): Promise<AllocationSplitServiceResult> => {
    const sourceForId = await loadSourceAllocationForWrite(tx, vendorAllocationId);
    if (!sourceForId) {
      throw new AllocationSplitValidationError('allocation_missing', 'Vendor allocation could not be found.', 404);
    }
    const selectedLineIdsForHash = selectedInputLineIds.length
      ? selectedInputLineIds
      : sourceForId.lineItems
        .filter((line) => (input.selectedShopifyLineItemIds ?? []).map(normalizeText).includes(line.shopifyLineItemId) ||
          (input.selectedShopifyLineItemIds ?? []).map(normalizeText).includes(line.shopifyOrderLineItem.sourceLineItemId))
        .map((line) => line.id);
    if (selectedLineIdsForHash.length === 0) {
      throw new AllocationSplitValidationError('selected_lines_empty', 'Select at least one allocation line item.', 400);
    }
    const selectedLineHash = buildAllocationSplitSelectedLineHash(selectedLineIdsForHash);
    const childAllocationId = buildDeterministicChildAllocationId(vendorAllocationId, selectedLineIdsForHash);
    const splitEventId = buildSplitEventId(childAllocationId);
    const normalSourceLedgerId = buildSaleLedgerEntryId(
      sourceForId.assignedVendorId,
      sourceForId.order.sourceShopifyOrderId,
      sourceForId.id,
    );
    const remainingLedgerId = buildRemainingReplacementLedgerId({
      vendorId: sourceForId.assignedVendorId,
      sourceShopifyOrderId: sourceForId.order.sourceShopifyOrderId,
      sourceAllocationId: sourceForId.id,
      selectedLineHash,
    });
    const childLedgerId = buildSaleLedgerEntryId(
      sourceForId.assignedVendorId,
      sourceForId.order.sourceShopifyOrderId,
      childAllocationId,
    );

    const existingArtifacts = await loadExistingSplitArtifacts({
      db: tx,
      sourceAllocationId: vendorAllocationId,
      childAllocationId,
      splitEventId,
      remainingLedgerId,
      childLedgerId,
      normalSourceLedgerId,
    });
    if (isCompleteExistingSplit({
      artifacts: existingArtifacts,
      sourceAllocationId: vendorAllocationId,
      childAllocationId,
      splitEventId,
      selectedLineIds: selectedLineIdsForHash,
      remainingLedgerId,
      childLedgerId,
    })) {
      return buildResult({
        splitEventId,
        sourceAllocationId: vendorAllocationId,
        childAllocationId,
        movedVendorAllocationLineItemIds: selectedLineIdsForHash,
        movedShopifyLineItemIds: existingArtifacts.childAllocation?.lineItems.map((line) => line.shopifyLineItemId) ?? [],
        sourceSaleLedgerId: normalSourceLedgerId,
        remainingSaleLedgerId: remainingLedgerId,
        childSaleLedgerId: childLedgerId,
        amountPlan: {
          originalAmount: toNumber(existingArtifacts.sourceLedger?.amount),
          selectedAmount: toNumber(existingArtifacts.childLedger?.amount),
          remainingAmount: toNumber(existingArtifacts.remainingLedger?.amount),
        },
        idempotent: true,
      });
    }
    assertNoInconsistentExistingSplit({
      artifacts: existingArtifacts,
      childAllocationId,
      splitEventId,
      remainingLedgerId,
      childLedgerId,
    });

    const planner = await planAllocationSplitForLineItemReject({
      vendorAllocationId,
      selectedVendorAllocationLineItemIds: input.selectedVendorAllocationLineItemIds,
      selectedShopifyLineItemIds: input.selectedShopifyLineItemIds,
      actorVendorId: input.actorVendorId,
      reason,
      note,
    }, tx);
    if (planner.decision !== 'can_split') {
      const firstBlocker = planner.blockers[0] ?? planner.warnings[0];
      throw new AllocationSplitValidationError(
        firstBlocker?.code ?? planner.decision,
        firstBlocker?.message ?? 'Allocation cannot be split.',
        409,
      );
    }

    const freshSource = await loadSourceAllocationForWrite(tx, vendorAllocationId);
    if (!freshSource || freshSource.allocationStatus !== AllocationStatus.ACTIVE) {
      throw new AllocationSplitValidationError('allocation_not_active', 'Source allocation is no longer active.');
    }
    const selectedLines = planner.selectedLines;
    const selectedLineIds = selectedLines.map((line) => line.id);
    const remainingLineIds = planner.remainingLines.map((line) => line.id);
    assertLineSetStillMatches({
      selectedLineIds,
      remainingLineIds,
      sourceAllocation: freshSource,
    });
    const sourceLedger = getActiveSourceSaleLedger(freshSource);
    if (sourceLedger.id !== planner.financePlan.sourceSaleLedgerId) {
      throw new AllocationSplitValidationError('source_sale_ledger_changed', 'Active source sale ledger changed during allocation split.');
    }
    if (toMinorUnits(sourceLedger.amount) !== toMinorUnits(planner.financePlan.sourceSaleLedgerAmount)) {
      throw new AllocationSplitValidationError('source_sale_ledger_amount_changed', 'Active source sale ledger amount changed during allocation split.');
    }
    assertMinorAmountIntegrity({
      selectedAmount: planner.amountPlan.selectedAmount,
      remainingAmount: planner.amountPlan.remainingAmount,
      sourceLedgerAmount: sourceLedger.amount,
    });

    const childAllocation = await tx.vendorAllocation.create({
      data: {
        id: childAllocationId,
        sourceShopifyOrderId: freshSource.sourceShopifyOrderId,
        sourceShopifyOrderNumber: freshSource.sourceShopifyOrderNumber,
        originalVendorId: freshSource.originalVendorId,
        assignedVendorId: freshSource.assignedVendorId,
        allocationStatus: AllocationStatus.VENDOR_BLOCKED,
        reassignmentRequired: true,
        cancellationReason: reason,
        cancelRefundReviewStatus: null,
        cancelRefundReviewReason: null,
        cancelRefundReviewNote: null,
        cancelRefundReviewRequestedAt: null,
        cancelRefundReviewRequestedByUserId: null,
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        trackingNumber: null,
        carrier: null,
        vendorIntegrationTrackingUrl: null,
        vendorIntegrationShippedAt: null,
        odooSaleOrderId: null,
        odooSaleOrderName: null,
        odooSaleOrderSyncedAt: null,
        vendorIntegrationStatus: null,
        vendorIntegrationStatusMessage: null,
        vendorIntegrationStatusUpdatedAt: null,
        vendorIntegrationProvider: null,
        lastVendorIntegrationRequestId: null,
        lastVendorIntegrationShipmentRequestId: null,
        vendorInvoiceNumber: null,
        vendorInvoiceDate: null,
        vendorInvoiceUrl: null,
        vendorInvoiceAmount: null,
        vendorInvoiceReceivedAt: null,
        lastVendorIntegrationInvoiceRequestId: null,
      },
      include: {
        order: true,
      },
    });

    const movedLineUpdate = await tx.vendorAllocationLineItem.updateMany({
      where: {
        id: {
          in: selectedLineIds,
        },
        vendorAllocationId,
      },
      data: {
        vendorAllocationId: childAllocationId,
      },
    });
    if (movedLineUpdate.count !== selectedLineIds.length) {
      throw new AllocationSplitValidationError('selected_line_set_changed', 'Selected line items changed during allocation split.');
    }
    const remainingCount = await tx.vendorAllocationLineItem.count({
      where: {
        vendorAllocationId,
      },
    });
    if (remainingCount !== remainingLineIds.length || remainingCount === 0) {
      throw new AllocationSplitValidationError('source_remaining_lines_invalid', 'Source allocation must retain remaining line items after split.');
    }

    await tx.financeLedgerEntry.update({
      where: {
        id: sourceLedger.id,
      },
      data: {
        voidedAt: new Date(),
        voidReason: `allocation_split:${splitEventId}`,
        supersededByLedgerId: remainingLedgerId,
      },
    });

    const remainingLedger = await createSplitSaleLedger({
      tx,
      ledgerId: remainingLedgerId,
      allocation: {
        id: freshSource.id,
        assignedVendorId: freshSource.assignedVendorId,
        createdAt: freshSource.createdAt,
        shippingStatus: freshSource.shippingStatus,
        order: freshSource.order,
      },
      sourceLedger,
      amount: planner.amountPlan.remainingAmount,
      splitEventId,
      sourceAllocationId: freshSource.id,
      ledgerRole: 'remaining_source',
      movedLineIds: selectedLineIds,
    });
    const childLedger = await createSplitSaleLedger({
      tx,
      ledgerId: childLedgerId,
      allocation: {
        id: childAllocation.id,
        assignedVendorId: childAllocation.assignedVendorId,
        createdAt: childAllocation.createdAt,
        shippingStatus: childAllocation.shippingStatus,
        order: childAllocation.order,
      },
      sourceLedger,
      amount: planner.amountPlan.selectedAmount,
      splitEventId,
      sourceAllocationId: freshSource.id,
      ledgerRole: 'child_blocked',
      movedLineIds: selectedLineIds,
    });

    await tx.allocationSplitEvent.create({
      data: {
        id: splitEventId,
        sourceAllocationId: freshSource.id,
        childAllocationId,
        reason,
        note: note || null,
        actorUserId: input.actorUserId ?? null,
        movedVendorAllocationLineItemIdsJson: selectedLineIds as Prisma.InputJsonValue,
        movedShopifyLineItemIdsJson: selectedLines.map((line) => line.shopifyLineItemId) as Prisma.InputJsonValue,
        sourceFinanceLedgerEntryId: sourceLedger.id,
        remainingFinanceLedgerEntryId: remainingLedger.id,
        childFinanceLedgerEntryId: childLedger.id,
        metadataJson: {
          selectedAmount: planner.amountPlan.selectedAmount,
          remainingAmount: planner.amountPlan.remainingAmount,
          originalAmount: planner.amountPlan.originalAmount,
          selectedLineHash,
          selectedVendorAllocationLineItemIds: selectedLineIds,
          selectedShopifyLineItemIds: selectedLines.map((line) => line.shopifyLineItemId),
        } satisfies Prisma.InputJsonValue,
      },
    });

    await tx.allocationAssignmentHistory.create({
      data: {
        vendorAllocationId: freshSource.id,
        action: 'allocation_split_source_updated',
        fromVendorId: freshSource.assignedVendorId,
        toVendorId: freshSource.assignedVendorId,
        reason: `Split selected line items into ${childAllocationId}. ${buildLineReason(reason, note)}`,
        actorUserId: input.actorUserId ?? null,
      },
    });
    await tx.allocationAssignmentHistory.create({
      data: {
        vendorAllocationId: childAllocationId,
        action: 'vendor_blocked',
        fromVendorId: freshSource.assignedVendorId,
        toVendorId: freshSource.assignedVendorId,
        reason: buildLineReason(reason, note),
        actorUserId: input.actorUserId ?? null,
      },
    });

    return buildResult({
      splitEventId,
      sourceAllocationId: freshSource.id,
      childAllocationId,
      movedVendorAllocationLineItemIds: selectedLineIds,
      movedShopifyLineItemIds: selectedLines.map((line) => line.shopifyLineItemId),
      sourceSaleLedgerId: sourceLedger.id,
      remainingSaleLedgerId: remainingLedger.id,
      childSaleLedgerId: childLedger.id,
      amountPlan: planner.amountPlan,
      idempotent: false,
    });
  };

  if (typeof db.$transaction !== 'function') {
    throw new AllocationSplitValidationError('transaction_required', 'Database transaction support is required for allocation split.', 500);
  }

  return db.$transaction(run);
}

export const __allocationSplitServiceTesting = {
  buildRemainingReplacementLedgerId,
  buildSplitEventId,
};
