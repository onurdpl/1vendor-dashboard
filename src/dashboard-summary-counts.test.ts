import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  returnRecord: {
    count: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/lib/dashboard-timing.js', () => ({
  withDashboardTiming: vi.fn((_step: string, action: () => unknown) => action()),
}));

const { getDashboardOperationalSummary } = await import('../backend/src/modules/dashboard/dashboard-summary.service.js');
const { buildReturnReviewAttentionWhere, isReturnReviewAttentionStatus } = await import('../backend/src/modules/returns/return-review-status.js');

describe('dashboard summary return review counts', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.count.mockReset();
    prismaMock.vendorAllocation.groupBy.mockReset();
    prismaMock.returnRecord.count.mockReset();

    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(4);
    prismaMock.vendorAllocation.groupBy.mockResolvedValueOnce([]);
    prismaMock.returnRecord.count.mockResolvedValueOnce(5);
  });

  it('counts return review attention with the Returns workflow status set', async () => {
    const summary = await getDashboardOperationalSummary('yalispor');

    expect(summary.returns.refundAttention).toBe(5);
    expect(prismaMock.vendorAllocation.count).toHaveBeenNthCalledWith(1, {
      where: { assignedVendorId: 'yalispor' },
    });
    expect(prismaMock.vendorAllocation.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        assignedVendorId: 'yalispor',
        fullRefundTerminalFact: null,
      },
    }));
    expect(prismaMock.vendorAllocation.count).toHaveBeenNthCalledWith(2, {
      where: {
        assignedVendorId: 'yalispor',
        fullRefundTerminalFact: null,
        order: {
          cancelledAt: null,
        },
        NOT: expect.any(Array),
      },
    });
    expect(prismaMock.returnRecord.count).toHaveBeenCalledWith({
      where: {
        vendorAllocation: {
          assignedVendorId: 'yalispor',
        },
        ...buildReturnReviewAttentionWhere(),
      },
    });
  });

  it('matches Returns page active-review statuses and excludes terminal statuses', () => {
    expect(isReturnReviewAttentionStatus('requested')).toBe(true);
    expect(isReturnReviewAttentionStatus('Requested')).toBe(true);
    expect(isReturnReviewAttentionStatus('awaiting_review')).toBe(true);
    expect(isReturnReviewAttentionStatus('Awaiting Review')).toBe(true);
    expect(isReturnReviewAttentionStatus('pending')).toBe(true);
    expect(isReturnReviewAttentionStatus('in_review')).toBe(true);
    expect(isReturnReviewAttentionStatus('in review')).toBe(true);

    expect(isReturnReviewAttentionStatus('approved')).toBe(false);
    expect(isReturnReviewAttentionStatus('refunded')).toBe(false);
    expect(isReturnReviewAttentionStatus('processed')).toBe(false);
    expect(isReturnReviewAttentionStatus('closed')).toBe(false);
    expect(isReturnReviewAttentionStatus('cancelled')).toBe(false);
  });
});
