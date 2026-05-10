import { afterEach, describe, expect, it } from 'vitest';
import { clearCurrentUser, clearToken, setCurrentUser, setToken, type CurrentUser } from '../auth';
import { MockRequestError, mockRequest } from './mockTransport';
import type { ShopifyOrderBreakdown } from './contracts';

const adminUser: CurrentUser = {
  email: 'admin@demo.com',
  name: 'Demo Admin',
  role: 'admin',
  vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
  canSwitchVendors: true,
  defaultVendorId: 'demo-vendor-a',
};

const vendorUser: CurrentUser = {
  email: 'vendor-a@demo.com',
  name: 'Vendor A User',
  role: 'vendor',
  vendorAccess: ['demo-vendor-a'],
  canSwitchVendors: false,
  defaultVendorId: 'demo-vendor-a',
};

describe('mock admin Shopify order breakdown transport', () => {
  afterEach(() => {
    clearToken();
    clearCurrentUser();
  });

  it('allows admin to fetch full Shopify order breakdown', async () => {
    setToken('mock-session');
    setCurrentUser(adminUser);

    const breakdown = await mockRequest<ShopifyOrderBreakdown>('/admin/orders/1001');

    expect(breakdown.sourceShopifyOrderNumber).toBe(1001);
    expect(breakdown.allocations).toHaveLength(2);
    expect(breakdown.allocations.map((allocation) => allocation.vendorId).sort()).toEqual([
      'demo-vendor-a',
      'demo-vendor-b',
    ]);
    expect(
      breakdown.allocations.every(
        (allocation) => allocation.assignedVendorId === allocation.originalVendorId && allocation.vendorId === allocation.assignedVendorId,
      ),
    ).toBe(true);
    expect(
      breakdown.allocations.some(
        (allocation) =>
          allocation.allocationStatus === 'pending_reassignment' &&
          allocation.reassignmentRequired &&
          allocation.cancellationReason === 'out_of_stock' &&
          allocation.reassignmentCandidateVendorIds.length > 0 &&
          allocation.assignmentHistory.some((entry) => entry.action === 'reassignment_requested'),
      ),
    ).toBe(true);
  });

  it('blocks vendor user from admin Shopify breakdown endpoint', async () => {
    setToken('mock-session');
    setCurrentUser(vendorUser);

    await expect(mockRequest('/admin/orders/1001')).rejects.toMatchObject({
      status: 403,
    });
  });
});
