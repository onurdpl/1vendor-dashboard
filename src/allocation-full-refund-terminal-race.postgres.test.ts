import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function withTimeout<T>(promise: Promise<T>, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), 3_000);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

describeWithPostgres('allocation terminal fact and action guard races with real PostgreSQL', () => {
  let database: (typeof import('../backend/src/db/prisma.js'))['prisma'];
  let acquireOrderLock: (typeof import(
    '../backend/src/modules/shopify/orders-create-ownership.service.js'
  ))['acquireShopifyOrderTransactionLock'];
  let assertActionable: (typeof import(
    '../backend/src/modules/orders/allocation-actionability-guard.service.js'
  ))['assertAllocationActionable'];
  let GuardError: (typeof import(
    '../backend/src/modules/orders/allocation-actionability-guard.service.js'
  ))['AllocationActionabilityGuardError'];
  let createWriter: (typeof import(
    '../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js'
  ))['createAllocationFullRefundTerminalFactService'];
  let sources: (typeof import(
    '../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js'
  ))['FULL_REFUND_TERMINAL_FACT_SOURCES'];

  const runId = `phase3a-${process.pid}-${Date.now()}`;
  const vendorId = `${runId}-vendor`;
  const fixtureIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ prisma: database } = await import('../backend/src/db/prisma.js'));
    ({ acquireShopifyOrderTransactionLock: acquireOrderLock } = await import(
      '../backend/src/modules/shopify/orders-create-ownership.service.js'
    ));
    ({
      assertAllocationActionable: assertActionable,
      AllocationActionabilityGuardError: GuardError,
    } = await import('../backend/src/modules/orders/allocation-actionability-guard.service.js'));
    ({
      createAllocationFullRefundTerminalFactService: createWriter,
      FULL_REFUND_TERMINAL_FACT_SOURCES: sources,
    } = await import('../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js'));
    await database.$connect();
    await database.vendor.create({ data: { id: vendorId, name: vendorId } });
  });

  afterAll(async () => {
    if (!database) return;
    await database.allocationFullRefundTerminalFact.deleteMany({
      where: { vendorAllocationId: { in: fixtureIds } },
    });
    await database.shipmentExecution.deleteMany({
      where: { allocationId: { in: fixtureIds } },
    });
    await database.vendorAllocation.deleteMany({ where: { id: { in: fixtureIds } } });
    await database.shopifyOrder.deleteMany({
      where: { sourceShopifyOrderId: { startsWith: runId } },
    });
    await database.vendor.deleteMany({ where: { id: vendorId } });
    await database.$disconnect();
  });

  async function createFixture(label: string) {
    const allocationId = `${runId}-${label}-allocation`;
    const localOrderId = `${runId}-${label}-local-order`;
    const sourceShopifyOrderId = `${runId}-${label}-shopify-order`;
    fixtureIds.push(allocationId);
    await database.shopifyOrder.create({
      data: {
        id: localOrderId,
        sourceShopifyOrderId,
        sourceShopifyOrderNumber: `#${label}`,
      },
    });
    await database.vendorAllocation.create({
      data: {
        id: allocationId,
        sourceShopifyOrderId: localOrderId,
        sourceShopifyOrderNumber: `#${label}`,
        originalVendorId: vendorId,
        assignedVendorId: vendorId,
      },
    });
    return { allocationId, localOrderId, sourceShopifyOrderId };
  }

  function qualifyingVerifier(sourceShopifyOrderId: string) {
    return {
      verify: async () => ({
        state: 'QUALIFIES' as const,
        reasonCode: 'allocation_full_refund_terminal_verified' as const,
        shopifyOrderGid: `gid://shopify/Order/${sourceShopifyOrderId}`,
        evidence: {
          schemaVersion: 1 as const,
          orderLineItemsComplete: true as const,
          refundsListComplete: true as const,
          fulfillmentCollectionsComplete: true as const,
          refundEvidenceClassification: 'MONETARY_REFUND' as const,
          refundEvidenceReasonCode: 'monetary_refund_verified' as const,
          lines: [{
            vendorAllocationLineItemId: `${runId}-verified-line`,
            shopifyLineItemGid: `gid://shopify/LineItem/${runId}-line`,
            ownedQuantity: 1,
            successfullyRefundedQuantity: 1,
            remainingFulfillableQuantity: 0,
            refunds: [{
              shopifyRefundGid: `gid://shopify/Refund/${runId}-refund`,
              classification: 'MONETARY_REFUND' as const,
              reasonCode: 'monetary_refund_verified' as const,
              refundLineItemsComplete: true as const,
              transactionsComplete: true as const,
              refundLineItems: [{
                shopifyRefundLineItemGid: `gid://shopify/RefundLineItem/${runId}-refund-line`,
                refundedQuantity: 1,
              }],
              transactions: [{
                shopifyTransactionGid: `gid://shopify/OrderTransaction/${runId}-transaction`,
                kind: 'REFUND' as const,
                status: 'SUCCESS' as const,
              }],
            }],
            fulfillmentOrderLines: [],
          }],
        },
      }),
    };
  }

  it('makes a guarded transaction wait and observe a fact when the writer lock wins', async () => {
    const fixture = await createFixture('writer-wins');
    const writerLocked = deferred<void>();
    const releaseWriter = deferred<void>();
    const guardAttemptedLock = deferred<void>();
    const writer = createWriter(
      { FULL_REFUND_TERMINAL_WRITER_ENABLED: true, SHOPIFY_API_VERSION: '2026-01' },
      {} as never,
      {
        db: database,
        verifier: qualifyingVerifier(fixture.sourceShopifyOrderId),
        acquireOrderLock: async (tx, identity) => {
          await acquireOrderLock(tx, identity);
          writerLocked.resolve();
          await releaseWriter.promise;
        },
      },
    );

    const writerResult = writer.createVerifiedFact({
      vendorAllocationId: fixture.allocationId,
      verificationSource: sources.REFUND_WEBHOOK,
    });
    await withTimeout(writerLocked.promise, 'Writer lock');

    let guardSettled = false;
    const guardResult = database.$transaction((tx) => assertActionable(tx, fixture.allocationId, {
      acquireOrderLock: async (lockTx, identity) => {
        guardAttemptedLock.resolve();
        await acquireOrderLock(lockTx, identity);
      },
    })).then(
      () => null,
      (error) => error,
    ).finally(() => {
      guardSettled = true;
    });
    await withTimeout(guardAttemptedLock.promise, 'Guard lock attempt');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(guardSettled).toBe(false);

    releaseWriter.resolve();
    await expect(withTimeout(writerResult, 'Writer result')).resolves.toMatchObject({ outcome: 'CREATED' });
    const guardError = await withTimeout(guardResult, 'Guard result');
    expect(guardError).toBeInstanceOf(GuardError);
    expect(guardError).toMatchObject({ code: 'ALLOCATION_REFUND_TERMINAL' });
  });

  it('makes the writer wait and re-read a durable claim when the guard lock wins', async () => {
    const fixture = await createFixture('guard-wins');
    const guardClaimPersisted = deferred<void>();
    const releaseGuard = deferred<void>();
    const writerAttemptedLock = deferred<void>();

    const guardedClaim = database.$transaction(async (tx) => {
      await assertActionable(tx, fixture.allocationId);
      await tx.shipmentExecution.create({
        data: {
          id: `${runId}-pending-shipment`,
          allocationId: fixture.allocationId,
          vendorId,
          sourceShopifyOrderId: fixture.localOrderId,
          provider: 'KARGONOMI',
          shipmentStatus: 'PENDING',
          requestSnapshot: {},
        },
      });
      guardClaimPersisted.resolve();
      await releaseGuard.promise;
    });
    await withTimeout(guardClaimPersisted.promise, 'Guard durable claim');

    let writerSettled = false;
    const writer = createWriter(
      { FULL_REFUND_TERMINAL_WRITER_ENABLED: true, SHOPIFY_API_VERSION: '2026-01' },
      {} as never,
      {
        db: database,
        verifier: qualifyingVerifier(fixture.sourceShopifyOrderId),
        acquireOrderLock: async (tx, identity) => {
          writerAttemptedLock.resolve();
          await acquireOrderLock(tx, identity);
        },
      },
    );
    const writerResult = writer.createVerifiedFact({
      vendorAllocationId: fixture.allocationId,
      verificationSource: sources.CANONICAL_RECONCILIATION,
    }).finally(() => {
      writerSettled = true;
    });
    await withTimeout(writerAttemptedLock.promise, 'Writer lock attempt');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(writerSettled).toBe(false);

    releaseGuard.resolve();
    await withTimeout(guardedClaim, 'Guard transaction');
    await expect(withTimeout(writerResult, 'Writer result')).resolves.toEqual({
      outcome: 'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM',
      fact: null,
      reasonCode: 'shipment_execution_pending',
    });
    await expect(database.allocationFullRefundTerminalFact.findUnique({
      where: { vendorAllocationId: fixture.allocationId },
    })).resolves.toBeNull();
  });
});
