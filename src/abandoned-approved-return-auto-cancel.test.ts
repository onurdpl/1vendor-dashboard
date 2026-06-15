import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  returnRecord: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  APPROVED_RETURN_AUTO_CANCEL_DEFAULT_DAYS,
  runAbandonedApprovedReturnAutoCancel,
} = await import('../backend/src/modules/returns/abandoned-approved-return-auto-cancel.service.js');
const { hasApprovedOpenReturnHold } = await import('../backend/src/modules/finance/settlement-return-hold.service.js');

const now = new Date('2026-06-15T10:00:00.000Z');
const oldApprovedAt = new Date('2026-05-25T10:00:00.000Z');
const recentApprovedAt = new Date('2026-06-10T10:00:00.000Z');

const env = {
  NODE_ENV: 'test' as const,
  APPROVED_RETURN_AUTO_CANCEL_DAYS: 14,
  APPROVED_RETURN_AUTO_CANCEL_LIMIT: 25,
};

function buildReturnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    vendorAllocationId: 'alloc-1',
    sourceShopifyOrderId: '1075',
    sourceShopifyOrderNumber: '#1075',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: '239',
    sourceShopifyReturnGid: 'gid://shopify/Return/239',
    sourceShopifyLineItemId: 'line-1',
    returnLifecycleStatus: 'approved',
    returnRequestSource: 'shopify_return_request',
    requestCreatedAt: new Date('2026-05-20T10:00:00.000Z'),
    requestUpdatedAt: oldApprovedAt,
    status: 'approved',
    reason: 'Return approved',
    returnReasonNote: null,
    returnProvider: null,
    returnProviderShipmentId: null,
    returnTrackingNumber: null,
    returnTrackingUrl: null,
    returnLabel: null,
    returnProviderSnapshot: null,
    returnCarrierName: null,
    returnReferenceId: null,
    navlungoReturnCreatedAt: null,
    vendorReceivedAt: null,
    vendorReviewedAt: null,
    vendorDecision: null,
    vendorDecisionReason: null,
    createdAt: new Date('2026-05-20T10:00:00.000Z'),
    updatedAt: oldApprovedAt,
    vendorAllocation: {
      refundRecords: [],
      financeEntries: [],
    },
    ...overrides,
  };
}

function buildShopifyState(overrides: Record<string, unknown> = {}) {
  return {
    returnGid: 'gid://shopify/Return/239',
    status: 'OPEN',
    requestApprovedAt: oldApprovedAt.toISOString(),
    closedAt: null,
    refundIds: [],
    transactionIds: [],
    reverseFulfillmentOrders: [
      {
        id: 'gid://shopify/ReverseFulfillmentOrder/1',
        status: 'OPEN',
        lineItems: [],
        reverseDeliveries: [],
      },
    ],
    source: 'shopify_admin' as const,
    ...overrides,
  };
}

function buildShopifyService(overrides: Record<string, unknown> = {}) {
  return {
    fetchReturnCancellationState: vi.fn().mockResolvedValue(buildShopifyState()),
    cancelReturn: vi.fn().mockResolvedValue({
      returnGid: 'gid://shopify/Return/239',
      status: 'CANCELED',
      userErrors: [],
      source: 'shopify_admin' as const,
    }),
    ...overrides,
  };
}

function mockCandidateAndRelated(record = buildReturnRecord(), related = [record]) {
  prismaMock.returnRecord.findMany.mockResolvedValueOnce([record]).mockResolvedValueOnce(related);
}

