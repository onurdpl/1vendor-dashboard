import { describe, expect, it } from 'vitest';
import { registerWebhookTopics } from '../backend/scripts/shopify-webhook-registration-lib.mjs';

const orderRefundTopics = [
  { topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' },
  { topic: 'ORDERS_PAID', routePath: '/webhooks/shopify/orders-paid' },
  { topic: 'ORDERS_CANCELLED', routePath: '/webhooks/shopify/orders-cancelled' },
  { topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' },
  { topic: 'REFUNDS_CREATE', routePath: '/webhooks/shopify/refunds-create' },
] as const;

describe('Shopify webhook registration helpers', () => {
  it('registers the exact five-topic order/refund family idempotently without duplicating existing callbacks', async () => {
    expect(orderRefundTopics).toHaveLength(5);
    expect(orderRefundTopics).toEqual([
      { topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' },
      { topic: 'ORDERS_PAID', routePath: '/webhooks/shopify/orders-paid' },
      { topic: 'ORDERS_CANCELLED', routePath: '/webhooks/shopify/orders-cancelled' },
      { topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' },
      { topic: 'REFUNDS_CREATE', routePath: '/webhooks/shopify/refunds-create' },
    ]);
    const client = {};
    const listSubscriptions = async () => [
      {
        id: 'gid://shopify/WebhookSubscription/1',
        topic: 'ORDERS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
      },
      {
        id: 'gid://shopify/WebhookSubscription/2',
        topic: 'ORDERS_PAID',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-paid',
      },
      {
        id: 'gid://shopify/WebhookSubscription/3',
        topic: 'ORDERS_CANCELLED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-cancelled',
      },
      {
        id: 'gid://shopify/WebhookSubscription/4',
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
      },
      {
        id: 'gid://shopify/WebhookSubscription/5',
        topic: 'REFUNDS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/refunds-create',
      },
    ];
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: orderRefundTopics,
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
        {
          topic: 'ORDERS_PAID',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-paid',
          subscriptionId: 'gid://shopify/WebhookSubscription/2',
        },
        {
          topic: 'ORDERS_CANCELLED',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-cancelled',
          subscriptionId: 'gid://shopify/WebhookSubscription/3',
        },
        {
          topic: 'ORDERS_UPDATED',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
          subscriptionId: 'gid://shopify/WebhookSubscription/4',
        },
        {
          topic: 'REFUNDS_CREATE',
          callbackUrl: 'https://backend.example/webhooks/shopify/refunds-create',
          subscriptionId: 'gid://shopify/WebhookSubscription/5',
        },
      ],
      failed: [],
    });
  });

  it('creates missing order/refund callbacks through the shared registration path', async () => {
    const client = {};
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: orderRefundTopics,
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
      {
        topic: 'ORDERS_PAID',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-paid',
      },
      {
        topic: 'ORDERS_CANCELLED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-cancelled',
      },
      {
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
      },
      {
        topic: 'REFUNDS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/refunds-create',
      },
    ]);
    expect(summary.created).toEqual([
      {
        topic: 'ORDERS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
        subscriptionId: 'gid://shopify/WebhookSubscription/2',
      },
      {
        topic: 'ORDERS_PAID',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-paid',
        subscriptionId: 'gid://shopify/WebhookSubscription/2',
      },
      {
        topic: 'ORDERS_CANCELLED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-cancelled',
        subscriptionId: 'gid://shopify/WebhookSubscription/2',
      },
      {
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
        subscriptionId: 'gid://shopify/WebhookSubscription/2',
      },
      {
        topic: 'REFUNDS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/refunds-create',
        subscriptionId: 'gid://shopify/WebhookSubscription/2',
      },
    ]);
    expect(summary.failed).toEqual([]);
  });

  it('creates only missing paid/cancelled/updated/refund webhooks when ORDERS_CREATE already exists', async () => {
    const client = {};
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: orderRefundTopics,
      baseUrl: 'https://backend.example',
      listSubscriptions: async () => [
        {
          id: 'gid://shopify/WebhookSubscription/1',
          topic: 'ORDERS_CREATE',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
        },
      ],
      createSubscription: async (_client, topic, callbackUrl) => {
        createCalls.push({ topic, callbackUrl });
        return { ok: true, subscriptionId: 'gid://shopify/WebhookSubscription/3' };
      },
    });

    expect(createCalls).toEqual([
      {
        topic: 'ORDERS_PAID',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-paid',
      },
      {
        topic: 'ORDERS_CANCELLED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-cancelled',
      },
      {
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
      },
      {
        topic: 'REFUNDS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/refunds-create',
      },
    ]);
    expect(summary.existing).toEqual([
      {
        topic: 'ORDERS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
        subscriptionId: 'gid://shopify/WebhookSubscription/1',
      },
    ]);
    expect(summary.created).toEqual([
      {
        topic: 'ORDERS_PAID',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-paid',
        subscriptionId: 'gid://shopify/WebhookSubscription/3',
      },
      {
        topic: 'ORDERS_CANCELLED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-cancelled',
        subscriptionId: 'gid://shopify/WebhookSubscription/3',
      },
      {
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
        subscriptionId: 'gid://shopify/WebhookSubscription/3',
      },
      {
        topic: 'REFUNDS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/refunds-create',
        subscriptionId: 'gid://shopify/WebhookSubscription/3',
      },
    ]);
    expect(summary.failed).toEqual([]);
  });

  it('reports a REFUNDS_CREATE callback mismatch without creating a duplicate or replacement', async () => {
    const client = {};
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: [{ topic: 'REFUNDS_CREATE', routePath: '/webhooks/shopify/refunds-create' }],
      baseUrl: 'https://backend.example',
      listSubscriptions: async () => [
        {
          id: 'gid://shopify/WebhookSubscription/4',
          topic: 'REFUNDS_CREATE',
          callbackUrl: 'https://old-backend.example/webhooks/shopify/refunds-create',
        },
      ],
      createSubscription: async (_client, topic, callbackUrl) => {
        createCalls.push({ topic, callbackUrl });
        return { ok: true, subscriptionId: 'gid://shopify/WebhookSubscription/5' };
      },
    });

    expect(createCalls).toEqual([]);
    expect(summary.created).toEqual([]);
    expect(summary.existing).toEqual([]);
    expect(summary.failed).toEqual([
      {
        topic: 'REFUNDS_CREATE',
        callbackUrl: 'https://backend.example/webhooks/shopify/refunds-create',
        reason: 'Existing REFUNDS_CREATE subscription uses a different callback URL: https://old-backend.example/webhooks/shopify/refunds-create',
      },
    ]);
  });
});
