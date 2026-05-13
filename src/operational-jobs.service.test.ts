import { describe, expect, it, vi } from 'vitest';
import {
  classifyOperationalFailure,
  getRetryDelayMs,
  inferOperationalJobTypeForWebhookTopic,
  runBestEffortOperationalJobMutation,
} from '../backend/src/modules/operational-jobs/operational-jobs.service.js';

describe('operational jobs service', () => {
  it('maps Shopify topics into lightweight operational job categories', () => {
    expect(inferOperationalJobTypeForWebhookTopic('refunds/create')).toBe('refund_sync');
    expect(inferOperationalJobTypeForWebhookTopic('returns/request')).toBe('return_sync');
    expect(inferOperationalJobTypeForWebhookTopic('fulfillments/update')).toBe('fulfillment_sync');
    expect(inferOperationalJobTypeForWebhookTopic('fulfillment_events/create')).toBe('fulfillment_sync');
    expect(inferOperationalJobTypeForWebhookTopic('orders/create')).toBe('webhook_processing');
  });

  it('keeps operational job persistence best-effort for request paths', async () => {
    const onError = vi.fn();

    const result = await runBestEffortOperationalJobMutation(async () => {
      throw new Error('OperationalJob table is unavailable');
    }, onError);

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('classifies transient and deterministic failures for retry policy', () => {
    expect(classifyOperationalFailure(new Error('Shopify Admin timeout'))).toBe('transient');
    expect(classifyOperationalFailure(new Error('Shopify order id was missing'))).toBe('validation');
    expect(classifyOperationalFailure(new Error('seller_info mapping unresolved'))).toBe('reconciliation_required');
    expect(classifyOperationalFailure(new Error('already processed duplicate'))).toBe('duplicate_noop');
  });

  it('backs off retry delay without exceeding the operational cap', () => {
    expect(getRetryDelayMs({ retryCount: 0, retryBackoffMs: 60_000 })).toBe(60_000);
    expect(getRetryDelayMs({ retryCount: 2, retryBackoffMs: 60_000 })).toBe(240_000);
    expect(getRetryDelayMs({ retryCount: 10, retryBackoffMs: 60_000 })).toBe(1_800_000);
  });
});
