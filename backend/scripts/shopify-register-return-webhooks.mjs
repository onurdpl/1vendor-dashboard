import path from 'node:path';
import {
  createShopifyGraphqlClient,
  getEnvValue,
  isValidShopDomain,
  loadEnvFile,
  printRegistrationSummary,
  registerWebhookTopics,
} from './shopify-webhook-registration-lib.mjs';

const backendDir = process.cwd();
const envFilePath = path.join(backendDir, '.env');
const exampleEnvFilePath = path.join(backendDir, '.env.example');

const topics = [
  { topic: 'RETURNS_REQUEST', routePath: '/webhooks/shopify/returns-request' },
  { topic: 'RETURNS_APPROVE', routePath: '/webhooks/shopify/returns-approve' },
  { topic: 'RETURNS_DECLINE', routePath: '/webhooks/shopify/returns-decline' },
  { topic: 'RETURNS_CLOSE', routePath: '/webhooks/shopify/returns-close' },
];

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function main() {
  const fallbackEnv = {
    ...loadEnvFile(exampleEnvFilePath),
    ...loadEnvFile(envFilePath),
  };

  const config = {
    SHOPIFY_REGISTER_RETURN_WEBHOOKS: getEnvValue('SHOPIFY_REGISTER_RETURN_WEBHOOKS', fallbackEnv),
    SHOPIFY_SHOP_DOMAIN: getEnvValue('SHOPIFY_SHOP_DOMAIN', fallbackEnv),
    SHOPIFY_ADMIN_ACCESS_TOKEN: getEnvValue('SHOPIFY_ADMIN_ACCESS_TOKEN', fallbackEnv),
    SHOPIFY_API_VERSION: getEnvValue('SHOPIFY_API_VERSION', fallbackEnv),
    SHOPIFY_RETURN_WEBHOOK_BASE_URL: getEnvValue('SHOPIFY_RETURN_WEBHOOK_BASE_URL', fallbackEnv).replace(/\/+$/, ''),
  };

  if (config.SHOPIFY_REGISTER_RETURN_WEBHOOKS !== 'true') {
    console.log('Shopify return webhook registration skipped (set SHOPIFY_REGISTER_RETURN_WEBHOOKS=true to enable).');
    return;
  }

  const missing = [];
  for (const key of [
    'SHOPIFY_SHOP_DOMAIN',
    'SHOPIFY_ADMIN_ACCESS_TOKEN',
    'SHOPIFY_API_VERSION',
    'SHOPIFY_RETURN_WEBHOOK_BASE_URL',
  ]) {
    if (!config[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required variables: ${missing.join(', ')}`);
  }

  if (!isValidShopDomain(config.SHOPIFY_SHOP_DOMAIN)) {
    throw new Error('Invalid SHOPIFY_SHOP_DOMAIN format.');
  }

  if (!/^\d{4}-\d{2}$/.test(config.SHOPIFY_API_VERSION)) {
    throw new Error('Invalid SHOPIFY_API_VERSION format. Expected YYYY-MM.');
  }

  if (!isValidHttpUrl(config.SHOPIFY_RETURN_WEBHOOK_BASE_URL)) {
    throw new Error('Invalid SHOPIFY_RETURN_WEBHOOK_BASE_URL. Expected http(s) URL.');
  }

  const client = createShopifyGraphqlClient({
    shopDomain: config.SHOPIFY_SHOP_DOMAIN,
    accessToken: config.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion: config.SHOPIFY_API_VERSION,
  });

  const summary = await registerWebhookTopics({
    client,
    topics,
    baseUrl: config.SHOPIFY_RETURN_WEBHOOK_BASE_URL,
  });

  printRegistrationSummary(summary);

  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
