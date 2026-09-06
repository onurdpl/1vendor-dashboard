import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../backend/src/config/env.js';
import {
  AllocationActionabilityGuardError,
  ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES,
  assertAllocationActionable,
} from '../backend/src/modules/orders/allocation-actionability-guard.service.js';
import {
  createAllocationFullRefundTerminalFactService,
  FULL_REFUND_TERMINAL_FACT_OUTCOMES,
  FULL_REFUND_TERMINAL_FACT_SOURCES,
} from '../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js';
import type { AllocationFullRefundTerminalVerifierResult } from '../backend/src/modules/orders/allocation-full-refund-terminal-verifier.service.js';

const localOrderId = 'cm1234567890localorder';
const shopifyOrderId = '8151983227217';
const shopifyOrderGid = `gid://shopify/Order/${shopifyOrderId}`;
const allocationId = 'alloc-yalispor-8151983227217';

const evidence = {
  schemaVersion: 1 as const,
  orderLineItemsComplete: true as const,
  refundsListComplete: true as const,
  fulfillmentCollectionsComplete: true as const,
  refundEvidenceClassification: 'MONETARY_REFUND' as const,
  refundEvidenceReasonCode: 'monetary_refund_verified' as const,
  lines: [{
    vendorAllocationLineItemId: 'allocation-line-1',
    shopifyLineItemGid: 'gid://shopify/LineItem/line-1',
    ownedQuantity: 1,
    successfullyRefundedQuantity: 1,
    remainingFulfillableQuantity: 0,
    refunds: [{
      shopifyRefundGid: 'gid://shopify/Refund/refund-1',
      classification: 'MONETARY_REFUND' as const,
      reasonCode: 'monetary_refund_verified' as const,
      refundLineItemsComplete: true as const,
      transactionsComplete: true as const,
      refundLineItems: [{
        shopifyRefundLineItemGid: 'gid://shopify/RefundLineItem/refund-line-1',
        refundedQuantity: 1,
      }],
      transactions: [{
        shopifyTransactionGid: 'gid://shopify/OrderTransaction/transaction-1',
        kind: 'REFUND' as const,
        status: 'SUCCESS' as const,
      }],
    }],
    fulfillmentOrderLines: [],
  }],
};

const qualifyingResult: AllocationFullRefundTerminalVerifierResult = {
  state: 'QUALIFIES',
  reasonCode: 'allocation_full_refund_terminal_verified',
  shopifyOrderGid,
  evidence,
};

function verificationAllocation(orderIdentity = shopifyOrderId) {
  return {
    id: allocationId,
    sourceShopifyOrderId: localOrderId,
    order: {
      id: localOrderId,
      sourceShopifyOrderId: orderIdentity,
    },
    lineItems: [{
      id: 'allocation-line-1',
      shopifyLineItemId: 'local-line-1',
      quantity: 1,
      shopifyOrderLineItem: {
        id: 'local-line-1',
        sourceLineItemId: 'line-1',
      },
    }],
  };
}

function persistedFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'terminal-fact-1',
    vendorAllocationId: allocationId,
    shopifyOrderGid,
    verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    shopifyApiVersion: '2026-01',
    verifiedAt: new Date('2026-09-06T10:00:00.000Z'),
    evidenceJson: evidence,
    ...overrides,
  };
}

function currentAllocation(input: {
  terminalFact?: ReturnType<typeof persistedFact> | null;
  pendingShipment?: boolean;
  fulfillmentSyncStatus?: string | null;
} = {}) {
  return {
    id: allocationId,
    sourceShopifyOrderId: localOrderId,
    order: { id: localOrderId, sourceShopifyOrderId: shopifyOrderId },
    fullRefundTerminalFact: input.terminalFact ?? null,
    shipmentExecutions: input.pendingShipment ? [{ id: 'shipment-pending-1' }] : [],
    fulfillment: input.fulfillmentSyncStatus === undefined
      ? null
      : { syncStatus: input.fulfillmentSyncStatus },
  };
}

