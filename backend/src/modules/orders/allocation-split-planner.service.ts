import { createHash } from 'node:crypto';
import { AllocationStatus, ShipmentExecutionStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { buildSaleLedgerEntryId } from '../finance/sale-ledger.service.js';

export type AllocationSplitPlannerInput = {
  vendorAllocationId: string;
  selectedVendorAllocationLineItemIds?: string[];
  selectedShopifyLineItemIds?: string[];
  actorVendorId?: string;
  reason?: string;
  note?: string;
};

export type AllocationSplitPlannerBlocker = {
  code: string;
  message: string;
};

export type AllocationSplitPlannerLine = {
  id: string;
  shopifyLineItemId: string;
  sourceLineItemId?: string | null;
  quantity: number;
  lineAmount: number;
  title?: string | null;
  sku?: string | null;
};

export type AllocationSplitPlannerResult = {
  canSplit: boolean;
  decision: 'can_split' | 'use_full_allocation_reject' | 'blocked';
  blockers: AllocationSplitPlannerBlocker[];
  warnings: AllocationSplitPlannerBlocker[];
  sourceAllocation: {
    id: string;
    allocationStatus: string;
    originalVendorId: string;
    assignedVendorId: string;
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber?: string | null;
  } | null;
  selectedLines: AllocationSplitPlannerLine[];
  remainingLines: AllocationSplitPlannerLine[];
  amountPlan: {
    originalAmount: number;
    selectedAmount: number;
    remainingAmount: number;
  };
  proposedChildAllocation: {
    id: string | null;
    deterministic: true;
  };
  financePlan: {
    sourceSaleLedgerId?: string | null;
    sourceSaleLedgerAmount?: number | null;
    expectedRemainingSaleLedgerId: string | null;
    expectedChildSaleLedgerId: string | null;
  };
};

type AllocationSplitPlannerDb = Pick<
  Prisma.TransactionClient,
  'vendorAllocation'
>;

type LoadedAllocation = Awaited<ReturnType<typeof loadAllocationForSplitPlan>>;
type LoadedLine = NonNullable<LoadedAllocation>['lineItems'][number];
type LoadedLedger = NonNullable<LoadedAllocation>['financeEntries'][number];

const BLOCKING_ALERT_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED']);
const BLOCKING_ALERT_SEVERITIES = new Set(['WARNING', 'CRITICAL']);
const ACTIVE_REVIEW_STATUSES = new Set(['PENDING_REVIEW', 'CUSTOMER_CONTACTED', 'SHOPIFY_ACTION_PENDING']);
const BLOCKING_TRANSFER_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'PROCESSING', 'STARTED', 'FAILED', 'FAILURE', 'ERROR', 'COMPLETED']);

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeUpper(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function addBlocker(blockers: AllocationSplitPlannerBlocker[], code: string, message: string) {
  blockers.push({ code, message });
}

function hasDuplicateValues(values: string[]) {
  return new Set(values).size !== values.length;
}

export function buildAllocationSplitSelectedLineHash(selectedLineIds: string[]) {
  const sorted = [...selectedLineIds].sort();
  return createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 16);
}

export function buildDeterministicChildAllocationId(sourceAllocationId: string, selectedLineIds: string[]) {
  const digest = buildAllocationSplitSelectedLineHash(selectedLineIds);
  const base = `alloc-split-${sourceAllocationId}-${digest}`;
  return base.length <= 120 ? base : `alloc-split-${digest}`;
}

function mapLine(line: LoadedLine): AllocationSplitPlannerLine {
  return {
    id: line.id,
    shopifyLineItemId: line.shopifyLineItemId,
    sourceLineItemId: line.shopifyOrderLineItem?.sourceLineItemId ?? null,
    quantity: line.quantity,
    lineAmount: toNumber(line.lineAmount),
    title: line.shopifyOrderLineItem?.title ?? null,
    sku: line.shopifyOrderLineItem?.sku ?? null,
  };
}

function isActiveSaleLedger(entry: LoadedLedger) {
  return normalizeUpper(entry.entryType) === 'SALE' && !entry.voidedAt && !entry.supersededByLedgerId;
}

function hasBlockingShipmentExecution(execution: NonNullable<LoadedAllocation>['shipmentExecutions'][number]) {
  const status = execution.shipmentStatus;
  return status !== ShipmentExecutionStatus.FAILED && status !== ShipmentExecutionStatus.CANCELLED;
}

