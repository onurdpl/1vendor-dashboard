import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repairMissingShopifyOrder } from './diagnostics';

const apiClientPost = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    post: apiClientPost,
  },
}));

describe('real diagnostics current-state repair service', () => {
  beforeEach(() => {
    apiClientPost.mockReset();
    apiClientPost.mockResolvedValue({ ok: true, dryRun: true, executed: false });
  });

  it('posts the hash-prefixed order number supplied by the Recovery Center', async () => {
    await repairMissingShopifyOrder('  #1105  ');

    expect(apiClientPost).toHaveBeenCalledWith('/admin/diagnostics/shopify/order-repair', {
      orderIdentifier: '#1105',
      execute: false,
    });
  });
});
