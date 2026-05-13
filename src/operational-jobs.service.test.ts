import { describe, expect, it, vi } from 'vitest';
import {
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
});
