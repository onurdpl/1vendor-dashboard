import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backfillShopifyReturnReasons } from '../backend/src/modules/returns/return-reason-backfill.service.js';

const findManyMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const fetchReturnDetailsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    returnRecord: {
      findMany: findManyMock,
      update: updateMock,
    },
  },
}));

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => ({
    fetchReturnDetails: fetchReturnDetailsMock,
  })),
}));

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    sourceShopifyOrderNumber: '#1026',
    sourceShopifyReturnId: '23165600086',
    sourceShopifyReturnGid: 'gid://shopify/Return/23165600086',
    sourceShopifyLineItemId: 'line-1026',
    reason: 'Return requested',
    returnReasonNote: null,
    createdAt: new Date('2026-05-13T04:44:00Z'),
    ...overrides,
  };
}

function returnDetails(overrides: Record<string, unknown> = {}) {
  return {
    returnGid: 'gid://shopify/Return/23165600086',
    orderGid: 'gid://shopify/Order/1026',
    source: 'shopify_admin',
    lineItems: [
      {
        returnLineItemGid: 'gid://shopify/ReturnLineItem/1',
        fulfillmentLineItemGid: 'gid://shopify/FulfillmentLineItem/1',
        lineItemGid: 'gid://shopify/LineItem/line-1026',
        sku: 'SWOOSH-WHITE-S',
        returnReason: 'SIZE_TOO_LARGE',
        returnReasonNote: 'Beden büyük geldi.',
        customerNote: null,
      },
    ],
    ...overrides,
  };
}

describe('Shopify return reason backfill', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    updateMock.mockReset();
    fetchReturnDetailsMock.mockReset();
  });

  it('dry-run reports eligible rows without updating', async () => {
    findManyMock.mockResolvedValueOnce([record()]);
    fetchReturnDetailsMock.mockResolvedValueOnce(returnDetails());

    const result = await backfillShopifyReturnReasons({} as never, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.eligible).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.results[0]).toEqual(expect.objectContaining({
      status: 'eligible',
      reasonPreview: 'SIZE_TOO_LARGE',
      notePreview: 'Beden büyük geldi.',
    }));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('backfills generic reasons and note fields when execution is requested', async () => {
    findManyMock.mockResolvedValueOnce([record()]);
    fetchReturnDetailsMock.mockResolvedValueOnce(returnDetails({
      lineItems: [
        {
          returnLineItemGid: 'gid://shopify/ReturnLineItem/1',
          fulfillmentLineItemGid: 'gid://shopify/FulfillmentLineItem/1',
          lineItemGid: 'gid://shopify/LineItem/line-1026',
          sku: 'SWOOSH-WHITE-S',
          returnReason: 'SIZE_TOO_LARGE',
          returnReasonNote: 'Beden büyük geldi.',
          customerNote: 'Ürün büyük oldu.',
        },
      ],
    }));

    const result = await backfillShopifyReturnReasons({} as never, { dryRun: false });

    expect(result.updated).toBe(1);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'return-1' },
      data: {
        reason: 'SIZE_TOO_LARGE',
        returnReasonNote: 'Beden büyük geldi.',
      },
    });
  });

  it('does not overwrite a non-generic customer reason', async () => {
    findManyMock.mockResolvedValueOnce([record({ reason: 'SIZE_TOO_SMALL', returnReasonNote: 'Already captured.' })]);

    const result = await backfillShopifyReturnReasons({} as never, { dryRun: false });

    expect(result.skipped).toBe(1);
    expect(result.results[0]?.status).toBe('skipped_existing_reason');
    expect(fetchReturnDetailsMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('skips rows missing a Shopify return id', async () => {
    findManyMock.mockResolvedValueOnce([
      record({ sourceShopifyReturnId: null, sourceShopifyReturnGid: null }),
    ]);

    const result = await backfillShopifyReturnReasons({} as never, { dryRun: false });

    expect(result.skipped).toBe(1);
    expect(result.results[0]?.status).toBe('skipped_missing_return_id');
    expect(fetchReturnDetailsMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('populates note from returnReasonNote when customerNote is absent', async () => {
    findManyMock.mockResolvedValueOnce([record()]);
    fetchReturnDetailsMock.mockResolvedValueOnce(returnDetails());

    await backfillShopifyReturnReasons({} as never, { dryRun: false });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        reason: 'SIZE_TOO_LARGE',
        returnReasonNote: 'Beden büyük geldi.',
      },
    }));
  });
});
