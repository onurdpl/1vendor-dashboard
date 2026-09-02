import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCustomerCancellationAutoRefundCanaryChildEnv,
  parseCustomerCancellationAutoRefundCanaryArgs,
} from '../backend/scripts/customer-cancellation-preview-auto-refund-canary.mjs';
import {
  CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME,
  CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE,
  assertCustomerCancellationPreviewDatabase,
  loadCustomerCancellationPreviewEnv,
  parseCustomerCancellationPreviewEnvFile,
  validateCustomerCancellationPreviewEnv,
} from '../backend/scripts/customer-cancellation-preview-env.mjs';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: `postgresql://postgres:postgres@localhost:5432/${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}`,
  SHOPIFY_SHOP_DOMAIN: 'sporgym-cancellation-dev.myshopify.com',
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: '2f542047bb25c5f0e2eef3e279390c8d',
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET: 'configured-preview-secret',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-preview-token',
  CUSTOMER_CANCELLATION_INTAKE_ENABLED: 'true',
  CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: 'false',
  SHIPPING_EXECUTION_ENABLED: 'false',
  SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'false',
  SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: 'false',
  SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED: 'false',
  SCHEDULED_RECONCILIATION_ENABLED: 'false',
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: 'false',
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: 'false',
  APPROVED_RETURN_AUTO_CANCEL_ENABLED: 'false',
  CANONICAL_RECONCILIATION_ENABLED: 'false',
  SHIPPING_PROVIDER: 'kargonomi',
  KARGONOMI_BASE_URL: 'http://127.0.0.1:9',
  KARGONOMI_API_TOKEN: 'dummy-preview-token-shipping-disabled',
};

function writeEnvFile(directory: string, env: Record<string, string>) {
  const envFile = path.join(directory, '.env.customer-cancellation-preview');
  fs.writeFileSync(
    envFile,
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  );
  return envFile;
}

describe('customer cancellation preview env guard', () => {
  it('accepts the exact preview database on localhost', () => {
    expect(() =>
      assertCustomerCancellationPreviewDatabase(
        `postgresql://postgres:postgres@localhost:5432/${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}`,
      ),
    ).not.toThrow();
  });

  it('accepts the exact preview database on 127.0.0.1', () => {
    expect(() =>
      assertCustomerCancellationPreviewDatabase(
        `postgresql://postgres:postgres@127.0.0.1:5432/${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}`,
      ),
    ).not.toThrow();
  });

  it('accepts the exact preview database on ::1', () => {
    expect(() =>
      assertCustomerCancellationPreviewDatabase(
        `postgresql://postgres:postgres@[::1]:5432/${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}`,
      ),
    ).not.toThrow();
  });

  it('rejects remote hosts before preview tooling can initialize Prisma', () => {
    expect(() =>
      assertCustomerCancellationPreviewDatabase(
        `postgresql://postgres:postgres@dpg-prod-example.render.com:5432/${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}`,
      ),
    ).toThrow(/local PostgreSQL only|production-like marker/);
  });

  it('rejects local databases with the wrong name before preview tooling can initialize Prisma', () => {
    expect(() =>
      assertCustomerCancellationPreviewDatabase('postgresql://postgres:postgres@localhost:5432/vendor_dashboard'),
    ).toThrow(`exactly ${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}`);
  });

  it('does not accept preview-looking database-name substrings', () => {
    expect(() =>
      assertCustomerCancellationPreviewDatabase(
        `postgresql://postgres:postgres@localhost:5432/${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}_copy`,
      ),
    ).toThrow(`exactly ${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}`);
  });

  it('fails closed when the absolute preview env file is missing', () => {
    const missingEnvFile = path.join(os.tmpdir(), `missing-preview-env-${Date.now()}`);
    expect(() => loadCustomerCancellationPreviewEnv(missingEnvFile)).toThrow(/Preview env file does not exist/);
  });

  it('does not use an ambient production-like DATABASE_URL when the preview env is missing', () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://prod:prod@dpg-prod-example.render.com:5432/production';
    try {
      const missingEnvFile = path.join(os.tmpdir(), `missing-preview-env-${Date.now()}`);
      expect(() => loadCustomerCancellationPreviewEnv(missingEnvFile)).toThrow(/Preview env file does not exist/);
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('resolves the repository preview env by absolute script-derived path from repository root', () => {
    const originalCwd = process.cwd();
    process.chdir(path.resolve('.'));
    try {
      expect(CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE).toBe(
        path.resolve('backend/.env.customer-cancellation-preview'),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves the repository preview env by absolute script-derived path from backend directory', () => {
    const originalCwd = process.cwd();
    process.chdir(path.resolve('backend'));
    try {
      expect(CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE).toBe(
        path.resolve('..', 'backend/.env.customer-cancellation-preview'),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves the repository preview env by absolute script-derived path from another cwd', () => {
    const originalCwd = process.cwd();
    const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-cwd-'));
    process.chdir(otherCwd);
    try {
      expect(CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE).toBe(
        path.resolve(originalCwd, 'backend/.env.customer-cancellation-preview'),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('validates a checked-in-style preview env file without reading ambient process env', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-env-'));
    const envFile = writeEnvFile(tempDir, validEnv);
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://prod:prod@dpg-prod-example.render.com:5432/production';
    try {
      const loaded = validateCustomerCancellationPreviewEnv(parseCustomerCancellationPreviewEnvFile(envFile), {
        envFile,
      });
      expect(loaded.database).toEqual({
        host: 'localhost',
        database: CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME,
      });
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('keeps normal preview startup closed when auto-refund is true', () => {
    expect(() =>
      validateCustomerCancellationPreviewEnv({
        ...validEnv,
        CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: 'true',
      }),
    ).toThrow(/CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED must be false/);
  });

  it('requires an explicit canary request id before reaching Prisma', () => {
    expect(() => parseCustomerCancellationAutoRefundCanaryArgs([])).toThrow(/request ID is required/i);
  });

  it('defaults the canary runner to dry-run mode', () => {
    expect(parseCustomerCancellationAutoRefundCanaryArgs(['cmtjozilt00018obvfsx0po00'])).toEqual({
      requestId: 'cmtjozilt00018obvfsx0po00',
      execute: false,
    });
  });

  it('scopes auto-refund enablement only to explicit canary execution child env', () => {
    expect(validEnv.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED).toBe('false');
    expect(
      buildCustomerCancellationAutoRefundCanaryChildEnv(validEnv, { execute: false })
        .CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED,
    ).toBe('false');
    expect(
      buildCustomerCancellationAutoRefundCanaryChildEnv(validEnv, { execute: true })
        .CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED,
    ).toBe('true');
  });
});