async function loadAllocationForSplitPlan(db: AllocationSplitPlannerDb, vendorAllocationId: string) {
  return db.vendorAllocation.findUnique({
    where: { id: vendorAllocationId },
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

function emptyResult(blockers: AllocationSplitPlannerBlocker[]): AllocationSplitPlannerResult {
  return {
    canSplit: false,
    decision: 'blocked',
    blockers,
    warnings: [],
    sourceAllocation: null,
    selectedLines: [],
    remainingLines: [],
    amountPlan: {
      originalAmount: 0,
      selectedAmount: 0,
      remainingAmount: 0,
    },
    proposedChildAllocation: {
      id: null,
      deterministic: true,
    },
    financePlan: {
      sourceSaleLedgerId: null,
      sourceSaleLedgerAmount: null,
      expectedRemainingSaleLedgerId: null,
      expectedChildSaleLedgerId: null,
    },
  };
}

export async function planAllocationSplitForLineItemReject(
  input: AllocationSplitPlannerInput,
  db: AllocationSplitPlannerDb = prisma,
): Promise<AllocationSplitPlannerResult> {
  const blockers: AllocationSplitPlannerBlocker[] = [];
  const warnings: AllocationSplitPlannerBlocker[] = [];
  const vendorAllocationId = normalizeText(input.vendorAllocationId);
  if (!vendorAllocationId) {
    addBlocker(blockers, 'allocation_missing', 'Vendor allocation id is required.');
    return emptyResult(blockers);
  }

  const allocation = await loadAllocationForSplitPlan(db, vendorAllocationId);
  if (!allocation) {
    addBlocker(blockers, 'allocation_missing', 'Vendor allocation could not be found.');
    return emptyResult(blockers);
  }

  if (input.actorVendorId && input.actorVendorId !== allocation.assignedVendorId) {
    addBlocker(blockers, 'actor_vendor_mismatch', 'Actor vendor does not own this allocation.');
  }

  if (allocation.allocationStatus !== AllocationStatus.ACTIVE) {
    addBlocker(blockers, 'allocation_not_active', 'Only active allocations can be planned for line-item rejection split.');
  }

  if (allocation.reassignmentRequired) {
    addBlocker(blockers, 'reassignment_already_required', 'Allocation already requires reassignment.');
  }

  if (ACTIVE_REVIEW_STATUSES.has(normalizeUpper(allocation.cancelRefundReviewStatus))) {
    addBlocker(blockers, 'cancel_refund_review_active', 'Cancel/refund review is already active for this allocation.');
  }

  if (allocation.trackingNumber?.trim()) {
    addBlocker(blockers, 'tracking_exists', 'Allocation already has tracking evidence.');
  }

  if (allocation.carrier?.trim()) {
    addBlocker(blockers, 'carrier_exists', 'Allocation already has carrier evidence.');
  }

  if (allocation.fulfillment) {
    addBlocker(blockers, 'fulfillment_exists', 'Allocation already has fulfillment evidence.');
  }

  if (allocation.shipmentExecutions.some(hasBlockingShipmentExecution)) {
    addBlocker(blockers, 'shipment_execution_exists', 'Allocation already has shipment execution evidence.');
  }

  if (allocation.refundRecords.length > 0) {
    addBlocker(blockers, 'refund_exists', 'Allocation already has refund records.');
  }

  if (allocation.returnRecords.length > 0) {
    addBlocker(blockers, 'return_exists', 'Allocation already has return records.');
  }

  if (allocation.financeIntegrityAlerts.some((alert) =>
    BLOCKING_ALERT_STATUSES.has(normalizeUpper(alert.status)) &&
    BLOCKING_ALERT_SEVERITIES.has(normalizeUpper(alert.severity))
  )) {
    addBlocker(blockers, 'finance_integrity_alert_exists', 'Open or acknowledged finance integrity alert blocks allocation split planning.');
  }

  if (allocation.economicTransfers.some((transfer) => BLOCKING_TRANSFER_STATUSES.has(normalizeUpper(transfer.status)))) {
    addBlocker(blockers, 'economic_transfer_exists', 'Economic transfer already exists for this allocation.');
  }

  const saleLedgers = allocation.financeEntries.filter((entry) => normalizeUpper(entry.entryType) === 'SALE');
  const activeSaleLedgers = allocation.financeEntries.filter(isActiveSaleLedger);
  if (activeSaleLedgers.length === 0) {
    const voidedSaleLedger = saleLedgers.find((entry) => entry.voidedAt || entry.supersededByLedgerId);
    if (voidedSaleLedger) {
      addBlocker(blockers, 'source_sale_ledger_voided', 'Source sale ledger is already voided or superseded.');
    } else {
      addBlocker(blockers, 'source_sale_ledger_missing', 'Allocation has no active source sale ledger.');
    }
  }
  if (activeSaleLedgers.length > 1) {
    addBlocker(blockers, 'multiple_active_sale_ledgers', 'Allocation has multiple active sale ledgers.');
  }

  const sourceSaleLedger = activeSaleLedgers.length === 1 ? activeSaleLedgers[0] : null;

  if (allocation.financeEntries.some((entry) => entry.settlementApprovalLines.length > 0)) {
    addBlocker(blockers, 'settlement_approval_exists', 'Allocation already has settlement approval evidence.');
  }

  if (allocation.financeEntries.some((entry) => entry.payoutBatchLines.length > 0)) {
    addBlocker(blockers, 'payout_batch_exists', 'Allocation already has payout batch evidence.');
  }

  const selectedAllocationLineIds = (input.selectedVendorAllocationLineItemIds ?? []).map(normalizeText).filter(Boolean);
  const selectedShopifyLineIds = (input.selectedShopifyLineItemIds ?? []).map(normalizeText).filter(Boolean);
  if (selectedAllocationLineIds.length === 0 && selectedShopifyLineIds.length === 0) {
    addBlocker(blockers, 'selected_lines_empty', 'Select at least one allocation line item.');
  }
  if (hasDuplicateValues(selectedAllocationLineIds) || hasDuplicateValues(selectedShopifyLineIds)) {
    addBlocker(blockers, 'duplicate_selected_lines', 'Selected line items must be unique.');
  }

  const selectedLineSet = new Set(selectedAllocationLineIds);
  const selectedShopifyLineSet = new Set(selectedShopifyLineIds);
  const selectedLinesRaw = allocation.lineItems.filter((line) =>
    selectedLineSet.has(line.id) ||
    selectedShopifyLineSet.has(line.shopifyLineItemId) ||
    selectedShopifyLineSet.has(line.shopifyOrderLineItem?.sourceLineItemId ?? '')
  );
  const matchedSelectedKeys = new Set<string>();
  selectedLinesRaw.forEach((line) => {
    if (selectedLineSet.has(line.id)) {
      matchedSelectedKeys.add(`allocation:${line.id}`);
    }
    if (selectedShopifyLineSet.has(line.shopifyLineItemId)) {
      matchedSelectedKeys.add(`shopify:${line.shopifyLineItemId}`);
    }
    if (line.shopifyOrderLineItem?.sourceLineItemId && selectedShopifyLineSet.has(line.shopifyOrderLineItem.sourceLineItemId)) {
      matchedSelectedKeys.add(`shopify:${line.shopifyOrderLineItem.sourceLineItemId}`);
    }
  });
  selectedAllocationLineIds.forEach((id) => {
    if (!matchedSelectedKeys.has(`allocation:${id}`)) {
      addBlocker(blockers, 'selected_line_not_owned', `Selected allocation line item ${id} is not owned by this allocation.`);
    }
  });
  selectedShopifyLineIds.forEach((id) => {
    if (!matchedSelectedKeys.has(`shopify:${id}`)) {
      addBlocker(blockers, 'selected_line_not_owned', `Selected Shopify line item ${id} is not owned by this allocation.`);
    }
  });

  const selectedLines = selectedLinesRaw.map(mapLine);
  const selectedRawIds = new Set(selectedLinesRaw.map((line) => line.id));
  const remainingLines = allocation.lineItems
    .filter((line) => !selectedRawIds.has(line.id))
    .map(mapLine);
  const originalAmount = allocation.lineItems.reduce((sum, line) => sum + toNumber(line.lineAmount), 0);
  const selectedAmount = selectedLines.reduce((sum, line) => sum + line.lineAmount, 0);
  const remainingAmount = remainingLines.reduce((sum, line) => sum + line.lineAmount, 0);
  const childAllocationId = selectedLines.length > 0
    ? buildDeterministicChildAllocationId(allocation.id, selectedLines.map((line) => line.id))
    : null;
  const sourceOrderId = allocation.order.sourceShopifyOrderId;
  const expectedRemainingSaleLedgerId = buildSaleLedgerEntryId(allocation.assignedVendorId, sourceOrderId, allocation.id);
  const expectedChildSaleLedgerId = childAllocationId
    ? buildSaleLedgerEntryId(allocation.assignedVendorId, sourceOrderId, childAllocationId)
    : null;

  let decision: AllocationSplitPlannerResult['decision'] = 'blocked';
  let canSplit = false;
  if (blockers.length === 0 && selectedLines.length === allocation.lineItems.length) {
    decision = 'use_full_allocation_reject';
    warnings.push({
      code: 'all_lines_selected',
      message: 'All allocation lines were selected; use full allocation reject instead of split.',
    });
  } else if (blockers.length === 0) {
    decision = 'can_split';
    canSplit = true;
  }

  return {
    canSplit,
    decision,
    blockers,
    warnings,
    sourceAllocation: {
      id: allocation.id,
      allocationStatus: allocation.allocationStatus,
      originalVendorId: allocation.originalVendorId,
      assignedVendorId: allocation.assignedVendorId,
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
    },
    selectedLines,
    remainingLines,
    amountPlan: {
      originalAmount,
      selectedAmount,
      remainingAmount,
    },
    proposedChildAllocation: {
      id: childAllocationId,
      deterministic: true,
    },
    financePlan: {
      sourceSaleLedgerId: sourceSaleLedger?.id ?? null,
      sourceSaleLedgerAmount: sourceSaleLedger ? toNumber(sourceSaleLedger.amount) : null,
      expectedRemainingSaleLedgerId,
      expectedChildSaleLedgerId,
    },
  };
}

export const __allocationSplitPlannerTesting = {
  buildAllocationSplitSelectedLineHash,
  buildDeterministicChildAllocationId,
};
