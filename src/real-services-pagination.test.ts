import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listWebhookDiagnostics } from './services/real/diagnostics';
import { getFinanceDashboard } from './services/real/finance';
import { listOrders } from './services/real/orders';
import { listAdminOperationsQueue } from './services/real/operations';
import { listReturns } from './services/real/returns';

const apiClientGet = vi.hoisted(() => vi.fn());

vi.mock('./lib/api-client', () => ({
  apiClient: {
    get: apiClientGet,
  },
}));

describe('real service pagination plumbing', () => {
  beforeEach(() => {
    apiClientGet.mockReset();
  });

  it('passes limit and offset to operational list endpoints', async () => {
    apiClientGet
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ summary: {}, events: [] })
      .mockResolvedValueOnce({ summary: {}, items: [] });

    await listOrders({ limit: 25, offset: 50 });
    await listReturns({ limit: 25, offset: 50 });
    await listWebhookDiagnostics({ limit: 25, offset: 50 });
    await listAdminOperationsQueue({ limit: 25, offset: 50 });

    expect(apiClientGet).toHaveBeenNthCalledWith(1, '/orders?limit=25&offset=50');
    expect(apiClientGet).toHaveBeenNthCalledWith(2, '/returns?limit=25&offset=50');
    expect(apiClientGet).toHaveBeenNthCalledWith(3, '/admin/diagnostics/webhooks?limit=25&offset=50');
    expect(apiClientGet).toHaveBeenNthCalledWith(4, '/admin/operations?limit=25&offset=50');
  });

  it('keeps finance summary request array-shaped while allowing record windowing', async () => {
    apiClientGet.mockResolvedValueOnce({
      summary: {
        grossSales: '0',
        refunds: '0',
        netRevenue: '0',
        platformFee: '0',
        payoutEstimate: '0',
      },
      records: [],
    });

    await getFinanceDashboard({ limit: 50 });

    expect(apiClientGet).toHaveBeenCalledWith('/finance?limit=50');
  });
});
