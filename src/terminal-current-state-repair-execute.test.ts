import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, type AppEnv } from '../backend/src/config/env.js';
import {
  buildTerminalCurrentStateRepairJobCreateData,
  buildTerminalCurrentStateRepairJobFinalData,
  createTerminalCurrentStateRepairExecuteService,
  TerminalCurrentStateExecuteError,
  type TerminalCurrentStateExecuteDependencies,
} from '../backend/src/modules/orders/terminal-current-state-repair-execute.service.js';
import { FULL_REFUND_TERMINAL_FACT_SOURCES } from '../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js';

const orderId = '8151983227217';
const orderGid = `gid://shopify/Order/${orderId}`;

function terminalFact(id: string) {
  return {
    id: `${id}-fact`,
    vendorAllocationId: id,
    shopifyOrderGid: orderGid,
    verificationSource: 'refund_webhook',
    shopifyApiVersion: '2026-01',
    verifiedAt: new Date('2026-09-06T10:00:00.000Z'),
    evidenceJson: {},
  };
}

function allocation(input: { id: string; vendorId: string; terminal?: boolean }) {
  return {
    id: input.id,
    assignedVendorId: input.vendorId,
    lineItems: [{
      id: `${input.id}-line`,
      shopifyLineItemId: `${input.id}-order-line`,
      quantity: 1,
      shopifyOrderLineItem: {
        id: `${input.id}-order-line`,
        sourceLineItemId: `${input.id}-shopify-line`,
      },
    }],
    fullRefundTerminalFact: input.terminal
      ? { id: `${input.id}-fact`, shopifyOrderGid: orderGid }
      : null,
  };
}

function arrange(input: {
  allocations?: ReturnType<typeof allocation>[];
  writeEnabled?: boolean;
  writerEnabled?: boolean;
} = {}) {
  const allocations = input.allocations ?? [allocation({ id: 'alloc-a', vendorId: 'vendor-a' })];
  const order = {
    id: 'local-order-1',
    sourceShopifyOrderId: orderId,
    sourceShopifyOrderNumber: '#1128',
    allocations,
  };
  const writer = {
    createVerifiedFact: vi.fn(async ({ vendorAllocationId }: { vendorAllocationId: string }) => ({
      outcome: 'CREATED' as const,
      fact: terminalFact(vendorAllocationId),
      reasonCode: null,
    })),
  };
  const dependencies = {
    findByShopifyOrderId: vi.fn(async (value: string) => value === orderId ? order : null),
    findByOrderNumber: vi.fn(async (value: string) => value === '#1128' ? [order] : []),
    writer,
    createOperationalJob: vi.fn(async () => ({ id: 'job-1' })),
    finalizeOperationalJob: vi.fn(async () => undefined),
  } as unknown as TerminalCurrentStateExecuteDependencies;
  const env = {
    FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED: input.writeEnabled ?? true,
    FULL_REFUND_TERMINAL_WRITER_ENABLED: input.writerEnabled ?? true,
  } as AppEnv;
  return {
    service: createTerminalCurrentStateRepairExecuteService(env, dependencies),
    dependencies,
    writer,
    order,
  };
}

