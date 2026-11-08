import { describe, expect, it } from 'vitest';
import { queryKeys } from './queryKeys';

describe('vendor scoped query keys', () => {
  it('keeps orders, returns, and finance caches separated by selected vendor', () => {
    expect(queryKeys.orders.list('demo-vendor-a')).not.toEqual(queryKeys.orders.list('demo-vendor-b'));
    expect(queryKeys.returns.list('demo-vendor-a')).not.toEqual(queryKeys.returns.list('demo-vendor-b'));
    expect(queryKeys.finance.summary('demo-vendor-a')).not.toEqual(queryKeys.finance.summary('demo-vendor-b'));
  });

  it('keeps Returns page and search results in separate Vendor cache entries', () => {
    expect(queryKeys.returns.list('vendor-a', { limit: 101, offset: 0, search: 'SKU-1' }))
      .not.toEqual(queryKeys.returns.list('vendor-a', { limit: 101, offset: 100, search: 'SKU-1' }));
    expect(queryKeys.returns.list('vendor-a', { search: 'SKU-1' }))
      .not.toEqual(queryKeys.returns.list('vendor-a', { search: 'SKU-2' }));
    expect(queryKeys.returns.list('vendor-a', { search: 'SKU-1' }))
      .not.toEqual(queryKeys.returns.list('vendor-b', { search: 'SKU-1' }));
    expect(queryKeys.returns.list('vendor-a', { workflow: 'requested' }))
      .not.toEqual(queryKeys.returns.list('vendor-a', { workflow: 'approved' }));
    expect(queryKeys.returns.list('vendor-a', { status: 'Requested' }))
      .not.toEqual(queryKeys.returns.list('vendor-a', { status: 'Approved' }));
    expect(queryKeys.returns.list('vendor-a', { source: 'pending' }))
      .not.toEqual(queryKeys.returns.list('vendor-a', { source: 'refunded' }));
    expect(queryKeys.returns.statusOptions('vendor-a')).not.toEqual(queryKeys.returns.statusOptions('vendor-b'));
  });

  it('keeps vendor order workflow pages and summaries in distinct cache buckets', () => {
    expect(queryKeys.orders.list('vendor-a')).toEqual([
      'orders',
      'list',
      'vendor-a',
      'all',
      'default',
      0,
      '',
      'all',
      'all',
      'all',
      false,
      false,
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
    expect(queryKeys.orders.list('vendor-a', { search: '#1150' }))
      .not.toEqual(queryKeys.orders.list('vendor-a', { search: '#1151' }));
    const filterVariants = [
      {},
      { allocationStatus: 'active' },
      { fulfillmentStatus: 'Pending' },
      { shippingStatus: 'In Transit' },
      { blocked: true },
      { trackingMissing: true },
      { allocationStatus: 'active', fulfillmentStatus: 'Pending', shippingStatus: 'In Transit',
        blocked: true, trackingMissing: true },
    ] as const;
    const filterKeys = filterVariants.map((filters) => queryKeys.orders.list('vendor-a', {
      workflow: 'awaitingShipment', limit: 101, offset: 100, search: '#1150', ...filters,
    }));
    expect(new Set(filterKeys.map((key) => JSON.stringify(key))).size).toBe(filterVariants.length);
    expect(queryKeys.orders.workflowSummary('vendor-a')).toEqual([
      'orders',
      'workflow-summary',
      'vendor-a',
    ]);
    expect(queryKeys.orders.workflowSummary('vendor-a')).not.toEqual(queryKeys.orders.list('vendor-a'));
  });
});
