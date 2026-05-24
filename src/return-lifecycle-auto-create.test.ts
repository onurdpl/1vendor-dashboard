import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookEvent: {
    update: vi.fn(),
  },
  returnRecord: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const shopifyAdminMock = vi.hoisted(() => ({
  fetchReturnDetails: vi.fn(),
}));

const autoCreateNavlungoReturnPickupForApprovedReturnMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: () => shopifyAdminMock,
}));

vi.mock('../backend/src/modules/returns/returns.service.js', () => ({
  autoCreateNavlungoReturnPickupForApprovedReturn: autoCreateNavlungoReturnPickupForApprovedReturnMock,
}));

const { applyReturnLifecycleStatusWebhook } = await import('../backend/src/modules/shopify/return-lifecycle-ingestion.service.js');

const env = {
  NODE_ENV: 'test' as const,
  PORT: 4000,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
  CORS_ORIGIN: ['http://localhost:5173'],
  JWT_SECRET: 'test',
  JWT_EXPIRES_IN: '12h',
  SHOPIFY_WEBHOOK_SECRET: 'test',
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
  SCHEDULED_RECONCILIATION_ENABLED: false,
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
  SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
  SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
  SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
  EMAIL_NOTIFICATIONS_ENABLED: false,
  EMAIL_PROVIDER: 'noop' as const,
  EMAIL_ADMIN_RECIPIENTS: [],
  INVOICE_EXECUTION_ENABLED: false,
  INVOICE_PROVIDER: 'bizimhesap' as const,
  BIZIMHESAP_ENABLED: false,
  SHIPPING_EXECUTION_ENABLED: true,
  SHIPPING_SANDBOX_MODE: false,
  SHIPPING_PROVIDER: 'navlungo' as const,
  KARGO_ENTEGRATOR_ENABLED: true,
  KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
  KARGO_ENTEGRATOR_BASE_URL: 'https://kargo.example',
  KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
  TRY_OTO_ENABLED: false,
  TRY_OTO_BASE_URL: undefined,
  TRY_OTO_REFRESH_TOKEN: undefined,
  TRY_OTO_SANDBOX_MODE: false,
  TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
  NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2.1',
  NAVLUNGO_API_USERNAME: 'user',
  NAVLUNGO_API_PASSWORD: 'pass',
  NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: '55574',
  NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID: '77701',
  NAVLUNGO_DEFAULT_BARCODE_FORMAT: 'pdf-A6',
  NAVLUNGO_DEFAULT_CARRIER_ID: '9',
};

describe('return lifecycle Navlungo auto-create trigger', () => {
  beforeEach(() => {
    prismaMock.webhookEvent.update.mockReset();
    prismaMock.returnRecord.updateMany.mockReset();
    prismaMock.returnRecord.findMany.mockReset();
    prismaMock.$transaction.mockReset();
    shopifyAdminMock.fetchReturnDetails.mockReset();
    autoCreateNavlungoReturnPickupForApprovedReturnMock.mockReset();

    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
      callback(prismaMock),
    );
    prismaMock.webhookEvent.update.mockResolvedValue({});
    prismaMock.returnRecord.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.returnRecord.findMany.mockResolvedValue([{ id: 'return-request-1' }]);
    shopifyAdminMock.fetchReturnDetails.mockResolvedValue({ returnTracking: null });
    autoCreateNavlungoReturnPickupForApprovedReturnMock.mockResolvedValue({ attempted: true, skippedReason: null });
  });

  it('runs Navlungo return pickup auto-create after Shopify return approval updates ReturnRecord status', async () => {
    const result = await applyReturnLifecycleStatusWebhook(env, 'returns/approve', {
      event: {
        id: 'webhook-1',
      } as never,
      payload: {
        id: 23165600081,
        admin_graphql_api_id: 'gid://shopify/Return/23165600081',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      affectedRecordCount: 1,
      navlungoReturnAutoCreateAttemptedCount: 1,
      navlungoReturnAutoCreateSkippedCount: 0,
    });
    expect(autoCreateNavlungoReturnPickupForApprovedReturnMock).toHaveBeenCalledWith('return-request-1', env);
  });

  it('does not auto-create Navlungo return pickup for non-approved lifecycle updates', async () => {
    const result = await applyReturnLifecycleStatusWebhook(env, 'returns/close', {
      event: {
        id: 'webhook-1',
      } as never,
      payload: {
        id: 23165600081,
        admin_graphql_api_id: 'gid://shopify/Return/23165600081',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      affectedRecordCount: 1,
      navlungoReturnAutoCreateAttemptedCount: 0,
      navlungoReturnAutoCreateSkippedCount: 1,
    });
    expect(autoCreateNavlungoReturnPickupForApprovedReturnMock).not.toHaveBeenCalled();
  });
});
