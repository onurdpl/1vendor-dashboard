import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  outboundShopifyRefundAttempt: {
    findUnique: vi.fn(),
  },
  orderShippingRefundClaim: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

const {
  acquireOrderShippingRefundClaim,
  buildShopifyRefundIdempotencyKey,
  releaseResolvedOrderShippingRefundClaimsForAllocation,
  OrderShippingRefundClaimValidationError,
} = await import('../backend/src/modules/orders/order-shipping-refund-claim.service.js');

const activeClaim = {
  id: 'claim-a',
  shopifyOrderId: 'order-x',
  ownerAttemptId: 'attempt-a',
  activeOrderKey: 'order-x',
  status: 'ACTIVE',
  acquiredAt: new Date('2026-08-10T12:00:00.000Z'),
  releasedAt: null,
  releaseReason: null,
  createdAt: new Date('2026-08-10T12:00:00.000Z'),
  updatedAt: new Date('2026-08-10T12:00:00.000Z'),
};

function attempt(id: string, shopifyOrderId = 'order-x', status = 'READY_TO_SUBMIT') {
  return { id, shopifyOrderId, status };
}

describe('order-level checkout shipping refund ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.outboundShopifyRefundAttempt.findUnique.mockResolvedValue(attempt('attempt-a'));
    prismaMock.orderShippingRefundClaim.findUnique.mockResolvedValue(null);
    prismaMock.orderShippingRefundClaim.findFirst.mockResolvedValue(null);
    prismaMock.orderShippingRefundClaim.create.mockResolvedValue(activeClaim);
  });

  it('acquires the first claim for an order', async () => {
    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-a' }))
      .resolves.toEqual({ outcome: 'ACQUIRED', claimId: 'claim-a', ownerAttemptId: 'attempt-a' });

    expect(prismaMock.orderShippingRefundClaim.create).toHaveBeenCalledWith({
      data: {
        shopifyOrderId: 'order-x',
        ownerAttemptId: 'attempt-a',
        activeOrderKey: 'order-x',
        status: 'ACTIVE',
      },
    });
  });

  it('returns SAME_OWNER when the same logical attempt resumes', async () => {
    prismaMock.orderShippingRefundClaim.findUnique.mockResolvedValue(activeClaim);

    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-a' }))
      .resolves.toEqual({ outcome: 'SAME_OWNER', claimId: 'claim-a', ownerAttemptId: 'attempt-a' });
    expect(prismaMock.orderShippingRefundClaim.create).not.toHaveBeenCalled();
  });

  it('returns OWNED_BY_ANOTHER_ATTEMPT for a database unique conflict on the same order', async () => {
    prismaMock.outboundShopifyRefundAttempt.findUnique.mockResolvedValue(attempt('attempt-b'));
    prismaMock.orderShippingRefundClaim.create.mockRejectedValue({ code: 'P2002' });
    prismaMock.orderShippingRefundClaim.findFirst.mockResolvedValue(activeClaim);

    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-b' }))
      .resolves.toEqual({
        outcome: 'OWNED_BY_ANOTHER_ATTEMPT',
        claimId: 'claim-a',
        ownerAttemptId: 'attempt-a',
      });
  });

  it('allows different orders to acquire independent active keys', async () => {
    prismaMock.outboundShopifyRefundAttempt.findUnique
      .mockResolvedValueOnce(attempt('attempt-a', 'order-x'))
      .mockResolvedValueOnce(attempt('attempt-b', 'order-y'));
    prismaMock.orderShippingRefundClaim.create
      .mockResolvedValueOnce(activeClaim)
      .mockResolvedValueOnce({ ...activeClaim, id: 'claim-b', shopifyOrderId: 'order-y', ownerAttemptId: 'attempt-b', activeOrderKey: 'order-y' });

    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-a' }))
      .resolves.toMatchObject({ outcome: 'ACQUIRED', claimId: 'claim-a' });
    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-y', attemptId: 'attempt-b' }))
      .resolves.toMatchObject({ outcome: 'ACQUIRED', claimId: 'claim-b' });
  });

  it('treats a concurrent unique conflict from the same attempt as SAME_OWNER', async () => {
    prismaMock.orderShippingRefundClaim.create.mockRejectedValue({ code: 'P2002' });
    prismaMock.orderShippingRefundClaim.findFirst.mockResolvedValue(activeClaim);

    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-a' }))
      .resolves.toEqual({ outcome: 'SAME_OWNER', claimId: 'claim-a', ownerAttemptId: 'attempt-a' });
  });

  it('preserves the same Shopify idempotency identity for the same attempt', () => {
    const input = { allocationId: 'allocation-a', attemptId: 'attempt-a' };
    expect(buildShopifyRefundIdempotencyKey(input)).toBe('shopify-refund:allocation-a:attempt-a');
    expect(buildShopifyRefundIdempotencyKey(input)).toBe('shopify-refund:allocation-a:attempt-a');
  });

  it('releases ownership only through a canonically resolved owner query', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(releaseResolvedOrderShippingRefundClaimsForAllocation(
      { orderShippingRefundClaim: { updateMany } } as never,
      { vendorAllocationId: 'allocation-a', releasedAt: new Date('2026-08-10T13:00:00.000Z') },
    )).resolves.toEqual({ outcome: 'RELEASED', releasedClaims: 1 });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'ACTIVE',
        ownerAttempt: {
          vendorAllocationId: 'allocation-a',
          status: 'RESOLVED',
        },
      }),
      data: expect.objectContaining({
        status: 'RELEASED',
        activeOrderKey: null,
        releaseReason: 'OWNER_ATTEMPT_RESOLVED',
      }),
    }));
  });

  it('allows a later attempt to acquire after the resolved owner claim is released', async () => {
    prismaMock.outboundShopifyRefundAttempt.findUnique.mockResolvedValue(attempt('attempt-b'));
    prismaMock.orderShippingRefundClaim.findUnique.mockResolvedValue(null);
    prismaMock.orderShippingRefundClaim.create.mockResolvedValue({
      ...activeClaim,
      id: 'claim-b',
      ownerAttemptId: 'attempt-b',
    });

    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-b' }))
      .resolves.toEqual({ outcome: 'ACQUIRED', claimId: 'claim-b', ownerAttemptId: 'attempt-b' });
  });

  it.each(['READY_TO_SUBMIT', 'SHOPIFY_ACTION_PENDING', 'FAILED'])(
    'does not release %s or other non-RESOLVED ownership',
    async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      await expect(releaseResolvedOrderShippingRefundClaimsForAllocation(
        { orderShippingRefundClaim: { updateMany } } as never,
        { vendorAllocationId: 'allocation-a', releasedAt: new Date('2026-08-10T13:00:00.000Z') },
      )).resolves.toEqual({ outcome: 'NOT_RELEASED', releasedClaims: 0 });
    },
  );

  it('keeps a nonterminal crash-style owner resumable and blocks a different allocation attempt', async () => {
    prismaMock.outboundShopifyRefundAttempt.findUnique
      .mockResolvedValueOnce(attempt('attempt-a', 'order-x', 'SHOPIFY_ACTION_PENDING'))
      .mockResolvedValueOnce(attempt('attempt-b', 'order-x', 'READY_TO_SUBMIT'));
    prismaMock.orderShippingRefundClaim.findUnique
      .mockResolvedValueOnce(activeClaim)
      .mockResolvedValueOnce(null);
    prismaMock.orderShippingRefundClaim.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.orderShippingRefundClaim.findFirst.mockResolvedValue(activeClaim);

    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-a' }))
      .resolves.toMatchObject({ outcome: 'SAME_OWNER' });
    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-b' }))
      .resolves.toMatchObject({ outcome: 'OWNED_BY_ANOTHER_ATTEMPT', ownerAttemptId: 'attempt-a' });
  });

  it('rejects ownership for terminal attempts and leaves product-only execution opt-in', async () => {
    prismaMock.outboundShopifyRefundAttempt.findUnique.mockResolvedValue(attempt('attempt-a', 'order-x', 'RESOLVED'));

    await expect(acquireOrderShippingRefundClaim({ shopifyOrderId: 'order-x', attemptId: 'attempt-a' }))
      .rejects.toBeInstanceOf(OrderShippingRefundClaimValidationError);
    expect(prismaMock.orderShippingRefundClaim.create).not.toHaveBeenCalled();
  });
});
