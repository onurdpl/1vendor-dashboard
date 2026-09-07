import { describe, expect, it } from 'vitest';
import { queryKeys } from './queryKeys';

describe('vendor scoped query keys', () => {
  it('keeps orders, returns, and finance caches separated by selected vendor', () => {
    expect(queryKeys.orders.list('demo-vendor-a')).not.toEqual(queryKeys.orders.list('demo-vendor-b'));
    expect(queryKeys.returns.list('demo-vendor-a')).not.toEqual(queryKeys.returns.list('demo-vendor-b'));
    expect(queryKeys.finance.summary('demo-vendor-a')).not.toEqual(queryKeys.finance.summary('demo-vendor-b'));
  });

  it('keeps vendor order workflow pages and summaries in distinct cache buckets', () => {
    expect(queryKeys.orders.list('vendor-a')).toEqual([
      'orders',
      'list',
      'vendor-a',
      'all',
      'default',
      0,
    ]);
    expect(queryKeys.orders.list('vendor-a', {
      workflow: 'awaitingShipment',
      limit: 25,
      offset: 50,
    })).not.toEqual(queryKeys.orders.list('vendor-a', {
      workflow: 'trackingMissing',
      limit: 25,
      offset: 50,
    }));
    expect(queryKeys.orders.list('vendor-a', {
      workflow: 'awaitingShipment',
      limit: 25,
      offset: 50,
    })).not.toEqual(queryKeys.orders.list('vendor-a', {
      workflow: 'awaitingShipment',
      limit: 50,
      offset: 50,
    }));
    expect(queryKeys.orders.list('vendor-a', {
      workflow: 'awaitingShipment',
      limit: 25,
      offset: 50,
    })).not.toEqual(queryKeys.orders.list('vendor-a', {
      workflow: 'awaitingShipment',
      limit: 25,
      offset: 75,
    }));
    expect(queryKeys.orders.workflowSummary('vendor-a')).toEqual([
      'orders',
      'workflow-summary',
      'vendor-a',
    ]);
  });
});
