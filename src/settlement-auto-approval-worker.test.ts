import { describe, expect, it } from 'vitest';
import { runAutomaticSettlementApprovalWorker } from '../backend/src/modules/finance/settlement-auto-approval-worker.service.js';

describe('locally callable automatic settlement approval worker', () => {
  it('rejects a missing vendor identity before any database operation', async () => {
    await expect(runAutomaticSettlementApprovalWorker({ vendorId: '' }))
      .rejects.toThrow('requires an exact vendor identity');
  });

  it('rejects a whitespace-altered vendor identity', async () => {
    await expect(runAutomaticSettlementApprovalWorker({ vendorId: ' vendor ' }))
      .rejects.toThrow('requires an exact vendor identity');
  });
});
