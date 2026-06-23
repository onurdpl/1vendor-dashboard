import { describe, expect, it } from 'vitest';
import {
  __allocationSplitServiceTesting,
  AllocationSplitValidationError,
  splitAllocationForLineItemReject,
} from '../backend/src/modules/orders/allocation-split.service';
import { buildAllocationSplitSelectedLineHash, buildDeterministicChildAllocationId } from '../backend/src/modules/orders/allocation-split-planner.service';
import { getOperationalStory } from './lib/orderOperationalStory';

function buildLine(id: string, sourceLineItemId: string, amount: string) {
  return {
    id,
    vendorAllocationId: 'alloc-source',
    shopifyLineItemId: `shopify-db-${sourceLineItemId}`,
    quantity: 1,
    lineAmount: amount,
    createdAt: new Date('2026-06-23T08:00:00.000Z'),
    updatedAt: new Date('2026-06-23T08:00:00.000Z'),
    shopifyOrderLineItem: {
      id: `shopify-db-${sourceLineItemId}`,
      shopifyOrderId: 'shopify-order-db-1098',
      sourceLineItemId,
      sku: `SKU-${sourceLineItemId}`,
      title: `Item ${sourceLineItemId}`,
      imageUrl: null,
      shopifyProductId: null,
      sourceVariantId: null,
      quantity: 1,
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

function buildSourceLedger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fin-vendor-a-sale-781877444617-alloc-source',
    vendorAllocationId: 'alloc-source',
    vendorId: 'vendor-a',
    entryType: 'sale',
    amount: '600.00',
    payoutStatus: 'PENDING',
    description: 'Allocated sale for Shopify order #1098',
    commissionPercentSnapshot: '10.00',
    commissionVatPercentSnapshot: '20.00',
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: 'DISABLED',
    fixedShippingFeeSnapshot: null,
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    shippingCostIdSnapshot: null,
    financialProfileIdSnapshot: 'profile-vendor-a',
    settlementDelayDaysSnapshot: 21,
    settlementStatus: 'ACCRUING',
    settlementEligibleAt: null,
    accruedAt: new Date('2026-06-23T08:00:00.000Z'),
    payableAt: null,
    settledAt: null,
    settlementHoldReason: null,
    voidedAt: null,
    voidReason: null,
    supersededByLedgerId: null,
    payoutBatchLines: [],
    settlementApprovalLines: [],
    ...overrides,
  };
}

function buildSourceAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-source',
    sourceShopifyOrderId: 'shopify-order-db-1098',
    sourceShopifyOrderNumber: '#1098',
    originalVendorId: 'vendor-a',
    assignedVendorId: 'vendor-a',
    allocationStatus: 'ACTIVE',
    cancellationReason: null,
    reassignmentRequired: false,
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
    createdAt: new Date('2026-06-23T08:00:00.000Z'),
    updatedAt: new Date('2026-06-23T08:00:00.000Z'),
    order: {
      id: 'shopify-order-db-1098',
      sourceShopifyOrderId: '781877444617',
      sourceShopifyOrderNumber: '#1098',
      currency: 'TRY',
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
    financeEntries: [buildSourceLedger()],
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createSplitDb(sourceOverrides: Record<string, unknown> = {}) {
  const state = {
    allocations: new Map<string, any>(),
    lines: new Map<string, any>(),
    ledgers: new Map<string, any>(),
    splitEvents: new Map<string, any>(),
    history: [] as any[],
    financeEvents: [] as any[],
    ledgerOperations: [] as string[],
  };
  const source = buildSourceAllocation(sourceOverrides);
  state.allocations.set(source.id, source);
  source.lineItems.forEach((line: any) => state.lines.set(line.id, line));
  source.financeEntries.forEach((ledger: any) => state.ledgers.set(ledger.id, ledger));

  function hydrateAllocation(allocation: any) {
    if (!allocation) return null;
    const copy = clone(allocation);
    copy.lineItems = [...state.lines.values()]
      .filter((line) => line.vendorAllocationId === allocation.id)
      .map(clone);
    copy.financeEntries = [...state.ledgers.values()]
      .filter((ledger) => ledger.vendorAllocationId === allocation.id)
      .map(clone);
    return copy;
  }

  const tx = {
    vendorAllocation: {
      findUnique: async ({ where }: any) => hydrateAllocation(state.allocations.get(where.id)),
      create: async ({ data, include }: any) => {
        const created = {
          ...data,
          createdAt: new Date('2026-06-23T08:01:00.000Z'),
          updatedAt: new Date('2026-06-23T08:01:00.000Z'),
          order: source.order,
          lineItems: [],
          fulfillment: null,
          shipmentExecutions: [],
          returnRecords: [],
          refundRecords: [],
          economicTransfers: [],
          financeIntegrityAlerts: [],
          financeEntries: [],
        };
        state.allocations.set(created.id, created);
        return include?.order ? hydrateAllocation(created) : clone(created);
      },
    },
    vendorAllocationLineItem: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        const ids = new Set(where.id.in);
        state.lines.forEach((line) => {
          if (ids.has(line.id) && line.vendorAllocationId === where.vendorAllocationId) {
            line.vendorAllocationId = data.vendorAllocationId;
            count += 1;
          }
        });
        return { count };
      },
      count: async ({ where }: any) =>
        [...state.lines.values()].filter((line) => line.vendorAllocationId === where.vendorAllocationId).length,
    },
    financeLedgerEntry: {
      findMany: async ({ where }: any) => {
        const ids = new Set(where.id.in);
        return [...state.ledgers.values()].filter((ledger) => ids.has(ledger.id)).map(clone);
      },
      create: async ({ data }: any) => {
        if (state.ledgers.has(data.id)) {
          throw new Error(`duplicate ledger ${data.id}`);
        }
        state.ledgerOperations.push(`create:${data.id}`);
        const created = {
          ...data,
          voidedAt: null,
          voidReason: null,
          supersededByLedgerId: null,
          payoutBatchLines: [],
          settlementApprovalLines: [],
          createdAt: new Date('2026-06-23T08:01:00.000Z'),
          updatedAt: new Date('2026-06-23T08:01:00.000Z'),
        };
        state.ledgers.set(created.id, created);
        return clone(created);
      },
      update: async ({ where, data }: any) => {
        const existing = state.ledgers.get(where.id);
        if (!existing) throw new Error(`missing ledger ${where.id}`);
        if (data.supersededByLedgerId && !state.ledgers.has(data.supersededByLedgerId)) {
          throw new Error(`foreign key violation for supersededByLedgerId ${data.supersededByLedgerId}`);
        }
        state.ledgerOperations.push(`update:${where.id}:supersededBy:${data.supersededByLedgerId ?? 'none'}`);
        Object.assign(existing, data);
        return clone(existing);
      },
    },
    allocationSplitEvent: {
      findUnique: async ({ where }: any) => clone(state.splitEvents.get(where.id) ?? null),
      create: async ({ data }: any) => {
        if (state.splitEvents.has(data.id)) {
          throw new Error(`duplicate split event ${data.id}`);
        }
        const created = {
          ...data,
          createdAt: new Date('2026-06-23T08:01:00.000Z'),
        };
        state.splitEvents.set(created.id, created);
        return clone(created);
      },
    },
    allocationAssignmentHistory: {
      create: async ({ data }: any) => {
        state.history.push(data);
        return clone(data);
      },
    },
    financeEvent: {
      createMany: async ({ data }: any) => {
        state.financeEvents.push(...data);
        return { count: data.length };
      },
    },
  };
  const db = {
    $transaction: async (callback: any) => callback(tx),
  };
  return { db, tx, state };
}

