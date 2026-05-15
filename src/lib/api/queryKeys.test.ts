import { describe, expect, it } from 'vitest';
import { queryKeys } from './queryKeys';

describe('vendor scoped query keys', () => {
  it('keeps orders, returns, and finance caches separated by selected vendor', () => {
    expect(queryKeys.orders.list('demo-vendor-a')).not.toEqual(queryKeys.orders.list('demo-vendor-b'));
    expect(queryKeys.returns.list('demo-vendor-a')).not.toEqual(queryKeys.returns.list('demo-vendor-b'));
    expect(queryKeys.finance.summary('demo-vendor-a')).not.toEqual(queryKeys.finance.summary('demo-vendor-b'));
  });
});
