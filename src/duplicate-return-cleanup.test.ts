import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  returnRecord: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  financeLedgerEntry: {
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { cleanupDuplicateReturnRecords } = await import('../backend/src/modules/returns/duplicate-return-cleanup.service.js');

function canonicalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-request-23229399377-sporjinal-20346971095377',
    vendorAllocationId: 'alloc-1029-sporjinal',
    sourceShopifyOrderId: '7621834670417',
    sourceShopifyOrderNumber: '#1029',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: '23229399377',
    sourceShopifyReturnGid: 'gid://shopify/Return/23229399377',
    sourceShopifyLineItemId: '20346971095377',
    returnRequestSource: 'shopify_return_request',
    returnLifecycleStatus: 'closed',
    status: 'closed',
    reason: 'UNWANTED',
    updatedAt: new Date('2026-05-16T14:37:39.246Z'),
    createdAt: new Date('2026-05-16T14:33:19.569Z'),
    vendorAllocation: {
      assignedVendorId: 'sporjinal',
      lineItems: [
        {
          shopifyOrderLineItem: {
            sourceLineItemId: '20346971095377',
            sku: 'DJ1196-002-42',
            title: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 42',
          },
        },
      ],
      refundRecords: [
        {
          sourceShopifyRefundId: '1074533826897',
          amount: '3399.00',
          status: 'processed',
          updatedAt: new Date('2026-05-16T14:37:39.019Z'),
          lineItems: [
            {
              sourceLineItemId: '20346971095377',
              sku: 'DJ1196-002-42',
              title: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 42',
              shopifyOrderLineItem: {
                sourceLineItemId: '20346971095377',
                sku: 'DJ1196-002-42',
                title: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 42',
              },
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function duplicateRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...canonicalRecord(),
    id: 'return-sporjinal-1074533826897',
    sourceShopifyRefundId: '1074533826897',
    sourceShopifyReturnId: null,
    sourceShopifyReturnGid: null,
    sourceShopifyLineItemId: null,
    returnRequestSource: null,
    returnLifecycleStatus: null,
    status: 'processed',
    reason: null,
    createdAt: new Date('2026-05-16T14:37:39.019Z'),
    updatedAt: new Date('2026-05-16T14:37:39.019Z'),
    ...overrides,
  };
}

describe('duplicate Shopify return cleanup', () => {
  beforeEach(() => {
    prismaMock.returnRecord.findMany.mockReset();
    prismaMock.returnRecord.update.mockReset();
    prismaMock.financeLedgerEntry.update.mockReset();
    prismaMock.financeLedgerEntry.delete.mockReset();
  });

  it('dry-run detects a #1029-style duplicate pair without updating', async () => {
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([canonicalRecord(), duplicateRecord()]);

    const result = await cleanupDuplicateReturnRecords({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.duplicatePairs).toEqual([
      expect.objectContaining({
        canonicalRow: expect.objectContaining({
          id: 'return-request-23229399377-sporjinal-20346971095377',
        }),
        duplicateRow: expect.objectContaining({
          id: 'return-sporjinal-1074533826897',
        }),
        fieldsToCopy: expect.objectContaining({
          sourceShopifyRefundId: '1074533826897',
          status: 'processed',
          refundAmount: '3399.00',
        }),
        safeToExecute: true,
        archiveAvailable: false,
      }),
    ]);
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
  });

  it('execution copies refund metadata to the canonical row and does not delete duplicate records', async () => {
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([canonicalRecord(), duplicateRecord()]);

    const result = await cleanupDuplicateReturnRecords({ dryRun: false });

    expect(result.updated).toBe(1);
    expect(result.deleted).toBe(0);
    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith({
      where: {
        id: 'return-request-23229399377-sporjinal-20346971095377',
      },
      data: {
        sourceShopifyRefundId: '1074533826897',
        status: 'processed',
      },
    });
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.delete).not.toHaveBeenCalled();
  });

  it('ignores non-duplicates', async () => {
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([
      canonicalRecord(),
      duplicateRecord({ vendorAllocationId: 'other-allocation' }),
    ]);

    const result = await cleanupDuplicateReturnRecords({ dryRun: true });

    expect(result.duplicatePairs).toHaveLength(0);
  });
});
