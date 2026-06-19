import { describe, expect, it } from 'vitest';
import { createApp } from '../backend/src/app';

describe('legacy InvoiceExecution API removal', () => {
  it('does not register legacy /admin/invoices routes', async () => {
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