function createDbMock() {
  return {
    $transaction: vi.fn(),
    shopifyOrder: {
      findUnique: vi.fn(),
    },
    vendorAllocation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    allocationFullRefundTerminalFact: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    shipmentExecution: {
      update: vi.fn(),
      delete: vi.fn(),
    },
    fulfillment: {
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function arrangeWriter(input: {
  enabled?: boolean;
  verification?: AllocationFullRefundTerminalVerifierResult;
  current?: ReturnType<typeof currentAllocation>;
} = {}) {
  const db = createDbMock();
  const verifier = { verify: vi.fn().mockResolvedValue(input.verification ?? qualifyingResult) };
  const acquireOrderLock = vi.fn().mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const current = input.current ?? currentAllocation();
  db.$transaction.mockImplementation(async (callback) => callback(db));
  db.shopifyOrder.findUnique.mockResolvedValue({
    allocations: [{ id: allocationId }],
  });
  db.vendorAllocation.findUnique.mockImplementation(async (args) => {
    if (args.select?.lineItems) return verificationAllocation();
    if (args.select?.fullRefundTerminalFact) return current;
    return verificationAllocation();
  });
  db.allocationFullRefundTerminalFact.create.mockImplementation(async ({ data }) => persistedFact({
    ...data,
  }));
  db.allocationFullRefundTerminalFact.findUnique.mockResolvedValue(null);

  const service = createAllocationFullRefundTerminalFactService(
    {
      FULL_REFUND_TERMINAL_WRITER_ENABLED: input.enabled ?? true,
      SHOPIFY_API_VERSION: '2026-01',
    },
    {} as never,
    {
      db: db as never,
      verifier,
      acquireOrderLock,
      logger: logger as never,
    },
  );
  return { service, db, verifier, acquireOrderLock, logger };
}

describe('allocation full-refund terminal fact writer foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults the writer feature flag to false', () => {
    const keys = [
      'NODE_ENV',
      'FULL_REFUND_TERMINAL_WRITER_ENABLED',
      'CUSTOMER_CANCELLATION_INTAKE_ENABLED',
      'KARGONOMI_BASE_URL',
      'KARGONOMI_API_TOKEN',
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = 'test';
    delete process.env.FULL_REFUND_TERMINAL_WRITER_ENABLED;
    process.env.CUSTOMER_CANCELLATION_INTAKE_ENABLED = 'false';
    process.env.KARGONOMI_BASE_URL = 'https://kargonomi.invalid';
    process.env.KARGONOMI_API_TOKEN = 'test-only-token';
    try {
      expect(loadEnv().FULL_REFUND_TERMINAL_WRITER_ENABLED).toBe(false);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  it('does no DB or canonical work while the writer flag is disabled', async () => {
    const { service, db, verifier, acquireOrderLock } = arrangeWriter({ enabled: false });

    await expect(service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    })).resolves.toEqual({ outcome: 'DISABLED', fact: null, reasonCode: 'writer_disabled' });
    expect(db.vendorAllocation.findUnique).not.toHaveBeenCalled();
    expect(db.allocationFullRefundTerminalFact.create).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(acquireOrderLock).not.toHaveBeenCalled();
  });

  it('does no order lookup or canonical work for disabled order-scoped orchestration', async () => {
    const { service, db, verifier } = arrangeWriter({ enabled: false });

    await expect(service.createVerifiedFactsForShopifyOrder({
      sourceShopifyOrderId: shopifyOrderId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    })).resolves.toEqual({
      sourceShopifyOrderId: shopifyOrderId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
      outcome: 'DISABLED',
      reasonCode: 'writer_disabled',
      allocations: [],
    });
    expect(db.shopifyOrder.findUnique).not.toHaveBeenCalled();
    expect(db.vendorAllocation.findUnique).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('evaluates every allocation independently without order-level closure', async () => {
    const { service, db, verifier, logger } = arrangeWriter();
    db.shopifyOrder.findUnique.mockResolvedValueOnce({
      allocations: [{ id: 'alloc-a' }, { id: 'alloc-b' }],
    });
    db.vendorAllocation.findUnique.mockImplementation(async (args) => {
      if (args.select?.lineItems) {
        return { ...verificationAllocation(), id: args.where.id };
      }
      if (args.select?.fullRefundTerminalFact) {
        return { ...currentAllocation(), id: args.where.id };
      }
      return { ...verificationAllocation(), id: args.where.id };
    });
    verifier.verify
      .mockResolvedValueOnce(qualifyingResult)
      .mockResolvedValueOnce({
        state: 'DOES_NOT_QUALIFY',
        reasonCode: 'refund_quantity_below_owned_quantity',
        evidence: null,
      });

    const result = await service.createVerifiedFactsForShopifyOrder({
      sourceShopifyOrderId: shopifyOrderId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION,
    });

    expect(db.shopifyOrder.findUnique).toHaveBeenCalledWith({
      where: { sourceShopifyOrderId: shopifyOrderId },
      select: {
        allocations: {
          select: { id: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    expect(verifier.verify).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      outcome: 'COMPLETED',
      reasonCode: null,
      allocations: [
        {
          allocationId: 'alloc-a',
          verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION,
          outcome: 'CREATED',
          reasonCode: null,
        },
        {
          allocationId: 'alloc-b',
          verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION,
          outcome: 'DOES_NOT_QUALIFY',
          reasonCode: 'refund_quantity_below_owned_quantity',
        },
      ],
    });
    expect(result).not.toHaveProperty('fact');
    expect(result).not.toHaveProperty('evidenceJson');
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('isolates one allocation exception and continues evaluating the others', async () => {
    const { service, db, verifier, logger } = arrangeWriter();
    db.shopifyOrder.findUnique.mockResolvedValueOnce({
      allocations: [{ id: 'alloc-a' }, { id: 'alloc-b' }],
    });
    db.vendorAllocation.findUnique.mockImplementation(async (args) => ({
      ...verificationAllocation(),
      id: args.where.id,
    }));
    verifier.verify
      .mockRejectedValueOnce(new Error('sensitive upstream detail'))
      .mockResolvedValueOnce({
        state: 'DOES_NOT_QUALIFY',
        reasonCode: 'refund_quantity_below_owned_quantity',
        evidence: null,
      });

    const result = await service.createVerifiedFactsForShopifyOrder({
      sourceShopifyOrderId: shopifyOrderId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    });

    expect(verifier.verify).toHaveBeenCalledTimes(2);
    expect(result.allocations).toEqual([
      {
        allocationId: 'alloc-a',
        verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
        outcome: 'ERROR',
        reasonCode: 'unexpected_writer_error',
      },
      {
        allocationId: 'alloc-b',
        verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
        outcome: 'DOES_NOT_QUALIFY',
        reasonCode: 'refund_quantity_below_owned_quantity',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('sensitive upstream detail');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      allocationId: 'alloc-a',
      outcome: 'ERROR',
      reasonCode: 'unexpected_writer_error',
    }), expect.any(String));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sensitive upstream detail');
  });

  it('warns with sanitized fields when an allocation is indeterminate', async () => {
    const { service, logger } = arrangeWriter({
      verification: {
        state: 'INDETERMINATE',
        reasonCode: 'canonical_refunds_list_incomplete',
        evidence: null,
      },
    });

    const result = await service.createVerifiedFactsForShopifyOrder({
      sourceShopifyOrderId: shopifyOrderId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION,
    });

    expect(result.allocations[0]).toMatchObject({
      outcome: 'INDETERMINATE',
      reasonCode: 'canonical_refunds_list_incomplete',
    });
    expect(logger.warn).toHaveBeenCalledWith({
      allocationId,
      sourceShopifyOrderId: shopifyOrderId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION,
      outcome: 'INDETERMINATE',
      reasonCode: 'canonical_refunds_list_incomplete',
    }, expect.any(String));
  });

  it('creates exactly one immutable fact from the qualifying verifier result', async () => {
    const { service, db, verifier, acquireOrderLock } = arrangeWriter();

    const result = await service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    });

    expect(result.outcome).toBe(FULL_REFUND_TERMINAL_FACT_OUTCOMES.created);
    expect(verifier.verify).toHaveBeenCalledWith(verificationAllocation());
    expect(acquireOrderLock).toHaveBeenCalledWith(db, shopifyOrderId);
    expect(acquireOrderLock).not.toHaveBeenCalledWith(db, localOrderId);
    expect(db.allocationFullRefundTerminalFact.create).toHaveBeenCalledTimes(1);
    expect(db.allocationFullRefundTerminalFact.create).toHaveBeenCalledWith({
      data: {
        vendorAllocationId: allocationId,
        shopifyOrderGid,
        verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
        shopifyApiVersion: '2026-01',
        evidenceJson: evidence,
      },
    });
    expect(shopifyOrderGid).not.toBe(localOrderId);
    expect(db.allocationFullRefundTerminalFact.update).not.toHaveBeenCalled();
    expect(db.allocationFullRefundTerminalFact.delete).not.toHaveBeenCalled();
    expect(db.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('returns the original fact without changing source or evidence on a duplicate invocation', async () => {
    const original = persistedFact({
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION,
      evidenceJson: { original: true },
    });
    const { service, db } = arrangeWriter({ current: currentAllocation({ terminalFact: original }) });

    const result = await service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.HISTORICAL_BACKFILL,
    });

    expect(result).toEqual({
      outcome: 'ALREADY_EXISTS_SAME_TERMINAL_STATE',
      fact: original,
      reasonCode: null,
    });
    expect(db.allocationFullRefundTerminalFact.create).not.toHaveBeenCalled();
    expect(db.allocationFullRefundTerminalFact.update).not.toHaveBeenCalled();
    expect(result.fact?.verificationSource).toBe(FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION);
    expect(result.fact?.evidenceJson).toEqual({ original: true });
  });

  it('re-reads and returns the immutable winner after a P2002 create race', async () => {
    const winner = persistedFact({ verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CURRENT_STATE_REPAIR });
    const { service, db } = arrangeWriter();
    db.allocationFullRefundTerminalFact.create.mockRejectedValueOnce({ code: 'P2002' });
    db.allocationFullRefundTerminalFact.findUnique.mockResolvedValueOnce(winner);

    const result = await service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    });

    expect(result).toEqual({
      outcome: 'ALREADY_EXISTS_SAME_TERMINAL_STATE',
      fact: winner,
      reasonCode: null,
    });
    expect(db.allocationFullRefundTerminalFact.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      state: 'DOES_NOT_QUALIFY' as const,
      reasonCode: 'refund_quantity_below_owned_quantity',
      expectedOutcome: 'DOES_NOT_QUALIFY',
    },
    {
      state: 'INDETERMINATE' as const,
      reasonCode: 'canonical_shopify_order_identity_missing',
      expectedOutcome: 'INDETERMINATE',
    },
  ])('does not write for $state verification', async ({ state, reasonCode, expectedOutcome }) => {
    const { service, db } = arrangeWriter({
      verification: { state, reasonCode, evidence: null } as AllocationFullRefundTerminalVerifierResult,
    });

    const result = await service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CANONICAL_RECONCILIATION,
    });

    expect(result).toEqual({ outcome: expectedOutcome, fact: null, reasonCode });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.allocationFullRefundTerminalFact.create).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical Shopify identity is missing at locked creation time', async () => {
    const current = currentAllocation();
    current.order.sourceShopifyOrderId = '  ';
    const { service, db, acquireOrderLock } = arrangeWriter({ current });

    const result = await service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    });

    expect(result).toEqual({
      outcome: 'INDETERMINATE',
      fact: null,
      reasonCode: 'canonical_shopify_order_identity_changed',
    });
    expect(acquireOrderLock).toHaveBeenCalledWith(db, shopifyOrderId);
    expect(db.allocationFullRefundTerminalFact.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      current: currentAllocation({ pendingShipment: true }),
      reasonCode: 'shipment_execution_pending',
    },
    {
      current: currentAllocation({ fulfillmentSyncStatus: 'fulfillment_submission_pending' }),
      reasonCode: 'shopify_fulfillment_submission_pending',
    },
  ])('returns a controlled conflict for active durable claim $reasonCode', async ({ current, reasonCode }) => {
    const { service, db } = arrangeWriter({ current });

    const result = await service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.REFUND_WEBHOOK,
    });

    expect(result).toEqual({
      outcome: 'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM',
      fact: null,
      reasonCode,
    });
    expect(db.vendorAllocation.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        shipmentExecutions: expect.objectContaining({
          where: { shipmentStatus: 'PENDING' },
        }),
      }),
    }));
    expect(db.allocationFullRefundTerminalFact.create).not.toHaveBeenCalled();
  });

  it('preserves completed historical shipment and fulfillment state', async () => {
    const { service, db } = arrangeWriter({
      current: currentAllocation({ fulfillmentSyncStatus: 'synced' }),
    });

    await expect(service.createVerifiedFact({
      vendorAllocationId: allocationId,
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.HISTORICAL_BACKFILL,
    })).resolves.toMatchObject({ outcome: 'CREATED' });
    expect(db.shipmentExecution.update).not.toHaveBeenCalled();
    expect(db.shipmentExecution.delete).not.toHaveBeenCalled();
    expect(db.fulfillment.update).not.toHaveBeenCalled();
    expect(db.fulfillment.delete).not.toHaveBeenCalled();
    expect(db.vendorAllocation.update).not.toHaveBeenCalled();
  });
});

