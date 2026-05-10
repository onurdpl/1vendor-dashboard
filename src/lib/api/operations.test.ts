import { describe, expect, it } from 'vitest';
import { hasPermission } from '../auth/permissions';
import { listAdminOperationsQueue } from './operations';

describe('admin operations queue', () => {
  it('includes a pending reassignment item', () => {
    const queue = listAdminOperationsQueue();
    expect(queue.some((item) => item.type === 'pending_reassignment')).toBe(true);
  });

  it('includes a vendor blocked item', () => {
    const queue = listAdminOperationsQueue();
    expect(queue.some((item) => item.type === 'vendor_blocked')).toBe(true);
  });

  it('includes queue links to admin Shopify order details', () => {
    const queue = listAdminOperationsQueue();
    expect(queue.some((item) => item.actionTo?.startsWith('/admin/orders/'))).toBe(true);
  });

  it('denies vendor write-level admin queue access permission', () => {
    expect(hasPermission('vendor', 'orders:write')).toBe(false);
    expect(hasPermission('admin', 'orders:write')).toBe(true);
  });
});
