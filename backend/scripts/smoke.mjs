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
const backendEnv = loadEnvFile(path.join(process.cwd(), '.env'));
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
  const sellerInfoMap = JSON.stringify({
    '9001': {
      'DH2987-100-41': 'yalispor',
      'DH2987-100-40,5': 'sporjinal',
    },
    '9002': {
      'DH2987-100-41': 'yalispor',
    },
  });
  const mockReturnDetails = JSON.stringify({
    'gid://shopify/Return/777001': {
      orderGid: 'gid://shopify/Order/9001',
      lineItems: [
        {
          returnLineItemGid: `gid://shopify/ReturnLineItem/rli-a-${runId}`,
          fulfillmentLineItemGid: `gid://shopify/FulfillmentLineItem/fli-a-${runId}`,
          lineItemGid: `gid://shopify/LineItem/li-a-${runId}`,
          sku: 'DH2987-100-41',
        },
      ],
    },
  });
  const mockFulfillmentOrders = JSON.stringify({
    '9001': [
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
  });
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
      SHOPIFY_RETURN_WEBHOOK_SECRET: shopifyReturnWebhookSecret,
      SHOPIFY_MOCK_SELLER_INFO: sellerInfoMap,
      SHOPIFY_MOCK_RETURN_DETAILS: mockReturnDetails,
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
      id: 9001,
      order_number: 9001,
      name: '#9001',
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

    const ingestedOrderBreakdownResponse = await fetch(`${baseUrl}/admin/orders/9001`, {
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
      throw new Error(`/admin/orders/9001 after ingestion failed with ${ingestedOrderBreakdownResponse.status}`);
    }
    const ingestedOrderBreakdownJson = await ingestedOrderBreakdownResponse.json();
    if (!Array.isArray(ingestedOrderBreakdownJson?.allocations) || ingestedOrderBreakdownJson.allocations.length !== 2) {
      throw new Error(`/admin/orders/9001 expected two allocations, got ${JSON.stringify(ingestedOrderBreakdownJson)}`);
    }
    const allocationVendorIds = new Set(ingestedOrderBreakdownJson.allocations.map((allocation) => allocation.vendorId));
    if (!allocationVendorIds.has('yalispor') || !allocationVendorIds.has('sporjinal')) {
      throw new Error(`/admin/orders/9001 missing expected vendor allocations: ${JSON.stringify(ingestedOrderBreakdownJson)}`);
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
        id: 9001,
        admin_graphql_api_id: 'gid://shopify/Order/9001',
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
    if (!adminOrdersYali.some((order) => order.sourceShopifyOrderId === '9001' && order.vendorId === 'yalispor')) {
      throw new Error('/orders admin yalispor did not include ingested Shopify order 9001 allocation.');
    }
    const ingestedYalisporAllocation = adminOrdersYali.find((order) => order.sourceShopifyOrderId === '9001');
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
    if (!Array.isArray(adminOrdersSporjinal) || !adminOrdersSporjinal.some((order) => order.sourceShopifyOrderId === '9001' && order.vendorId === 'sporjinal')) {
      throw new Error('/orders admin sporjinal did not include ingested Shopify order 9001 allocation.');
    }
    const ingestedSporjinalAllocation = adminOrdersSporjinal.find((order) => order.sourceShopifyOrderId === '9001');
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
      order_id: 9001,
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
      order_id: 9001,
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
    const processedWebhookEvent = adminWebhookDiagnostics.events.find((event) => event?.status === 'PROCESSED');
    if (!processedWebhookEvent) {
      throw new Error('/admin/diagnostics/webhooks missing processed webhook event.');
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
      typeof adminWebhookDiagnosticsDetail?.payloadAvailable !== 'boolean'
    ) {
      throw new Error('/admin/diagnostics/webhooks/:webhookEventId returned invalid shape.');
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
    if (missingPayloadReplayJson?.message !== 'Webhook payload is not available for replay') {
      throw new Error(
        `/admin/diagnostics/webhooks/:id/replay missing payload returned unexpected message: ${JSON.stringify(missingPayloadReplayJson)}`,
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
