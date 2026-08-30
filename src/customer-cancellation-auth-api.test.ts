import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createCustomerAccountSessionTokenVerifier,
  CustomerAccountSessionTokenError,
} from '../backend/src/modules/orders/customer-cancellation-session-token.service.js';
import {
  createCustomerCancellationApiService,
  CustomerCancellationApiError,
} from '../backend/src/modules/orders/customer-cancellation-api.service.js';
import type { AppEnv } from '../backend/src/config/env.js';

const clientId = 'customer-account-client-id';
const clientSecret = 'customer-account-client-secret';
const shopDomain = 'xgi47p-3k.myshopify.com';
const customerGid = 'gid://shopify/Customer/101';
const PENDING = 'PENDING' as const;

function baseEnv(): AppEnv {
  return {
    NODE_ENV: 'test',
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: clientId,
    SHOPIFY_WEBHOOK_SECRET: clientSecret,
    SHOPIFY_SHOP_DOMAIN: shopDomain,
  } as AppEnv;
}

function signToken(
  overrides: Record<string, unknown> = {},
  secret = clientSecret,
) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    dest: `https://${shopDomain}`,
    aud: clientId,
    sub: customerGid,
    exp: now + 300,
    nbf: now,
    iat: now,
    jti: randomUUID(),
    ...overrides,
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function session(customer = customerGid) {
  return {
    shopDomain,
    customerGid: customer,
    audience: clientId,
    tokenId: randomUUID(),
    issuedAt: 1,
    expiresAt: 2,
  };
}

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    orderGid: 'gid://shopify/Order/500',
    sourceShopifyOrderId: '500',
    sourceShopifyOrderNumber: '#500',
    customerGid,
    cancelledAt: null,
    lineItems: [{
      lineItemGid: 'gid://shopify/LineItem/700',
      sourceLineItemId: '700',
      title: 'Test product',
      variantTitle: 'Default Title',
      imageUrl: null,
      quantity: 2,
      currentQuantity: 2,
      refundableQuantity: 2,
    }],
    fulfillmentOrders: [{
      id: 'gid://shopify/FulfillmentOrder/800',
      status: 'OPEN',
      requestStatus: 'UNSUBMITTED',
      lineItems: [{
        id: 'gid://shopify/FulfillmentOrderLineItem/900',
        lineItemId: 'gid://shopify/LineItem/700',
        remainingQuantity: 2,
        totalQuantity: 2,
      }],
    }],
    ...overrides,
  } as never;
}

function localOrder(input: { shipped?: boolean; pending?: boolean; secondAllocation?: boolean } = {}) {
  const makeAllocationLine = (id: string, quantity: number) => ({
    quantity,
    vendorAllocation: {
      id,
      allocationStatus: 'ACTIVE',
      cancellationReason: null,
      trackingNumber: input.shipped ? 'TRACK-1' : null,
      carrier: null,
      vendorIntegrationTrackingUrl: null,
      vendorIntegrationShippedAt: null,
      returnRecords: [],
      refundRecords: [],
      vendorIntegrationShipmentEvents: [],
      fulfillment: null,
      shipmentExecutions: [],
    },
  });
  return {
    id: 'local-order-500',
    sourceShopifyOrderId: '500',
    sourceShopifyOrderNumber: '#500',
    customerCancellationRequests: input.pending ? [{
      id: 'pending-request',
      status: PENDING,
      requestedAt: new Date('2026-01-01T00:00:00Z'),
      shopifyCustomerId: customerGid,
      idempotencyKey: 'existing-idem',
      reasonCode: 'CUSTOMER_REQUEST',
      customerNote: null,
      items: [{
        shopifyOrderLineItemId: 'local-line-700',
        vendorAllocationId: 'allocation-a',
        requestedQuantity: 1,
        status: PENDING,
      }],
    }] : [],
    lineItems: [{
      id: 'local-line-700',
      sourceLineItemId: '700',
      title: 'Test product',
      imageUrl: null,
      quantity: 2,
      allocationLineItems: input.secondAllocation
        ? [makeAllocationLine('allocation-a', 1), makeAllocationLine('allocation-b', 1)]
        : [makeAllocationLine('allocation-a', 2)],
    }],
  };
}

