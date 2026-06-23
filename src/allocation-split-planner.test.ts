import { describe, expect, it, vi } from 'vitest';
import {
  __allocationSplitPlannerTesting,
  planAllocationSplitForLineItemReject,
} from '../backend/src/modules/orders/allocation-split-planner.service';

function buildLine(id: string, sourceLineItemId: string, amount: string, quantity = 1) {
  return {
    id,
    vendorAllocationId: 'alloc-source',
    shopifyLineItemId: `shopify-db-${sourceLineItemId}`,
    quantity,
    lineAmount: amount,
    createdAt: new Date('2026-06-23T08:00:00.000Z'),
    updatedAt: new Date('2026-06-23T08:00:00.000Z'),
    shopifyOrderLineItem: {
      id: `shopify-db-${sourceLineItemId}`,
      shopifyOrderId: 'shopify-order-db-1097',
      sourceLineItemId,
      sku: `SKU-${sourceLineItemId}`,
      title: `Item ${sourceLineItemId}`,
      imageUrl: null,
      shopifyProductId: null,
      sourceVariantId: null,
      quantity,
      unitPrice: amount,
      unitPriceVatIncluded: amount,
      lineTotalVatIncluded: amount,
      lineTaxAmount: null,
      vatRate: null,
      originalVendorId: 'vendor-a',
      createdAt: new Date('2026-06-23T08:00:00.000Z'),
      updatedAt: new Date('2026-06-23T08:00:00.000Z'),
    },
  };
}

function buildSaleLedger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fin-vendor-a-sale-781877444617-alloc-source',
    vendorAllocationId: 'alloc-source',
    vendorId: 'vendor-a',
    entryType: 'sale',
    amount: '600.00',
    payoutStatus: 'PENDING',
    settlementStatus: 'ACCRUING',
    voidedAt: null,
    supersededByLedgerId: null,
    payoutBatchLines: [],
    settlementApprovalLines: [],
    ...overrides,
  };
}

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-source',
    sourceShopifyOrderId: 'shopify-order-db-1097',
    sourceShopifyOrderNumber: '#1097',
    originalVendorId: 'vendor-a',
    assignedVendorId: 'vendor-a',
    allocationStatus: 'ACTIVE',
    cancellationReason: null,
    reassignmentRequired: false,
    cancelRefundReviewStatus: null,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    order: {
      id: 'shopify-order-db-1097',
      sourceShopifyOrderId: '781877444617',
      sourceShopifyOrderNumber: '#1097',
    },
    lineItems: [
      buildLine('line-1', 'source-line-1', '100.00'),
      buildLine('line-2', 'source-line-2', '200.00'),
      buildLine('line-3', 'source-line-3', '300.00'),
    ],
    fulfillment: null,
    shipmentExecutions: [],
    returnRecords: [],
    refundRecords: [],
    economicTransfers: [],
    financeIntegrityAlerts: [],
    financeEntries: [buildSaleLedger()],
    ...overrides,
  };
}

function buildDb(allocation: unknown) {
  return {
    vendorAllocation: {
      findUnique: vi.fn().mockResolvedValue(allocation),
    },
  };
}

async function plan(overrides: Record<string, unknown> = {}, input: Record<string, unknown> = {}) {
  const db = buildDb(buildAllocation(overrides));
  const result = await planAllocationSplitForLineItemReject({
    vendorAllocationId: 'alloc-source',
    selectedVendorAllocationLineItemIds: ['line-2'],
    actorVendorId: 'vendor-a',
    ...input,
  }, db as never);
  return { result, db };
}