async function expectSplitBlocked(sourceOverrides: Record<string, unknown>, expectedCode: string) {
  const { db } = createSplitDb(sourceOverrides);
  await expect(splitAllocationForLineItemReject({
    vendorAllocationId: 'alloc-source',
    selectedVendorAllocationLineItemIds: ['line-2'],
    actorVendorId: 'vendor-a',
    actorUserId: 'admin-1',
    reason: 'OUT_OF_STOCK',
    note: 'one line unavailable',
    confirmSplit: true,
  }, db as never)).rejects.toMatchObject({
    code: expectedCode,
  });
}

describe('allocation split service', () => {
  it('splits one line out of three transactionally', async () => {
    const { db, state } = createSplitDb();

    const result = await splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      actorVendorId: 'vendor-a',
      actorUserId: 'admin-1',
      reason: 'OUT_OF_STOCK',
      note: 'one line unavailable',
      confirmSplit: true,
    }, db as never);

    const selectedHash = buildAllocationSplitSelectedLineHash(['line-2']);
    const expectedChildId = buildDeterministicChildAllocationId('alloc-source', ['line-2']);
    const expectedRemainingLedgerId = __allocationSplitServiceTesting.buildRemainingReplacementLedgerId({
      vendorId: 'vendor-a',
      sourceShopifyOrderId: '781877444617',
      sourceAllocationId: 'alloc-source',
      selectedLineHash: selectedHash,
    });

    expect(result).toMatchObject({
      splitEventId: `split-event-${expectedChildId}`,
      sourceAllocationId: 'alloc-source',
      childAllocationId: expectedChildId,
      movedVendorAllocationLineItemIds: ['line-2'],
      sourceSaleLedgerId: 'fin-vendor-a-sale-781877444617-alloc-source',
      remainingSaleLedgerId: expectedRemainingLedgerId,
      childSaleLedgerId: `fin-vendor-a-sale-781877444617-${expectedChildId}`,
      amountPlan: {
        originalAmount: 600,
        selectedAmount: 200,
        remainingAmount: 400,
      },
      idempotent: false,
    });
    expect(state.lines.get('line-2').vendorAllocationId).toBe(expectedChildId);
    expect(state.lines.get('line-1').vendorAllocationId).toBe('alloc-source');
    expect(state.lines.get('line-3').vendorAllocationId).toBe('alloc-source');

    const child = state.allocations.get(expectedChildId);
    expect(child).toMatchObject({
      allocationStatus: 'VENDOR_BLOCKED',
      reassignmentRequired: true,
      cancellationReason: 'OUT_OF_STOCK',
      trackingNumber: null,
      carrier: null,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    });
    expect(state.allocations.get('alloc-source')).toMatchObject({
      allocationStatus: 'ACTIVE',
      reassignmentRequired: false,
      cancellationReason: null,
    });
  });

  it('voids source ledger, creates replacement ledgers, split event, history, and sale events', async () => {
    const { db, state } = createSplitDb();

    const result = await splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      actorVendorId: 'vendor-a',
      actorUserId: 'admin-1',
      reason: 'OUT_OF_STOCK',
      note: 'one line unavailable',
      confirmSplit: true,
    }, db as never);

    const sourceLedger = state.ledgers.get(result.sourceSaleLedgerId);
    const remainingLedger = state.ledgers.get(result.remainingSaleLedgerId);
    const childLedger = state.ledgers.get(result.childSaleLedgerId);

    expect(sourceLedger).toMatchObject({
      voidReason: `allocation_split:${result.splitEventId}`,
      supersededByLedgerId: result.remainingSaleLedgerId,
    });
    expect(sourceLedger.voidedAt).toBeInstanceOf(Date);
    expect(remainingLedger).toMatchObject({
      vendorAllocationId: 'alloc-source',
      amount: '400.00',
      voidedAt: null,
    });
    expect(childLedger).toMatchObject({
      vendorAllocationId: result.childAllocationId,
      amount: '200.00',
      voidedAt: null,
    });
    const activeSourceLedgers = [...state.ledgers.values()].filter((ledger) =>
      ledger.vendorAllocationId === 'alloc-source' && ledger.entryType === 'sale' && !ledger.voidedAt && !ledger.supersededByLedgerId
    );
    const activeChildLedgers = [...state.ledgers.values()].filter((ledger) =>
      ledger.vendorAllocationId === result.childAllocationId && ledger.entryType === 'sale' && !ledger.voidedAt && !ledger.supersededByLedgerId
    );
    expect(activeSourceLedgers.map((ledger) => ledger.id)).toEqual([result.remainingSaleLedgerId]);
    expect(activeChildLedgers.map((ledger) => ledger.id)).toEqual([result.childSaleLedgerId]);

    expect(state.splitEvents.get(result.splitEventId)).toMatchObject({
      sourceAllocationId: 'alloc-source',
      childAllocationId: result.childAllocationId,
      sourceFinanceLedgerEntryId: result.sourceSaleLedgerId,
      remainingFinanceLedgerEntryId: result.remainingSaleLedgerId,
      childFinanceLedgerEntryId: result.childSaleLedgerId,
    });
    expect(state.history.map((entry) => entry.action)).toEqual([
      'allocation_split_source_updated',
      'vendor_blocked',
    ]);
    expect(state.financeEvents).toHaveLength(8);
    expect(state.financeEvents.map((event) => event.idempotencyKey)).toEqual(
      expect.arrayContaining([
        `${result.remainingSaleLedgerId}:SALE_RECORDED`,
        `${result.remainingSaleLedgerId}:COMMISSION_RESERVED`,
        `${result.remainingSaleLedgerId}:COMMISSION_VAT_RESERVED`,
        `${result.remainingSaleLedgerId}:VENDOR_PAYABLE_RESERVED`,
        `${result.childSaleLedgerId}:SALE_RECORDED`,
        `${result.childSaleLedgerId}:COMMISSION_RESERVED`,
        `${result.childSaleLedgerId}:COMMISSION_VAT_RESERVED`,
        `${result.childSaleLedgerId}:VENDOR_PAYABLE_RESERVED`,
      ]),
    );
    expect(Number(remainingLedger.amount) + Number(childLedger.amount)).toBe(Number(sourceLedger.amount));
  });

  it('creates replacement ledgers before superseding the source ledger', async () => {
    const { db, state } = createSplitDb();

    const result = await splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      actorVendorId: 'vendor-a',
      actorUserId: 'admin-1',
      reason: 'OUT_OF_STOCK',
      note: 'one line unavailable',
      confirmSplit: true,
    }, db as never);

    const remainingCreateIndex = state.ledgerOperations.indexOf(`create:${result.remainingSaleLedgerId}`);
    const childCreateIndex = state.ledgerOperations.indexOf(`create:${result.childSaleLedgerId}`);
    const supersedeUpdateIndex = state.ledgerOperations.indexOf(
      `update:${result.sourceSaleLedgerId}:supersededBy:${result.remainingSaleLedgerId}`,
    );

    expect(remainingCreateIndex).toBeGreaterThanOrEqual(0);
    expect(childCreateIndex).toBeGreaterThanOrEqual(0);
    expect(supersedeUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(remainingCreateIndex).toBeLessThan(supersedeUpdateIndex);
    expect(childCreateIndex).toBeLessThan(supersedeUpdateIndex);
    expect(state.ledgers.has(result.remainingSaleLedgerId)).toBe(true);
    expect(state.ledgers.get(result.sourceSaleLedgerId).supersededByLedgerId).toBe(result.remainingSaleLedgerId);
  });

  it('rejects all-selected splits in favor of full allocation reject', async () => {
    const { db } = createSplitDb();

    await expect(splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-1', 'line-2', 'line-3'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, db as never)).rejects.toMatchObject({
      code: 'all_lines_selected',
    });
  });

  it('requires confirmSplit', async () => {
    const { db } = createSplitDb();

    await expect(splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: false as true,
    }, db as never)).rejects.toMatchObject({
      code: 'confirm_split_required',
    });
  });

  it.each([
    ['tracking', { trackingNumber: 'TRACK-1' }, 'tracking_exists'],
    ['carrier', { carrier: 'Carrier' }, 'carrier_exists'],
    ['fulfillment', { fulfillment: { id: 'fulfillment-1' } }, 'fulfillment_exists'],
    ['pending shipment', { shipmentExecutions: [{ shipmentStatus: 'PENDING' }] }, 'shipment_execution_exists'],
    ['refund', { refundRecords: [{ id: 'refund-1' }] }, 'refund_exists'],
    ['return', { returnRecords: [{ id: 'return-1' }] }, 'return_exists'],
    ['finance alert', { financeIntegrityAlerts: [{ status: 'acknowledged', severity: 'warning' }] }, 'finance_integrity_alert_exists'],
    ['settlement', { financeEntries: [buildSourceLedger({ settlementApprovalLines: [{ id: 'settlement-line-1' }] })] }, 'settlement_approval_exists'],
    ['payout', { financeEntries: [buildSourceLedger({ payoutBatchLines: [{ id: 'payout-line-1' }] })] }, 'payout_batch_exists'],
    ['transfer', { economicTransfers: [{ status: 'IN_PROGRESS' }] }, 'economic_transfer_exists'],
    ['multiple active sale ledgers', { financeEntries: [buildSourceLedger(), buildSourceLedger({ id: 'fin-second-sale' })] }, 'multiple_active_sale_ledgers'],
    ['missing source ledger', { financeEntries: [] }, 'source_sale_ledger_missing'],
  ])('blocks when %s evidence exists', async (_name, sourceOverrides, expectedCode) => {
    await expectSplitBlocked(sourceOverrides, expectedCode);
  });

  it('allows failed and cancelled shipment executions', async () => {
    await expect(splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, createSplitDb({ shipmentExecutions: [{ shipmentStatus: 'FAILED' }] }).db as never)).resolves.toMatchObject({
      childAllocationId: expect.stringContaining('alloc-split-alloc-source'),
    });

    await expect(splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, createSplitDb({ shipmentExecutions: [{ shipmentStatus: 'CANCELLED' }] }).db as never)).resolves.toMatchObject({
      childAllocationId: expect.stringContaining('alloc-split-alloc-source'),
    });
  });

  it('returns completed split idempotently for the same request', async () => {
    const { db } = createSplitDb();
    const first = await splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, db as never);
    const second = await splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, db as never);

    expect(second).toMatchObject({
      ...first,
      idempotent: true,
    });
  });

  it('blocks existing child without split event', async () => {
    const { db, state } = createSplitDb();
    const childId = buildDeterministicChildAllocationId('alloc-source', ['line-2']);
    state.allocations.set(childId, {
      ...buildSourceAllocation({ id: childId }),
      id: childId,
      lineItems: [],
      financeEntries: [],
    });

    await expect(splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, db as never)).rejects.toMatchObject({
      code: 'allocation_split_inconsistent_existing_child',
    });
  });

  it('blocks voided source ledger without complete split', async () => {
    const { db, state } = createSplitDb();
    const sourceLedger = state.ledgers.get('fin-vendor-a-sale-781877444617-alloc-source');
    sourceLedger.voidedAt = new Date('2026-06-23T09:00:00.000Z');
    sourceLedger.voidReason = 'allocation_split:missing';

    await expect(splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, db as never)).rejects.toMatchObject({
      code: 'allocation_split_inconsistent_voided_source_ledger',
    });
  });

  it('projects source and child through canonical operational story states', async () => {
    const { db, state } = createSplitDb();
    const result = await splitAllocationForLineItemReject({
      vendorAllocationId: 'alloc-source',
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      confirmSplit: true,
    }, db as never);

    expect(getOperationalStory(state.allocations.get('alloc-source')).state).toBe('active_or_unknown');
    expect(getOperationalStory(state.allocations.get(result.childAllocationId)).state).toBe('vendor_blocked_awaiting_admin_resolution');
  });
});
