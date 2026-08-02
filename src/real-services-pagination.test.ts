import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listWebhookDiagnostics } from './services/real/diagnostics';
import { getFinanceDashboard, getFinanceProfile, getFinanceSummary, getReturnFinanceRecords } from './services/real/finance';
import { listOrders } from './services/real/orders';
import { getAdminOperationsQueueDashboard, listAdminOperationsQueue } from './services/real/operations';
import { queryKeys } from './lib/api/queryKeys';
import { listDashboardReturns, listReturns } from './services/real/returns';
import { listAdminSupportAttentionTickets, listAdminSupportTickets } from './services/real/support';

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

  it('passes the operations queue type filter only when requested', async () => {
    apiClientGet
      .mockResolvedValueOnce({ summary: {}, items: [] })
      .mockResolvedValueOnce({ summary: {}, items: [] })
      .mockResolvedValueOnce({ summary: {}, items: [] })
      .mockResolvedValueOnce({ summary: {}, items: [] })
      .mockResolvedValueOnce({ summary: {}, items: [] })
      .mockResolvedValueOnce({ summary: {}, items: [] });

    await getAdminOperationsQueueDashboard({ limit: 5, offset: 5, type: 'vendor_blocked' });
    await getAdminOperationsQueueDashboard({ limit: 10, offset: 20, type: 'awaiting_shipment' });
    await getAdminOperationsQueueDashboard({ limit: 10, offset: 30, type: 'return_review' });
    await getAdminOperationsQueueDashboard({ limit: 10, offset: 40, type: 'finance_review' });
    await getAdminOperationsQueueDashboard({ limit: 10, offset: 50, type: 'finance_integrity_alert' });
    await getAdminOperationsQueueDashboard({ limit: 5, offset: 0 });

    expect(apiClientGet).toHaveBeenNthCalledWith(1, '/admin/operations?type=vendor_blocked&limit=5&offset=5', expect.any(Object));
    expect(apiClientGet).toHaveBeenNthCalledWith(2, '/admin/operations?type=awaiting_shipment&limit=10&offset=20', expect.any(Object));
    expect(apiClientGet).toHaveBeenNthCalledWith(3, '/admin/operations?type=return_review&limit=10&offset=30', expect.any(Object));
    expect(apiClientGet).toHaveBeenNthCalledWith(4, '/admin/operations?type=finance_review&limit=10&offset=40', expect.any(Object));
    expect(apiClientGet).toHaveBeenNthCalledWith(5, '/admin/operations?type=finance_integrity_alert&limit=10&offset=50', expect.any(Object));
    expect(apiClientGet).toHaveBeenNthCalledWith(6, '/admin/operations?limit=5', expect.any(Object));
  });

  it('keeps filtered and unfiltered operations queue pages in separate query-key buckets', () => {
    expect(queryKeys.admin.operations.queuePage(5, 0)).toEqual(['admin', 'operations', 'queue', 'all', 5, 0]);
    expect(queryKeys.admin.operations.queuePage(5, 0, 'vendor_blocked')).toEqual(['admin', 'operations', 'queue', 'vendor_blocked', 5, 0]);
    expect(queryKeys.admin.operations.queuePage(10, 20, 'awaiting_shipment')).toEqual(['admin', 'operations', 'queue', 'awaiting_shipment', 10, 20]);
    expect(queryKeys.admin.operations.queuePage(10, 30, 'return_review')).toEqual(['admin', 'operations', 'queue', 'return_review', 10, 30]);
    expect(queryKeys.admin.operations.queuePage(10, 40, 'finance_review')).toEqual([
      'admin',
      'operations',
      'queue',
      'finance_review',
      10,
      40,
    ]);
    expect(queryKeys.admin.operations.queuePage(10, 50, 'finance_integrity_alert')).toEqual([
      'admin',
      'operations',
      'queue',
      'finance_integrity_alert',
      10,
      50,
    ]);
  });

  it('preserves structured finance review fields from operations queue responses', async () => {
    apiClientGet.mockResolvedValueOnce({
      summary: {
        total: 1,
        financeReview: 1,
      },
      items: [
        {
          id: 'op-finance-review-ledger-1',
          type: 'finance_review',
          severity: 'critical',
          title: 'Payout review needed',
          description: 'Settlement hold requires admin review.',
          vendorId: 'vendor-1',
          vendorName: 'Vendor 1',
          relatedOrderId: 'alloc-1',
          relatedShopifyOrderId: '7709129507153',
          relatedShopifyOrderNumber: '#1091',
          status: 'hold',
          createdAt: '2026-06-21T09:00:00.000Z',
          actionLabel: 'Review finance',
          destinationPath: '/finance',
          financeLedgerEntryId: 'ledger-1',
          financeReviewReason: 'Settlement hold requires admin review.',
          financeReviewAmount: '4584.35',
          payoutStatus: 'HOLD',
          settlementStatus: 'HELD',
          vendorAllocationId: 'alloc-1',
        },
      ],
    });

    const dashboard = await getAdminOperationsQueueDashboard({
      limit: 10,
      offset: 0,
      type: 'finance_review',
    });

    expect(dashboard.summary.financeReview).toBe(1);
    expect(dashboard.items[0]).toMatchObject({
      id: 'op-finance-review-ledger-1',
      type: 'finance_review',
      financeLedgerEntryId: 'ledger-1',
      financeReviewReason: 'Settlement hold requires admin review.',
      financeReviewAmount: '4584.35',
      payoutStatus: 'HOLD',
      settlementStatus: 'HELD',
      vendorAllocationId: 'alloc-1',
      actionTo: '/finance',
    });
  });

  it('preserves structured finance integrity alert diagnostics from operations queue responses', async () => {
    apiClientGet.mockResolvedValueOnce({
      summary: {
        total: 1,
        financeIntegrityAlerts: 1,
      },
      items: [
        {
          id: 'op-finance-integrity-alert-1',
          type: 'finance_integrity_alert',
          severity: 'critical',
          title: 'Finance integrity alert',
          description: 'Category: multiple_active_sale_ledgers. Reason: Two active sale ledgers exist.',
          vendorId: 'vendor-1',
          vendorName: 'Vendor 1',
          relatedOrderId: 'alloc-1',
          relatedShopifyOrderId: '7709129507153',
          relatedShopifyOrderNumber: '#1091',
          relatedReturnId: null,
          relatedRefundId: null,
          status: 'open',
          createdAt: '2026-06-21T09:00:00.000Z',
          actionLabel: 'Investigate finance alert',
          destinationPath: '/admin/orders/7709129507153',
          financeIntegrityAlertId: 'alert-1',
          financeIntegrityCategory: 'multiple_active_sale_ledgers',
          financeIntegrityReason: 'Two active sale ledgers exist.',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: 'transfer-1',
        },
      ],
    });

    const dashboard = await getAdminOperationsQueueDashboard({
      limit: 10,
      offset: 0,
      type: 'finance_integrity_alert',
    });

    expect(dashboard.items[0]).toMatchObject({
      id: 'op-finance-integrity-alert-1',
      type: 'finance_integrity_alert',
      severity: 'critical',
      relatedShopifyOrderNumber: '#1091',
      financeIntegrityAlertId: 'alert-1',
      financeIntegrityCategory: 'multiple_active_sale_ledgers',
      financeIntegrityReason: 'Two active sale ledgers exist.',
      vendorAllocationId: 'alloc-1',
      allocationEconomicTransferId: 'transfer-1',
      actionTo: '/admin/orders/7709129507153',
    });
  });

  it('passes the support attention filter with limit and offset without changing the unfiltered admin support list', async () => {
    apiClientGet
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ total: 30, items: [] });

    await listAdminSupportTickets();
    await listAdminSupportAttentionTickets({ limit: 20, offset: 20 });

    expect(apiClientGet).toHaveBeenNthCalledWith(1, '/admin/support/tickets', expect.any(Object));
    expect(apiClientGet).toHaveBeenNthCalledWith(2, '/admin/support/tickets?attention=true&limit=20&offset=20', expect.any(Object));
  });

  it('keeps support attention and normal admin support tickets in separate query-key buckets', () => {
    expect(queryKeys.admin.support.tickets()).toEqual(['admin', 'support', 'tickets']);
    expect(queryKeys.admin.support.attentionTickets(20, 0)).toEqual(['admin', 'support', 'tickets', 'attention', 20, 0]);
    expect(queryKeys.admin.support.attentionTickets(20, 20)).toEqual(['admin', 'support', 'tickets', 'attention', 20, 20]);
  });

  it('passes limit and offset to dashboard return projection endpoint', async () => {
    apiClientGet.mockResolvedValueOnce([]);

    await listDashboardReturns({
      vendorId: 'vendor-1',
      limit: 10,
      offset: 0,
      headers: { 'X-Dashboard-Deferred-Load': 'true' },
    });

    expect(apiClientGet).toHaveBeenCalledWith(
      '/returns/dashboard?limit=10&offset=0',
      expect.objectContaining({
        vendorId: 'vendor-1',
        headers: { 'X-Dashboard-Deferred-Load': 'true' },
      }),
    );
    expect(apiClientGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/returns(?:\?|$)/), expect.anything());
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

  it('preserves finance split summaries on mapped dashboard records', async () => {
    apiClientGet.mockResolvedValueOnce({
      summary: {
        grossSales: '100.00',
        refunds: '0',
        netRevenue: '100.00',
        platformFee: '10.00',
        payoutEstimate: '90.00',
      },
      records: [
        {
          id: 'ledger-split-child',
          type: 'sale',
          amount: '100.00',
          status: 'recorded',
          description: 'Split child held ledger',
          relatedOrderId: 'gid://shopify/Order/1097',
          relatedOrderNumber: '1097',
          relatedReturnId: null,
          relatedRefundId: null,
          createdAt: '2026-06-20T09:00:00Z',
          payoutCalculation: null,
          settlement: null,
          payoutBatch: null,
          settlementRefundAdjustments: [],
          splitFinanceSummary: {
            splitEventId: 'split-1097',
            sourceAllocationId: 'alloc-source-1097',
            childAllocationId: 'alloc-child-1097',
            sourceFinanceLedgerEntryId: 'ledger-split-source-original',
            remainingFinanceLedgerEntryId: 'ledger-split-source-remaining',
            childFinanceLedgerEntryId: 'ledger-split-child',
            lineageRole: 'child',
            splitReason: 'OUT_OF_STOCK',
            splitCreatedAt: '2026-06-20T08:55:00Z',
          },
        },
      ],
    });

    const dashboard = await getFinanceDashboard();

    expect(dashboard.transactions[0].splitFinanceSummary).toEqual({
      splitEventId: 'split-1097',
      sourceAllocationId: 'alloc-source-1097',
      childAllocationId: 'alloc-child-1097',
      sourceFinanceLedgerEntryId: 'ledger-split-source-original',
      remainingFinanceLedgerEntryId: 'ledger-split-source-remaining',
      childFinanceLedgerEntryId: 'ledger-split-child',
      lineageRole: 'child',
      splitReason: 'OUT_OF_STOCK',
      splitCreatedAt: '2026-06-20T08:55:00Z',
    });
  });

  it('reads dashboard finance summary without calling the full finance dashboard endpoint', async () => {
    apiClientGet.mockResolvedValueOnce({
      summary: {
        grossSales: '100.00',
        refunds: '25.00',
        netRevenue: '75.00',
        payoutEstimate: '67.50',
      },
      latestCompletedPayment: {
        id: 'payout-paid-1',
        netAmount: '50.25',
        currency: 'TRY',
        paidAt: '2026-07-14T11:25:00.000Z',
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
    expect(summary.latestCompletedPayment).toEqual({
      id: 'payout-paid-1',
      netAmount: 'TRY\u00a050.25',
      currency: 'TRY',
      paidAt: '2026-07-14T11:25:00.000Z',
    });
  });

  it('reads the vendor finance profile without calling the full finance dashboard endpoint', async () => {
    apiClientGet.mockResolvedValueOnce({
      vendorId: 'vendor-1',
      commissionPercent: '12.50',
      commissionVatPercent: '20.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'configured',
    });

    const profile = await getFinanceProfile({
      vendorId: 'vendor-1',
    });

    expect(apiClientGet).toHaveBeenCalledWith(
      '/finance/profile',
      expect.objectContaining({
        vendorId: 'vendor-1',
      }),
    );
    expect(apiClientGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/finance(?:\?|$)/), expect.anything());
    expect(profile).toEqual({
      vendorId: 'vendor-1',
      commissionPercent: '12.50',
      commissionVatPercent: '20.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'configured',
    });
  });

  it('reads return-scoped finance records without calling the full finance dashboard endpoint', async () => {
    apiClientGet.mockResolvedValueOnce({
      records: [
        {
          id: 'ledger-refund-1',
          category: 'refund',
          amount: 125.5,
          status: 'recorded',
          date: '2026-05-13T05:00:00.000Z',
        },
      ],
    });

    const response = await getReturnFinanceRecords({
      vendorId: 'vendor-1',
      shopifyRefundId: 'gid://shopify/Refund/1',
      shopifyOrderNumber: 1023,
    });

    expect(apiClientGet).toHaveBeenCalledWith(
      '/finance/return-records?shopifyRefundId=gid%3A%2F%2Fshopify%2FRefund%2F1&shopifyOrderNumber=1023',
      expect.objectContaining({
        vendorId: 'vendor-1',
      }),
    );
    expect(apiClientGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/finance(?:\?|$)/), expect.anything());
    expect(response).toEqual({
      records: [
        {
          id: 'ledger-refund-1',
          category: 'Refund',
          amount: 'TRY\u00a0125.50',
          status: 'Recorded',
          date: '2026-05-13T05:00:00.000Z',
          settlementRefundAdjustments: [],
        },
      ],
    });
  });
});
