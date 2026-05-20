import { describe, expect, it } from 'vitest';
import { registerWebhookTopics } from '../backend/scripts/shopify-webhook-registration-lib.mjs';

describe('Shopify webhook registration helpers', () => {
  it('registers ORDERS_CREATE idempotently without duplicating an existing callback', async () => {
    const client = {};
    const listSubscriptions = async () => [
      {
        id: 'gid://shopify/WebhookSubscription/1',
        topic: 'ORDERS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
      },
    ];
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: [{ topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' }],
      baseUrl: 'https://backend.example',
      listSubscriptions,
      createSubscription: async (_client, topic, callbackUrl) => {
        createCalls.push({ topic, callbackUrl });
        return { ok: true, subscriptionId: 'created' };
      },
    });

    expect(createCalls).toEqual([]);
    expect(summary).toEqual({
      created: [],
      existing: [
        {
          topic: 'ORDERS_CREATE',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
          subscriptionId: 'gid://shopify/WebhookSubscription/1',
        },
      ],
      failed: [],
    });
  });

  it('creates missing ORDERS_CREATE callback through the shared registration path', async () => {
    const client = {};
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: [{ topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' }],
      baseUrl: 'https://backend.example',
      listSubscriptions: async () => [],
      createSubscription: async (_client, topic, callbackUrl) => {
        createCalls.push({ topic, callbackUrl });
        return { ok: true, subscriptionId: 'gid://shopify/WebhookSubscription/2' };
      },
    });

    expect(createCalls).toEqual([
      {
        topic: 'ORDERS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
      },
    ]);
    expect(summary.created).toEqual([
      {
        topic: 'ORDERS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
        subscriptionId: 'gid://shopify/WebhookSubscription/2',
      },
    ]);
    expect(summary.failed).toEqual([]);
  });
});