describe('abandoned approved return auto-cancel', () => {
  beforeEach(() => {
    prismaMock.returnRecord.findMany.mockReset();
    prismaMock.returnRecord.update.mockReset();
    prismaMock.returnRecord.update.mockResolvedValue({});
  });

  it('auto-cancels an old approved untouched Shopify return', async () => {
    const record = buildReturnRecord();
    const shopifyService = buildShopifyService();
    mockCandidateAndRelated(record);

    const result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(shopifyService.fetchReturnCancellationState).toHaveBeenCalledWith('gid://shopify/Return/239');
    expect(shopifyService.cancelReturn).toHaveBeenCalledWith('gid://shopify/Return/239');
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith({
      where: { id: 'return-1' },
      data: expect.objectContaining({
        returnLifecycleStatus: 'cancelled',
        status: 'cancelled',
        requestUpdatedAt: now,
      }),
    });
    expect(result).toMatchObject({
      policyDays: APPROVED_RETURN_AUTO_CANCEL_DEFAULT_DAYS,
      cancelledCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  it('constructs a Shopify Return GID from legacy numeric return ids', async () => {
    const record = buildReturnRecord({ sourceShopifyReturnGid: null, sourceShopifyReturnId: '239' });
    const shopifyService = buildShopifyService();
    mockCandidateAndRelated(record);

    await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(shopifyService.fetchReturnCancellationState).toHaveBeenCalledWith('gid://shopify/Return/239');
    expect(shopifyService.cancelReturn).toHaveBeenCalledWith('gid://shopify/Return/239');
  });

  it('skips approved returns younger than 14 days', async () => {
    const record = buildReturnRecord({ requestUpdatedAt: recentApprovedAt, updatedAt: recentApprovedAt });
    const shopifyService = buildShopifyService();
    mockCandidateAndRelated(record);

    const result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(shopifyService.cancelReturn).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith({
      where: { id: 'return-1' },
      data: {
        returnProviderSnapshot: expect.objectContaining({
          abandonedApprovedReturnAutoCancel: expect.objectContaining({
            status: 'skipped',
            skippedReason: 'approved_return_too_recent',
          }),
        }),
      },
    });
    expect(result.skippedCount).toBe(1);
  });

  it('skips when a RefundRecord exists', async () => {
    const record = buildReturnRecord({
      vendorAllocation: {
        refundRecords: [{ id: 'refund-record-1', sourceShopifyRefundId: 'refund-1' }],
        financeEntries: [],
      },
    });
    const shopifyService = buildShopifyService();
    mockCandidateAndRelated(record);

    const result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(shopifyService.cancelReturn).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ status: 'skipped', skippedReason: 'refund_record_exists' });
  });

  it('skips when refund ledger evidence exists', async () => {
    const record = buildReturnRecord({
      vendorAllocation: {
        refundRecords: [],
        financeEntries: [{ id: 'fin-refund-1' }],
      },
    });
    const shopifyService = buildShopifyService();
    mockCandidateAndRelated(record);

    const result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(shopifyService.cancelReturn).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ status: 'skipped', skippedReason: 'refund_ledger_exists' });
  });

  it('skips when vendor receipt or decision exists', async () => {
    const receivedRecord = buildReturnRecord({ vendorReceivedAt: new Date('2026-06-01T10:00:00.000Z') });
    const decisionRecord = buildReturnRecord({ id: 'return-2', vendorDecision: 'approved' });
    const shopifyService = buildShopifyService();

    mockCandidateAndRelated(receivedRecord);
    let result = await runAbandonedApprovedReturnAutoCancel(env as never, { now, shopifyAdminService: shopifyService });
    expect(result.results[0]).toMatchObject({ status: 'skipped', skippedReason: 'vendor_received' });

    prismaMock.returnRecord.findMany.mockReset();
    mockCandidateAndRelated(decisionRecord);
    result = await runAbandonedApprovedReturnAutoCancel(env as never, { now, shopifyAdminService: shopifyService });
    expect(result.results[0]).toMatchObject({ status: 'skipped', skippedReason: 'vendor_decision_exists' });
    expect(shopifyService.cancelReturn).not.toHaveBeenCalled();
  });

  it('skips when local or Shopify return shipment evidence exists', async () => {
    const localEvidenceRecord = buildReturnRecord({ returnTrackingNumber: 'RET-TRACK-1' });
    const shopifyService = buildShopifyService();
    mockCandidateAndRelated(localEvidenceRecord);

    let result = await runAbandonedApprovedReturnAutoCancel(env as never, { now, shopifyAdminService: shopifyService });
    expect(result.results[0]).toMatchObject({ status: 'skipped', skippedReason: 'return_shipment_evidence_exists' });

    prismaMock.returnRecord.findMany.mockReset();
    const canonicalEvidenceService = buildShopifyService({
      fetchReturnCancellationState: vi.fn().mockResolvedValue(buildShopifyState({
        reverseFulfillmentOrders: [
          {
            id: 'gid://shopify/ReverseFulfillmentOrder/1',
            status: 'IN_TRANSIT',
            lineItems: [],
            reverseDeliveries: [
              {
                id: 'gid://shopify/ReverseDelivery/1',
                labelPublicFileUrl: 'https://labels.example/return.pdf',
                trackingNumber: 'RET-TRACK-1',
                trackingUrl: null,
                carrierName: 'Carrier',
              },
            ],
          },
        ],
      })),
    });
    mockCandidateAndRelated(buildReturnRecord());
    result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: canonicalEvidenceService,
    });
    expect(canonicalEvidenceService.cancelReturn).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      status: 'skipped',
      skippedReason: 'shopify_reverse_delivery_evidence_exists',
    });
  });

  it('skips when Shopify canonical status is not OPEN', async () => {
    const shopifyService = buildShopifyService({
      fetchReturnCancellationState: vi.fn().mockResolvedValue(buildShopifyState({ status: 'CLOSED' })),
    });
    mockCandidateAndRelated(buildReturnRecord());

    const result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(shopifyService.cancelReturn).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ status: 'skipped', skippedReason: 'shopify_return_not_open' });
  });

  it('does not mutate local status when Shopify returnCancel returns userErrors', async () => {
    const shopifyService = buildShopifyService({
      cancelReturn: vi.fn().mockResolvedValue({
        returnGid: 'gid://shopify/Return/239',
        status: 'OPEN',
        userErrors: [{ field: ['id'], message: 'Return cannot be cancelled.' }],
        source: 'shopify_admin' as const,
      }),
    });
    mockCandidateAndRelated(buildReturnRecord());

    const result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith({
      where: { id: 'return-1' },
      data: {
        returnProviderSnapshot: expect.objectContaining({
          abandonedApprovedReturnAutoCancel: expect.objectContaining({
            status: 'failed',
            skippedReason: 'shopify_cancel_user_errors',
          }),
        }),
      },
    });
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled' }),
    }));
    expect(result.failedCount).toBe(1);
  });

  it('is idempotent when no local candidates remain', async () => {
    const shopifyService = buildShopifyService();
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([]);

    const result = await runAbandonedApprovedReturnAutoCancel(env as never, {
      now,
      shopifyAdminService: shopifyService,
    });

    expect(shopifyService.fetchReturnCancellationState).not.toHaveBeenCalled();
    expect(shopifyService.cancelReturn).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidatesFound: 0,
      processedShopifyReturns: 0,
      cancelledCount: 0,
    });
  });

  it('cancelled return status releases the existing settlement hold helper', () => {
    expect(hasApprovedOpenReturnHold({
      entryType: 'sale',
      vendorAllocation: {
        refundRecords: [],
        returnRecords: [
          {
            status: 'approved',
            returnLifecycleStatus: 'approved',
            sourceShopifyRefundId: null,
          },
        ],
      },
    })).toBe(true);

    expect(hasApprovedOpenReturnHold({
      entryType: 'sale',
      vendorAllocation: {
        refundRecords: [],
        returnRecords: [
          {
            status: 'cancelled',
            returnLifecycleStatus: 'cancelled',
            sourceShopifyRefundId: null,
          },
        ],
      },
    })).toBe(false);
  });
});
