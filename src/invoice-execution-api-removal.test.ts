import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../backend/src/app';

function stubBackendTestEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SHIPPING_PROVIDER', 'kargonomi');
  vi.stubEnv('KARGONOMI_BASE_URL', 'https://app.kargonomi.com.tr/api/v1');
  vi.stubEnv('KARGONOMI_API_TOKEN', 'test-token');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('legacy InvoiceExecution API removal', () => {
  it('does not register legacy /admin/invoices routes', async () => {
    stubBackendTestEnv();
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/invoices/create',
        payload: {
          financeLedgerEntryId: 'ledger-1',
          provider: 'bizimhesap',
        },
      });

      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