describe('terminal Current-State Repair exact-order execute service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults the dedicated write flag to false', () => {
    const keys = [
      'NODE_ENV',
      'FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED',
      'KARGONOMI_BASE_URL',
      'KARGONOMI_API_TOKEN',
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = 'test';
    delete process.env.FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED;
    process.env.KARGONOMI_BASE_URL = 'https://kargonomi.invalid';
    process.env.KARGONOMI_API_TOKEN = 'test-only-token';
    try {
      expect(loadEnv().FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED).toBe(false);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  it('builds one non-retrying sanitized reconciliation audit job lifecycle', () => {
    const startedAt = new Date('2026-09-07T10:00:00.000Z');
    const completedAt = new Date('2026-09-07T10:00:01.000Z');
    const counters = {
      scanned: 2,
      candidateAllocations: 1,
      created: 1,
      alreadyTerminal: 1,
      doesNotQualify: 0,
      indeterminate: 0,
      conflict: 0,
      errors: 0,
    };
    const created = buildTerminalCurrentStateRepairJobCreateData({
      sourceShopifyOrderId: orderId,
      allocationIds: ['alloc-a', 'alloc-b'],
      startedAt,
    });
    const finalized = buildTerminalCurrentStateRepairJobFinalData({
      allocationIds: ['alloc-a', 'alloc-b'],
      counters,
      completedAt,
    });
    expect(created).toMatchObject({
      jobType: 'RECONCILIATION',
      status: 'PROCESSING',
      sourceShopifyOrderId: orderId,
      maxRetries: 0,
      startedAt,
      payload: { operation: 'terminal_current_state_repair', allocationIds: ['alloc-a', 'alloc-b'] },
    });
    expect(finalized).toMatchObject({
      status: 'COMPLETED',
      completedAt,
      failedAt: null,
      payload: {
        operation: 'terminal_current_state_repair',
        allocationIds: ['alloc-a', 'alloc-b'],
        outcomeCounts: counters,
      },
    });
    expect(JSON.stringify({ created, finalized })).not.toMatch(
      /customer|email|phone|address|evidenceJson|rawShopify|token|secret/i,
    );

    const failed = buildTerminalCurrentStateRepairJobFinalData({
      allocationIds: ['alloc-a'],
      counters: { ...counters, created: 0, errors: 1 },
      completedAt,
    });
    expect(failed).toMatchObject({
      status: 'FAILED',
      completedAt: null,
      failedAt: completedAt,
      failureCategory: 'current_state_terminal_repair',
    });
  });

  it.each([
    [{ writeEnabled: false }, 'terminal_current_state_repair_write_disabled'],
    [{ writerEnabled: false }, 'full_refund_terminal_writer_disabled'],
  ] as const)('fails closed before reads or audit writes when a required flag is off', async (flags, code) => {
    const fixture = arrange(flags);
    await expect(fixture.service.execute({ orderIdentifier: '#1128', execute: true })).rejects.toMatchObject({
      code,
      statusCode: 503,
    } satisfies Partial<TerminalCurrentStateExecuteError>);
    expect(fixture.dependencies.findByOrderNumber).not.toHaveBeenCalled();
    expect(fixture.dependencies.createOperationalJob).not.toHaveBeenCalled();
    expect(fixture.writer.createVerifiedFact).not.toHaveBeenCalled();
  });

  it('requires literal execution confirmation', async () => {
    const fixture = arrange();
    await expect(fixture.service.execute({ orderIdentifier: '#1128', execute: false as true }))
      .rejects.toMatchObject({ code: 'execution_confirmation_required', statusCode: 400 });
    expect(fixture.dependencies.findByOrderNumber).not.toHaveBeenCalled();
  });

  it('creates facts independently, skips existing facts, and completes one sanitized job', async () => {
    const fixture = arrange({
      allocations: [
        allocation({ id: 'alloc-z', vendorId: 'vendor-z' }),
        allocation({ id: 'alloc-a', vendorId: 'vendor-a', terminal: true }),
        allocation({ id: 'alloc-m', vendorId: 'vendor-m' }),
      ],
    });
    fixture.writer.createVerifiedFact
      .mockResolvedValueOnce({ outcome: 'CREATED', fact: terminalFact('alloc-m'), reasonCode: null })
      .mockResolvedValueOnce({
        outcome: 'DOES_NOT_QUALIFY',
        fact: null,
        reasonCode: 'refund_quantity_below_owned_quantity',
      });

    const result = await fixture.service.execute({ orderIdentifier: '#1128', execute: true });

    expect(result).toEqual({
      dryRun: false,
      executed: true,
      operationalJobId: 'job-1',
      shopifyOrderGid: orderGid,
      scanned: 3,
      candidateAllocations: 2,
      created: 1,
      alreadyTerminal: 1,
      doesNotQualify: 1,
      indeterminate: 0,
      conflict: 0,
      errors: 0,
      allocations: [
        { vendorAllocationId: 'alloc-a', shopifyOrderGid: orderGid, vendorId: 'vendor-a', state: 'ALREADY_TERMINAL', reason: null },
        { vendorAllocationId: 'alloc-m', shopifyOrderGid: orderGid, vendorId: 'vendor-m', state: 'CREATED', reason: null },
        { vendorAllocationId: 'alloc-z', shopifyOrderGid: orderGid, vendorId: 'vendor-z', state: 'DOES_NOT_QUALIFY', reason: 'refund_quantity_below_owned_quantity' },
      ],
    });
    expect(fixture.writer.createVerifiedFact).toHaveBeenCalledTimes(2);
    expect(fixture.writer.createVerifiedFact).toHaveBeenCalledWith({
      vendorAllocationId: 'alloc-m',
      verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CURRENT_STATE_REPAIR,
    });
    expect(fixture.dependencies.createOperationalJob).toHaveBeenCalledWith({
      sourceShopifyOrderId: orderId,
      allocationIds: ['alloc-a', 'alloc-m', 'alloc-z'],
      startedAt: expect.any(Date),
    });
    expect(fixture.dependencies.finalizeOperationalJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      allocationIds: ['alloc-a', 'alloc-m', 'alloc-z'],
      counters: expect.objectContaining({ created: 1, alreadyTerminal: 1, doesNotQualify: 1, errors: 0 }),
    }));
    expect(Object.keys(fixture.dependencies).sort()).toEqual([
      'createOperationalJob',
      'finalizeOperationalJob',
      'findByOrderNumber',
      'findByShopifyOrderId',
      'writer',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/customer|email|phone|address|evidenceJson|payload|token|secret/i);
  });

  it.each([
    [{ outcome: 'ALREADY_EXISTS_SAME_TERMINAL_STATE', fact: terminalFact('alloc-a'), reasonCode: null }, 'ALREADY_TERMINAL', null],
    [{ outcome: 'INDETERMINATE', fact: null, reasonCode: 'canonical_refunds_list_incomplete' }, 'INDETERMINATE', 'canonical_refunds_list_incomplete'],
    [{ outcome: 'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM', fact: null, reasonCode: 'shipment_execution_pending' }, 'CONFLICT', 'shipment_execution_pending'],
    [{ outcome: 'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM', fact: null, reasonCode: 'shopify_fulfillment_submission_pending' }, 'CONFLICT', 'shopify_fulfillment_submission_pending'],
  ] as const)('maps immutable writer outcome without weakening its reason', async (writerResult, state, reason) => {
    const fixture = arrange();
    fixture.writer.createVerifiedFact.mockResolvedValue(writerResult);
    const result = await fixture.service.execute({ orderIdentifier: orderId, execute: true });
    expect(result.allocations[0]).toMatchObject({ state, reason });
  });

  it('maps an unexpected allocation writer failure to sanitized ERROR and a failed job outcome', async () => {
    const fixture = arrange();
    fixture.writer.createVerifiedFact.mockRejectedValue(new Error('secret raw Shopify payload'));
    const result = await fixture.service.execute({ orderIdentifier: orderId, execute: true });
    expect(result.allocations[0]).toMatchObject({ state: 'ERROR', reason: 'unexpected_writer_error' });
    expect(result.errors).toBe(1);
    expect(JSON.stringify(result)).not.toContain('secret raw Shopify payload');
    expect(fixture.dependencies.finalizeOperationalJob).toHaveBeenCalledWith(expect.objectContaining({
      counters: expect.objectContaining({ errors: 1 }),
    }));
  });

  it('treats a stale dry-run durable shipment claim as a writer conflict and creates no fact itself', async () => {
    const fixture = arrange();
    fixture.writer.createVerifiedFact.mockResolvedValue({
      outcome: 'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM',
      fact: null,
      reasonCode: 'shipment_execution_pending',
    });
    const result = await fixture.service.execute({ orderIdentifier: '#1128', execute: true });
    expect(result).toMatchObject({ created: 0, conflict: 1 });
    expect(result.allocations[0]).toMatchObject({ state: 'CONFLICT', reason: 'shipment_execution_pending' });
  });

  it('is idempotent when the second exact-order read observes the original fact', async () => {
    const fixture = arrange();
    const first = await fixture.service.execute({ orderIdentifier: '#1128', execute: true });
    const originalFact = terminalFact('alloc-a');
    fixture.order.allocations[0].fullRefundTerminalFact = {
      id: originalFact.id,
      shopifyOrderGid: originalFact.shopifyOrderGid,
    };
    const second = await fixture.service.execute({ orderIdentifier: '#1128', execute: true });
    expect(first.allocations[0].state).toBe('CREATED');
    expect(second.allocations[0]).toMatchObject({ state: 'ALREADY_TERMINAL', shopifyOrderGid: orderGid });
    expect(fixture.writer.createVerifiedFact).toHaveBeenCalledTimes(1);
    expect(originalFact).toMatchObject({
      id: 'alloc-a-fact',
      verifiedAt: new Date('2026-09-06T10:00:00.000Z'),
      verificationSource: 'refund_webhook',
      shopifyApiVersion: '2026-01',
      evidenceJson: {},
    });
  });

  it('rejects malformed, missing, and ambiguous exact identities', async () => {
    const fixture = arrange();
    await expect(fixture.service.execute({ orderIdentifier: '1128,1129', execute: true }))
      .rejects.toMatchObject({ code: 'invalid_order_identifier', statusCode: 400 });
    await expect(fixture.service.execute({ orderIdentifier: '#9999', execute: true }))
      .rejects.toMatchObject({ code: 'order_not_found', statusCode: 404 });
    fixture.dependencies.findByOrderNumber = vi.fn(async () => [{}, {}]) as never;
    await expect(fixture.service.execute({ orderIdentifier: '#1128', execute: true }))
      .rejects.toMatchObject({ code: 'ambiguous_order_identifier', statusCode: 409 });
  });
});
