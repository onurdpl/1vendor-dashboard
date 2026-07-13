import { describe, expect, it } from 'vitest';
import { __diagnosticsRecoveryPolicyTesting } from '../backend/src/modules/diagnostics/diagnostics.service.js';

const baseEvent = {
  topic: 'refunds/create',
  status: 'FAILED',
  rawPayload: '{"id":501}',
  payloadHash: 'sha256:refund-501',
};

describe('diagnostics recovery policy', () => {
  it('blocks stored replay for a successfully processed orders/create event', () => {
    const reason = __diagnosticsRecoveryPolicyTesting.getReplayBlockedReason({
      ...baseEvent,
      topic: 'orders/create',
      status: 'PROCESSED',
    });

    expect(reason).toMatch(/not safe for topic orders\/create/i);
  });

  it('blocks stored replay for stateful order and fulfillment topics', () => {
    for (const topic of ['orders/cancelled', 'fulfillments/update', 'fulfillment_orders/cancelled']) {
      expect(__diagnosticsRecoveryPolicyTesting.getReplayBlockedReason({ ...baseEvent, topic }))
        .toMatch(/not safe for topic/i);
    }
  });

  it('allows stored replay only for failed payload-backed refunds/create events', () => {
    expect(__diagnosticsRecoveryPolicyTesting.getReplayBlockedReason(baseEvent)).toBeNull();
    expect(__diagnosticsRecoveryPolicyTesting.getReplayBlockedReason({ ...baseEvent, status: 'PROCESSED' }))
      .toMatch(/successfully processed/i);
    expect(__diagnosticsRecoveryPolicyTesting.getReplayBlockedReason({ ...baseEvent, rawPayload: null }))
      .toMatch(/payload is not available/i);
  });

  it('allows recovery for failed and stuck received events but not processed events', () => {
    expect(__diagnosticsRecoveryPolicyTesting.getRecoverBlockedReason(baseEvent)).toBeNull();
    expect(__diagnosticsRecoveryPolicyTesting.getRecoverBlockedReason({ ...baseEvent, status: 'RECEIVED' })).toBeNull();
    expect(__diagnosticsRecoveryPolicyTesting.getRecoverBlockedReason({ ...baseEvent, status: 'PROCESSED' }))
      .toMatch(/not recoverable/i);
  });
});
