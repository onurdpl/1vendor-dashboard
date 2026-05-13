import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  automationAction: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  notificationIntent: {
    upsert: vi.fn(),
  },
  operationalJob: {
    findUnique: vi.fn(),
  },
  operationalSignal: {
    findMany: vi.fn(),
  },
}));

const listOperationalSignalsMock = vi.hoisted(() => vi.fn());
const createOperationalJobMock = vi.hoisted(() => vi.fn());
const serializeOperationalJobMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/rules/rules.service.js', () => ({
  listOperationalSignals: listOperationalSignalsMock,
}));

vi.mock('../backend/src/modules/operational-jobs/operational-jobs.service.js', () => ({
  createOperationalJob: createOperationalJobMock,
  serializeOperationalJob: serializeOperationalJobMock,
}));

const {
  executeAutomationAction,
  generateAutomationActionsForSignals,
  listAutomationActions,
} = await import('../backend/src/modules/automation/automation-actions.service.js');

function buildSignal(overrides: Record<string, unknown>) {
  const now = new Date('2026-05-13T10:00:00.000Z');
  return {
    id: 'signal-stale',
    type: 'stale_fulfillment',
    severity: 'HIGH',
    sourceArea: 'FULFILLMENT',
    vendorId: 'sporjinal',
    allocationId: 'alloc-1',
    financeLedgerEntryId: null,
    payoutBatchId: null,
    operationalJobId: null,
    title: 'Fulfillment is stale',
    description: 'Allocation alloc-1 is stale.',
    suggestedAction: 'Check vendor shipment progress or run reconciliation.',
    status: 'ACTIVE',
    ruleKey: 'fulfillment.stale_awaiting_shipment',
    triggeredAt: now,
    resolvedAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildAction(overrides: Record<string, unknown>) {
  const now = new Date('2026-05-13T10:00:00.000Z');
  return {
    id: 'automation-suggest_stale_fulfillment_review-signal-stale',
    signalId: 'signal-stale',
    type: 'SUGGEST_STALE_FULFILLMENT_REVIEW',
    status: 'SUGGESTED',
    executionMode: 'ASSISTED',
    vendorId: 'sporjinal',
    allocationId: 'alloc-1',
    financeLedgerEntryId: null,
    payoutBatchId: null,
    operationalJobId: null,
    title: 'Review stale fulfillment',
    description: 'Check shipment progress.',
    resultSummary: null,
    executedAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('automation action foundation', () => {
  beforeEach(() => {
    prismaMock.automationAction.findMany.mockReset();
    prismaMock.automationAction.findUnique.mockReset();
    prismaMock.automationAction.update.mockReset();
    prismaMock.automationAction.upsert.mockReset();
    prismaMock.notificationIntent.upsert.mockReset();
    prismaMock.operationalJob.findUnique.mockReset();
    prismaMock.operationalSignal.findMany.mockReset();
    listOperationalSignalsMock.mockReset();
    createOperationalJobMock.mockReset();
    serializeOperationalJobMock.mockReset();

    listOperationalSignalsMock.mockResolvedValue({ summary: { total: 0 }, signals: [] });
    prismaMock.operationalSignal.findMany.mockResolvedValue([]);
    prismaMock.automationAction.findMany.mockResolvedValue([]);
    prismaMock.automationAction.upsert.mockImplementation(async ({ create, update, where }) =>
      buildAction({
        ...create,
        ...update,
        id: where.id,
      }),
    );
    prismaMock.automationAction.update.mockImplementation(async ({ data, where }) =>
      buildAction({
        id: where.id,
        ...data,
      }),
    );
    prismaMock.notificationIntent.upsert.mockImplementation(async ({ create, update, where }) => ({
      ...create,
      ...update,
      id: where.id,
    }));
    createOperationalJobMock.mockResolvedValue({
      id: 'job-reconciliation-1',
      jobType: 'RECONCILIATION',
      status: 'PENDING',
      retryCount: 0,
      maxRetries: 1,
      scheduledAt: new Date('2026-05-13T10:00:00.000Z'),
      createdAt: new Date('2026-05-13T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    });
    serializeOperationalJobMock.mockReturnValue({ id: 'job-reconciliation-1', jobType: 'reconciliation' });
  });

  it('creates duplicate-safe automation suggestions from stale signals', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([
      buildSignal({ id: 'signal-stale', ruleKey: 'fulfillment.stale_awaiting_shipment' }),
    ]);

    await generateAutomationActionsForSignals();
    await generateAutomationActionsForSignals();

    expect(prismaMock.automationAction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'automation-suggest_stale_fulfillment_review-signal-stale',
        },
      }),
    );
    expect(prismaMock.automationAction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'automation-auto_create_reconciliation_candidate-signal-stale',
        },
      }),
    );
    expect(prismaMock.automationAction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'automation-auto_prioritize_stale_queue_item-signal-stale',
        },
      }),
    );
  });

  it('lists actions and creates in-app automation notifications when requested', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([
      buildSignal({ id: 'signal-shipping', ruleKey: 'shipping_cost.missing_after_fulfillment', sourceArea: 'SHIPPING_COST' }),
    ]);
    prismaMock.automationAction.findMany.mockResolvedValue([
      buildAction({
        id: 'automation-suggest_shipping_cost_attachment-signal-shipping',
        type: 'SUGGEST_SHIPPING_COST_ATTACHMENT',
        executionMode: 'MANUAL',
      }),
    ]);

    const response = await listAutomationActions({ includeNotifications: true });

    expect(response.summary.total).toBe(1);
    expect(response.actions[0]).toMatchObject({
      id: 'automation-suggest_shipping_cost_attachment-signal-shipping',
      type: 'suggest_shipping_cost_attachment',
      vendorId: 'sporjinal',
    });
    expect(prismaMock.notificationIntent.upsert).toHaveBeenCalled();
  });

  it('marks manual suggestions handled without mutating operational records', async () => {
    prismaMock.automationAction.findUnique.mockResolvedValue(
      buildAction({
        id: 'automation-suggest_payout_review-signal-payout',
        type: 'SUGGEST_PAYOUT_REVIEW',
        executionMode: 'MANUAL',
        payoutBatchId: 'batch-1',
      }),
    );

    const action = await executeAutomationAction({
      actionId: 'automation-suggest_payout_review-signal-payout',
      execution: 'mark_handled',
      actorUserId: 'admin-1',
    });

    expect(action).toMatchObject({
      status: 'executed',
      resultSummary: 'Automation suggestion marked handled by operator. No operational state was mutated.',
    });
    expect(createOperationalJobMock).not.toHaveBeenCalled();
  });

  it('executes bounded auto-safe reconciliation candidate actions', async () => {
    prismaMock.automationAction.findUnique.mockResolvedValue(
      buildAction({
        id: 'automation-auto_create_reconciliation_candidate-signal-stale',
        type: 'AUTO_CREATE_RECONCILIATION_CANDIDATE',
        executionMode: 'AUTO_SAFE',
        allocationId: 'alloc-1',
      }),
    );

    const action = await executeAutomationAction({
      actionId: 'automation-auto_create_reconciliation_candidate-signal-stale',
      execution: 'execute_safe',
      actorUserId: 'admin-1',
    });

    expect(createOperationalJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'reconciliation',
        vendorAllocationId: 'alloc-1',
        maxRetries: 1,
      }),
    );
    expect(action).toMatchObject({
      status: 'executed',
      resultSummary: 'Created reconciliation job job-reconciliation-1.',
    });
  });

  it('preserves vendor scope on generated finance automation actions', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([
      buildSignal({
        id: 'signal-negative',
        ruleKey: 'finance.negative_payable_balance',
        sourceArea: 'PAYOUT',
        vendorId: 'sporjinal',
      }),
    ]);

    await generateAutomationActionsForSignals();

    expect(prismaMock.automationAction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          type: 'SUGGEST_NEGATIVE_PAYOUT_INVESTIGATION',
        }),
      }),
    );
  });
});
