import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  operationalJob: {
    findUnique: vi.fn(),
  },
}));
const reconcileAllocationMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderMock = vi.hoisted(() => vi.fn());
const markOperationalJobProcessingMock = vi.hoisted(() => vi.fn());
const markOperationalJobCompletedMock = vi.hoisted(() => vi.fn());
const markOperationalJobFailedMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/reconciliation/reconciliation.service.js', () => ({
  createReconciliationService: vi.fn(() => ({
    reconcileAllocation: reconcileAllocationMock,
    reconcileShopifyOrder: reconcileShopifyOrderMock,
  })),
}));
vi.mock('../backend/src/modules/operational-jobs/operational-jobs.service.js', () => ({
  createOperationalJob: vi.fn(),
  markOperationalJobProcessing: markOperationalJobProcessingMock,
  markOperationalJobCompleted: markOperationalJobCompletedMock,
  markOperationalJobFailed: markOperationalJobFailedMock,
  serializeOperationalJob: vi.fn(),
}));

const { executeScheduledReconciliationJob } = await import(
  '../backend/src/modules/reconciliation/scheduled-reconciliation.service.js'
);

describe('scheduled allocation reconciliation scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markOperationalJobProcessingMock.mockResolvedValue(undefined);
    markOperationalJobCompletedMock.mockResolvedValue(undefined);
    markOperationalJobFailedMock.mockResolvedValue(undefined);
    reconcileAllocationMock.mockResolvedValue({
      reconciliationStatus: 'in_sync',
      staleFields: [],
      repairedFields: [],
      skippedFields: [],
      affectedAllocations: [],
      affectedVendorIds: [],
      warnings: [],
      requiresManualReview: false,
    });
  });

  it('keeps an allocation-linked scheduled job on reconcileAllocation', async () => {
    prismaMock.operationalJob.findUnique.mockResolvedValue({
      id: 'job-allocation-a',
      jobType: 'RECONCILIATION',
      vendorAllocationId: 'alloc-a',
      sourceShopifyOrderId: 'order-1',
    });

    const result = await executeScheduledReconciliationJob({} as never, 'job-allocation-a');

    expect(result.status).toBe('completed');
    expect(reconcileAllocationMock).toHaveBeenCalledWith('alloc-a');
    expect(reconcileShopifyOrderMock).not.toHaveBeenCalled();
  });
});
