import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const CustomerCancellationStatus = {
  PENDING: 'PENDING',
  APPROVED_FOR_REFUND: 'APPROVED_FOR_REFUND',
  CONFLICTED: 'CONFLICTED',
  TOO_LATE: 'TOO_LATE',
} as const;
const ShippingProvider = { KARGONOMI: 'KARGONOMI' } as const;
const ShipmentExecutionStatus = { PENDING: 'PENDING', CREATED: 'CREATED' } as const;

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
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

async function waitForAdvisoryBlock(
  database: (typeof import('../backend/src/db/prisma.js'))['prisma'],
  blockerPid: number,
  blockedPid: number,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const [{ blocked }] = await database.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT (${blockerPid})::integer = ANY(pg_blocking_pids((${blockedPid})::integer)) AS "blocked"
    `;
    if (blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Customer-cancellation/shipment advisory blocking was not observed.');
}

describeWithPostgres('customer cancellation shipment hold with real PostgreSQL', () => {
  let database: (typeof import('../backend/src/db/prisma.js'))['prisma'];
  let acquireShopifyOrderTransactionLock: (typeof import(
    '../backend/src/modules/shopify/orders-create-ownership.service.js'
  ))['acquireShopifyOrderTransactionLock'];
  let assertNoPendingCustomerCancellationHold: (typeof import(
    '../backend/src/modules/orders/customer-cancellation-hold.service.js'
  ))['assertNoPendingCustomerCancellationHold'];
  let hasPendingCustomerCancellationHold: (typeof import(
    '../backend/src/modules/orders/customer-cancellation-hold.service.js'
  ))['hasPendingCustomerCancellationHold'];
  let createPendingCustomerCancellationRequest: (typeof import(
    '../backend/src/modules/orders/customer-cancellation-request.service.js'
  ))['createPendingCustomerCancellationRequest'];
  let approveCustomerCancellationItemForRefund: (typeof import(
    '../backend/src/modules/orders/customer-cancellation-request.service.js'
  ))['approveCustomerCancellationItemForRefund'];

  const suffix = `phase2-${process.pid}`;
  const vendorAId = `${suffix}-vendor-a`;
  const vendorBId = `${suffix}-vendor-b`;
  const orderId = `${suffix}-order`;
  const sourceOrderId = `gid://shopify/Order/${suffix}`;
  const lineAId = `${suffix}-line-a`;
  const lineBId = `${suffix}-line-b`;
  const allocationAId = `${suffix}-allocation-a`;
  const allocationBId = `${suffix}-allocation-b`;
  const adminUserId = `${suffix}-admin`;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ prisma: database } = await import('../backend/src/db/prisma.js'));
    ({ acquireShopifyOrderTransactionLock } = await import(
      '../backend/src/modules/shopify/orders-create-ownership.service.js'
    ));
    ({ assertNoPendingCustomerCancellationHold, hasPendingCustomerCancellationHold } = await import(
      '../backend/src/modules/orders/customer-cancellation-hold.service.js'
    ));
    ({ createPendingCustomerCancellationRequest, approveCustomerCancellationItemForRefund } = await import(
      '../backend/src/modules/orders/customer-cancellation-request.service.js'
    ));
    await database.$connect();
  });

  beforeEach(async () => {
    await database.shopifyOrder.deleteMany({ where: { id: orderId } });
    await database.vendor.deleteMany({ where: { id: { in: [vendorAId, vendorBId] } } });
    await database.user.upsert({
      where: { email: `${suffix}@example.test` },
      create: {
        id: adminUserId,
        email: `${suffix}@example.test`,
        name: 'Phase lifecycle admin',
        role: 'ADMIN',
        passwordHash: 'not-used',
      },
      update: {},
    });
    await database.vendor.createMany({
      data: [
        { id: vendorAId, name: 'Phase 2 Vendor A' },
        { id: vendorBId, name: 'Phase 2 Vendor B' },
      ],
    });
    await database.shopifyOrder.create({
      data: {
        id: orderId,
        sourceShopifyOrderId: sourceOrderId,
        sourceShopifyOrderNumber: '#phase2',
        lineItems: {
          create: [
            { id: lineAId, sourceLineItemId: `gid://shopify/LineItem/${suffix}-a`, quantity: 1 },
            { id: lineBId, sourceLineItemId: `gid://shopify/LineItem/${suffix}-b`, quantity: 1 },
          ],
        },
      },
    });
    await database.vendorAllocation.create({
      data: {
        id: allocationAId,
        sourceShopifyOrderId: orderId,
        sourceShopifyOrderNumber: '#phase2',
        originalVendorId: vendorAId,
        assignedVendorId: vendorAId,
        lineItems: { create: { id: `${suffix}-allocation-line-a`, shopifyLineItemId: lineAId, quantity: 1 } },
      },
    });
    await database.vendorAllocation.create({
      data: {
        id: allocationBId,
        sourceShopifyOrderId: orderId,
        sourceShopifyOrderNumber: '#phase2',
        originalVendorId: vendorBId,
        assignedVendorId: vendorBId,
        lineItems: { create: { id: `${suffix}-allocation-line-b`, shopifyLineItemId: lineBId, quantity: 1 } },
      },
    });
  });

  afterAll(async () => {
    if (!database) return;
    await database.shopifyOrder.deleteMany({ where: { id: orderId } });
    await database.vendor.deleteMany({ where: { id: { in: [vendorAId, vendorBId] } } });
    await database.user.deleteMany({ where: { id: adminUserId } });
    await database.$disconnect();
  });

  it('serializes a request winner before shipment authorization and keeps the hold allocation-scoped', async () => {
    const requestCommitted = deferred<number>();
    const releaseRequest = deferred<void>();
    const shipmentStarted = deferred<number>();

    const requestTransaction = database.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::integer AS "pid"`;
      await acquireShopifyOrderTransactionLock(tx, sourceOrderId);
      await tx.customerCancellationRequest.create({
        data: {
          shopifyOrderId: orderId,
          shopDomain: 'xgi47p-3k.myshopify.com',
          shopifyCustomerId: `gid://shopify/Customer/${suffix}`,
          status: CustomerCancellationStatus.PENDING,
          reasonCode: 'CUSTOMER_CHANGED_MIND',
          idempotencyKey: `${suffix}-request-wins`,
          items: {
            create: {
              shopifyOrderLineItemId: lineAId,
              vendorAllocationId: allocationAId,
              requestedQuantity: 1,
              status: CustomerCancellationStatus.PENDING,
            },
          },
        },
      });
      requestCommitted.resolve(pid);
      await releaseRequest.promise;
    });

    let shipmentTransaction: Promise<void> | undefined;
    try {
      const requestPid = await withTimeout(requestCommitted.promise, 2_000, 'Request lock');
      shipmentTransaction = database.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::integer AS "pid"`;
        shipmentStarted.resolve(pid);
        await acquireShopifyOrderTransactionLock(tx, sourceOrderId);
        await assertNoPendingCustomerCancellationHold(allocationAId, tx);
      });
      const shipmentPid = await withTimeout(shipmentStarted.promise, 2_000, 'Shipment transaction');
      await waitForAdvisoryBlock(database, requestPid, shipmentPid);
      releaseRequest.resolve();
      await expect(withTimeout(shipmentTransaction, 2_000, 'Blocked shipment')).rejects.toMatchObject({
        code: 'CUSTOMER_CANCELLATION_PENDING',
        statusCode: 409,
      });
      await expect(hasPendingCustomerCancellationHold(allocationAId)).resolves.toBe(true);
      await expect(hasPendingCustomerCancellationHold(allocationBId)).resolves.toBe(false);
    } finally {
      releaseRequest.resolve();
      await Promise.allSettled([requestTransaction, ...(shipmentTransaction ? [shipmentTransaction] : [])]);
    }
  });

  it('retains the persisted hold after approval for later refund execution', async () => {
    const created = await createPendingCustomerCancellationRequest({
      shopifyOrderId: orderId,
      shopDomain: 'xgi47p-3k.myshopify.com',
      shopifyCustomerId: `gid://shopify/Customer/${suffix}`,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      idempotencyKey: `${suffix}-approve-for-refund`,
      items: [{
        shopifyOrderLineItemId: lineAId,
        vendorAllocationId: allocationAId,
        requestedQuantity: 1,
      }],
    });
    const item = created.request.items[0];
    expect(item).toBeDefined();

    const approved = await approveCustomerCancellationItemForRefund({
      requestId: created.request.id,
      itemId: item!.id,
      reviewedByUserId: adminUserId,
      reviewReason: 'Approved for controlled refund execution.',
    });

    expect(approved.request.status).toBe(CustomerCancellationStatus.APPROVED_FOR_REFUND);
    expect(approved.item.status).toBe(CustomerCancellationStatus.APPROVED_FOR_REFUND);
    await expect(hasPendingCustomerCancellationHold(allocationAId)).resolves.toBe(true);
    await expect(hasPendingCustomerCancellationHold(allocationBId)).resolves.toBe(false);
  });

  it('classifies a later request as conflicted when durable provider-call intent wins first', async () => {
    await database.$transaction(async (tx) => {
      await acquireShopifyOrderTransactionLock(tx, sourceOrderId);
      await tx.shipmentExecution.create({
        data: {
          id: `${suffix}-shipment-intent`,
          allocationId: allocationAId,
          vendorId: vendorAId,
          sourceShopifyOrderId: sourceOrderId,
          sourceShopifyOrderNumber: '#phase2',
          provider: ShippingProvider.KARGONOMI,
          shipmentStatus: ShipmentExecutionStatus.PENDING,
          requestSnapshot: {},
          responseSnapshot: { providerCallClaimedAt: '2026-08-30T10:00:00.000Z' },
        },
      });
    });

    const result = await createPendingCustomerCancellationRequest({
      shopifyOrderId: orderId,
      shopDomain: 'xgi47p-3k.myshopify.com',
      shopifyCustomerId: `gid://shopify/Customer/${suffix}`,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      idempotencyKey: `${suffix}-shipment-wins`,
      items: [{
        shopifyOrderLineItemId: lineAId,
        vendorAllocationId: allocationAId,
        requestedQuantity: 1,
      }],
    });

    expect(result.request.status).toBe(CustomerCancellationStatus.CONFLICTED);
    expect(result.request.items).toHaveLength(1);
    expect(result.request.items[0]?.status).toBe(CustomerCancellationStatus.CONFLICTED);
    await expect(hasPendingCustomerCancellationHold(allocationAId)).resolves.toBe(false);
  });

  it('classifies a later request as too late when real provider evidence already exists', async () => {
    await database.shipmentExecution.create({
      data: {
        id: `${suffix}-shipment-evidence`,
        allocationId: allocationAId,
        vendorId: vendorAId,
        sourceShopifyOrderId: sourceOrderId,
        sourceShopifyOrderNumber: '#phase2',
        provider: ShippingProvider.KARGONOMI,
        shipmentStatus: ShipmentExecutionStatus.CREATED,
        providerShipmentId: `${suffix}-provider-shipment`,
        trackingNumber: `${suffix}-tracking`,
        requestSnapshot: {},
      },
    });

    const result = await createPendingCustomerCancellationRequest({
      shopifyOrderId: orderId,
      shopDomain: 'xgi47p-3k.myshopify.com',
      shopifyCustomerId: `gid://shopify/Customer/${suffix}`,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      idempotencyKey: `${suffix}-evidence-wins`,
      items: [{
        shopifyOrderLineItemId: lineAId,
        vendorAllocationId: allocationAId,
        requestedQuantity: 1,
      }],
    });

    expect(result.request.status).toBe(CustomerCancellationStatus.TOO_LATE);
    expect(result.request.items[0]?.status).toBe(CustomerCancellationStatus.TOO_LATE);
  });
});
