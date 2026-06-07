import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listWebhookDiagnostics } from './services/real/diagnostics';
import { getFinanceDashboard, getFinanceSummary } from './services/real/finance';
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
    expect(apiClientGet).toHaveBeenNthCalledWith(3, '/admin/diagnostics/webhooks?limit=25&offset=50', expect.any(Object));
    expect(apiClientGet).toHaveBeenNthCalledWith(4, '/admin/operations?limit=25&offset=50', expect.any(Object));
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

  it('reads dashboard finance summary without calling the full finance dashboard endpoint', async () => {
    apiClientGet.mockResolvedValueOnce({
      summary: {
        grossSales: '100.00',
        refunds: '25.00',
        netRevenue: '75.00',
        payoutEstimate: '67.50',
      },
    });

    const summary = await getFinanceSummary({
      vendorId: 'vendor-1',
      headers: { 'X-Dashboard-Deferred-Load': 'true' },
    });

    expect(apiClientGet).toHaveBeenCalledWith(
      '/finance/summary',
      expect.objectContaining({
        vendorId: 'vendor-1',
        headers: { 'X-Dashboard-Deferred-Load': 'true' },
      }),
    );
    expect(apiClientGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/finance(?:\?|$)/), expect.anything());
    expect(summary.summary).toEqual({
      grossSales: 'TRY\u00a0100.00',
      refunds: 'TRY\u00a025.00',
      netRevenue: 'TRY\u00a075.00',
      payoutEstimate: 'TRY\u00a067.50',
    });
  });
});
