import type { AppEnv } from '../../config/env.js';

// @ts-ignore The operational registration helper is an ESM script outside backend/src.
import { createShopifyGraphqlClient, isValidShopDomain, registerWebhookTopics } from '../../../scripts/shopify-webhook-registration-lib.mjs';

const DEFAULT_ORDER_WEBHOOK_BASE_URL = 'https://vendor-dashboard-backend-398h.onrender.com';

const ORDER_WEBHOOK_TOPICS = [
  { topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' },
  { topic: 'ORDERS_PAID', routePath: '/webhooks/shopify/orders-paid' },
  { topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' },
] as const;

type RegistrationSummary = {
  created: Array<{ topic: string; callbackUrl: string; subscriptionId?: string }>;
  existing: Array<{ topic: string; callbackUrl: string; subscriptionId?: string }>;
  failed: Array<{ topic: string; callbackUrl: string; reason?: string }>;
};

function normalizeBaseUrl(value: string | null | undefined) {
  return value?.trim().replace(/\/+$/, '') || null;
}

function resolveOrderWebhookBaseUrl(env: AppEnv) {
  return normalizeBaseUrl(env.SHOPIFY_ORDER_WEBHOOK_BASE_URL) ?? DEFAULT_ORDER_WEBHOOK_BASE_URL;
}

function isValidHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isCallbackMismatch(reason: string | undefined) {
  return Boolean(reason?.startsWith('Existing ') && reason.includes('uses a different callback URL'));
}

function sanitizeRegistrationSummary(summary: RegistrationSummary) {
  return [
    ...summary.existing.map((entry) => ({
      topic: entry.topic,
      callbackUrl: entry.callbackUrl,
      action: 'exists' as const,
      subscriptionId: entry.subscriptionId ?? null,
    })),
    ...summary.created.map((entry) => ({
      topic: entry.topic,
      callbackUrl: entry.callbackUrl,
      action: 'created' as const,
      subscriptionId: entry.subscriptionId ?? null,
    })),
    ...summary.failed.map((entry) => ({
      topic: entry.topic,
      callbackUrl: entry.callbackUrl,
      action: isCallbackMismatch(entry.reason) ? 'mismatch' as const : 'failed' as const,
      subscriptionId: null,
      reason: entry.reason ?? 'Unknown Shopify registration error.',
    })),
  ].sort((left, right) => left.topic.localeCompare(right.topic) || left.action.localeCompare(right.action));
}

export async function registerShopifyOrderWebhooksFromAdmin(env: AppEnv) {
  const baseUrl = resolveOrderWebhookBaseUrl(env);
  const missing = [
    !env.SHOPIFY_SHOP_DOMAIN ? 'SHOPIFY_SHOP_DOMAIN' : null,
    !env.SHOPIFY_ADMIN_ACCESS_TOKEN ? 'SHOPIFY_ADMIN_ACCESS_TOKEN' : null,
    !env.SHOPIFY_API_VERSION ? 'SHOPIFY_API_VERSION' : null,
    !baseUrl ? 'SHOPIFY_ORDER_WEBHOOK_BASE_URL' : null,
  ].filter((entry): entry is string => Boolean(entry));

  if (missing.length > 0) {
    return {
      ok: false,
      baseUrl,
      results: [],
      error: `Missing required variables: ${missing.join(', ')}`,
    };
  }

  if (!isValidShopDomain(env.SHOPIFY_SHOP_DOMAIN as string)) {
    return {
      ok: false,
      baseUrl,
      results: [],
      error: 'Invalid SHOPIFY_SHOP_DOMAIN format.',
    };
  }

  if (!/^\d{4}-\d{2}$/.test(env.SHOPIFY_API_VERSION)) {
    return {
      ok: false,
      baseUrl,
      results: [],
      error: 'Invalid SHOPIFY_API_VERSION format. Expected YYYY-MM.',
    };
  }

  if (!isValidHttpsUrl(baseUrl)) {
    return {
      ok: false,
      baseUrl,
      results: [],
      error: 'Invalid SHOPIFY_ORDER_WEBHOOK_BASE_URL. Expected HTTPS URL.',
    };
  }

  const client = createShopifyGraphqlClient({
    shopDomain: env.SHOPIFY_SHOP_DOMAIN,
    accessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion: env.SHOPIFY_API_VERSION,
  });
  const summary = await registerWebhookTopics({
    client,
    topics: ORDER_WEBHOOK_TOPICS,
    baseUrl,
  }) as RegistrationSummary;
  const results = sanitizeRegistrationSummary(summary);

  return {
    ok: summary.failed.length === 0,
    baseUrl,
    results,
  };
}
