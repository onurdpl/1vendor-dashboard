import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

const env: AppEnv = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
  CORS_ORIGIN: ['http://localhost:5173'],
  JWT_SECRET: 'test',
  JWT_EXPIRES_IN: '12h',
  SHOPIFY_WEBHOOK_SECRET: 'test',
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_SHOP_DOMAIN: 'demo.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
  SCHEDULED_RECONCILIATION_ENABLED: false,
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
  SCHEDULED_RECONCILIATION_INTERVAL_MS: 1_800_000,
  SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1_800_000,
  SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
  EMAIL_NOTIFICATIONS_ENABLED: false,
  EMAIL_PROVIDER: 'noop',
  EMAIL_ADMIN_RECIPIENTS: [],
  SHIPPING_EXECUTION_ENABLED: false,
  SHIPPING_SANDBOX_MODE: false,
  SHIPPING_PROVIDER: 'hepsijet',
  KARGO_ENTEGRATOR_ENABLED: false,
  KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
  TRY_OTO_ENABLED: false,
  TRY_OTO_SANDBOX_MODE: false,
  TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
};

const fulfillmentGid = 'gid://shopify/Fulfillment/7210505470289';
const orderGid = 'gid://shopify/Order/8134219268433';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installShopifyFetch(input?: {
  initialStatus?: string;
  mutation?: (state: { setStatus(status: string): void }) => Response | Promise<Response>;
}) {
  let canonicalStatus = input?.initialStatus ?? 'SUCCESS';
  let mutationCalls = 0;

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('/fulfillment_orders.json')) {
      return jsonResponse({ fulfillment_orders: [] });
    }

    const body = JSON.parse(String(init?.body)) as { query: string; variables: { id: string } };
    if (body.query.includes('query FulfillmentCancellationTarget')) {
      return jsonResponse({
        data: {
          fulfillment: {
            id: fulfillmentGid,
            status: canonicalStatus,
            order: { id: orderGid },
          },
        },
      });
    }
    if (body.query.includes('query OrderFulfillmentState')) {
      return jsonResponse({
        data: {
          order: {
            id: orderGid,
            name: '#1125',
            displayFulfillmentStatus: canonicalStatus === 'CANCELLED' ? 'UNFULFILLED' : 'FULFILLED',
            fulfillments: [
              {
                id: fulfillmentGid,
                status: canonicalStatus,
                createdAt: '2026-08-29T10:00:00.000Z',
                updatedAt: '2026-08-29T10:01:00.000Z',
                trackingInfo: [],
                events: { edges: [] },
                fulfillmentLineItems: { edges: [] },
              },
            ],
          },
        },
      });
    }
    if (body.query.includes('mutation FulfillmentCancel')) {
      mutationCalls += 1;
      if (input?.mutation) {
        return input.mutation({ setStatus: (status) => { canonicalStatus = status; } });
      }
      canonicalStatus = 'CANCELLED';
      return jsonResponse({
        data: {
          fulfillmentCancel: {
            fulfillment: { id: fulfillmentGid, status: 'CANCELLED' },
            userErrors: [],
          },
        },
      });
    }
    throw new Error(`Unexpected Shopify request: ${body.query}`);
  });

  return {
    fetchMock,
    getMutationCalls: () => mutationCalls,
  };
}

