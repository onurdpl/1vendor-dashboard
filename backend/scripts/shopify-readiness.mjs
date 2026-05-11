import fs from 'node:fs';
import path from 'node:path';

const backendDir = process.cwd();
const envFilePath = path.join(backendDir, '.env');
const exampleEnvFilePath = path.join(backendDir, '.env.example');

const placeholderValues = new Set([
  '',
  'dev-shopify-webhook-secret',
  'your-shopify-shop-domain.myshopify.com',
  'your-shopify-admin-access-token',
  'changeme',
]);

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
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      acc[key] = value;
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

function maskResult(message) {
  process.stdout.write(`${message}\n`);
}

async function runLiveCheck(config) {
  const response = await fetch(`https://${config.SHOPIFY_SHOP_DOMAIN}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-access-token': config.SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      query: `
        query ShopifyReadiness {
          shop {
            name
            myshopifyDomain
          }
        }
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Shopify Admin API readiness check failed with status ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`Shopify Admin API readiness check returned GraphQL errors: ${payload.errors.map((error) => error.message).join('; ')}`);
  }

  const shop = payload.data?.shop;
  if (!shop?.name || !shop?.myshopifyDomain) {
    throw new Error('Shopify Admin API readiness check returned an incomplete shop payload.');
  }

  maskResult(`Shopify live API check passed for shop "${shop.name}" (${shop.myshopifyDomain}).`);
}

async function main() {
  const fallbackEnv = {
    ...loadEnvFile(exampleEnvFilePath),
    ...loadEnvFile(envFilePath),
  };

  const config = {
    SHOPIFY_SHOP_DOMAIN: getEnvValue('SHOPIFY_SHOP_DOMAIN', fallbackEnv),
    SHOPIFY_ADMIN_ACCESS_TOKEN: getEnvValue('SHOPIFY_ADMIN_ACCESS_TOKEN', fallbackEnv),
    SHOPIFY_WEBHOOK_SECRET: getEnvValue('SHOPIFY_WEBHOOK_SECRET', fallbackEnv),
    SHOPIFY_API_VERSION: getEnvValue('SHOPIFY_API_VERSION', fallbackEnv),
    SHOPIFY_READINESS_LIVE_CHECK: getEnvValue('SHOPIFY_READINESS_LIVE_CHECK', fallbackEnv),
  };

  const missingVariables = Object.entries(config)
    .filter(([key, value]) => key !== 'SHOPIFY_READINESS_LIVE_CHECK' && (!value || placeholderValues.has(value)))
    .map(([key]) => key);

  if (!config.SHOPIFY_SHOP_DOMAIN || !placeholderValues.has(config.SHOPIFY_SHOP_DOMAIN) && !isValidShopDomain(config.SHOPIFY_SHOP_DOMAIN)) {
    if (!missingVariables.includes('SHOPIFY_SHOP_DOMAIN')) {
      missingVariables.push('SHOPIFY_SHOP_DOMAIN');
    }
  }

  if (config.SHOPIFY_API_VERSION && !/^\d{4}-\d{2}$/.test(config.SHOPIFY_API_VERSION)) {
    throw new Error('SHOPIFY_API_VERSION must look like YYYY-MM.');
  }

  if (missingVariables.length > 0) {
    throw new Error(
      `Shopify live readiness failed. Configure these variables with non-placeholder values: ${missingVariables.sort().join(', ')}`,
    );
  }

  maskResult('Shopify readiness config check passed.');
  maskResult(`- Shop domain format: valid (${config.SHOPIFY_SHOP_DOMAIN})`);
  maskResult(`- API version format: valid (${config.SHOPIFY_API_VERSION})`);
  maskResult('- Required Shopify secrets are present.');

  if (config.SHOPIFY_READINESS_LIVE_CHECK === 'true') {
    await runLiveCheck(config);
    return;
  }

  maskResult('Live Shopify Admin API check skipped. Set SHOPIFY_READINESS_LIVE_CHECK=true to enable it.');
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