describe('allocation split planner', () => {
  it('plans a split for one line out of three', async () => {
    const { result } = await plan();

    expect(result.canSplit).toBe(true);
    expect(result.decision).toBe('can_split');
    expect(result.blockers).toEqual([]);
    expect(result.selectedLines.map((line) => line.id)).toEqual(['line-2']);
    expect(result.remainingLines.map((line) => line.id)).toEqual(['line-1', 'line-3']);
    expect(result.amountPlan).toEqual({
      originalAmount: 600,
      selectedAmount: 200,
      remainingAmount: 400,
    });
    expect(result.proposedChildAllocation.id).toMatch(/^alloc-split-alloc-source-[a-f0-9]{16}$/);
    expect(result.financePlan).toMatchObject({
      sourceSaleLedgerId: 'fin-vendor-a-sale-781877444617-alloc-source',
      sourceSaleLedgerAmount: 600,
      expectedRemainingSaleLedgerId: 'fin-vendor-a-sale-781877444617-alloc-source',
      expectedChildSaleLedgerId: `fin-vendor-a-sale-781877444617-${result.proposedChildAllocation.id}`,
    });
  });

  it('uses full allocation reject when all lines are selected', async () => {
    const { result } = await plan({}, {
      selectedVendorAllocationLineItemIds: ['line-1', 'line-2', 'line-3'],
    });

    expect(result.canSplit).toBe(false);
    expect(result.decision).toBe('use_full_allocation_reject');
    expect(result.warnings.map((warning) => warning.code)).toContain('all_lines_selected');
  });

  it.each([
    ['inactive allocation', { allocationStatus: 'VENDOR_BLOCKED' }, 'allocation_not_active'],
    ['vendor mismatch', {}, 'actor_vendor_mismatch', { actorVendorId: 'vendor-b' }],
    ['tracking exists', { trackingNumber: 'TRACK-1' }, 'tracking_exists'],
    ['carrier exists', { carrier: 'Carrier' }, 'carrier_exists'],
    ['shipment pending', { shipmentExecutions: [{ shipmentStatus: 'PENDING' }] }, 'shipment_execution_exists'],
    ['refund exists', { refundRecords: [{ id: 'refund-1' }] }, 'refund_exists'],
    ['return exists', { returnRecords: [{ id: 'return-1' }] }, 'return_exists'],
    ['cancel/refund review active', { cancelRefundReviewStatus: 'PENDING_REVIEW' }, 'cancel_refund_review_active'],
    ['finance alert', { financeIntegrityAlerts: [{ status: 'open', severity: 'critical' }] }, 'finance_integrity_alert_exists'],
    ['transfer exists', { economicTransfers: [{ status: 'FAILED' }] }, 'economic_transfer_exists'],
    ['settlement exists', { financeEntries: [buildSaleLedger({ settlementApprovalLines: [{ id: 'line-1' }] })] }, 'settlement_approval_exists'],
    ['payout exists', { financeEntries: [buildSaleLedger({ payoutBatchLines: [{ id: 'payout-line-1' }] })] }, 'payout_batch_exists'],
    ['multiple active sale ledgers', { financeEntries: [buildSaleLedger(), buildSaleLedger({ id: 'fin-vendor-a-sale-781877444617-alloc-source-2' })] }, 'multiple_active_sale_ledgers'],
  ])('blocks when %s', async (_name, allocationOverrides, expectedCode, inputOverrides = {}) => {
    const { result } = await plan(allocationOverrides, inputOverrides);

    expect(result.canSplit).toBe(false);
    expect(result.decision).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toContain(expectedCode);
  });

  it('allows failed shipment execution', async () => {
    const { result } = await plan({
      shipmentExecutions: [{ shipmentStatus: 'FAILED' }],
    });

    expect(result.canSplit).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('blocks selected lines not owned by allocation and duplicate selected lines', async () => {
    const { result } = await plan({}, {
      selectedVendorAllocationLineItemIds: ['line-2', 'line-2', 'line-other'],
    });

    expect(result.canSplit).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain('duplicate_selected_lines');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('selected_line_not_owned');
  });

  it('supports selected Shopify source line item ids', async () => {
    const { result } = await plan({}, {
      selectedVendorAllocationLineItemIds: [],
      selectedShopifyLineItemIds: ['source-line-3'],
    });

    expect(result.canSplit).toBe(true);
    expect(result.selectedLines.map((line) => line.id)).toEqual(['line-3']);
    expect(result.amountPlan.selectedAmount).toBe(300);
  });

  it('blocks when source sale ledger is missing or voided', async () => {
    const missing = await plan({ financeEntries: [] });
    expect(missing.result.blockers.map((blocker) => blocker.code)).toContain('source_sale_ledger_missing');

    const voided = await plan({ financeEntries: [buildSaleLedger({ voidedAt: new Date('2026-06-23T09:00:00.000Z') })] });
    expect(voided.result.blockers.map((blocker) => blocker.code)).toContain('source_sale_ledger_voided');
  });

  it('builds deterministic child allocation ids independent of selected line order', () => {
    const first = __allocationSplitPlannerTesting.buildDeterministicChildAllocationId('alloc-source', ['line-3', 'line-1']);
    const second = __allocationSplitPlannerTesting.buildDeterministicChildAllocationId('alloc-source', ['line-1', 'line-3']);

    expect(first).toBe(second);
    expect(first).toMatch(/^alloc-split-alloc-source-[a-f0-9]{16}$/);
  });

  it('performs no writes', async () => {
    const db = buildDb(buildAllocation());
    await planAllocationSplitForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
    }, db as never);

    expect(db.vendorAllocation.findUnique).toHaveBeenCalledTimes(1);
    expect(Object.keys(db)).toEqual(['vendorAllocation']);
  });
});
