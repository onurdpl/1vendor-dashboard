import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runShopifyOrderBackfill } from './order-backfill.service.js';

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return acc;
      }

      const index = trimmed.indexOf('=');
      if (index === -1) {
        return acc;
      }

      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function buildEnv() {
  const backendDir = process.cwd();
  const fallbackEnv = {
    ...loadEnvFile(path.join(backendDir, '.env.example')),
    ...loadEnvFile(path.join(backendDir, '.env')),
  };

  return {
    ...fallbackEnv,
    ...process.env,
  };
}

const result = await runShopifyOrderBackfill(buildEnv()).catch((error) => {
  console.error(error instanceof Error ? error.message : 'Shopify order backfill failed.');
  process.exitCode = 1;
  return null;
});

if (result) {
  console.log('Manual Shopify order backfill completed.');
  console.log(`Order: ${result.orderName}`);
  console.log(`Shopify order id: ${result.shopifyOrderId ?? 'unknown'}`);
  console.log(`Webhook id: ${result.webhookId ?? 'unknown'}`);
  console.log(`Eligible for live backfill: ${result.eligibleForLiveBackfill ? 'yes' : 'no'}`);
  console.log(`Live backfill attempted: ${result.liveBackfillAttempted ? 'yes' : 'no'}`);
  console.log(`Blocked reasons: ${result.blockedReasonCodes.length > 0 ? result.blockedReasonCodes.join(', ') : 'none'}`);
  console.log(`Missing fields: ${result.missingFields.length > 0 ? result.missingFields.join(', ') : 'none'}`);
  console.log(`Expected vendors: ${result.expectedVendors.length > 0 ? result.expectedVendors.join(', ') : 'none'}`);
  console.log(`Expected allocations: ${result.expectedAllocations.length > 0 ? result.expectedAllocations.join(', ') : 'none'}`);
  console.log(`Expected sale ledgers: ${result.expectedSaleLedgerIds.length > 0 ? result.expectedSaleLedgerIds.join(', ') : 'none'}`);
  console.log(`Backend HTTP status: ${result.backendStatus ?? 'unknown'}`);
  console.log(`Backend action: ${result.backendAction ?? 'unknown'}`);
  console.log(`Duplicate ignored: ${result.duplicate ? 'yes' : 'no'}`);
  console.log(`Allocation count: ${result.allocationCount ?? 'unknown'}`);
  if (result.message) {
    console.log(`Message: ${result.message}`);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}