function guardInitial(orderIdentity = shopifyOrderId) {
  return {
    id: allocationId,
    sourceShopifyOrderId: localOrderId,
    order: { id: localOrderId, sourceShopifyOrderId: orderIdentity },
  };
}

function guardCurrent(terminal = false) {
  return {
    ...guardInitial(),
    allocationStatus: 'ACTIVE',
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    reassignmentRequired: false,
    carrier: null,
    trackingNumber: null,
    fullRefundTerminalFact: terminal ? { id: 'terminal-fact-1' } : null,
  };
}

describe('shared allocation actionability guard foundation', () => {
  it('locks by real Shopify identity, re-reads, and returns actionable context', async () => {
    const tx = { vendorAllocation: { findUnique: vi.fn() } };
    tx.vendorAllocation.findUnique
      .mockResolvedValueOnce(guardInitial())
      .mockResolvedValueOnce(guardCurrent(false));
    const acquireOrderLock = vi.fn().mockResolvedValue(undefined);

    const result = await assertAllocationActionable(tx as never, allocationId, { acquireOrderLock });

    expect(result.decision).toEqual({ actionable: true, reason: null });
    expect(result.sourceShopifyOrderId).toBe(shopifyOrderId);
    expect(acquireOrderLock).toHaveBeenCalledWith(tx, shopifyOrderId);
    expect(acquireOrderLock).not.toHaveBeenCalledWith(tx, localOrderId);
    expect(acquireOrderLock.mock.invocationCallOrder[0]).toBeLessThan(
      tx.vendorAllocation.findUnique.mock.invocationCallOrder[1]!,
    );
  });

  it('throws the structured terminal reason only after the locked re-read', async () => {
    const tx = { vendorAllocation: { findUnique: vi.fn() } };
    tx.vendorAllocation.findUnique
      .mockResolvedValueOnce(guardInitial())
      .mockResolvedValueOnce(guardCurrent(true));
    const acquireOrderLock = vi.fn().mockResolvedValue(undefined);

    const error = await assertAllocationActionable(tx as never, allocationId, { acquireOrderLock })
      .then(() => null, (caught) => caught);

    expect(error).toBeInstanceOf(AllocationActionabilityGuardError);
    expect(error).toMatchObject({
      code: ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.refundTerminal,
      message: 'Allocation is operationally closed by a verified full refund.',
    });
    expect(acquireOrderLock.mock.invocationCallOrder[0]).toBeLessThan(
      tx.vendorAllocation.findUnique.mock.invocationCallOrder[1]!,
    );
    expect(error).not.toHaveProperty('evidenceJson');
  });

  it('fails closed without locking when canonical Shopify identity is missing', async () => {
    const tx = { vendorAllocation: { findUnique: vi.fn().mockResolvedValue(guardInitial('  ')) } };
    const acquireOrderLock = vi.fn().mockResolvedValue(undefined);

    await expect(
      assertAllocationActionable(tx as never, allocationId, { acquireOrderLock }),
    ).rejects.toMatchObject({
      code: ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.canonicalOrderIdentityMissing,
    });
    expect(acquireOrderLock).not.toHaveBeenCalled();
    expect(tx.vendorAllocation.findUnique).toHaveBeenCalledTimes(1);
  });
});
