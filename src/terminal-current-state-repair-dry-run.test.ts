import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import {
  createTerminalCurrentStateRepairDryRunService,
  TerminalCurrentStateDryRunError,
  type TerminalCurrentStateDryRunDependencies,
} from '../backend/src/modules/orders/terminal-current-state-repair-dry-run.service.js';
import type { AllocationFullRefundTerminalVerifierResult } from '../backend/src/modules/orders/allocation-full-refund-terminal-verifier.service.js';

const orderId = '8151983227217';
const orderGid = `gid://shopify/Order/${orderId}`;

function allocation(input: {
  id: string;
  vendorId?: string;
  terminal?: boolean;
  pendingShipment?: boolean;
  fulfillmentSyncStatus?: string | null;
  quantity?: number;
}) {
  const localOrderId = 'local-order-1';
  return {
    id: input.id,
    assignedVendorId: input.vendorId ?? 'yalispor',
    sourceShopifyOrderId: localOrderId,
    order: { id: localOrderId, sourceShopifyOrderId: orderId },
    lineItems: [{
      id: `${input.id}-line`,
      shopifyLineItemId: `${input.id}-order-line`,
      quantity: input.quantity ?? 1,
      shopifyOrderLineItem: {
        id: `${input.id}-order-line`,
        sourceLineItemId: `${input.id}-shopify-line`,
      },
    }],
    fullRefundTerminalFact: input.terminal
      ? { id: `${input.id}-fact`, shopifyOrderGid: orderGid }
      : null,
    shipmentExecutions: input.pendingShipment ? [{ id: `${input.id}-shipment` }] : [],
    fulfillment: input.fulfillmentSyncStatus === undefined
      ? null
      : { syncStatus: input.fulfillmentSyncStatus },
  };
}

function result(state: AllocationFullRefundTerminalVerifierResult['state'], reasonCode: string) {
  if (state === 'QUALIFIES') {
    return {
      state,
      reasonCode: 'allocation_full_refund_terminal_verified',
      shopifyOrderGid: orderGid,
      evidence: {},
    } as AllocationFullRefundTerminalVerifierResult;
  }
  return { state, reasonCode, evidence: null } as AllocationFullRefundTerminalVerifierResult;
}

function arrange(
  allocations: ReturnType<typeof allocation>[],
  outcomes: Record<string, AllocationFullRefundTerminalVerifierResult> = {},
) {
  const order = {
    id: 'local-order-1',
    sourceShopifyOrderId: orderId,
    sourceShopifyOrderNumber: '#1128',
    allocations,
  };
  const verifier = {
    verify: vi.fn(async (candidate: { id: string }) => outcomes[candidate.id] ??
      result('QUALIFIES', 'allocation_full_refund_terminal_verified')),
  };
  const dependencies = {
    findByShopifyOrderId: vi.fn(async (id: string) => id === orderId ? order : null),
    findByOrderNumber: vi.fn(async (number: string) => number === '#1128' ? [order] : []),
    verifier,
  } as unknown as TerminalCurrentStateDryRunDependencies;
  return {
    service: createTerminalCurrentStateRepairDryRunService({} as AppEnv, dependencies),
    dependencies,
    verifier,
  };
}