function buildApi(input: { canonical?: ReturnType<typeof canonical>; local?: ReturnType<typeof localOrder>; createRequest?: ReturnType<typeof vi.fn> } = {}) {
  const canonicalOrder = input.canonical ?? canonical();
  const local = input.local ?? localOrder();
  const createRequest = input.createRequest ?? vi.fn(async (request) => ({
    idempotent: false,
    request: {
      id: 'request-1',
      shopifyOrderId: 'local-order-500',
      shopDomain,
      shopifyCustomerId: customerGid,
      status: PENDING,
      reasonCode: request.reasonCode,
      customerNote: request.customerNote ?? null,
      idempotencyKey: request.idempotencyKey,
      requestedAt: new Date('2026-01-01T00:00:00Z'),
      resolvedAt: null,
      reviewedByUserId: null,
      reviewReason: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      items: request.items.map((item, index) => ({
        id: `request-item-${index}`,
        requestId: 'request-1',
        ...item,
        resolvedQuantity: null,
        status: PENDING,
        reviewedByUserId: null,
        reviewReason: null,
        reviewedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    },
  }));
  const api = createCustomerCancellationApiService(baseEnv(), {
    db: { shopifyOrder: { findUnique: vi.fn(async () => local) } } as never,
    shopify: {
      fetchCustomerCancellationOrderSnapshot: vi.fn(async () => canonicalOrder),
      fetchCanonicalRefundsForOrder: vi.fn(async () => ({ orderGid: canonicalOrder.orderGid, sourceShopifyOrderId: '500', refunds: [], refundsListComplete: true, orderTotalRefundedAmount: '0', orderTotalRefundedCurrencyCode: 'TRY', source: 'mock' })),
      fetchCanonicalReturnsForOrder: vi.fn(async () => ({ orderGid: canonicalOrder.orderGid, sourceShopifyOrderId: '500', returns: [], source: 'mock' })),
    } as never,
    createRequest: createRequest as never,
  });
  return { api, createRequest };
}

describe('Shopify Customer Account session-token verification', () => {
  it('accepts a valid signed-in customer token', () => {
    expect(createCustomerAccountSessionTokenVerifier(baseEnv()).verifySessionToken(signToken())).toMatchObject({
      customerGid,
      shopDomain,
      audience: clientId,
    });
  });

  it.each([
    ['invalid signature', () => signToken({}, 'wrong-secret')],
    ['expired token', () => signToken({ exp: Math.floor(Date.now() / 1000) - 10 })],
    ['wrong audience', () => signToken({ aud: 'wrong-client' })],
    ['wrong destination', () => signToken({ dest: 'https://other.myshopify.com' })],
    ['missing customer subject', () => signToken({ sub: undefined })],
  ])('rejects %s', (_label, tokenFactory) => {
    expect(() => createCustomerAccountSessionTokenVerifier(baseEnv()).verifySessionToken(tokenFactory())).toThrow(
      CustomerAccountSessionTokenError,
    );
  });
});

describe('customer cancellation API domain boundary', () => {
  it('rejects unauthenticated eligibility and creation requests before domain processing', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SHIPPING_PROVIDER', 'kargonomi');
    vi.stubEnv('KARGONOMI_BASE_URL', 'https://kargonomi.test.example.com');
    vi.stubEnv('KARGONOMI_API_TOKEN', 'test-token');
    const { createApp } = await import('../backend/src/app.js');
    const app = createApp();
    try {
      const read = await app.inject({
        method: 'GET',
        url: '/api/customer-cancellations/eligibility?shopifyOrderId=500',
        headers: { origin: 'null' },
      });
      const create = await app.inject({
        method: 'POST',
        url: '/api/customer-cancellations/requests',
        payload: { shopifyOrderId: '500', items: [], reasonCode: 'x', idempotencyKey: 'x' },
      });
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/customer-cancellations/requests',
        headers: {
          origin: 'null',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(read.statusCode).toBe(401);
      expect(read.json()).toMatchObject({ code: 'CUSTOMER_SESSION_INVALID' });
      expect(read.headers['access-control-allow-origin']).toBe('*');
      expect(read.headers['access-control-allow-credentials']).toBeUndefined();
      expect(create.statusCode).toBe(401);
      expect(create.json()).toMatchObject({ code: 'CUSTOMER_SESSION_INVALID' });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('*');
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  });

  it('rejects access when the canonical order belongs to another customer', async () => {
    const { api } = buildApi();
    await expect(api.getEligibility(session('gid://shopify/Customer/other'), '500')).rejects.toMatchObject({
      code: 'ORDER_NOT_OWNED_BY_CUSTOMER',
      statusCode: 403,
    });
  });

  it('returns only canonical requestable quantity for an eligible unfulfilled line', async () => {
    const { api } = buildApi();
    await expect(api.getEligibility(session(), '500')).resolves.toMatchObject({
      canRequestCancellation: true,
      lineItems: [{ shopifyLineItemId: 'gid://shopify/LineItem/700', requestableQuantity: 2, eligible: true }],
    });
  });

  it('blocks tracked shipment authority and ambiguous multi-allocation mappings', async () => {
    const shipped = buildApi({ local: localOrder({ shipped: true }) });
    await expect(shipped.api.getEligibility(session(), '500')).resolves.toMatchObject({
      canRequestCancellation: false,
      lineItems: [{ unavailableReason: 'ALREADY_SHIPPED' }],
    });
    const split = buildApi({ local: localOrder({ secondAllocation: true }) });
    await expect(split.api.getEligibility(session(), '500')).resolves.toMatchObject({
      canRequestCancellation: false,
      lineItems: [{ unavailableReason: 'NOT_FULFILLABLE' }],
    });
  });

  it('derives allocation identity server-side and invokes only the Phase 1 request writer', async () => {
    const { api, createRequest } = buildApi();
    const result = await api.createCancellationRequest(session(), {
      shopifyOrderId: 'gid://shopify/Order/500',
      items: [{ shopifyLineItemId: 'gid://shopify/LineItem/700', requestedQuantity: 1 }],
      reasonCode: 'CUSTOMER_REQUEST',
      note: 'Please cancel one.',
      idempotencyKey: 'idem-1',
    });
    expect(result).toMatchObject({ requestId: 'request-1', status: PENDING });
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      shopifyOrderId: 'local-order-500',
      shopifyCustomerId: customerGid,
      items: [{ shopifyOrderLineItemId: 'local-line-700', vendorAllocationId: 'allocation-a', requestedQuantity: 1 }],
    }));
    expect(createRequest).toHaveBeenCalledTimes(1);
  });

  it('maps a selected line to only its own allocation in a multi-vendor order', async () => {
    const baseCanonical = canonical();
    const baseLocal = localOrder();
    const firstCanonicalLine = baseCanonical.lineItems[0]!;
    const firstLocalLine = baseLocal.lineItems[0]!;
    const firstAllocationLine = firstLocalLine.allocationLineItems[0]!;
    const multiCanonical = canonical({
      lineItems: [
        firstCanonicalLine,
        { ...firstCanonicalLine, lineItemGid: 'gid://shopify/LineItem/701', sourceLineItemId: '701', title: 'Vendor B product', quantity: 1, currentQuantity: 1, refundableQuantity: 1 },
      ],
      fulfillmentOrders: [{
        ...baseCanonical.fulfillmentOrders[0]!,
        lineItems: [
          ...baseCanonical.fulfillmentOrders[0]!.lineItems,
          { id: 'gid://shopify/FulfillmentOrderLineItem/901', lineItemId: 'gid://shopify/LineItem/701', remainingQuantity: 1, totalQuantity: 1 },
        ],
      }],
    });
    const multiLocal = {
      ...baseLocal,
      lineItems: [
        firstLocalLine,
        {
          ...firstLocalLine,
          id: 'local-line-701',
          sourceLineItemId: '701',
          title: 'Vendor B product',
          quantity: 1,
          allocationLineItems: [{
            ...firstAllocationLine,
            quantity: 1,
            vendorAllocation: { ...firstAllocationLine.vendorAllocation, id: 'allocation-b' },
          }],
        },
      ],
    };
    const { api, createRequest } = buildApi({ canonical: multiCanonical, local: multiLocal });

    await api.createCancellationRequest(session(), {
      shopifyOrderId: '500',
      items: [{ shopifyLineItemId: 'gid://shopify/LineItem/701', requestedQuantity: 1 }],
      reasonCode: 'CUSTOMER_REQUEST',
      idempotencyKey: 'multi-vendor-idem',
    });

    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ shopifyOrderLineItemId: 'local-line-701', vendorAllocationId: 'allocation-b', requestedQuantity: 1 }],
    }));
    expect(createRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([expect.objectContaining({ vendorAllocationId: 'allocation-a' })]),
    }));
  });

  it('returns stable pending and too-late errors without invoking the writer', async () => {
    const pending = buildApi({ local: localOrder({ pending: true }) });
    await expect(pending.api.createCancellationRequest(session(), {
      shopifyOrderId: '500', items: [{ shopifyLineItemId: '700', requestedQuantity: 1 }], reasonCode: 'CUSTOMER_REQUEST', idempotencyKey: 'idem-2',
    })).rejects.toMatchObject({ code: 'CANCELLATION_ALREADY_PENDING' });
    expect(pending.createRequest).not.toHaveBeenCalled();

    const shipped = buildApi({ local: localOrder({ shipped: true }) });
    await expect(shipped.api.createCancellationRequest(session(), {
      shopifyOrderId: '500', items: [{ shopifyLineItemId: '700', requestedQuantity: 1 }], reasonCode: 'CUSTOMER_REQUEST', idempotencyKey: 'idem-3',
    })).rejects.toMatchObject({ code: 'CANCELLATION_TOO_LATE' });
    expect(shipped.createRequest).not.toHaveBeenCalled();
  });

  it('does not create a request for an already-cancelled canonical order', async () => {
    const cancelled = buildApi({ canonical: canonical({ cancelledAt: '2026-08-30T00:00:00Z' }) });
    await expect(cancelled.api.createCancellationRequest(session(), {
      shopifyOrderId: '500',
      items: [{ shopifyLineItemId: '700', requestedQuantity: 1 }],
      reasonCode: 'CUSTOMER_REQUEST',
      idempotencyKey: 'cancelled-idem',
    })).rejects.toMatchObject({ code: 'CANCELLATION_CONFLICT', statusCode: 409 });
    expect(cancelled.createRequest).not.toHaveBeenCalled();
  });

  it('returns an identical existing database-idempotent request without invoking the writer', async () => {
    const { api, createRequest } = buildApi({ local: localOrder({ pending: true }) });
    await expect(api.createCancellationRequest(session(), {
      shopifyOrderId: '500',
      items: [{ shopifyLineItemId: '700', requestedQuantity: 1 }],
      reasonCode: 'CUSTOMER_REQUEST',
      idempotencyKey: 'existing-idem',
    })).resolves.toMatchObject({ requestId: 'pending-request', idempotent: true, status: PENDING });
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('returns a resolved idempotent request even when the order is now cancelled', async () => {
    const pendingLocal = localOrder({ pending: true });
    const existing = pendingLocal.customerCancellationRequests[0]!;
    const resolvedLocal = {
      ...pendingLocal,
      customerCancellationRequests: [{
        ...existing,
        status: 'DECLINED' as const,
        items: existing.items.map((item) => ({ ...item, status: 'DECLINED' as const })),
      }],
    };
    const { api, createRequest } = buildApi({
      canonical: canonical({ cancelledAt: '2026-08-30T00:00:00Z' }),
      local: resolvedLocal as never,
    });

    await expect(api.createCancellationRequest(session(), {
      shopifyOrderId: '500',
      items: [{ shopifyLineItemId: '700', requestedQuantity: 1 }],
      reasonCode: 'CUSTOMER_REQUEST',
      idempotencyKey: 'existing-idem',
    })).resolves.toMatchObject({ requestId: 'pending-request', idempotent: true, status: 'DECLINED' });
    expect(createRequest).not.toHaveBeenCalled();
  });
});
