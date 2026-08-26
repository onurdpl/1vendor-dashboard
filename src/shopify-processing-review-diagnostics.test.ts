import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookEvent: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  operationalJob: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  operationalSignal: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  shopifyOrder: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  shopifyOrderLineItem: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  vendorAllocation: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  financeLedgerEntry: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  fulfillment: { findMany: vi.fn() },
}));

const createShopifyAdminServiceMock = vi.hoisted(() => vi.fn());
const ingestShopifyOrderWebhookMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: createShopifyAdminServiceMock,
}));
vi.mock('../backend/src/modules/shopify/order-ingestion.service.js', () => ({
  ingestShopifyOrderWebhook: ingestShopifyOrderWebhookMock,
}));

const {
  __processingReviewTesting,
  evaluateProcessingReviewSignals,
  getReconciliationDiagnostics,
} = await import('../backend/src/modules/diagnostics/diagnostics.service.js');

const now = new Date('2026-08-26T12:00:00.000Z');

function job(status = 'PROCESSING', overrides: Record<string, unknown> = {}) {
  return {
    id: `job-${status.toLowerCase()}`,
    jobType: 'WEBHOOK_PROCESSING',
    status,
    priority: 0,
    payload: null,
    payloadRef: 'payload-hash',
    webhookEventId: 'event-processing-1',
    sourceShopifyOrderId: '9001',
    vendorAllocationId: null,
    refundRecordId: null,
    returnRecordId: null,
    retryCount: 1,
    maxRetries: 3,
    scheduledAt: new Date('2026-08-26T11:30:00.000Z'),
    nextRetryAt: null,
    lastAttemptAt: new Date('2026-08-26T11:31:00.000Z'),
    retryBackoffMs: null,
    startedAt: new Date('2026-08-26T11:30:30.000Z'),
    completedAt: null,
    failedAt: null,
    errorSummary: null,
    failureCategory: null,
    escalationReason: null,
    createdAt: new Date('2026-08-26T11:30:00.000Z'),
    updatedAt: new Date('2026-08-26T11:31:00.000Z'),
    ...overrides,
  };
}

function event(input: {
  receivedAt?: Date;
  rawPayload?: string | null;
  status?: string;
  jobs?: ReturnType<typeof job>[];
} = {}) {
  return {
    id: 'event-processing-1',
    sourceShopDomain: 'sporgym.myshopify.com',
    topic: 'orders/create',
    webhookId: 'shopify-webhook-1',
    idempotencyKey: 'orders-create-1',
    payloadHash: 'payload-hash',
    rawPayload: input.rawPayload === undefined
      ? JSON.stringify({ id: 9001, name: '#1201', email: 'not-returned@example.com' })
      : input.rawPayload,
    status: input.status ?? 'PROCESSING',
    receivedAt: input.receivedAt ?? new Date('2026-08-26T11:30:00.000Z'),
    processedAt: null,
    errorMessage: null,
    shopifyOrderId: null,
    shopifyOrder: null,
    operationalJobs: input.jobs ?? [],
  };
}

