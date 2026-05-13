import { describe, expect, it, vi } from 'vitest';
import { registerWebhookTopics } from '../backend/scripts/shopify-webhook-registration-lib.mjs';

describe('registerWebhookTopics', () => {
  it('registers missing topics while keeping already-existing topics', async () => {
    const topics = [
      { topic: 'TOPIC_A', routePath: '/a' },
      { topic: 'TOPIC_B', routePath: '/b' },
    ];
    const listSubscriptions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'sub-a',
          topic: 'TOPIC_A',
          callbackUrl: 'https://example.com/a',
        },
      ]);
    const createSubscription = vi.fn().mockResolvedValue({
      ok: true,
      subscriptionId: 'sub-b',
    });

    const summary = await registerWebhookTopics({
      topics,
      baseUrl: 'https://example.com',
      listSubscriptions,
      createSubscription,
    });

    expect(summary.existing).toEqual([
      {
        topic: 'TOPIC_A',
        callbackUrl: 'https://example.com/a',
        subscriptionId: 'sub-a',
      },
    ]);
    expect(summary.created).toEqual([
      {
        topic: 'TOPIC_B',
        callbackUrl: 'https://example.com/b',
        subscriptionId: 'sub-b',
      },
    ]);
    expect(summary.failed).toEqual([]);
  });

  it('treats duplicate address-taken as existing and continues', async () => {
    const topics = [{ topic: 'TOPIC_A', routePath: '/a' }];
    const listSubscriptions = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'sub-a',
          topic: 'TOPIC_A',
          callbackUrl: 'https://example.com/a',
        },
      ]);
    const createSubscription = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'user_errors',
      userErrors: [{ field: ['topic'], message: 'Address for this topic has already been taken' }],
    });

    const summary = await registerWebhookTopics({
      topics,
      baseUrl: 'https://example.com',
      listSubscriptions,
      createSubscription,
    });

    expect(summary.created).toEqual([]);
    expect(summary.failed).toEqual([]);
    expect(summary.existing).toEqual([
      {
        topic: 'TOPIC_A',
        callbackUrl: 'https://example.com/a',
        subscriptionId: 'sub-a',
      },
    ]);
  });

  it('continues after unexpected topic failures and reports them', async () => {
    const topics = [
      { topic: 'TOPIC_A', routePath: '/a' },
      { topic: 'TOPIC_B', routePath: '/b' },
    ];
    const listSubscriptions = vi.fn().mockResolvedValue([]);
    const createSubscription = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({
        ok: true,
        subscriptionId: 'sub-b',
      });

    const summary = await registerWebhookTopics({
      topics,
      baseUrl: 'https://example.com',
      listSubscriptions,
      createSubscription,
    });

    expect(summary.created).toEqual([
      {
        topic: 'TOPIC_B',
        callbackUrl: 'https://example.com/b',
        subscriptionId: 'sub-b',
      },
    ]);
    expect(summary.failed).toEqual([
      {
        topic: 'TOPIC_A',
        callbackUrl: 'https://example.com/a',
        reason: 'network timeout',
      },
    ]);
  });
});
