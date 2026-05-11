import type { FastifyRequest } from 'fastify';

export type ShopifyWebhookHeaders = {
  hmac: string | null;
  topic: string;
  shopDomain: string;
  webhookId: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export function getShopifyWebhookHeaders(request: FastifyRequest): ShopifyWebhookHeaders {
  const hmac = request.headers['x-shopify-hmac-sha256'];
  const topic = request.headers['x-shopify-topic'];
  const shopDomain = request.headers['x-shopify-shop-domain'];
  const webhookId = request.headers['x-shopify-webhook-id'];

  return {
    hmac: typeof hmac === 'string' ? hmac : null,
    topic: typeof topic === 'string' && topic ? topic : 'orders/create',
    shopDomain: typeof shopDomain === 'string' && shopDomain ? shopDomain : 'unknown.myshopify.com',
    webhookId: typeof webhookId === 'string' && webhookId ? webhookId : 'unknown-webhook-id',
  };
}