function localOrder(allocationCount: number, saleLedgerCounts: number[]) {
  return {
    sourceShopifyOrderId: '9001',
    allocations: Array.from({ length: allocationCount }, (_, index) => ({
      financeEntries: Array.from({ length: saleLedgerCounts[index] ?? 0 }, (__, ledgerIndex) => ({
        id: `ledger-${index}-${ledgerIndex}`,
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.operationalSignal.findMany.mockResolvedValue([]);
  prismaMock.operationalSignal.findUnique.mockResolvedValue(null);
  prismaMock.operationalSignal.upsert.mockResolvedValue({});
  prismaMock.operationalSignal.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.webhookEvent.findUnique.mockResolvedValue({ status: 'PROCESSING' });
  prismaMock.webhookEvent.findMany.mockResolvedValue([event()]);
  prismaMock.shopifyOrder.findMany.mockResolvedValue([]);
  prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
  prismaMock.fulfillment.findMany.mockResolvedValue([]);
  prismaMock.operationalJob.findMany.mockResolvedValue([]);
});

describe('Shopify orders/create PROCESSING supervised review diagnostics', () => {
  it('surfaces a threshold-aged PROCESSING event with safe absent-order evidence', async () => {
    const items = await evaluateProcessingReviewSignals({ now });

    expect(items).toEqual([
      expect.objectContaining({
        id: __processingReviewTesting.buildProcessingReviewSignalId('event-processing-1'),
        type: 'processing_review_required',
        relatedShopifyOrderId: '9001',
        relatedShopifyOrderNumber: '#1201',
        status: 'PROCESSING',
        receivedAgeMs: 30 * 60 * 1000,
        localCommerceClassification: 'LOCAL_ORDER_ABSENT',
        allocationCount: 0,
        saleLedgerCount: 0,
      }),
    ]);
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'signal-diagnostics-shopify-orders-create-processing-review-event-processing-1' },
      create: expect.objectContaining({
        type: 'shopify_orders_create_processing_review_required',
        ruleKey: 'diagnostics.shopify_orders_create_processing_review_required',
        severity: 'HIGH',
        sourceArea: 'DIAGNOSTICS',
      }),
    }));
  });

  it.each(['PENDING', 'PROCESSING', 'RETRYING'])('keeps a %s linked job review-visible', async (status) => {
    prismaMock.webhookEvent.findMany.mockResolvedValue([event({ jobs: [job(status)] })]);

    const [item] = await evaluateProcessingReviewSignals({ now });

    expect(item).toMatchObject({
      latestJobStatus: status,
      currentJobSuppressesMissedOrderDiscovery: true,
    });
  });

  it('does not create review noise below the diagnostic threshold', async () => {
    prismaMock.webhookEvent.findMany.mockResolvedValue([]);

    expect(await evaluateProcessingReviewSignals({ now })).toEqual([]);
    expect(prismaMock.webhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        receivedAt: { lte: new Date('2026-08-26T11:45:00.000Z') },
      }),
    }));
    expect(prismaMock.operationalSignal.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [[], 'LOCAL_ORDER_ABSENT', 0, 0],
    [[localOrder(0, [])], 'LOCAL_ORDER_EXISTS', 0, 0],
    [[localOrder(2, [0, 0])], 'LOCAL_ORDER_EXISTS_WITH_ALLOCATIONS', 2, 0],
    [[localOrder(2, [1, 1])], 'LOCAL_ORDER_EXISTS_WITH_FINANCE', 2, 2],
  ] as const)('classifies local commerce as %s', async (orders, classification, allocationCount, saleLedgerCount) => {
    prismaMock.shopifyOrder.findMany.mockResolvedValue(orders);

    const [item] = await evaluateProcessingReviewSignals({ now });

    expect(item).toMatchObject({ localCommerceClassification: classification, allocationCount, saleLedgerCount });
  });

  it('fails closed when safe identity extraction is unavailable', async () => {
    prismaMock.webhookEvent.findMany.mockResolvedValue([event({ rawPayload: JSON.stringify({ note: 'no safe identity' }) })]);

    const [item] = await evaluateProcessingReviewSignals({ now });

    expect(item).toMatchObject({ localCommerceClassification: 'AMBIGUOUS_QUERY_FAILED', localOrderExists: null });
    expect(prismaMock.shopifyOrder.findMany).not.toHaveBeenCalled();
  });

  it('uses the safe Shopify order ID when an order number is unavailable', async () => {
    prismaMock.webhookEvent.findMany.mockResolvedValue([event({ rawPayload: JSON.stringify({ id: 9001 }) })]);

    const [item] = await evaluateProcessingReviewSignals({ now });

    expect(item).toMatchObject({ relatedShopifyOrderId: '9001', relatedShopifyOrderNumber: null });
  });

  it('fails closed when local commerce lookup fails', async () => {
    prismaMock.shopifyOrder.findMany.mockRejectedValue(new Error('database unavailable'));

    const [item] = await evaluateProcessingReviewSignals({ now });

    expect(item).toMatchObject({ localCommerceClassification: 'AMBIGUOUS_QUERY_FAILED' });
  });

  it('preserves deterministic identity and first detection time across evaluations', async () => {
    const firstDetectedAt = new Date('2026-08-26T11:40:00.000Z');
    prismaMock.operationalSignal.findUnique.mockResolvedValue({
      triggeredAt: firstDetectedAt,
      status: 'ACTIVE',
      metadata: { webhookEventId: 'event-processing-1' },
    });

    await evaluateProcessingReviewSignals({ now });
    await evaluateProcessingReviewSignals({ now: new Date('2026-08-26T12:05:00.000Z') });

    const calls = prismaMock.operationalSignal.upsert.mock.calls;
    expect(new Set(calls.map(([input]) => input.where.id))).toEqual(new Set([
      'signal-diagnostics-shopify-orders-create-processing-review-event-processing-1',
    ]));
    expect(calls[1][0].update.metadata.firstDetectedAt).toBe(firstDetectedAt.toISOString());
    expect(calls[1][0].update.metadata.lastObservedAt).toBe('2026-08-26T12:05:00.000Z');
  });

  it('preserves an acknowledged signal while refreshing its evidence', async () => {
    prismaMock.operationalSignal.findUnique.mockResolvedValue({
      triggeredAt: new Date('2026-08-26T11:40:00.000Z'),
      status: 'ACKNOWLEDGED',
      metadata: { webhookEventId: 'event-processing-1' },
    });

    await evaluateProcessingReviewSignals({ now });

    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'ACKNOWLEDGED' }),
    }));
  });

  it('resolves an existing signal when the webhook event leaves PROCESSING', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([{
      id: 'signal-diagnostics-shopify-orders-create-processing-review-event-processing-1',
      metadata: { webhookEventId: 'event-processing-1' },
    }]);
    prismaMock.webhookEvent.findUnique.mockResolvedValue({ status: 'PROCESSED' });
    prismaMock.webhookEvent.findMany.mockResolvedValue([]);

    await evaluateProcessingReviewSignals({ now });

    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RESOLVED', metadata: expect.objectContaining({ resolutionReason: 'event_left_processing' }) }),
    }));
    expect(prismaMock.webhookEvent.update).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalJob.update).not.toHaveBeenCalled();
    expect(prismaMock.operationalJob.updateMany).not.toHaveBeenCalled();
  });

  it('does not resolve merely because local commerce appears', async () => {
    prismaMock.shopifyOrder.findMany.mockResolvedValue([localOrder(1, [1])]);

    const items = await evaluateProcessingReviewSignals({ now });

    expect(items).toHaveLength(1);
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'ACTIVE', severity: 'WARNING' }),
    }));
  });

  it('keeps incomplete multi-allocation finance evidence at HIGH severity', async () => {
    prismaMock.shopifyOrder.findMany.mockResolvedValue([localOrder(2, [1, 0])]);

    const [item] = await evaluateProcessingReviewSignals({ now });

    expect(item).toMatchObject({
      localCommerceClassification: 'LOCAL_ORDER_EXISTS_WITH_FINANCE',
      allocationCount: 2,
      saleLedgerCount: 1,
      severity: 'high',
    });
  });

  it('resolves only for a successfully executed Current-State Repair on the exact order', async () => {
    prismaMock.operationalSignal.findUnique.mockResolvedValue({
      triggeredAt: new Date('2026-08-26T11:40:00.000Z'),
      status: 'ACTIVE',
      metadata: { webhookEventId: 'event-processing-1' },
    });
    prismaMock.operationalJob.findMany.mockResolvedValue([
      job('COMPLETED', {
        id: 'repair-job-9001',
        jobType: 'RECONCILIATION',
        sourceShopifyOrderId: '9001',
        completedAt: new Date('2026-08-26T11:55:00.000Z'),
        payload: { operation: 'shopify_current_state_order_repair', dryRun: false, executed: true },
      }),
    ]);

    expect(await evaluateProcessingReviewSignals({ now })).toEqual([]);
    expect(prismaMock.operationalJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceShopifyOrderId: '9001',
        status: 'COMPLETED',
        completedAt: { gte: new Date('2026-08-26T11:30:00.000Z') },
      }),
    }));
    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'RESOLVED',
        metadata: expect.objectContaining({
          resolutionReason: 'commerce_repaired_from_canonical_current_state',
          repairJobId: 'repair-job-9001',
        }),
      }),
    }));
    expect(prismaMock.operationalSignal.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['dry-run', 'COMPLETED', { operation: 'shopify_current_state_order_repair', dryRun: true, executed: false }],
    ['failed repair', 'FAILED', { operation: 'shopify_current_state_order_repair', dryRun: false, executed: true }],
  ])('does not resolve for a %s', async (_name, status, payload) => {
    prismaMock.operationalSignal.findUnique.mockResolvedValue({
      triggeredAt: new Date('2026-08-26T11:40:00.000Z'),
      status: 'ACTIVE',
      metadata: { webhookEventId: 'event-processing-1' },
    });
    prismaMock.operationalJob.findMany.mockResolvedValue([job(status, { payload })]);

    expect(await evaluateProcessingReviewSignals({ now })).toHaveLength(1);
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalled();
  });

  it('does not rewrite an already resolved signal on repeated repair-aware evaluation', async () => {
    prismaMock.operationalSignal.findUnique.mockResolvedValue({
      triggeredAt: new Date('2026-08-26T11:40:00.000Z'),
      status: 'RESOLVED',
      metadata: { webhookEventId: 'event-processing-1' },
    });
    prismaMock.operationalJob.findMany.mockResolvedValue([
      job('COMPLETED', {
        id: 'repair-job-9001',
        jobType: 'RECONCILIATION',
        sourceShopifyOrderId: '9001',
        completedAt: new Date('2026-08-26T11:55:00.000Z'),
        payload: { operation: 'shopify_current_state_order_repair', dryRun: false, executed: true },
      }),
    ]);

    expect(await evaluateProcessingReviewSignals({ now })).toEqual([]);
    expect(prismaMock.operationalSignal.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).not.toHaveBeenCalled();
  });

  it('mutates only OperationalSignal diagnostic state', async () => {
    const originalEvent = event({ jobs: [job('PROCESSING')] });
    const eventSnapshot = structuredClone(originalEvent);
    prismaMock.webhookEvent.findMany.mockResolvedValue([originalEvent]);

    await evaluateProcessingReviewSignals({ now });

    expect(originalEvent).toEqual(eventSnapshot);
    expect(prismaMock.webhookEvent.update).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalJob.update).not.toHaveBeenCalled();
    expect(prismaMock.operationalJob.updateMany).not.toHaveBeenCalled();
    expect(createShopifyAdminServiceMock).not.toHaveBeenCalled();
    expect(ingestShopifyOrderWebhookMock).not.toHaveBeenCalled();
    for (const model of [
      prismaMock.shopifyOrder,
      prismaMock.shopifyOrderLineItem,
      prismaMock.vendorAllocation,
      prismaMock.financeLedgerEntry,
    ]) {
      expect(model.create).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
    }
  });

  it('projects the review item and count through the existing reconciliation response', async () => {
    prismaMock.webhookEvent.findMany.mockImplementation(async (input: { where?: Record<string, unknown> }) =>
      input.where?.topic === 'orders/create' ? [event()] : []
    );
    prismaMock.operationalSignal.findMany.mockResolvedValue([]);

    const response = await getReconciliationDiagnostics();

    expect(response.summary).toMatchObject({ processingReviewRequiredCount: 1, total: 1 });
    expect(response.items).toEqual([
      expect.objectContaining({
        type: 'processing_review_required',
        signalId: 'signal-diagnostics-shopify-orders-create-processing-review-event-processing-1',
        webhookEventId: 'event-processing-1',
        payloadAvailable: true,
      }),
    ]);
    expect(response.items[0]).not.toHaveProperty('rawPayload');
  });
});
