import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const port = 4010;
const baseUrl = `http://127.0.0.1:${port}`;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf('=');
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      acc[key] = value;
      return acc;
    }, {});
}

function resolveEffectiveWebhookSecret() {
  const backendEnvPath = path.join(process.cwd(), '.env');
  const backendEnv = loadEnvFile(backendEnvPath);
  return process.env.SHOPIFY_WEBHOOK_SECRET || backendEnv.SHOPIFY_WEBHOOK_SECRET || 'dev-shopify-webhook-secret';
}

const shopifyWebhookSecret = resolveEffectiveWebhookSecret();
const shopifyReturnWebhookSecret =
  process.env.SHOPIFY_RETURN_WEBHOOK_SECRET ||
  loadEnvFile(path.join(process.cwd(), '.env')).SHOPIFY_RETURN_WEBHOOK_SECRET ||
  shopifyWebhookSecret;
const shopifyFulfillmentWebhookSecret =
  process.env.SHOPIFY_FULFILLMENT_WEBHOOK_SECRET ||
  loadEnvFile(path.join(process.cwd(), '.env')).SHOPIFY_FULFILLMENT_WEBHOOK_SECRET ||
  'smoke-fulfillment-webhook-secret';
const backendEnv = {
  ...loadEnvFile(path.join(process.cwd(), '.env')),
  ...process.env,
};
const prisma = backendEnv.DATABASE_URL
  ? new PrismaClient({
      datasources: {
        db: {
          url: backendEnv.DATABASE_URL,
        },
      },
    })
  : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting for server startup.
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for backend readiness at ${url}.`);
}

async function runSmoke() {
  const runId = Date.now().toString();
  const smokeOrderId = String(9000000000 + Number(runId.slice(-6)));
  const cancellationOrderId = String(9100000000 + Number(runId.slice(-6)));
  const sellerInfoMap = JSON.stringify({
    [smokeOrderId]: {
      'DH2987-100-41': 'yalispor',
      'YALI-NOT-RETURNED-42': 'yalispor',
      'DH2987-100-40,5': 'sporjinal',
    },
    [cancellationOrderId]: {
      'CANCEL-YALI-41': 'yalispor',
      'CANCEL-SPOR-40': 'sporjinal',
    },
    '9002': {
      'DH2987-100-41': 'yalispor',
    },
  });
  const mockReturnDetails = JSON.stringify({
    'gid://shopify/Return/777001': {
      orderGid: `gid://shopify/Order/${smokeOrderId}`,
      lineItems: [
        {
          returnLineItemGid: `gid://shopify/ReturnLineItem/rli-a-${runId}`,
          fulfillmentLineItemGid: `gid://shopify/FulfillmentLineItem/fli-a-${runId}`,
          lineItemGid: `gid://shopify/LineItem/li-a-${runId}`,
          sku: 'DH2987-100-41',
        },
        {
          returnLineItemGid: `gid://shopify/ReturnLineItem/rli-b-${runId}`,
          fulfillmentLineItemGid: `gid://shopify/FulfillmentLineItem/fli-b-${runId}`,
          lineItemGid: `gid://shopify/LineItem/li-b-${runId}`,
          sku: 'DH2987-100-40,5',
        },
      ],
    },
  });
  const mockFulfillmentOrders = JSON.stringify({
    [smokeOrderId]: [
      {
        id: 'fo-9001-yalispor',
        status: 'open',
        lineItems: [
          {
            id: 'foli-9001-yalispor',
            lineItemId: `li-a-${runId}`,
            quantity: 1,
          },
        ],
      },
      {
        id: 'fo-9001-sporjinal',
        status: 'open',
        lineItems: [
          {
            id: 'foli-9001-sporjinal',
            lineItemId: `li-b-${runId}`,
            quantity: 1,
          },
        ],
      },
    ],
    [cancellationOrderId]: [
      {
        id: 'fo-cancel-yalispor',
        status: 'cancelled',
        lineItems: [
          {
            id: 'foli-cancel-yalispor',
            lineItemId: `cancel-li-yali-${runId}`,
            quantity: 1,
          },
        ],
      },
      {
        id: 'fo-cancel-sporjinal',
        status: 'open',
        lineItems: [
          {
            id: 'foli-cancel-sporjinal',
            lineItemId: `cancel-li-spor-${runId}`,
            quantity: 1,
          },
        ],
      },
    ],
  });
  const mockOrderFulfillmentState = JSON.stringify({
    [smokeOrderId]: {
      orderName: `#${smokeOrderId}`,
      displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
      fulfillments: [
        {
          id: `gid://shopify/Fulfillment/fulfillment-yali-${runId}`,
          sourceFulfillmentId: `fulfillment-yali-${runId}`,
          status: 'SUCCESS',
          createdAt: '2026-05-11T12:45:00.000Z',
          updatedAt: '2026-05-11T12:46:00.000Z',
          events: [],
          trackingInfo: [],
          lineItems: [
            {
              lineItemGid: `gid://shopify/LineItem/li-a-${runId}`,
              sourceLineItemId: `li-a-${runId}`,
              sku: 'DH2987-100-41',
              quantity: 1,
            },
          ],
        },
        {
          id: `gid://shopify/Fulfillment/fulfillment-spor-${runId}`,
          sourceFulfillmentId: `fulfillment-spor-${runId}`,
          status: 'SUCCESS',
          createdAt: '2026-05-11T12:50:00.000Z',
          updatedAt: '2026-05-11T12:55:00.000Z',
          events: [
            {
              status: 'IN_TRANSIT',
              happenedAt: '2026-05-11T12:56:00.000Z',
            },
          ],
          trackingInfo: [
            {
              company: 'MNG Kargo',
              number: `TRACK-INBOUND-${runId}`,
              url: `https://tracking.example/TRACK-INBOUND-${runId}`,
            },
          ],
          lineItems: [
            {
              lineItemGid: `gid://shopify/LineItem/li-b-${runId}`,
              sourceLineItemId: `li-b-${runId}`,
              sku: 'DH2987-100-40,5',
              quantity: 1,
            },
          ],
        },
      ],
    },
    [cancellationOrderId]: {
      orderName: `#${cancellationOrderId}`,
      displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
      fulfillments: [
        {
          id: `gid://shopify/Fulfillment/fulfillment-cancel-yali-${runId}`,
          sourceFulfillmentId: `fulfillment-cancel-yali-${runId}`,
          status: 'CANCELLED',
          createdAt: '2026-05-11T13:00:00.000Z',
          updatedAt: '2026-05-11T13:05:00.000Z',
          events: [],
          trackingInfo: [
            {
              company: 'Cancelled Carrier',
              number: `CANCELLED-${runId}`,
              url: `https://tracking.example/CANCELLED-${runId}`,
            },
          ],
          lineItems: [
            {
              lineItemGid: `gid://shopify/LineItem/cancel-li-yali-${runId}`,
              sourceLineItemId: `cancel-li-yali-${runId}`,
              sku: 'CANCEL-YALI-41',
              quantity: 1,
            },
          ],
        },
        {
          id: `gid://shopify/Fulfillment/fulfillment-cancel-spor-${runId}`,
          sourceFulfillmentId: `fulfillment-cancel-spor-${runId}`,
          status: 'SUCCESS',
          createdAt: '2026-05-11T13:10:00.000Z',
          updatedAt: '2026-05-11T13:12:00.000Z',
          events: [],
          trackingInfo: [
            {
              company: 'Aras Kargo',
              number: `ACTIVE-SPOR-${runId}`,
              url: `https://tracking.example/ACTIVE-SPOR-${runId}`,
            },
          ],
          lineItems: [
            {
              lineItemGid: `gid://shopify/LineItem/cancel-li-spor-${runId}`,
              sourceLineItemId: `cancel-li-spor-${runId}`,
              sku: 'CANCEL-SPOR-40',
              quantity: 1,
            },
          ],
        },
      ],
    },
  });
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
      SHOPIFY_RETURN_WEBHOOK_SECRET: shopifyReturnWebhookSecret,
      SHOPIFY_FULFILLMENT_WEBHOOK_SECRET: shopifyFulfillmentWebhookSecret,
      SHOPIFY_MOCK_SELLER_INFO: sellerInfoMap,
      SHOPIFY_MOCK_RETURN_DETAILS: mockReturnDetails,
      SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE: mockOrderFulfillmentState,
      SHOPIFY_MOCK_FULFILLMENT_ORDERS: mockFulfillmentOrders,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForReady(`${baseUrl}/health`);

    const healthResponse = await fetch(`${baseUrl}/health`);
    if (!healthResponse.ok) {
      throw new Error(`/health returned ${healthResponse.status}`);
    }

    const healthJson = await healthResponse.json();
    if (!healthJson || healthJson.ok !== true) {
      throw new Error(`/health payload invalid: ${JSON.stringify(healthJson)}`);
    }

    const versionResponse = await fetch(`${baseUrl}/version`);
    if (!versionResponse.ok) {
      throw new Error(`/version returned ${versionResponse.status}`);
    }

    const versionJson = await versionResponse.json();
    if (
      !versionJson ||
      versionJson.service !== 'vendor-dashboard-backend' ||
      typeof versionJson.version !== 'string'
    ) {
      throw new Error(`/version payload invalid: ${JSON.stringify(versionJson)}`);
    }

    const dbHealthResponse = await fetch(`${baseUrl}/health/db`);
    if (!dbHealthResponse.ok) {
      throw new Error(`/health/db returned ${dbHealthResponse.status}`);
    }

    const dbHealthJson = await dbHealthResponse.json();
    const validDbStatuses = new Set(['connected', 'not_configured', 'unavailable']);
    if (!dbHealthJson || !validDbStatuses.has(dbHealthJson.status)) {
      throw new Error(`/health/db payload invalid: ${JSON.stringify(dbHealthJson)}`);
    }

    const corsPreflightResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-vendor-id',
      },
    });
    if (!corsPreflightResponse.ok) {
      throw new Error(`/auth/login preflight expected success, got ${corsPreflightResponse.status}`);
    }
    const allowOrigin = corsPreflightResponse.headers.get('access-control-allow-origin');
    const allowMethods = corsPreflightResponse.headers.get('access-control-allow-methods') ?? '';
    const allowHeaders = corsPreflightResponse.headers.get('access-control-allow-headers') ?? '';
    if (allowOrigin !== 'http://127.0.0.1:5173') {
      throw new Error(`/auth/login preflight missing allow origin header: ${allowOrigin}`);
    }
    if (!allowMethods.toUpperCase().includes('POST') || !allowMethods.toUpperCase().includes('OPTIONS')) {
      throw new Error(`/auth/login preflight missing allow methods: ${allowMethods}`);
    }
    if (
      !allowHeaders.toLowerCase().includes('authorization') ||
      !allowHeaders.toLowerCase().includes('content-type') ||
      !allowHeaders.toLowerCase().includes('x-vendor-id')
    ) {
      throw new Error(`/auth/login preflight missing allow headers: ${allowHeaders}`);
    }

    const vendorMappingYaliResponse = await fetch(
      `${baseUrl}/debug/shopify/vendor-mapping?value=${encodeURIComponent('Yalı Spor')}`,
    );
    if (!vendorMappingYaliResponse.ok) {
      throw new Error(`/debug/shopify/vendor-mapping yalispor failed with ${vendorMappingYaliResponse.status}`);
    }
    const vendorMappingYaliJson = await vendorMappingYaliResponse.json();
    if (vendorMappingYaliJson?.vendorId !== 'yalispor') {
      throw new Error('/debug/shopify/vendor-mapping did not resolve Yalı Spor to yalispor.');
    }

    const vendorMappingSporjinalResponse = await fetch(
      `${baseUrl}/debug/shopify/vendor-mapping?value=${encodeURIComponent('Sporjinal')}`,
    );
    if (!vendorMappingSporjinalResponse.ok) {
      throw new Error(
        `/debug/shopify/vendor-mapping sporjinal failed with ${vendorMappingSporjinalResponse.status}`,
      );
    }
    const vendorMappingSporjinalJson = await vendorMappingSporjinalResponse.json();
    if (vendorMappingSporjinalJson?.vendorId !== 'sporjinal') {
      throw new Error('/debug/shopify/vendor-mapping did not resolve Sporjinal to sporjinal.');
    }

    const vendorMappingUnknownResponse = await fetch(
      `${baseUrl}/debug/shopify/vendor-mapping?value=${encodeURIComponent('Unknown Vendor')}`,
    );
    if (!vendorMappingUnknownResponse.ok) {
      throw new Error(
        `/debug/shopify/vendor-mapping unknown failed with ${vendorMappingUnknownResponse.status}`,
      );
    }
    const vendorMappingUnknownJson = await vendorMappingUnknownResponse.json();
    if (vendorMappingUnknownJson?.vendorId !== null) {
      throw new Error('/debug/shopify/vendor-mapping unknown vendor should resolve to null.');
    }

    const webhookPayload = JSON.stringify({
      id: smokeOrderId,
      order_number: Number(smokeOrderId),
      name: `#${smokeOrderId}`,
      total_price: '255.00',
      created_at: '2026-05-11T12:00:00.000Z',
      customer: {
        email: 'shopify.customer@example.com',
        first_name: 'Shopify',
        last_name: 'Customer',
      },
      line_items: [
        {
          id: `li-a-${runId}`,
          variant_id: 501,
          sku: 'DH2987-100-41',
          title: 'Nike Dunk Low',
          variant_title: '41',
          quantity: 1,
          price: '120.00',
        },
        {
          id: `li-yali-extra-${runId}`,
          variant_id: 503,
          sku: 'YALI-NOT-RETURNED-42',
          title: 'Yali Extra Shoe',
          variant_title: '42',
          quantity: 1,
          price: '90.00',
        },
        {
          id: `li-b-${runId}`,
          variant_id: 502,
          sku: 'DH2987-100-40,5',
          title: 'Nike Dunk Low',
          variant_title: '40,5',
          quantity: 1,
          price: '135.00',
        },
      ],
    });
    const validWebhookHmac = createHmac('sha256', shopifyWebhookSecret).update(webhookPayload, 'utf8').digest('base64');
    const webhookHeaders = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': validWebhookHmac,
      'x-shopify-topic': 'orders/create',
      'x-shopify-shop-domain': 'demo-shop.myshopify.com',
    };
    const uniqueWebhookId = `smoke-valid-${runId}`;

    const validWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/orders-create`, {
      method: 'POST',
      headers: {
        ...webhookHeaders,
        'x-shopify-webhook-id': uniqueWebhookId,
      },
      body: webhookPayload,
    });
    if (validWebhookResponse.status !== 202) {
      throw new Error(`/webhooks/shopify/orders-create valid signature expected 202, got ${validWebhookResponse.status}`);
    }
    const validWebhookJson = await validWebhookResponse.json();
    if (
      validWebhookJson?.duplicate !== false ||
      validWebhookJson?.action !== 'accepted' ||
      validWebhookJson?.processingStatus !== 'processed'
    ) {
      throw new Error(`/webhooks/shopify/orders-create first delivery payload invalid: ${JSON.stringify(validWebhookJson)}`);
    }

    const ingestedOrderBreakdownResponse = await fetch(`${baseUrl}/admin/orders/${smokeOrderId}`, {
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${(await (await fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'admin@demo.com',
            password: 'demo123',
          }),
        })).json()).token}`,
      },
    });
    if (!ingestedOrderBreakdownResponse.ok) {
      throw new Error(`/admin/orders/${smokeOrderId} after ingestion failed with ${ingestedOrderBreakdownResponse.status}`);
    }
    const ingestedOrderBreakdownJson = await ingestedOrderBreakdownResponse.json();
    if (!Array.isArray(ingestedOrderBreakdownJson?.allocations) || ingestedOrderBreakdownJson.allocations.length !== 2) {
      throw new Error(`/admin/orders/${smokeOrderId} expected two allocations, got ${JSON.stringify(ingestedOrderBreakdownJson)}`);
    }
    const allocationVendorIds = new Set(ingestedOrderBreakdownJson.allocations.map((allocation) => allocation.vendorId));
    if (!allocationVendorIds.has('yalispor') || !allocationVendorIds.has('sporjinal')) {
      throw new Error(`/admin/orders/${smokeOrderId} missing expected vendor allocations: ${JSON.stringify(ingestedOrderBreakdownJson)}`);
    }

    const duplicateWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/orders-create`, {
      method: 'POST',
      headers: {
        ...webhookHeaders,
        'x-shopify-webhook-id': uniqueWebhookId,
      },
      body: webhookPayload,
    });
    if (duplicateWebhookResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/orders-create duplicate webhook id expected 202, got ${duplicateWebhookResponse.status}`,
      );
    }
    const duplicateWebhookJson = await duplicateWebhookResponse.json();
    if (duplicateWebhookJson?.duplicate !== true || duplicateWebhookJson?.action !== 'duplicate_ignored') {
      throw new Error(
        `/webhooks/shopify/orders-create duplicate webhook id payload invalid: ${JSON.stringify(duplicateWebhookJson)}`,
      );
    }
    if (prisma) {
      const saleLedgerRows = await prisma.financeLedgerEntry.findMany({
        where: {
          id: {
            in: [`fin-yalispor-sale-${smokeOrderId}`, `fin-sporjinal-sale-${smokeOrderId}`],
          },
          entryType: 'sale',
        },
        orderBy: {
          id: 'asc',
        },
      });
      if (saleLedgerRows.length !== 2) {
        throw new Error(`orders/create should create one sale ledger row per vendor allocation, got ${saleLedgerRows.length}.`);
      }
      const yalisporSale = saleLedgerRows.find((entry) => entry.vendorId === 'yalispor');
      const sporjinalSale = saleLedgerRows.find((entry) => entry.vendorId === 'sporjinal');
      if (Number(yalisporSale?.amount ?? 0) !== 210 || Number(sporjinalSale?.amount ?? 0) !== 135) {
        throw new Error(`orders/create sale ledger amounts were not vendor-scoped: ${JSON.stringify(saleLedgerRows)}`);
      }
    }

    const payloadHashWebhookPayload = JSON.stringify({
      id: 9003,
      order_number: 9003,
      name: '#9003',
      total_price: '120.00',
      line_items: [
        {
          id: `li-fallback-${runId}`,
          sku: 'UNKNOWN-SKU-FALLBACK',
          quantity: 1,
          price: '120.00',
        },
      ],
    });
    const payloadHashWebhookHmac = createHmac('sha256', shopifyWebhookSecret)
      .update(payloadHashWebhookPayload, 'utf8')
      .digest('base64');
    const payloadHashHeaders = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': payloadHashWebhookHmac,
      'x-shopify-topic': 'orders/create',
      'x-shopify-shop-domain': 'demo-shop.myshopify.com',
    };

    const noWebhookIdFirstResponse = await fetch(`${baseUrl}/webhooks/shopify/orders-create`, {
      method: 'POST',
      headers: payloadHashHeaders,
      body: payloadHashWebhookPayload,
    });
    if (noWebhookIdFirstResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/orders-create first payload-hash fallback expected 202, got ${noWebhookIdFirstResponse.status}`,
      );
    }
    const noWebhookIdFirstJson = await noWebhookIdFirstResponse.json();
    if (
      noWebhookIdFirstJson?.duplicate !== false ||
      noWebhookIdFirstJson?.action !== 'received_needs_attention' ||
      noWebhookIdFirstJson?.processingStatus !== 'needs_attention'
    ) {
      throw new Error(
        `/webhooks/shopify/orders-create first payload-hash fallback invalid: ${JSON.stringify(noWebhookIdFirstJson)}`,
      );
    }

    const noWebhookIdDuplicateResponse = await fetch(`${baseUrl}/webhooks/shopify/orders-create`, {
      method: 'POST',
      headers: payloadHashHeaders,
      body: payloadHashWebhookPayload,
    });
    if (noWebhookIdDuplicateResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/orders-create duplicate payload-hash fallback expected 202, got ${noWebhookIdDuplicateResponse.status}`,
      );
    }
    const noWebhookIdDuplicateJson = await noWebhookIdDuplicateResponse.json();
    if (noWebhookIdDuplicateJson?.duplicate !== true || noWebhookIdDuplicateJson?.action !== 'duplicate_ignored') {
      throw new Error(
        `/webhooks/shopify/orders-create duplicate payload-hash fallback invalid: ${JSON.stringify(noWebhookIdDuplicateJson)}`,
      );
    }

    const failingWebhookPayload = JSON.stringify({
      id: 9002,
      order_number: 9002,
      name: '#9002',
      line_items: [
        {
          id: `li-fail-${runId}`,
          sku: 'DH2987-100-40,5',
          quantity: 1,
          price: '135.00',
        },
      ],
    });
    const failingWebhookHmac = createHmac('sha256', shopifyWebhookSecret)
      .update(failingWebhookPayload, 'utf8')
      .digest('base64');
    const failingWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/orders-create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': failingWebhookHmac,
        'x-shopify-topic': 'orders/create',
        'x-shopify-shop-domain': 'demo-shop.myshopify.com',
        'x-shopify-webhook-id': `smoke-fail-${runId}`,
      },
      body: failingWebhookPayload,
    });
    if (failingWebhookResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/orders-create unresolved seller_info expected 202, got ${failingWebhookResponse.status}`,
      );
    }
    const failingWebhookJson = await failingWebhookResponse.json();
    if (
      failingWebhookJson?.duplicate !== false ||
      failingWebhookJson?.action !== 'received_needs_attention' ||
      failingWebhookJson?.processingStatus !== 'needs_attention'
    ) {
      throw new Error(
        `/webhooks/shopify/orders-create unresolved seller_info payload invalid: ${JSON.stringify(failingWebhookJson)}`,
      );
    }

    const invalidWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/orders-create`, {
      method: 'POST',
      headers: {
        ...webhookHeaders,
        'x-shopify-hmac-sha256': 'invalid-signature',
        'x-shopify-webhook-id': `smoke-invalid-${runId}`,
      },
      body: webhookPayload,
    });
    if (invalidWebhookResponse.status !== 401) {
      throw new Error(
        `/webhooks/shopify/orders-create invalid signature expected 401, got ${invalidWebhookResponse.status}`,
      );
    }

    const returnLifecyclePayload = JSON.stringify({
      id: 777001,
      admin_graphql_api_id: 'gid://shopify/Return/777001',
      status: 'requested',
      order: {
        id: smokeOrderId,
        admin_graphql_api_id: `gid://shopify/Order/${smokeOrderId}`,
      },
    });
    const returnLifecycleHmac = createHmac('sha256', shopifyReturnWebhookSecret)
      .update(returnLifecyclePayload, 'utf8')
      .digest('base64');
    const returnLifecycleHeaders = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': returnLifecycleHmac,
      'x-shopify-topic': 'returns/request',
      'x-shopify-shop-domain': 'demo-shop.myshopify.com',
      'x-shopify-webhook-id': `smoke-returns-request-${runId}`,
    };

    const validReturnLifecycleResponse = await fetch(`${baseUrl}/webhooks/shopify/returns-request`, {
      method: 'POST',
      headers: returnLifecycleHeaders,
      body: returnLifecyclePayload,
    });
    if (validReturnLifecycleResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/returns-request valid signature expected 202, got ${validReturnLifecycleResponse.status}`,
      );
    }
    const validReturnLifecycleJson = await validReturnLifecycleResponse.json();
    if (
      validReturnLifecycleJson?.duplicate !== false ||
      validReturnLifecycleJson?.action !== 'accepted' ||
      validReturnLifecycleJson?.processingStatus !== 'processed' ||
      validReturnLifecycleJson?.topic !== 'returns/request'
    ) {
      throw new Error(
        `/webhooks/shopify/returns-request first delivery payload invalid: ${JSON.stringify(validReturnLifecycleJson)}`,
      );
    }

    const duplicateReturnLifecycleResponse = await fetch(`${baseUrl}/webhooks/shopify/returns-request`, {
      method: 'POST',
      headers: returnLifecycleHeaders,
      body: returnLifecyclePayload,
    });
    if (duplicateReturnLifecycleResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/returns-request duplicate expected 202, got ${duplicateReturnLifecycleResponse.status}`,
      );
    }
    const duplicateReturnLifecycleJson = await duplicateReturnLifecycleResponse.json();
    if (
      duplicateReturnLifecycleJson?.duplicate !== true ||
      duplicateReturnLifecycleJson?.action !== 'duplicate_ignored' ||
      duplicateReturnLifecycleJson?.topic !== 'returns/request'
    ) {
      throw new Error(
        `/webhooks/shopify/returns-request duplicate payload invalid: ${JSON.stringify(duplicateReturnLifecycleJson)}`,
      );
    }

    const returnApprovePayload = JSON.stringify({
      id: 777001,
      admin_graphql_api_id: 'gid://shopify/Return/777001',
      status: 'approved',
    });
    const returnApproveSignature = createHmac('sha256', shopifyReturnWebhookSecret)
      .update(returnApprovePayload, 'utf8')
      .digest('base64');
    const returnApproveResponse = await fetch(`${baseUrl}/webhooks/shopify/returns-approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': returnApproveSignature,
        'x-shopify-topic': 'returns/approve',
        'x-shopify-shop-domain': 'demo-shop.myshopify.com',
        'x-shopify-webhook-id': `smoke-returns-approve-${runId}`,
      },
      body: returnApprovePayload,
    });
    if (returnApproveResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/returns-approve valid signature expected 202, got ${returnApproveResponse.status}`,
      );
    }
    const returnApproveJson = await returnApproveResponse.json();
    if (
      returnApproveJson?.duplicate !== false ||
      returnApproveJson?.action !== 'accepted' ||
      returnApproveJson?.processingStatus !== 'processed' ||
      returnApproveJson?.topic !== 'returns/approve'
    ) {
      throw new Error(
        `/webhooks/shopify/returns-approve payload invalid: ${JSON.stringify(returnApproveJson)}`,
      );
    }

    const invalidReturnLifecycleResponse = await fetch(`${baseUrl}/webhooks/shopify/returns-request`, {
      method: 'POST',
      headers: {
        ...returnLifecycleHeaders,
        'x-shopify-hmac-sha256': 'invalid-signature',
      },
      body: returnLifecyclePayload,
    });
    if (invalidReturnLifecycleResponse.status !== 401) {
      throw new Error(
        `/webhooks/shopify/returns-request invalid signature expected 401, got ${invalidReturnLifecycleResponse.status}`,
      );
    }

    const adminLoginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@demo.com',
        password: 'demo123',
      }),
    });

    if (!adminLoginResponse.ok) {
      throw new Error(`/auth/login admin failed with ${adminLoginResponse.status}`);
    }

    const adminLoginJson = await adminLoginResponse.json();
    const adminToken = adminLoginJson?.token;
    if (!adminToken) {
      throw new Error('Admin login token missing in /auth/login response.');
    }

    const adminVendorContextResponse = await fetch(`${baseUrl}/debug/vendor-context`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });

    if (!adminVendorContextResponse.ok) {
      throw new Error(`/debug/vendor-context admin check failed with ${adminVendorContextResponse.status}`);
    }

    const vendorLoginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'yalispor@demo.com',
        password: 'demo123',
      }),
    });

    if (!vendorLoginResponse.ok) {
      throw new Error(`/auth/login vendor failed with ${vendorLoginResponse.status}`);
    }

    const vendorLoginJson = await vendorLoginResponse.json();
    const vendorToken = vendorLoginJson?.token;
    if (!vendorToken) {
      throw new Error('Vendor login token missing in /auth/login response.');
    }

    const legacyMissingPayloadEventId = `legacy-missing-payload-${runId}`;
    const recoverableReceivedEventId = `recoverable-received-${runId}`;
    if (prisma) {
      await prisma.webhookEvent.create({
        data: {
          id: legacyMissingPayloadEventId,
          sourceShopDomain: 'demo-shop.myshopify.com',
          topic: 'orders/create',
          idempotencyKey: `legacy:orders/create:${runId}`,
          payloadHash: `legacy-payload-hash-${runId}`,
          rawPayload: null,
          status: 'RECEIVED',
          receivedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      });

      await prisma.webhookEvent.create({
        data: {
          id: recoverableReceivedEventId,
          sourceShopDomain: 'demo-shop.myshopify.com',
          topic: 'orders/create',
          idempotencyKey: `recoverable:orders/create:${runId}`,
          payloadHash: `recoverable-payload-hash-${runId}`,
          rawPayload: webhookPayload,
          status: 'RECEIVED',
          receivedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      });
    }

    const allowedVendorContextResponse = await fetch(`${baseUrl}/debug/vendor-context`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });

    if (!allowedVendorContextResponse.ok) {
      throw new Error(
        `/debug/vendor-context allowed vendor check failed with ${allowedVendorContextResponse.status}`,
      );
    }

    const forbiddenVendorContextResponse = await fetch(`${baseUrl}/debug/vendor-context`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });

    if (forbiddenVendorContextResponse.status !== 403) {
      throw new Error(
        `/debug/vendor-context forbidden vendor expected 403, got ${forbiddenVendorContextResponse.status}`,
      );
    }

    const adminOrdersYaliResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!adminOrdersYaliResponse.ok) {
      throw new Error(`/orders admin yalispor failed with ${adminOrdersYaliResponse.status}`);
    }
    const adminOrdersYali = await adminOrdersYaliResponse.json();
    if (!Array.isArray(adminOrdersYali) || adminOrdersYali.length === 0) {
      throw new Error('/orders admin yalispor returned empty or invalid payload.');
    }
    if (!adminOrdersYali.some((order) => order.sourceShopifyOrderId === smokeOrderId && order.vendorId === 'yalispor')) {
      throw new Error(`/orders admin yalispor did not include ingested Shopify order ${smokeOrderId} allocation.`);
    }
    const ingestedYalisporAllocation = adminOrdersYali.find((order) => order.sourceShopifyOrderId === smokeOrderId);
    if (!ingestedYalisporAllocation?.id) {
      throw new Error('Unable to resolve yalispor ingested allocation from /orders payload.');
    }

    const adminOrdersSporjinalResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!adminOrdersSporjinalResponse.ok) {
      throw new Error(`/orders admin sporjinal failed with ${adminOrdersSporjinalResponse.status}`);
    }
    const adminOrdersSporjinal = await adminOrdersSporjinalResponse.json();
    if (!Array.isArray(adminOrdersSporjinal) || !adminOrdersSporjinal.some((order) => order.sourceShopifyOrderId === smokeOrderId && order.vendorId === 'sporjinal')) {
      throw new Error(`/orders admin sporjinal did not include ingested Shopify order ${smokeOrderId} allocation.`);
    }
    const ingestedSporjinalAllocation = adminOrdersSporjinal.find((order) => order.sourceShopifyOrderId === smokeOrderId);
    if (!ingestedSporjinalAllocation?.id) {
      throw new Error('Unable to resolve sporjinal ingested allocation from /orders payload.');
    }

    const missingFailedOrderResponse = await fetch(`${baseUrl}/admin/orders/9002`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (missingFailedOrderResponse.status !== 404) {
      throw new Error(`/admin/orders/9002 expected 404 after failed ingestion, got ${missingFailedOrderResponse.status}`);
    }

    if (adminOrdersSporjinal.length === 0) {
      throw new Error('/orders admin sporjinal returned empty or invalid payload.');
    }

    const refundWebhookPayload = JSON.stringify({
      id: `rf-${runId}`,
      order_id: smokeOrderId,
      created_at: '2026-05-11T12:30:00.000Z',
      note: 'Customer requested refund',
      refund_line_items: [
        {
          id: `rli-a-${runId}`,
          line_item_id: `li-a-${runId}`,
          quantity: 1,
          subtotal: '120.00',
          line_item: {
            id: `li-a-${runId}`,
            sku: 'DH2987-100-41',
            title: 'Nike Dunk Low',
            variant_title: '41',
          },
        },
        {
          id: `rli-b-${runId}`,
          line_item_id: `li-b-${runId}`,
          quantity: 1,
          subtotal: '135.00',
          line_item: {
            id: `li-b-${runId}`,
            sku: 'DH2987-100-40,5',
            title: 'Nike Dunk Low',
            variant_title: '40,5',
          },
        },
      ],
    });
    const refundWebhookHmac = createHmac('sha256', shopifyWebhookSecret)
      .update(refundWebhookPayload, 'utf8')
      .digest('base64');
    const refundWebhookHeaders = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': refundWebhookHmac,
      'x-shopify-topic': 'refunds/create',
      'x-shopify-shop-domain': 'demo-shop.myshopify.com',
    };
    const refundWebhookId = `smoke-refund-${runId}`;

    const validRefundWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/refunds-create`, {
      method: 'POST',
      headers: {
        ...refundWebhookHeaders,
        'x-shopify-webhook-id': refundWebhookId,
      },
      body: refundWebhookPayload,
    });
    if (validRefundWebhookResponse.status !== 202) {
      throw new Error(`/webhooks/shopify/refunds-create valid signature expected 202, got ${validRefundWebhookResponse.status}`);
    }
    const validRefundWebhookJson = await validRefundWebhookResponse.json();
    if (
      validRefundWebhookJson?.duplicate !== false ||
      validRefundWebhookJson?.action !== 'accepted' ||
      validRefundWebhookJson?.processingStatus !== 'processed' ||
      validRefundWebhookJson?.refundAllocationCount !== 2
    ) {
      throw new Error(`/webhooks/shopify/refunds-create first delivery payload invalid: ${JSON.stringify(validRefundWebhookJson)}`);
    }

    const duplicateRefundWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/refunds-create`, {
      method: 'POST',
      headers: {
        ...refundWebhookHeaders,
        'x-shopify-webhook-id': refundWebhookId,
      },
      body: refundWebhookPayload,
    });
    if (duplicateRefundWebhookResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/refunds-create duplicate webhook id expected 202, got ${duplicateRefundWebhookResponse.status}`,
      );
    }
    const duplicateRefundWebhookJson = await duplicateRefundWebhookResponse.json();
    if (duplicateRefundWebhookJson?.duplicate !== true || duplicateRefundWebhookJson?.action !== 'duplicate_ignored') {
      throw new Error(
        `/webhooks/shopify/refunds-create duplicate webhook id payload invalid: ${JSON.stringify(duplicateRefundWebhookJson)}`,
      );
    }

    const unresolvedRefundWebhookPayload = JSON.stringify({
      id: `rf-fail-${runId}`,
      order_id: smokeOrderId,
      refund_line_items: [
        {
          id: `rli-fail-${runId}`,
          line_item_id: `li-fail-${runId}`,
          quantity: 1,
          subtotal: '50.00',
          line_item: {
            id: `li-fail-${runId}`,
            sku: 'UNKNOWN-REFUND-SKU',
            title: 'Unknown Product',
          },
        },
      ],
    });
    const unresolvedRefundWebhookHmac = createHmac('sha256', shopifyWebhookSecret)
      .update(unresolvedRefundWebhookPayload, 'utf8')
      .digest('base64');
    const unresolvedRefundWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/refunds-create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': unresolvedRefundWebhookHmac,
        'x-shopify-topic': 'refunds/create',
        'x-shopify-shop-domain': 'demo-shop.myshopify.com',
        'x-shopify-webhook-id': `smoke-refund-fail-${runId}`,
      },
      body: unresolvedRefundWebhookPayload,
    });
    if (unresolvedRefundWebhookResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/refunds-create unresolved refund SKU expected 202, got ${unresolvedRefundWebhookResponse.status}`,
      );
    }
    const unresolvedRefundWebhookJson = await unresolvedRefundWebhookResponse.json();
    if (
      unresolvedRefundWebhookJson?.duplicate !== false ||
      unresolvedRefundWebhookJson?.action !== 'received_needs_attention' ||
      unresolvedRefundWebhookJson?.processingStatus !== 'needs_attention'
    ) {
      throw new Error(
        `/webhooks/shopify/refunds-create unresolved refund SKU payload invalid: ${JSON.stringify(unresolvedRefundWebhookJson)}`,
      );
    }

    const invalidRefundWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/refunds-create`, {
      method: 'POST',
      headers: {
        ...refundWebhookHeaders,
        'x-shopify-hmac-sha256': 'invalid-signature',
        'x-shopify-webhook-id': `smoke-refund-invalid-${runId}`,
      },
      body: refundWebhookPayload,
    });
    if (invalidRefundWebhookResponse.status !== 401) {
      throw new Error(
        `/webhooks/shopify/refunds-create invalid signature expected 401, got ${invalidRefundWebhookResponse.status}`,
      );
    }

    const fulfillmentWebhookPayload = JSON.stringify({
      id: `fulfillment-${runId}`,
      order_id: smokeOrderId,
      status: 'success',
    });
    const fulfillmentWebhookHmac = createHmac('sha256', shopifyFulfillmentWebhookSecret)
      .update(fulfillmentWebhookPayload, 'utf8')
      .digest('base64');
    const fulfillmentWebhookHeaders = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': fulfillmentWebhookHmac,
      'x-shopify-topic': 'fulfillments/create',
      'x-shopify-shop-domain': 'demo-shop.myshopify.com',
      'x-shopify-webhook-id': `smoke-fulfillment-${runId}`,
    };
    const validFulfillmentWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/fulfillments-create`, {
      method: 'POST',
      headers: fulfillmentWebhookHeaders,
      body: fulfillmentWebhookPayload,
    });
    if (validFulfillmentWebhookResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/fulfillments-create valid signature expected 202, got ${validFulfillmentWebhookResponse.status}`,
      );
    }
    const validFulfillmentWebhookJson = await validFulfillmentWebhookResponse.json();
    if (
      validFulfillmentWebhookJson?.duplicate !== false ||
      validFulfillmentWebhookJson?.action !== 'accepted' ||
      validFulfillmentWebhookJson?.processingStatus !== 'processed' ||
      validFulfillmentWebhookJson?.affectedAllocationCount !== 2
    ) {
      throw new Error(
        `/webhooks/shopify/fulfillments-create payload invalid: ${JSON.stringify(validFulfillmentWebhookJson)}`,
      );
    }

    const fulfillmentDuplicateResponse = await fetch(`${baseUrl}/webhooks/shopify/fulfillments-create`, {
      method: 'POST',
      headers: fulfillmentWebhookHeaders,
      body: fulfillmentWebhookPayload,
    });
    if (fulfillmentDuplicateResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/fulfillments-create duplicate expected 202, got ${fulfillmentDuplicateResponse.status}`,
      );
    }
    const fulfillmentDuplicateJson = await fulfillmentDuplicateResponse.json();
    if (fulfillmentDuplicateJson?.duplicate !== true || fulfillmentDuplicateJson?.action !== 'duplicate_ignored') {
      throw new Error(
        `/webhooks/shopify/fulfillments-create duplicate payload invalid: ${JSON.stringify(fulfillmentDuplicateJson)}`,
      );
    }

    const yalisporAfterInboundResponse = await fetch(`${baseUrl}/orders/${ingestedYalisporAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!yalisporAfterInboundResponse.ok) {
      throw new Error(`/orders/:orderId yalispor after inbound fulfillment failed with ${yalisporAfterInboundResponse.status}`);
    }
    const yalisporAfterInbound = await yalisporAfterInboundResponse.json();
    if (
      yalisporAfterInbound.fulfillmentStatus !== 'partially_fulfilled' ||
      yalisporAfterInbound.shippingStatus !== 'partially_shipped' ||
      yalisporAfterInbound.trackingNumber !== null ||
      yalisporAfterInbound.carrier !== null ||
      yalisporAfterInbound.trackingUrl !== null ||
      typeof yalisporAfterInbound.fulfilledAt !== 'string' ||
      typeof yalisporAfterInbound.shipmentCreatedAt !== 'string' ||
      typeof yalisporAfterInbound.shipmentUpdatedAt !== 'string'
    ) {
      throw new Error(
        `/orders/:orderId yalispor inbound fulfillment should be partial without tracking: ${JSON.stringify(yalisporAfterInbound)}`,
      );
    }

    const sporjinalAfterInboundResponse = await fetch(`${baseUrl}/orders/${ingestedSporjinalAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!sporjinalAfterInboundResponse.ok) {
      throw new Error(`/orders/:orderId sporjinal after inbound fulfillment failed with ${sporjinalAfterInboundResponse.status}`);
    }
    const sporjinalAfterInbound = await sporjinalAfterInboundResponse.json();
    if (
      sporjinalAfterInbound.fulfillmentStatus !== 'fulfilled' ||
      sporjinalAfterInbound.shippingStatus !== 'in_transit' ||
      sporjinalAfterInbound.trackingNumber !== `TRACK-INBOUND-${runId}` ||
      sporjinalAfterInbound.carrier !== 'MNG Kargo' ||
      sporjinalAfterInbound.trackingUrl !== `https://tracking.example/TRACK-INBOUND-${runId}` ||
      sporjinalAfterInbound.fulfilledAt !== '2026-05-11T12:50:00.000Z' ||
      sporjinalAfterInbound.shipmentCreatedAt !== '2026-05-11T12:50:00.000Z' ||
      sporjinalAfterInbound.shipmentUpdatedAt !== '2026-05-11T12:56:00.000Z'
    ) {
      throw new Error(
        `/orders/:orderId sporjinal inbound fulfillment should include tracking and timestamps: ${JSON.stringify(sporjinalAfterInbound)}`,
      );
    }

    const fulfillmentEventPayload = JSON.stringify({
      id: `fulfillment-event-${runId}`,
      order_id: smokeOrderId,
      fulfillment_id: `fulfillment-spor-${runId}`,
      status: 'delivered',
    });
    const fulfillmentEventHmac = createHmac('sha256', shopifyFulfillmentWebhookSecret)
      .update(fulfillmentEventPayload, 'utf8')
      .digest('base64');
    const fulfillmentEventResponse = await fetch(`${baseUrl}/webhooks/shopify/fulfillment-events-create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': fulfillmentEventHmac,
        'x-shopify-topic': 'fulfillment_events/create',
        'x-shopify-shop-domain': 'demo-shop.myshopify.com',
        'x-shopify-webhook-id': `smoke-fulfillment-event-${runId}`,
      },
      body: fulfillmentEventPayload,
    });
    if (fulfillmentEventResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/fulfillment-events-create valid signature expected 202, got ${fulfillmentEventResponse.status}`,
      );
    }
    const fulfillmentEventJson = await fulfillmentEventResponse.json();
    if (
      fulfillmentEventJson?.duplicate !== false ||
      fulfillmentEventJson?.action !== 'accepted' ||
      fulfillmentEventJson?.processingStatus !== 'processed'
    ) {
      throw new Error(
        `/webhooks/shopify/fulfillment-events-create payload invalid: ${JSON.stringify(fulfillmentEventJson)}`,
      );
    }

    const sporjinalDeliveredResponse = await fetch(`${baseUrl}/orders/${ingestedSporjinalAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    const sporjinalDelivered = await sporjinalDeliveredResponse.json();
    if (sporjinalDelivered?.shippingStatus !== 'delivered') {
      throw new Error(
        `/orders/:orderId fulfillment event should map sporjinal shippingStatus delivered: ${JSON.stringify(sporjinalDelivered)}`,
      );
    }
    const yalisporAfterDeliveredEventResponse = await fetch(`${baseUrl}/orders/${ingestedYalisporAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    const yalisporAfterDeliveredEvent = await yalisporAfterDeliveredEventResponse.json();
    if (yalisporAfterDeliveredEvent?.shippingStatus === 'delivered') {
      throw new Error(
        `/orders/:orderId fulfillment event leaked delivered status to unrelated yalispor fulfillment: ${JSON.stringify(yalisporAfterDeliveredEvent)}`,
      );
    }

    const cancellationOrderPayload = JSON.stringify({
      id: cancellationOrderId,
      order_number: Number(cancellationOrderId),
      name: `#${cancellationOrderId}`,
      total_price: '255.00',
      created_at: '2026-05-11T13:00:00.000Z',
      customer: {
        email: 'cancel.customer@example.com',
        first_name: 'Cancel',
        last_name: 'Customer',
      },
      line_items: [
        {
          id: `cancel-li-yali-${runId}`,
          variant_id: 601,
          sku: 'CANCEL-YALI-41',
          title: 'Cancelled Yali Item',
          variant_title: '41',
          quantity: 1,
          price: '120.00',
        },
        {
          id: `cancel-li-spor-${runId}`,
          variant_id: 602,
          sku: 'CANCEL-SPOR-40',
          title: 'Active Spor Item',
          variant_title: '40',
          quantity: 1,
          price: '135.00',
        },
      ],
    });
    const cancellationOrderHmac = createHmac('sha256', shopifyWebhookSecret)
      .update(cancellationOrderPayload, 'utf8')
      .digest('base64');
    const cancellationOrderResponse = await fetch(`${baseUrl}/webhooks/shopify/orders-create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': cancellationOrderHmac,
        'x-shopify-topic': 'orders/create',
        'x-shopify-shop-domain': 'demo-shop.myshopify.com',
        'x-shopify-webhook-id': `smoke-cancel-order-${runId}`,
      },
      body: cancellationOrderPayload,
    });
    if (cancellationOrderResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/orders-create cancellation fixture expected 202, got ${cancellationOrderResponse.status}`,
      );
    }

    const cancellationPayload = JSON.stringify({
      id: `fulfillment-order-cancelled-${runId}`,
      order_id: cancellationOrderId,
      admin_graphql_api_id: `gid://shopify/FulfillmentOrder/fo-cancel-yalispor`,
    });
    const cancellationHmac = createHmac('sha256', shopifyFulfillmentWebhookSecret)
      .update(cancellationPayload, 'utf8')
      .digest('base64');
    const cancellationHeaders = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': cancellationHmac,
      'x-shopify-topic': 'fulfillment_orders/cancelled',
      'x-shopify-shop-domain': 'demo-shop.myshopify.com',
      'x-shopify-webhook-id': `smoke-fulfillment-cancelled-${runId}`,
    };
    const cancellationResponse = await fetch(`${baseUrl}/webhooks/shopify/fulfillment-orders-cancelled`, {
      method: 'POST',
      headers: cancellationHeaders,
      body: cancellationPayload,
    });
    if (cancellationResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/fulfillment-orders-cancelled expected 202, got ${cancellationResponse.status}`,
      );
    }
    const cancellationJson = await cancellationResponse.json();
    if (
      cancellationJson?.duplicate !== false ||
      cancellationJson?.action !== 'accepted' ||
      cancellationJson?.processingStatus !== 'processed' ||
      cancellationJson?.affectedAllocationCount !== 2
    ) {
      throw new Error(
        `/webhooks/shopify/fulfillment-orders-cancelled payload invalid: ${JSON.stringify(cancellationJson)}`,
      );
    }
    const cancellationDuplicateResponse = await fetch(`${baseUrl}/webhooks/shopify/fulfillment-orders-cancelled`, {
      method: 'POST',
      headers: cancellationHeaders,
      body: cancellationPayload,
    });
    if (cancellationDuplicateResponse.status !== 202) {
      throw new Error(
        `/webhooks/shopify/fulfillment-orders-cancelled duplicate expected 202, got ${cancellationDuplicateResponse.status}`,
      );
    }
    const cancellationDuplicateJson = await cancellationDuplicateResponse.json();
    if (
      cancellationDuplicateJson?.duplicate !== true ||
      cancellationDuplicateJson?.action !== 'duplicate_ignored'
    ) {
      throw new Error(
        `/webhooks/shopify/fulfillment-orders-cancelled duplicate payload invalid: ${JSON.stringify(cancellationDuplicateJson)}`,
      );
    }

    const cancellationAdminYaliResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    const cancellationAdminYali = await cancellationAdminYaliResponse.json();
    const cancelledYaliAllocation = cancellationAdminYali.find((order) => order.sourceShopifyOrderId === cancellationOrderId);
    if (!cancelledYaliAllocation) {
      throw new Error(`/orders admin yalispor missing cancellation fixture ${cancellationOrderId}.`);
    }
    const cancelledYaliDetailResponse = await fetch(`${baseUrl}/orders/${cancelledYaliAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    const cancelledYaliDetail = await cancelledYaliDetailResponse.json();
    if (
      cancelledYaliDetail.fulfillmentStatus !== 'pending' ||
      cancelledYaliDetail.shippingStatus !== 'awaiting_shipment' ||
      cancelledYaliDetail.trackingNumber !== null ||
      cancelledYaliDetail.carrier !== null ||
      cancelledYaliDetail.trackingUrl !== null
    ) {
      throw new Error(
        `/orders/:orderId cancelled yalispor allocation should revert to awaiting shipment: ${JSON.stringify(cancelledYaliDetail)}`,
      );
    }

    const cancellationAdminSporResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    const cancellationAdminSpor = await cancellationAdminSporResponse.json();
    const activeSporAllocation = cancellationAdminSpor.find((order) => order.sourceShopifyOrderId === cancellationOrderId);
    if (!activeSporAllocation) {
      throw new Error(`/orders admin sporjinal missing cancellation fixture ${cancellationOrderId}.`);
    }
    const activeSporDetailResponse = await fetch(`${baseUrl}/orders/${activeSporAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    const activeSporDetail = await activeSporDetailResponse.json();
    if (
      activeSporDetail.fulfillmentStatus !== 'fulfilled' ||
      activeSporDetail.shippingStatus !== 'shipped' ||
      activeSporDetail.trackingNumber !== `ACTIVE-SPOR-${runId}` ||
      activeSporDetail.carrier !== 'Aras Kargo'
    ) {
      throw new Error(
        `/orders/:orderId active sporjinal allocation should stay fulfilled after yalispor cancellation: ${JSON.stringify(activeSporDetail)}`,
      );
    }

    if (prisma) {
      await prisma.vendorAllocation.update({
        where: { id: `alloc-yalispor-${cancellationOrderId}` },
        data: {
          fulfillmentStatus: 'fulfilled',
          shippingStatus: 'shipped',
          trackingNumber: `STALE-YALI-${runId}`,
          carrier: 'Stale Carrier',
        },
      });
      await prisma.fulfillment.upsert({
        where: { vendorAllocationId: `alloc-yalispor-${cancellationOrderId}` },
        update: {
          fulfillmentStatus: 'fulfilled',
          trackingNumber: `STALE-YALI-${runId}`,
          carrier: 'Stale Carrier',
          trackingUrl: `https://tracking.example/STALE-YALI-${runId}`,
          fulfilledAt: new Date('2026-05-11T11:00:00.000Z'),
          shipmentCreatedAt: new Date('2026-05-11T11:00:00.000Z'),
          shipmentUpdatedAt: new Date('2026-05-11T11:10:00.000Z'),
          syncStatus: 'stale_smoke_fixture',
        },
        create: {
          vendorAllocationId: `alloc-yalispor-${cancellationOrderId}`,
          fulfillmentStatus: 'fulfilled',
          trackingNumber: `STALE-YALI-${runId}`,
          carrier: 'Stale Carrier',
          trackingUrl: `https://tracking.example/STALE-YALI-${runId}`,
          notifyCustomer: false,
          fulfilledAt: new Date('2026-05-11T11:00:00.000Z'),
          shipmentCreatedAt: new Date('2026-05-11T11:00:00.000Z'),
          shipmentUpdatedAt: new Date('2026-05-11T11:10:00.000Z'),
          syncStatus: 'stale_smoke_fixture',
        },
      });
    }

    const reconcileCancelledAllocationResponse = await fetch(
      `${baseUrl}/admin/reconciliation/orders/alloc-yalispor-${cancellationOrderId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (reconcileCancelledAllocationResponse.status !== 200) {
      throw new Error(
        `/admin/reconciliation/orders/:allocationId cancellation expected 200, got ${reconcileCancelledAllocationResponse.status}`,
      );
    }
    const reconcileCancelledAllocationJson = await reconcileCancelledAllocationResponse.json();
    if (
      !['repaired', 'needs_attention'].includes(reconcileCancelledAllocationJson?.reconciliationStatus) ||
      !Array.isArray(reconcileCancelledAllocationJson?.repairedFields) ||
      reconcileCancelledAllocationJson.repairedFields.length === 0
    ) {
      throw new Error(
        `/admin/reconciliation/orders/:allocationId cancellation returned invalid result: ${JSON.stringify(reconcileCancelledAllocationJson)}`,
      );
    }

    const reconciledCancelledDetailResponse = await fetch(`${baseUrl}/orders/${cancelledYaliAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    const reconciledCancelledDetail = await reconciledCancelledDetailResponse.json();
    if (
      reconciledCancelledDetail.fulfillmentStatus !== 'pending' ||
      reconciledCancelledDetail.shippingStatus !== 'awaiting_shipment' ||
      reconciledCancelledDetail.trackingNumber !== null ||
      reconciledCancelledDetail.carrier !== null
    ) {
      throw new Error(
        `/admin/reconciliation/orders/:allocationId should repair stale cancelled fulfillment: ${JSON.stringify(reconciledCancelledDetail)}`,
      );
    }

    if (prisma) {
      await prisma.vendorAllocation.update({
        where: { id: `alloc-sporjinal-${smokeOrderId}` },
        data: {
          fulfillmentStatus: 'pending',
          shippingStatus: 'awaiting_shipment',
          trackingNumber: 'STALE-TRACKING',
          carrier: 'Stale Carrier',
        },
      });
      await prisma.fulfillment.update({
        where: { vendorAllocationId: `alloc-sporjinal-${smokeOrderId}` },
        data: {
          trackingNumber: 'STALE-TRACKING',
          carrier: 'Stale Carrier',
          trackingUrl: 'https://tracking.example/stale',
          syncStatus: 'stale_smoke_fixture',
        },
      });
    }

    const reconcileTrackingResponse = await fetch(`${baseUrl}/admin/reconciliation/orders/alloc-sporjinal-${smokeOrderId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (reconcileTrackingResponse.status !== 200) {
      throw new Error(`/admin/reconciliation/orders/:allocationId tracking expected 200, got ${reconcileTrackingResponse.status}`);
    }
    const reconcileTrackingJson = await reconcileTrackingResponse.json();
    if (
      reconcileTrackingJson?.reconciliationStatus !== 'repaired' ||
      !reconcileTrackingJson.repairedFields?.some((field) => field.field === 'trackingNumber')
    ) {
      throw new Error(
        `/admin/reconciliation/orders/:allocationId tracking did not repair tracking: ${JSON.stringify(reconcileTrackingJson)}`,
      );
    }

    const reconciledTrackingDetailResponse = await fetch(`${baseUrl}/orders/alloc-sporjinal-${smokeOrderId}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    const reconciledTrackingDetail = await reconciledTrackingDetailResponse.json();
    if (
      reconciledTrackingDetail.trackingNumber !== `TRACK-INBOUND-${runId}` ||
      reconciledTrackingDetail.carrier !== 'MNG Kargo' ||
      reconciledTrackingDetail.trackingUrl !== `https://tracking.example/TRACK-INBOUND-${runId}`
    ) {
      throw new Error(
        `/admin/reconciliation/orders/:allocationId tracking should refresh from canonical Shopify state: ${JSON.stringify(reconciledTrackingDetail)}`,
      );
    }

    if (prisma) {
      await prisma.refundRecord.update({
        where: { id: `refund-yalispor-rf-${runId}` },
        data: { status: 'failed' },
      });
      await prisma.financeLedgerEntry.deleteMany({
        where: { id: `fin-yalispor-refund-rf-${runId}` },
      });
      await prisma.financeLedgerEntry.deleteMany({
        where: { id: `fin-yalispor-sale-${smokeOrderId}` },
      });
    }

    const reconcileOrderResponse = await fetch(`${baseUrl}/admin/reconciliation/shopify-order/${smokeOrderId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (reconcileOrderResponse.status !== 200) {
      throw new Error(`/admin/reconciliation/shopify-order/:shopifyOrderId expected 200, got ${reconcileOrderResponse.status}`);
    }
    const reconcileOrderJson = await reconcileOrderResponse.json();
    if (
      !['repaired', 'needs_attention'].includes(reconcileOrderJson?.reconciliationStatus) ||
      !reconcileOrderJson.repairedFields?.some((field) => field.field === 'refund.status') ||
      !reconcileOrderJson.repairedFields?.some((field) => field.field === 'financeLedgerEntry') ||
      !reconcileOrderJson.repairedFields?.some((field) => field.field === 'saleFinanceLedgerEntry')
    ) {
      throw new Error(
        `/admin/reconciliation/shopify-order/:shopifyOrderId should repair refund state and missing sale/refund ledger: ${JSON.stringify(reconcileOrderJson)}`,
      );
    }

    const vendorReconcileResponse = await fetch(`${baseUrl}/admin/reconciliation/orders/alloc-yalispor-${smokeOrderId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vendorToken}`,
      },
    });
    if (vendorReconcileResponse.status !== 403) {
      throw new Error(`/admin/reconciliation/orders/:allocationId vendor forbidden expected 403, got ${vendorReconcileResponse.status}`);
    }

    const invalidFulfillmentWebhookResponse = await fetch(`${baseUrl}/webhooks/shopify/fulfillments-update`, {
      method: 'POST',
      headers: {
        ...fulfillmentWebhookHeaders,
        'x-shopify-topic': 'fulfillments/update',
        'x-shopify-hmac-sha256': 'invalid-signature',
        'x-shopify-webhook-id': `smoke-fulfillment-invalid-${runId}`,
      },
      body: fulfillmentWebhookPayload,
    });
    if (invalidFulfillmentWebhookResponse.status !== 401) {
      throw new Error(
        `/webhooks/shopify/fulfillments-update invalid signature expected 401, got ${invalidFulfillmentWebhookResponse.status}`,
      );
    }

    const vendorCrossTrackingResponse = await fetch(
      `${baseUrl}/fulfillments/${ingestedSporjinalAllocation.id}/tracking`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${vendorToken}`,
          'X-Vendor-Id': 'yalispor',
        },
        body: JSON.stringify({
          trackingNumber: 'TRACK-CROSS-FAIL',
          carrier: 'Yurtiçi Kargo',
        }),
      },
    );
    if (vendorCrossTrackingResponse.status !== 403) {
      throw new Error(
        `/fulfillments/:allocationId/tracking cross-vendor expected 403, got ${vendorCrossTrackingResponse.status}`,
      );
    }

    const adminTrackingUpdateResponse = await fetch(
      `${baseUrl}/fulfillments/${ingestedSporjinalAllocation.id}/tracking`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'X-Vendor-Id': 'sporjinal',
        },
        body: JSON.stringify({
          trackingNumber: 'TRACK-SPORJINAL-9001',
          carrier: 'MNG Kargo',
          notifyCustomer: true,
        }),
      },
    );
    if (!adminTrackingUpdateResponse.ok) {
      throw new Error(
        `/fulfillments/:allocationId/tracking admin update failed with ${adminTrackingUpdateResponse.status}`,
      );
    }
    const adminTrackingUpdateJson = await adminTrackingUpdateResponse.json();
    if (
      adminTrackingUpdateJson?.trackingNumber !== 'TRACK-SPORJINAL-9001' ||
      adminTrackingUpdateJson?.carrier !== 'MNG Kargo'
    ) {
      throw new Error(
        `/fulfillments/:allocationId/tracking admin response invalid: ${JSON.stringify(adminTrackingUpdateJson)}`,
      );
    }

    const invalidTrackingResponse = await fetch(`${baseUrl}/fulfillments/${ingestedYalisporAllocation.id}/tracking`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
      body: JSON.stringify({
        trackingNumber: '',
        carrier: 'Yurtiçi Kargo',
      }),
    });
    if (invalidTrackingResponse.status !== 400) {
      throw new Error(
        `/fulfillments/:allocationId/tracking missing tracking number expected 400, got ${invalidTrackingResponse.status}`,
      );
    }

    const blockedAllocationTrackingResponse = await fetch(`${baseUrl}/fulfillments/alloc-yalispor-1001/tracking`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
      body: JSON.stringify({
        trackingNumber: 'TRACK-BLOCKED-1001',
        carrier: 'Yurtiçi Kargo',
      }),
    });
    if (blockedAllocationTrackingResponse.status !== 409) {
      throw new Error(
        `/fulfillments/:allocationId/tracking blocked allocation expected 409, got ${blockedAllocationTrackingResponse.status}`,
      );
    }

    const vendorOrdersYaliResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!vendorOrdersYaliResponse.ok) {
      throw new Error(`/orders vendor yalispor failed with ${vendorOrdersYaliResponse.status}`);
    }
    const vendorOrdersYali = await vendorOrdersYaliResponse.json();
    if (!Array.isArray(vendorOrdersYali) || vendorOrdersYali.length === 0) {
      throw new Error('/orders vendor yalispor returned empty or invalid payload.');
    }

    const vendorTrackingUpdateResponse = await fetch(
      `${baseUrl}/fulfillments/${ingestedYalisporAllocation.id}/tracking`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${vendorToken}`,
          'X-Vendor-Id': 'yalispor',
        },
        body: JSON.stringify({
          trackingNumber: 'TRACK-YALI-9001',
          carrier: 'Yurtiçi Kargo',
          trackingUrl: 'https://tracking.example/TRACK-YALI-9001',
          notifyCustomer: true,
        }),
      },
    );
    if (!vendorTrackingUpdateResponse.ok) {
      throw new Error(
        `/fulfillments/:allocationId/tracking vendor own update failed with ${vendorTrackingUpdateResponse.status}`,
      );
    }
    const vendorTrackingUpdateJson = await vendorTrackingUpdateResponse.json();
    if (
      vendorTrackingUpdateJson?.fulfillmentStatus !== 'fulfillment_submitted' ||
      vendorTrackingUpdateJson?.shippingStatus !== 'shipped'
    ) {
      throw new Error(
        `/fulfillments/:allocationId/tracking vendor own response invalid: ${JSON.stringify(vendorTrackingUpdateJson)}`,
      );
    }

    const updatedVendorOrderResponse = await fetch(`${baseUrl}/orders/${ingestedYalisporAllocation.id}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!updatedVendorOrderResponse.ok) {
      throw new Error(
        `/orders/:orderId vendor updated allocation read failed with ${updatedVendorOrderResponse.status}`,
      );
    }
    const updatedVendorOrderJson = await updatedVendorOrderResponse.json();
    if (
      updatedVendorOrderJson?.trackingNumber !== 'TRACK-YALI-9001' ||
      updatedVendorOrderJson?.carrier !== 'Yurtiçi Kargo' ||
      updatedVendorOrderJson?.fulfillmentStatus !== 'fulfillment_submitted'
    ) {
      throw new Error('/orders/:orderId vendor updated allocation did not persist tracking fields.');
    }

    const vendorOrdersForbiddenResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (vendorOrdersForbiddenResponse.status !== 403) {
      throw new Error(`/orders vendor forbidden expected 403, got ${vendorOrdersForbiddenResponse.status}`);
    }

    const ownOrderId = vendorOrdersYali[0]?.id;
    if (!ownOrderId) {
      throw new Error('Unable to resolve vendor-owning orderId from /orders payload.');
    }
    const ownOrderResponse = await fetch(`${baseUrl}/orders/${ownOrderId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!ownOrderResponse.ok) {
      throw new Error(`/orders/:orderId vendor own access failed with ${ownOrderResponse.status}`);
    }

    const nonOwnedOrderId = adminOrdersSporjinal[0]?.id;
    if (!nonOwnedOrderId) {
      throw new Error('Unable to resolve cross-vendor orderId from admin /orders payload.');
    }
    const nonOwnedOrderResponse = await fetch(`${baseUrl}/orders/${nonOwnedOrderId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (nonOwnedOrderResponse.status !== 404) {
      throw new Error(`/orders/:orderId cross-vendor expected 404, got ${nonOwnedOrderResponse.status}`);
    }

    const adminReturnsYaliResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!adminReturnsYaliResponse.ok) {
      throw new Error(`/returns admin yalispor failed with ${adminReturnsYaliResponse.status}`);
    }
    const adminReturnsYali = await adminReturnsYaliResponse.json();
    if (!Array.isArray(adminReturnsYali) || adminReturnsYali.length === 0) {
      throw new Error('/returns admin yalispor returned empty or invalid payload.');
    }
    if (!adminReturnsYali.some((record) => record.sourceShopifyRefundId === `rf-${runId}`)) {
      throw new Error('/returns admin yalispor did not include ingested Shopify refund allocation.');
    }

    const adminReturnsSporjinalResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!adminReturnsSporjinalResponse.ok) {
      throw new Error(`/returns admin sporjinal failed with ${adminReturnsSporjinalResponse.status}`);
    }
    const adminReturnsSporjinal = await adminReturnsSporjinalResponse.json();
    if (!Array.isArray(adminReturnsSporjinal) || adminReturnsSporjinal.length === 0) {
      throw new Error('/returns admin sporjinal returned empty or invalid payload.');
    }
    if (!adminReturnsSporjinal.some((record) => record.sourceShopifyRefundId === `rf-${runId}`)) {
      throw new Error('/returns admin sporjinal did not include ingested Shopify refund allocation.');
    }

    const vendorReturnsYaliResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!vendorReturnsYaliResponse.ok) {
      throw new Error(`/returns vendor yalispor failed with ${vendorReturnsYaliResponse.status}`);
    }
    const vendorReturnsYali = await vendorReturnsYaliResponse.json();
    if (!Array.isArray(vendorReturnsYali) || vendorReturnsYali.length === 0) {
      throw new Error('/returns vendor yalispor returned empty or invalid payload.');
    }
    const yalisporReturnRequest = vendorReturnsYali.find(
      (record) => record.sourceShopifyReturnId === '777001' && record.returnRequestSource === 'shopify_return_request',
    );
    if (!yalisporReturnRequest?.id) {
      throw new Error('/returns vendor yalispor did not include pending Shopify return request 777001.');
    }
    if (
      yalisporReturnRequest.refundedItemCount !== 1 ||
      !Array.isArray(yalisporReturnRequest.refundedSkus) ||
      yalisporReturnRequest.refundedSkus.length !== 1 ||
      yalisporReturnRequest.refundedSkus[0] !== 'DH2987-100-41'
    ) {
      throw new Error(
        `/returns vendor yalispor return request should expose exactly one returned SKU, got ${JSON.stringify(yalisporReturnRequest)}`,
      );
    }

    const vendorReturnsForbiddenResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (vendorReturnsForbiddenResponse.status !== 403) {
      throw new Error(`/returns vendor forbidden expected 403, got ${vendorReturnsForbiddenResponse.status}`);
    }

    const ownReturnId = vendorReturnsYali[0]?.id;
    if (!ownReturnId) {
      throw new Error('Unable to resolve vendor-owning returnId from /returns payload.');
    }
    const ownReturnResponse = await fetch(`${baseUrl}/returns/${ownReturnId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!ownReturnResponse.ok) {
      throw new Error(`/returns/:returnId vendor own access failed with ${ownReturnResponse.status}`);
    }
    const yalisporReturnRequestDetailResponse = await fetch(`${baseUrl}/returns/${yalisporReturnRequest.id}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!yalisporReturnRequestDetailResponse.ok) {
      throw new Error(
        `/returns/:returnId yalispor return request detail failed with ${yalisporReturnRequestDetailResponse.status}`,
      );
    }
    const yalisporReturnRequestDetail = await yalisporReturnRequestDetailResponse.json();
    if (
      !Array.isArray(yalisporReturnRequestDetail.refundedItems) ||
      yalisporReturnRequestDetail.refundedItems.length !== 1 ||
      yalisporReturnRequestDetail.refundedItems[0]?.sku !== 'DH2987-100-41'
    ) {
      throw new Error(
        `/returns/:returnId yalispor request detail should include exactly one returned line item, got ${JSON.stringify(yalisporReturnRequestDetail)}`,
      );
    }
    if (
      yalisporReturnRequestDetail.refundedItems.some((item) => item.sku === 'YALI-NOT-RETURNED-42')
    ) {
      throw new Error('/returns/:returnId yalispor request detail leaked a non-returned same-vendor line item.');
    }

    const sporjinalReturnRequest = adminReturnsSporjinal.find(
      (record) => record.sourceShopifyReturnId === '777001' && record.returnRequestSource === 'shopify_return_request',
    );
    if (!sporjinalReturnRequest?.id) {
      throw new Error('/returns admin sporjinal did not include pending Shopify return request 777001.');
    }
    const sporjinalReturnRequestDetailResponse = await fetch(`${baseUrl}/returns/${sporjinalReturnRequest.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!sporjinalReturnRequestDetailResponse.ok) {
      throw new Error(
        `/returns/:returnId sporjinal return request detail failed with ${sporjinalReturnRequestDetailResponse.status}`,
      );
    }
    const sporjinalReturnRequestDetail = await sporjinalReturnRequestDetailResponse.json();
    if (
      !Array.isArray(sporjinalReturnRequestDetail.refundedItems) ||
      sporjinalReturnRequestDetail.refundedItems.length !== 1 ||
      sporjinalReturnRequestDetail.refundedItems[0]?.sku !== 'DH2987-100-40,5'
    ) {
      throw new Error(
        `/returns/:returnId sporjinal request detail should include exactly one returned line item, got ${JSON.stringify(sporjinalReturnRequestDetail)}`,
      );
    }

    const wrongVendorReturnRequestResponse = await fetch(`${baseUrl}/returns/${yalisporReturnRequest.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (wrongVendorReturnRequestResponse.status !== 404) {
      throw new Error(
        `/returns/:returnId wrong vendor return request expected 404, got ${wrongVendorReturnRequestResponse.status}`,
      );
    }

    const nonOwnedReturnId = adminReturnsSporjinal[0]?.id;
    if (!nonOwnedReturnId) {
      throw new Error('Unable to resolve cross-vendor returnId from admin /returns payload.');
    }
    const nonOwnedReturnResponse = await fetch(`${baseUrl}/returns/${nonOwnedReturnId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (nonOwnedReturnResponse.status !== 404) {
      throw new Error(`/returns/:returnId cross-vendor expected 404, got ${nonOwnedReturnResponse.status}`);
    }

    const adminFinanceYaliResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!adminFinanceYaliResponse.ok) {
      throw new Error(`/finance admin yalispor failed with ${adminFinanceYaliResponse.status}`);
    }
    const adminFinanceYali = await adminFinanceYaliResponse.json();
    if (!adminFinanceYali?.summary || !Array.isArray(adminFinanceYali?.records)) {
      throw new Error('/finance admin yalispor returned invalid shape.');
    }
    if (!adminFinanceYali.records.some((record) => record.id === `fin-yalispor-sale-${smokeOrderId}` && record.type === 'sale')) {
      throw new Error('/finance admin yalispor missing ingested order sale ledger row.');
    }

    const adminFinanceSporjinalResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!adminFinanceSporjinalResponse.ok) {
      throw new Error(`/finance admin sporjinal failed with ${adminFinanceSporjinalResponse.status}`);
    }
    const adminFinanceSporjinal = await adminFinanceSporjinalResponse.json();
    if (!adminFinanceSporjinal?.summary || !Array.isArray(adminFinanceSporjinal?.records)) {
      throw new Error('/finance admin sporjinal returned invalid shape.');
    }

    const vendorFinanceYaliResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!vendorFinanceYaliResponse.ok) {
      throw new Error(`/finance vendor yalispor failed with ${vendorFinanceYaliResponse.status}`);
    }
    const vendorFinanceYali = await vendorFinanceYaliResponse.json();
    if (!vendorFinanceYali?.summary || !Array.isArray(vendorFinanceYali?.records)) {
      throw new Error('/finance vendor yalispor returned invalid shape.');
    }

    const vendorFinanceForbiddenResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (vendorFinanceForbiddenResponse.status !== 403) {
      throw new Error(`/finance vendor forbidden expected 403, got ${vendorFinanceForbiddenResponse.status}`);
    }

    const adminAutomationYaliResponse = await fetch(`${baseUrl}/automation`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!adminAutomationYaliResponse.ok) {
      throw new Error(`/automation admin yalispor failed with ${adminAutomationYaliResponse.status}`);
    }
    const adminAutomationYali = await adminAutomationYaliResponse.json();
    if (!Array.isArray(adminAutomationYali?.alerts) || !Array.isArray(adminAutomationYali?.suggestions)) {
      throw new Error('/automation admin yalispor returned invalid shape.');
    }

    const vendorAutomationYaliResponse = await fetch(`${baseUrl}/automation`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!vendorAutomationYaliResponse.ok) {
      throw new Error(`/automation vendor yalispor failed with ${vendorAutomationYaliResponse.status}`);
    }
    const vendorAutomationYali = await vendorAutomationYaliResponse.json();
    if (!Array.isArray(vendorAutomationYali?.alerts) || !Array.isArray(vendorAutomationYali?.suggestions)) {
      throw new Error('/automation vendor yalispor returned invalid shape.');
    }

    const vendorAutomationForbiddenResponse = await fetch(`${baseUrl}/automation`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (vendorAutomationForbiddenResponse.status !== 403) {
      throw new Error(`/automation vendor forbidden expected 403, got ${vendorAutomationForbiddenResponse.status}`);
    }

    const adminOperationsResponse = await fetch(`${baseUrl}/admin/operations`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!adminOperationsResponse.ok) {
      throw new Error(`/admin/operations admin failed with ${adminOperationsResponse.status}`);
    }
    const adminOperations = await adminOperationsResponse.json();
    if (!adminOperations?.summary || !Array.isArray(adminOperations?.items)) {
      throw new Error('/admin/operations returned invalid shape.');
    }
    const hasBlockedOrPending = adminOperations.items.some(
      (item) => item?.type === 'pending_reassignment' || item?.type === 'vendor_blocked',
    );
    if (!hasBlockedOrPending) {
      throw new Error('/admin/operations missing pending_reassignment/vendor_blocked item.');
    }

    const vendorOperationsResponse = await fetch(`${baseUrl}/admin/operations`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
      },
    });
    if (vendorOperationsResponse.status !== 403) {
      throw new Error(`/admin/operations vendor forbidden expected 403, got ${vendorOperationsResponse.status}`);
    }

    const adminWebhookDiagnosticsResponse = await fetch(`${baseUrl}/admin/diagnostics/webhooks`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!adminWebhookDiagnosticsResponse.ok) {
      throw new Error(
        `/admin/diagnostics/webhooks admin failed with ${adminWebhookDiagnosticsResponse.status}`,
      );
    }
    const adminWebhookDiagnostics = await adminWebhookDiagnosticsResponse.json();
    if (!adminWebhookDiagnostics?.summary || !Array.isArray(adminWebhookDiagnostics?.events)) {
      throw new Error('/admin/diagnostics/webhooks returned invalid shape.');
    }
    const recoverableReceivedEvent =
      adminWebhookDiagnostics.events.find((event) => event?.id === recoverableReceivedEventId) ??
      adminWebhookDiagnostics.events.find((event) => event?.status === 'RECEIVED' && event?.payloadAvailable === true);
    if (!recoverableReceivedEvent) {
      throw new Error('/admin/diagnostics/webhooks missing recoverable RECEIVED event with payload.');
    }
    const processedWebhookEvent = adminWebhookDiagnostics.events.find((event) => event?.status === 'PROCESSED');
    if (!processedWebhookEvent) {
      throw new Error('/admin/diagnostics/webhooks missing processed webhook event.');
    }
    const firstOrderWebhookEvent = adminWebhookDiagnostics.events.find((event) => event?.shopifyWebhookId === uniqueWebhookId);
    if (!firstOrderWebhookEvent) {
      throw new Error('/admin/diagnostics/webhooks missing first accepted orders/create event.');
    }
    if (!Array.isArray(firstOrderWebhookEvent.relatedJobs) || firstOrderWebhookEvent.relatedJobs.length !== 1) {
      throw new Error('/admin/diagnostics/webhooks expected one operational job for first accepted orders/create event.');
    }
    if (firstOrderWebhookEvent.relatedJobs[0]?.status !== 'completed') {
      throw new Error(
        `/admin/diagnostics/webhooks expected completed operational job, got ${JSON.stringify(firstOrderWebhookEvent.relatedJobs[0])}`,
      );
    }
    if (prisma) {
      const firstOrderJobCount = await prisma.operationalJob.count({
        where: {
          webhookEventId: firstOrderWebhookEvent.id,
        },
      });
      if (firstOrderJobCount !== 1) {
        throw new Error(`/operational-jobs duplicate delivery expected one job, got ${firstOrderJobCount}`);
      }
    }
    const completedJobRetryResponse = await fetch(
      `${baseUrl}/admin/diagnostics/jobs/${firstOrderWebhookEvent.relatedJobs[0].id}/retry`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (completedJobRetryResponse.status !== 409) {
      throw new Error(
        `/admin/diagnostics/jobs/:operationalJobId/retry completed job expected 409, got ${completedJobRetryResponse.status}`,
      );
    }
    const failedWebhookEvent = adminWebhookDiagnostics.events.find(
      (event) => event?.status === 'FAILED' && event?.payloadAvailable === true,
    );
    if (!failedWebhookEvent) {
      throw new Error('/admin/diagnostics/webhooks missing failed webhook event.');
    }
    if (!adminWebhookDiagnostics.events.some((event) => typeof event?.payloadAvailable === 'boolean')) {
      throw new Error('/admin/diagnostics/webhooks missing payload availability flag.');
    }

    const adminWebhookDiagnosticsDetailResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${processedWebhookEvent.id}`,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (!adminWebhookDiagnosticsDetailResponse.ok) {
      throw new Error(
        `/admin/diagnostics/webhooks/:webhookEventId admin failed with ${adminWebhookDiagnosticsDetailResponse.status}`,
      );
    }
    const adminWebhookDiagnosticsDetail = await adminWebhookDiagnosticsDetailResponse.json();
    if (
      adminWebhookDiagnosticsDetail?.id !== processedWebhookEvent.id ||
      typeof adminWebhookDiagnosticsDetail?.payloadHash !== 'string' ||
      typeof adminWebhookDiagnosticsDetail?.payloadAvailable !== 'boolean' ||
      typeof adminWebhookDiagnosticsDetail?.replayEligible !== 'boolean' ||
      typeof adminWebhookDiagnosticsDetail?.recoverEligible !== 'boolean' ||
      !Array.isArray(adminWebhookDiagnosticsDetail?.relatedJobs) ||
      adminWebhookDiagnosticsDetail?.rawPayload !== undefined
    ) {
      throw new Error('/admin/diagnostics/webhooks/:webhookEventId returned invalid shape.');
    }
    const vendorWebhookDiagnosticsDetailResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${processedWebhookEvent.id}`,
      {
        headers: {
          Authorization: `Bearer ${vendorToken}`,
        },
      },
    );
    if (vendorWebhookDiagnosticsDetailResponse.status !== 403) {
      throw new Error(
        `/admin/diagnostics/webhooks/:webhookEventId vendor forbidden expected 403, got ${vendorWebhookDiagnosticsDetailResponse.status}`,
      );
    }

    const adminSyncEventsResponse = await fetch(`${baseUrl}/admin/diagnostics/sync-events`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!adminSyncEventsResponse.ok) {
      throw new Error(
        `/admin/diagnostics/sync-events admin failed with ${adminSyncEventsResponse.status}`,
      );
    }
    const adminSyncEvents = await adminSyncEventsResponse.json();
    if (!Array.isArray(adminSyncEvents?.items)) {
      throw new Error('/admin/diagnostics/sync-events returned invalid shape.');
    }
    const hasFailureSyncEvent = adminSyncEvents.items.some(
      (item) => item?.type === 'webhook_ingestion_failure' || item?.type === 'fulfillment_sync_failed',
    );
    if (!hasFailureSyncEvent) {
      throw new Error('/admin/diagnostics/sync-events missing expected failure diagnostics item.');
    }

    const adminReconciliationResponse = await fetch(`${baseUrl}/admin/diagnostics/reconciliation`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!adminReconciliationResponse.ok) {
      throw new Error(
        `/admin/diagnostics/reconciliation admin failed with ${adminReconciliationResponse.status}`,
      );
    }
    const adminReconciliation = await adminReconciliationResponse.json();
    if (!adminReconciliation?.summary || !Array.isArray(adminReconciliation?.items)) {
      throw new Error('/admin/diagnostics/reconciliation returned invalid shape.');
    }
    if (!adminReconciliation.items.some((item) => item?.type === 'missing_payload')) {
      throw new Error('/admin/diagnostics/reconciliation missing missing_payload recovery item.');
    }

    const vendorWebhookDiagnosticsResponse = await fetch(`${baseUrl}/admin/diagnostics/webhooks`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
      },
    });
    if (vendorWebhookDiagnosticsResponse.status !== 403) {
      throw new Error(
        `/admin/diagnostics/webhooks vendor forbidden expected 403, got ${vendorWebhookDiagnosticsResponse.status}`,
      );
    }

    const vendorSyncEventsResponse = await fetch(`${baseUrl}/admin/diagnostics/sync-events`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
      },
    });
    if (vendorSyncEventsResponse.status !== 403) {
      throw new Error(
        `/admin/diagnostics/sync-events vendor forbidden expected 403, got ${vendorSyncEventsResponse.status}`,
      );
    }

    const vendorReconciliationResponse = await fetch(`${baseUrl}/admin/diagnostics/reconciliation`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
      },
    });
    if (vendorReconciliationResponse.status !== 403) {
      throw new Error(
        `/admin/diagnostics/reconciliation vendor forbidden expected 403, got ${vendorReconciliationResponse.status}`,
      );
    }

    const missingPayloadReplayResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${legacyMissingPayloadEventId}/replay`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (missingPayloadReplayResponse.status !== 409) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/replay missing payload expected 409, got ${missingPayloadReplayResponse.status}`,
      );
    }
    const missingPayloadReplayJson = await missingPayloadReplayResponse.json();
    if (
      missingPayloadReplayJson?.skippedReason !== 'Webhook payload is not available for replay.' ||
      missingPayloadReplayJson?.replayStatus !== 'not_replayable'
    ) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/replay missing payload returned unexpected result: ${JSON.stringify(missingPayloadReplayJson)}`,
      );
    }

    const failedReplayResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${failedWebhookEvent.id}/replay`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (failedReplayResponse.status !== 202) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/replay failed event expected 202, got ${failedReplayResponse.status}`,
      );
    }
    const failedReplayJson = await failedReplayResponse.json();
    if (
      failedReplayJson?.ok !== true ||
      failedReplayJson?.webhookEventId !== failedWebhookEvent.id ||
      typeof failedReplayJson?.beforeStatus !== 'string' ||
      typeof failedReplayJson?.afterStatus !== 'string' ||
      typeof failedReplayJson?.replayStatus !== 'string' ||
      typeof failedReplayJson?.action !== 'string' ||
      typeof failedReplayJson?.processingStatus !== 'string'
    ) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/replay failed event returned invalid payload: ${JSON.stringify(failedReplayJson)}`,
      );
    }

    const vendorReplayResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${failedWebhookEvent.id}/replay`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vendorToken}`,
        },
      },
    );
    if (vendorReplayResponse.status !== 403) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/replay vendor forbidden expected 403, got ${vendorReplayResponse.status}`,
      );
    }

    const missingReplayIdResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/does-not-exist/replay`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (missingReplayIdResponse.status !== 404) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/replay missing event expected 404, got ${missingReplayIdResponse.status}`,
      );
    }

    const recoverReceivedResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${recoverableReceivedEvent.id}/recover`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (recoverReceivedResponse.status !== 202) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover received event expected 202, got ${recoverReceivedResponse.status}`,
      );
    }
    const recoverReceivedJson = await recoverReceivedResponse.json();
    if (
      recoverReceivedJson?.ok !== true ||
      typeof recoverReceivedJson?.recoveryStatus !== 'string' ||
      typeof recoverReceivedJson?.processingStatus !== 'string'
    ) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover received event returned invalid payload: ${JSON.stringify(recoverReceivedJson)}`,
      );
    }

    const recoverReceivedAgainResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${recoverableReceivedEvent.id}/recover`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (recoverReceivedAgainResponse.status !== 409) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover processed event expected 409, got ${recoverReceivedAgainResponse.status}`,
      );
    }
    const recoverReceivedAgainJson = await recoverReceivedAgainResponse.json();
    if (
      recoverReceivedAgainJson?.skippedReason !== 'Processed webhook events are not recoverable.' ||
      recoverReceivedAgainJson?.recoveryStatus !== 'not_recoverable'
    ) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover processed event returned unexpected result: ${JSON.stringify(recoverReceivedAgainJson)}`,
      );
    }

    const recoverMissingPayloadResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${legacyMissingPayloadEventId}/recover`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (recoverMissingPayloadResponse.status !== 409) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover missing payload expected 409, got ${recoverMissingPayloadResponse.status}`,
      );
    }
    const recoverMissingPayloadJson = await recoverMissingPayloadResponse.json();
    if (recoverMissingPayloadJson?.skippedReason !== 'Webhook payload is not available for replay.') {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover missing payload returned unexpected result: ${JSON.stringify(recoverMissingPayloadJson)}`,
      );
    }

    const recoverFailedResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${failedWebhookEvent.id}/recover`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    if (recoverFailedResponse.status !== 202) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover failed event expected 202, got ${recoverFailedResponse.status}`,
      );
    }
    const recoverFailedJson = await recoverFailedResponse.json();
    if (
      recoverFailedJson?.ok !== true ||
      recoverFailedJson?.webhookEventId !== failedWebhookEvent.id ||
      typeof recoverFailedJson?.beforeStatus !== 'string' ||
      typeof recoverFailedJson?.afterStatus !== 'string' ||
      typeof recoverFailedJson?.recoveryStatus !== 'string' ||
      typeof recoverFailedJson?.processingStatus !== 'string'
    ) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover failed event returned invalid payload: ${JSON.stringify(recoverFailedJson)}`,
      );
    }

    const vendorRecoverResponse = await fetch(
      `${baseUrl}/admin/diagnostics/webhooks/${failedWebhookEvent.id}/recover`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vendorToken}`,
        },
      },
    );
    if (vendorRecoverResponse.status !== 403) {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/recover vendor forbidden expected 403, got ${vendorRecoverResponse.status}`,
      );
    }

    const adminOrderBreakdownResponse = await fetch(`${baseUrl}/admin/orders/1001`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!adminOrderBreakdownResponse.ok) {
      throw new Error(`/admin/orders/:shopifyOrderId admin failed with ${adminOrderBreakdownResponse.status}`);
    }
    const adminOrderBreakdown = await adminOrderBreakdownResponse.json();
    if (!adminOrderBreakdown?.order || !Array.isArray(adminOrderBreakdown?.allocations)) {
      throw new Error('/admin/orders/:shopifyOrderId returned invalid shape.');
    }
    if (adminOrderBreakdown.allocations.length < 2) {
      throw new Error('/admin/orders/:shopifyOrderId expected at least two allocations.');
    }
    const seededAllocationVendorIds = new Set(adminOrderBreakdown.allocations.map((allocation) => allocation.vendorId));
    if (!seededAllocationVendorIds.has('yalispor') || !seededAllocationVendorIds.has('sporjinal')) {
      throw new Error('/admin/orders/:shopifyOrderId missing expected yalispor/sporjinal allocations.');
    }

    const vendorOrderBreakdownResponse = await fetch(`${baseUrl}/admin/orders/1001`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
      },
    });
    if (vendorOrderBreakdownResponse.status !== 403) {
      throw new Error(
        `/admin/orders/:shopifyOrderId vendor forbidden expected 403, got ${vendorOrderBreakdownResponse.status}`,
      );
    }

    const adminOrderMissingResponse = await fetch(`${baseUrl}/admin/orders/does-not-exist`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (adminOrderMissingResponse.status !== 404) {
      throw new Error(`/admin/orders/:shopifyOrderId missing expected 404, got ${adminOrderMissingResponse.status}`);
    }
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(5000),
    ]);
    if (prisma) {
      await prisma.$disconnect();
    }
  }

  if (child.exitCode && child.exitCode !== 0) {
    throw new Error(
      `Backend process exited with code ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  console.log('Backend smoke check passed.');
}

runSmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