describe('terminal Current-State Repair exact-order dry-run planner', () => {
  it('classifies multiple vendors independently, skips existing facts, and is deterministic', async () => {
    const fixture = arrange(
      [
        allocation({ id: 'alloc-z', vendorId: 'vendor-b' }),
        allocation({ id: 'alloc-a', vendorId: 'vendor-a', terminal: true }),
        allocation({ id: 'alloc-m', vendorId: 'vendor-c' }),
      ],
      {
        'alloc-z': result('QUALIFIES', 'allocation_full_refund_terminal_verified'),
        'alloc-m': result('DOES_NOT_QUALIFY', 'refund_quantity_below_owned_quantity'),
      },
    );

    const planned = await fixture.service.plan({ orderIdentifier: '#1128' });

    expect(planned).toEqual({
      dryRun: true,
      shopifyOrderGid: orderGid,
      scanned: 3,
      candidateAllocations: 2,
      qualifies: 1,
      doesNotQualify: 1,
      indeterminate: 0,
      conflict: 0,
      alreadyTerminal: 1,
      errors: 0,
      allocations: [
        { vendorAllocationId: 'alloc-a', shopifyOrderGid: orderGid, vendorId: 'vendor-a', state: 'ALREADY_TERMINAL', reason: null },
        { vendorAllocationId: 'alloc-m', shopifyOrderGid: orderGid, vendorId: 'vendor-c', state: 'DOES_NOT_QUALIFY', reason: 'refund_quantity_below_owned_quantity' },
        { vendorAllocationId: 'alloc-z', shopifyOrderGid: orderGid, vendorId: 'vendor-b', state: 'QUALIFIES', reason: 'allocation_full_refund_terminal_verified' },
      ],
    });
    expect(fixture.verifier.verify).toHaveBeenCalledTimes(2);
  });

  it('fails incomplete local identity closed without a canonical read', async () => {
    const broken = allocation({ id: 'alloc-broken', quantity: 0 });
    const fixture = arrange([broken]);
    const planned = await fixture.service.plan({ orderIdentifier: orderId });

    expect(planned.allocations[0]).toMatchObject({
      state: 'INDETERMINATE',
      reason: 'allocation_owned_quantity_invalid',
    });
    expect(fixture.verifier.verify).not.toHaveBeenCalled();
  });

  it('preserves verifier indeterminate results and sanitizes thrown failures', async () => {
    const first = allocation({ id: 'alloc-a' });
    const second = allocation({ id: 'alloc-b' });
    const fixture = arrange([first, second], {
      'alloc-a': result('INDETERMINATE', 'canonical_refunds_list_incomplete'),
    });
    fixture.verifier.verify.mockImplementation(async (candidate: { id: string }) => {
      if (candidate.id === 'alloc-b') throw new Error('secret raw payload');
      return result('INDETERMINATE', 'canonical_refunds_list_incomplete');
    });

    const planned = await fixture.service.plan({ orderIdentifier: orderId });
    expect(planned.allocations).toEqual([
      { vendorAllocationId: 'alloc-a', shopifyOrderGid: orderGid, vendorId: 'yalispor', state: 'INDETERMINATE', reason: 'canonical_refunds_list_incomplete' },
      { vendorAllocationId: 'alloc-b', shopifyOrderGid: orderGid, vendorId: 'yalispor', state: 'ERROR', reason: 'terminal_verification_failed' },
    ]);
    expect(JSON.stringify(planned)).not.toContain('secret raw payload');
  });

  it.each([
    [{ pendingShipment: true }, 'shipment_execution_pending'],
    [{ fulfillmentSyncStatus: 'fulfillment_submission_pending' }, 'shopify_fulfillment_submission_pending'],
  ] as const)('reports a qualifying durable claim as conflict', async (claim, reason) => {
    const fixture = arrange([allocation({ id: 'alloc-a', ...claim })]);
    const planned = await fixture.service.plan({ orderIdentifier: orderId });
    expect(planned.allocations[0]).toMatchObject({ state: 'CONFLICT', reason });
    expect(planned.conflict).toBe(1);
    expect(planned.qualifies).toBe(0);
  });

  it('performs no business writes and exposes no PII, evidence, payload, or secret fields', async () => {
    const fixture = arrange([allocation({ id: 'alloc-a' })]);
    const planned = await fixture.service.plan({ orderIdentifier: orderId });
    expect(Object.keys(fixture.dependencies).sort()).toEqual([
      'findByOrderNumber', 'findByShopifyOrderId', 'verifier',
    ]);
    expect(fixture.dependencies.findByShopifyOrderId).toHaveBeenCalledOnce();
    expect(fixture.dependencies.findByOrderNumber).not.toHaveBeenCalled();
    expect(Object.keys(planned.allocations[0]).sort()).toEqual([
      'reason', 'shopifyOrderGid', 'state', 'vendorAllocationId', 'vendorId',
    ]);
    expect(JSON.stringify(planned)).not.toMatch(/customer|email|phone|address|evidenceJson|payload|token|secret/i);
  });

  it('rejects invalid, missing, and ambiguous exact identities safely', async () => {
    const fixture = arrange([]);
    await expect(fixture.service.plan({ orderIdentifier: '1128,1129' })).rejects.toMatchObject({
      code: 'invalid_order_identifier', statusCode: 400,
    } satisfies Partial<TerminalCurrentStateDryRunError>);
    await expect(fixture.service.plan({ orderIdentifier: '#9999' })).rejects.toMatchObject({
      code: 'order_not_found', statusCode: 404,
    });

    fixture.dependencies.findByOrderNumber = vi.fn(async () => [{}, {}]) as never;
    await expect(fixture.service.plan({ orderIdentifier: '#1128' })).rejects.toMatchObject({
      code: 'ambiguous_order_identifier', statusCode: 409,
    });
  });
});