describe('Shopify fulfillment cancellation service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cancels a Fulfillment once and confirms CANCELLED from canonical order state', async () => {
    const harness = installShopifyFetch();
    const service = createShopifyAdminService(env);

    const result = await service.cancelFulfillment(fulfillmentGid);

    const mutationRequest = harness.fetchMock.mock.calls
      .filter((call) => call[1]?.body !== undefined)
      .map((call) => JSON.parse(String(call[1]?.body)) as { query?: string; variables?: { id?: string } })
      .find((body) => body.query?.includes('mutation FulfillmentCancel'));
    expect(mutationRequest?.variables?.id).toBe(fulfillmentGid);
    expect(mutationRequest?.query).toContain('fulfillmentCancel(id: $id)');
    expect(mutationRequest?.query).toContain('fulfillment {');
    expect(mutationRequest?.query).toContain('userErrors');
    expect(mutationRequest?.query).not.toContain('fulfillmentOrderCancel');
    expect(mutationRequest?.query).not.toContain('refundCreate');
    expect(mutationRequest?.query).not.toContain('orderCancel');
    expect(harness.getMutationCalls()).toBe(1);
    expect(result).toEqual({
      fulfillmentId: fulfillmentGid,
      fulfillmentStatus: 'CANCELLED',
      shopifyOrderId: orderGid,
      outcome: 'cancelled',
      confirmed: true,
      mutationAttempted: true,
      reason: 'canonical_cancelled',
      userErrors: [],
      source: 'shopify_admin',
    });
  });

  it('surfaces fulfillmentCancel userErrors without reporting success', async () => {
    const harness = installShopifyFetch({
      mutation: () => jsonResponse({
        data: {
          fulfillmentCancel: {
            fulfillment: null,
            userErrors: [{ field: ['id'], message: 'Fulfillment cannot be cancelled.' }],
          },
        },
      }),
    });
    const service = createShopifyAdminService(env);

    const result = await service.cancelFulfillment(fulfillmentGid);

    expect(harness.getMutationCalls()).toBe(1);
    expect(result.outcome).toBe('rejected');
    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe('shopify_user_errors');
    expect(result.userErrors).toEqual([{ field: ['id'], message: 'Fulfillment cannot be cancelled.' }]);
  });

  it('does not accept a mismatched mutation payload when canonical state remains active', async () => {
    const harness = installShopifyFetch({
      mutation: () => jsonResponse({
        data: {
          fulfillmentCancel: {
            fulfillment: { id: 'gid://shopify/Fulfillment/999', status: 'CANCELLED' },
            userErrors: [],
          },
        },
      }),
    });
    const service = createShopifyAdminService(env);

    const result = await service.cancelFulfillment(fulfillmentGid);

    expect(harness.getMutationCalls()).toBe(1);
    expect(result.outcome).toBe('ambiguous');
    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe('mutation_result_unconfirmed');
  });

  it('checks canonical state after a GraphQL failure and does not retry the mutation', async () => {
    const harness = installShopifyFetch({
      mutation: () => jsonResponse({ errors: [{ message: 'Temporary GraphQL failure.' }] }),
    });
    const service = createShopifyAdminService(env);

    const result = await service.cancelFulfillment(fulfillmentGid);

    expect(harness.getMutationCalls()).toBe(1);
    expect(result.outcome).toBe('ambiguous');
    expect(result.confirmed).toBe(false);
    expect(result.fulfillmentStatus).toBe('SUCCESS');
    expect(result.reason).toBe('mutation_request_failed');
  });

  it('resolves an ambiguous timeout to success when canonical state is CANCELLED', async () => {
    const harness = installShopifyFetch({
      mutation: ({ setStatus }) => {
        setStatus('CANCELLED');
        throw new TypeError('network timeout');
      },
    });
    const service = createShopifyAdminService(env);

    const result = await service.cancelFulfillment(fulfillmentGid);

    expect(harness.getMutationCalls()).toBe(1);
    expect(result.outcome).toBe('cancelled');
    expect(result.confirmed).toBe(true);
    expect(result.fulfillmentStatus).toBe('CANCELLED');
    expect(result.reason).toBe('canonical_cancelled');
  });

  it('returns an explicit ambiguous result after a timeout when canonical state is still active', async () => {
    const harness = installShopifyFetch({
      mutation: () => {
        throw new TypeError('network timeout');
      },
    });
    const service = createShopifyAdminService(env);

    const result = await service.cancelFulfillment(fulfillmentGid);

    expect(harness.getMutationCalls()).toBe(1);
    expect(result.outcome).toBe('ambiguous');
    expect(result.confirmed).toBe(false);
    expect(result.fulfillmentStatus).toBe('SUCCESS');
    expect(result.reason).toBe('mutation_request_failed');
  });

  it('returns current-state success without mutation when already canonically CANCELLED', async () => {
    const harness = installShopifyFetch({ initialStatus: 'CANCELLED' });
    const service = createShopifyAdminService(env);

    const result = await service.cancelFulfillment(fulfillmentGid);

    expect(harness.getMutationCalls()).toBe(0);
    expect(result.outcome).toBe('already_cancelled');
    expect(result.confirmed).toBe(true);
    expect(result.mutationAttempted).toBe(false);
    expect(result.fulfillmentStatus).toBe('CANCELLED');
  });

  it('rejects non-Fulfillment identifiers before any Shopify request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const service = createShopifyAdminService(env);

    await expect(service.cancelFulfillment('gid://shopify/FulfillmentOrder/123')).rejects.toThrow(
      'Shopify fulfillment cancel requires a Fulfillment GID.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
