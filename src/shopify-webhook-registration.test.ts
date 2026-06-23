import { describe, expect, it } from 'vitest';
import { registerWebhookTopics } from '../backend/scripts/shopify-webhook-registration-lib.mjs';

describe('Shopify webhook registration helpers', () => {
  it('registers order webhooks idempotently without duplicating existing callbacks', async () => {
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
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
      },
    ];
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: [
        { topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' },
        { topic: 'ORDERS_PAID', routePath: '/webhooks/shopify/orders-paid' },
        { topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' },
      ],
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
          topic: 'ORDERS_UPDATED',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
          subscriptionId: 'gid://shopify/WebhookSubscription/3',
        },
      ],
      failed: [],
    });
  });

  it('creates missing order callbacks through the shared registration path', async () => {
    const client = {};
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: [
        { topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' },
        { topic: 'ORDERS_PAID', routePath: '/webhooks/shopify/orders-paid' },
        { topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' },
      ],
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
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
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
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
        subscriptionId: 'gid://shopify/WebhookSubscription/2',
      },
    ]);
    expect(summary.failed).toEqual([]);
  });

  it('creates only missing paid/updated order webhooks when ORDERS_CREATE already exists', async () => {
    const client = {};
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: [
        { topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' },
        { topic: 'ORDERS_PAID', routePath: '/webhooks/shopify/orders-paid' },
        { topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' },
      ],
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
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
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
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
        subscriptionId: 'gid://shopify/WebhookSubscription/3',
      },
    ]);
    expect(summary.failed).toEqual([]);
  });

  it('reports a callback mismatch without creating a duplicate subscription for the same topic', async () => {
    const client = {};
    const createCalls: Array<{ topic: string; callbackUrl: string }> = [];

    const summary = await registerWebhookTopics({
      client,
      topics: [{ topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' }],
      baseUrl: 'https://backend.example',
      listSubscriptions: async () => [
        {
          id: 'gid://shopify/WebhookSubscription/4',
          topic: 'ORDERS_UPDATED',
          callbackUrl: 'https://old-backend.example/webhooks/shopify/orders-updated',
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
        topic: 'ORDERS_UPDATED',
        callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
        reason: 'Existing ORDERS_UPDATED subscription uses a different callback URL: https://old-backend.example/webhooks/shopify/orders-updated',
      },
    ]);
  });
});
