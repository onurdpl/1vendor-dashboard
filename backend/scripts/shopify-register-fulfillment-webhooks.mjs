import fs from 'node:fs';
import path from 'node:path';

const backendDir = process.cwd();
const envFilePath = path.join(backendDir, '.env');
const exampleEnvFilePath = path.join(backendDir, '.env.example');

const topics = [
  { topic: 'FULFILLMENTS_CREATE', routePath: '/webhooks/shopify/fulfillments-create' },
  { topic: 'FULFILLMENTS_UPDATE', routePath: '/webhooks/shopify/fulfillments-update' },
  { topic: 'FULFILLMENT_EVENTS_CREATE', routePath: '/webhooks/shopify/fulfillment-events-create' },
  { topic: 'FULFILLMENT_ORDERS_CANCELLED', routePath: '/webhooks/shopify/fulfillment-orders-cancelled' },
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      acc[key] = rawValue.replace(/^['"]|['"]$/g, '');
      return acc;
    }, {});
}

function getEnvValue(key, fallbackEnv) {
  const runtimeValue = process.env[key];
  if (typeof runtimeValue === 'string' && runtimeValue.trim()) {
    return runtimeValue.trim();
  }

  const fallbackValue = fallbackEnv[key];
  return typeof fallbackValue === 'string' ? fallbackValue.trim() : '';
}

function isValidShopDomain(value) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value);
}

function isValidHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function registerWebhook(config, registration) {
  const callbackUrl = `${config.SHOPIFY_FULFILLMENT_WEBHOOK_BASE_URL}${registration.routePath}`;
  const response = await fetch(
    `https://${config.SHOPIFY_SHOP_DOMAIN}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': config.SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query: `
          mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
            webhookSubscriptionCreate(
              topic: $topic
              webhookSubscription: {
                callbackUrl: $callbackUrl
                format: JSON
              }
            ) {
              userErrors {
                field
                message
              }
              webhookSubscription {
                id
              }
            }
          }
        `,
        variables: {
          topic: registration.topic,
          callbackUrl,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Shopify webhook registration failed for ${registration.topic} with status ${response.status}.`);
  }

  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      `Shopify GraphQL errors for ${registration.topic}: ${payload.errors.map((error) => error.message).join('; ')}`,
    );
  }

  const result = payload.data?.webhookSubscriptionCreate;
  const userErrors = Array.isArray(result?.userErrors) ? result.userErrors : [];
  if (userErrors.length > 0) {
    throw new Error(
      `Shopify user errors for ${registration.topic}: ${userErrors.map((error) => error.message).join('; ')}`,
    );
  }

  const subscriptionId = result?.webhookSubscription?.id;
  if (!subscriptionId) {
    throw new Error(`Shopify did not return a webhook subscription id for ${registration.topic}.`);
  }

  return {
    topic: registration.topic,
    callbackUrl,
    subscriptionId,
  };
}

async function main() {
  const fallbackEnv = {
    ...loadEnvFile(exampleEnvFilePath),
    ...loadEnvFile(envFilePath),
  };

  const config = {
    SHOPIFY_REGISTER_FULFILLMENT_WEBHOOKS: getEnvValue('SHOPIFY_REGISTER_FULFILLMENT_WEBHOOKS', fallbackEnv),
    SHOPIFY_SHOP_DOMAIN: getEnvValue('SHOPIFY_SHOP_DOMAIN', fallbackEnv),
    SHOPIFY_ADMIN_ACCESS_TOKEN: getEnvValue('SHOPIFY_ADMIN_ACCESS_TOKEN', fallbackEnv),
    SHOPIFY_API_VERSION: getEnvValue('SHOPIFY_API_VERSION', fallbackEnv),
    SHOPIFY_FULFILLMENT_WEBHOOK_BASE_URL: getEnvValue(
      'SHOPIFY_FULFILLMENT_WEBHOOK_BASE_URL',
      fallbackEnv,
    ).replace(/\/+$/, ''),
  };

  if (config.SHOPIFY_REGISTER_FULFILLMENT_WEBHOOKS !== 'true') {
    console.log('Shopify fulfillment webhook registration skipped (set SHOPIFY_REGISTER_FULFILLMENT_WEBHOOKS=true to enable).');
    return;
  }

  const missing = [];
  for (const key of [
    'SHOPIFY_SHOP_DOMAIN',
    'SHOPIFY_ADMIN_ACCESS_TOKEN',
    'SHOPIFY_API_VERSION',
    'SHOPIFY_FULFILLMENT_WEBHOOK_BASE_URL',
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

  if (!isValidHttpsUrl(config.SHOPIFY_FULFILLMENT_WEBHOOK_BASE_URL)) {
    throw new Error('Invalid SHOPIFY_FULFILLMENT_WEBHOOK_BASE_URL. Expected HTTPS URL.');
  }

  for (const topic of topics) {
    const result = await registerWebhook(config, topic);
    console.log(`topic=${result.topic} callback=${result.callbackUrl} subscriptionId=${result.subscriptionId}`);
  }
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
