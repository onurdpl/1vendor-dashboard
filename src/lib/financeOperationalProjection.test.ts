import { describe, expect, it } from 'vitest';
import type { FinanceDashboard, FinanceTransaction } from './api/contracts';
import {
  VENDOR_BLOCKED_FINANCE_HOLD_REASON,
  getFinanceNeedsReviewBreakdown,
  getFinanceOperationalProjection,
  getPayoutBatchStatusLabel,
} from './financeOperationalProjection';
import { formatCurrency } from '../services/real/formatting';
import { evaluateSaleSettlementDelay } from '../../backend/src/modules/finance/settlement-delay-eligibility.service';
import { getFinancePresentation, getFinanceSearchableText, getVendorFinanceScenario, hasReliablePaidEvidence } from './financePresentation';

const baseSale: FinanceTransaction = {
  id: 'ledger-sale',
  date: '2026-06-20T10:00:00Z',
  description: 'Sale',
  counterparty: 'Shopify order',
  category: 'Invoice',
  amount: 'TRY 1,000.00',
  status: 'Recorded',
  shopifyOrderNumber: '1099',
  payoutCalculation: {
    grossAmount: 'TRY 1,000.00',
    commission: 'TRY 100.00',
    commissionVat: 'TRY 0.00',
    shippingDeduction: 'TRY 0.00',
    refundImpact: 'TRY 0.00',
    estimatedPayout: 'TRY 900.00',
    shippingApplied: false,
    shippingMode: 'disabled',
    profileSource: 'snapshot',
    commissionPercent: '10.00',
    commissionVatPercent: '0.00',
  },
  settlement: {
    status: 'payable',
    payoutReady: true,
    eligibleAt: '2026-06-20T10:00:00Z',
    accruedAt: '2026-06-20T10:00:00Z',
    payableAt: '2026-06-20T10:00:00Z',
    settledAt: null,
    holdReason: null,
    note: 'Payable',
  },
  payoutBatch: null,
};

describe('financeOperationalProjection', () => {
  it('freezes reachable Admin row status precedence before presentation extraction', () => {
    const plain = { ...baseSale, settlement: undefined, payoutBatch: null };
    const batch = (status: NonNullable<FinanceTransaction['payoutBatch']>['status']) => ({
      id: `batch-${status}`, status, netAmount: 'TRY 900.00', createdAt: baseSale.date,
    });
    const review = (approvalStatus: 'draft' | 'approved', commissionInvoiceStatus: string | null = null) => ({
      approvalId: 'approval-1', approvalStatus, commissionInvoiceId: null,
      commissionInvoiceStatus, invoiceNo: null, providerUuid: null,
    });
    const cases: Array<[FinanceTransaction, string]> = [
      [plain, 'Estimated'],
      [baseSale, 'Pending review'],
      [{ ...plain, payoutBatch: batch('draft') }, 'Estimated'],
      [{ ...plain, payoutBatch: batch('review') }, 'Pending review'],
      [{ ...plain, payoutBatch: batch('approved') }, 'Approved'],
      [{ ...plain, payoutBatch: batch('execution_pending') }, 'Scheduled'],
      [{ ...plain, status: 'Failed' }, 'Blocked'],
      [{ ...baseSale, settlement: { ...baseSale.settlement!, status: 'held', holdReason: VENDOR_BLOCKED_FINANCE_HOLD_REASON } }, 'On hold'],
      [{ ...plain, category: 'Refund' }, 'Refund impact'],
      [{ ...baseSale, settlement: { ...baseSale.settlement!, review: review('draft') } }, 'Settlement draft locked'],
      [{ ...baseSale, settlement: { ...baseSale.settlement!, review: review('approved') } }, 'Settlement approved'],
      [{ ...baseSale, settlement: { ...baseSale.settlement!, review: review('approved', 'created') } }, 'Commission invoiced'],
      [{ ...plain, payoutBatch: batch('paid') }, 'Paid'],
      [{ ...plain, payoutBatch: batch('cashless_completed') }, 'Completed by verified offsets (no EFT)'],
      [{ ...plain, payoutBatch: batch('paid_placeholder') }, 'Payment evidence pending'],
      [{ ...plain, payoutBatch: batch('cancelled') }, 'Blocked'],
    ];
    for (const [record, expected] of cases) {
      expect(getFinanceOperationalProjection(record, { audience: 'admin' }).legacyStatusLabel).toBe(expected);
    }
    expect(getFinanceOperationalProjection({ ...plain, payoutBatch: batch('paid_placeholder') }, { audience: 'vendor' }).legacyStatusLabel)
      .toBe('Pending review');
  });

  it('preserves Vendor scenario statuses across Sale, Refund, Adjustment, Payout and Shipping evidence', () => {
    const plain = { ...baseSale, settlement: undefined, payoutBatch: null };
    const adjustment: NonNullable<FinanceTransaction['settlementRefundAdjustments']>[number] = {
      id: 'adjustment-1', status: 'applied', amountMinor: 1000, originalAmountMinor: 1000,
      appliedAmountMinor: 1000, remainingAmountMinor: 0, currencyCode: 'TRY', reason: 'Refund offset',
      originalSettlementApprovalId: null, originalSettlementApprovalLineId: null,
      originalSettlementCommissionInvoiceId: null, appliedSettlementApprovalId: null,
      appliedSettlementApprovalLineId: null, blockedReason: null, createdAt: baseSale.date, updatedAt: baseSale.date,
    };
    const cases: Array<[FinanceTransaction, string, string]> = [
      [plain, 'Hesaplanıyor', 'Sipariş Geliri'],
      [baseSale, 'Hazır', 'Sipariş Geliri'],
      [{ ...baseSale, settlement: { ...baseSale.settlement!, status: 'held' } }, 'Askıda', 'Sipariş Geliri'],
      [{ ...plain, status: 'Failed' }, 'Beklemede', 'Sipariş Geliri'],
      [{ ...baseSale, settlement: { ...baseSale.settlement!, status: 'partially_refunded' } }, 'İncelemede', 'Sipariş Geliri'],
      [{ ...plain, category: 'Refund' }, 'İncelemede', 'İade'],
      [{ ...plain, category: 'Refund', settlementRefundAdjustments: [adjustment] }, 'Hazır', 'İade'],
      [{ ...plain, category: 'Adjustment', settlementRefundAdjustments: [adjustment] }, 'Hazır', 'Bakiye Düzeltmesi'],
      [{ ...plain, category: 'Payout', payoutBatch: { id: 'batch-approved', status: 'approved', netAmount: 'TRY 900.00', createdAt: baseSale.date } }, 'Hazır', 'Ödeme'],
      [{ ...plain, category: 'Payout', payoutBatch: { id: 'batch-draft', status: 'draft', netAmount: 'TRY 900.00', createdAt: baseSale.date } }, 'Beklemede', 'Ödeme'],
      [{ ...plain, payoutCalculation: { ...baseSale.payoutCalculation!, shippingCostStatus: 'pending_provider_cost' } }, 'Beklemede', 'Kargo'],
      [{ ...plain, payoutCalculation: { ...baseSale.payoutCalculation!, shippingApplied: true } }, 'Hazır', 'Kargo'],
    ];
    for (const [record, status, type] of cases) {
      expect(getVendorFinanceScenario(record)).toMatchObject({ status, typeLabel: type });
      const view = getFinancePresentation(record, 'vendor', { vendorId: 'vendor-a', vendorName: 'Vendor A' });
      expect(view.vendorDisplayedStatus).toBe(status);
      expect(view.searchableStatus).toBe(getFinanceOperationalProjection(record, { audience: 'vendor' }).legacyStatusLabel);
    }
  });

  it('keeps paid evidence distinct from draft, approval, placeholder and cashless completion', () => {
    const paid = { ...baseSale, payoutStatus: 'paid', settlement: { ...baseSale.settlement!, status: 'settled' as const, settledAt: baseSale.date },
      payoutBatch: { id: 'batch-paid', status: 'paid' as const, netAmount: 'TRY 900.00', createdAt: baseSale.date, paidAt: baseSale.date } };
    expect(hasReliablePaidEvidence(paid)).toBe(true);
    expect(getVendorFinanceScenario(paid).status).toBe('Ödendi');
    for (const status of ['draft', 'approved', 'paid_placeholder', 'cashless_completed'] as const) {
      const record = { ...paid, payoutStatus: status, settlement: { ...paid.settlement, status: 'payable' as const, settledAt: null },
        payoutBatch: { ...paid.payoutBatch, status, paidAt: null } };
      expect(hasReliablePaidEvidence(record)).toBe(false);
      expect(getVendorFinanceScenario(record).status).not.toBe('Ödendi');
    }
    expect(getFinancePresentation({ ...paid, payoutStatus: 'cashless_completed',
      settlement: { ...paid.settlement, status: 'cashless_completed', settledAt: null },
      payoutBatch: { ...paid.payoutBatch, status: 'cashless_completed', paidAt: null } }, 'vendor',
    { vendorId: 'vendor-a', vendorName: 'Vendor A' }).searchableStatus)
      .toBe('Completed by verified offsets (no EFT)');
  });

  it('keeps the exact joined search string, case folding, context and formatted amount behavior', () => {
    const record: FinanceTransaction = { ...baseSale, id: 'ledger-alpha', description: 'Special Sale',
      counterparty: 'Counterparty Alpha', settlement: undefined, payoutBatch: null,
      amount: formatCurrency(1500), shopifyOrderNumber: '8123', shopifyOrderId: 'gid://shopify/Order/8123',
      shopifyRefundId: 'gid://shopify/Refund/98123' };
    const vendor = { vendorId: 'vendor-a', vendorName: 'Vendor A' };
    const text = getFinanceSearchableText(record, 'admin', vendor);
    expect(text).toBe('ledger-alpha special sale invoice estimated try\u00a01,500.00 counterparty alpha vendor a vendor-a 8123 gid://shopify/order/8123 gid://shopify/refund/98123');
    for (const [query, found] of [['1500', false], ['1500.00', false], ['1,500.00', true],
      ['TRY', true], ['TRY 1,500', false], ['TRY\u00a01,500', true], ['500.0', true],
      ['  1,500.00  ', true]] as const) {
      expect(text.includes(query.trim().toLowerCase())).toBe(found);
    }
    expect(getFinanceSearchableText(record, 'admin', { vendorId: 'vendor-b', vendorName: 'Vendor B' }))
      .not.toContain('vendor-a');
    expect(getFinancePresentation({ ...record, category: 'Refund' }, 'admin', vendor).displayedAmount)
      .toBe('-TRY\u00a01,500.00');
    expect(getFinancePresentation({ ...record, category: 'Adjustment' }, 'admin', vendor).displayedAmount)
      .toBe('-TRY\u00a01,500.00');
    expect(getFinancePresentation({ ...record, amount: formatCurrency(-1500) }, 'admin', vendor).formattedAmount)
      .toBe('-TRY\u00a01,500.00');
    expect(getFinanceSearchableText({ ...record, category: 'Refund' }, 'admin', vendor)).not.toContain('-try');
  });

  it('freezes the settlement delay before, at and after its exact time boundary', () => {
    const deliveredAt = new Date('2026-09-09T23:59:59.999Z');
    const input = { entryType: 'SALE', settlementDelayDaysSnapshot: 21, vendorAllocation: {
      id: 'allocation-a', outboundMethodSnapshot: 'KARGONOMI', outboundIntegrationProviderSnapshot: null,
      deliveredObservation: { vendorAllocationId: 'allocation-a', outboundMethod: 'KARGONOMI',
        outboundIntegrationProvider: null, firstObservedDeliveredAt: deliveredAt },
    } };
    const boundary = new Date('2026-09-30T23:59:59.999Z');
    expect(evaluateSaleSettlementDelay(input, new Date(boundary.getTime() - 1)).eligible).toBe(false);
    expect(evaluateSaleSettlementDelay(input, boundary).eligible).toBe(true);
    expect(evaluateSaleSettlementDelay(input, new Date(boundary.getTime() + 1)).eligible).toBe(true);
    const vendor = { vendorId: 'vendor-a', vendorName: 'Vendor A' };
    for (const [now, expectedAdmin, expectedVendor] of [
      [new Date(boundary.getTime() - 1), 'Estimated', 'Hesaplanıyor'],
      [boundary, 'Pending review', 'Hazır'],
      [new Date(boundary.getTime() + 1), 'Pending review', 'Hazır'],
    ] as const) {
      const eligible = evaluateSaleSettlementDelay(input, now).eligible;
      const record: FinanceTransaction = { ...baseSale, payoutBatch: null, settlement: {
        ...baseSale.settlement!, status: eligible ? 'payable' : 'accruing', payoutReady: eligible,
      } };
      expect(getFinancePresentation(record, 'admin', vendor).adminDisplayedStatus).toBe(expectedAdmin);
      expect(getFinancePresentation(record, 'vendor', vendor).vendorDisplayedStatus).toBe(expectedVendor);
    }
  });

  it('labels cashless completion as an offset, never as an EFT payment', () => {
    expect(getPayoutBatchStatusLabel('cashless_completed', 'vendor'))
      .toBe('Completed by verified offsets (no EFT)');
    const projection = getFinanceOperationalProjection({
      ...baseSale,
      status: 'Recorded',
      settlement: { ...baseSale.settlement!, status: 'cashless_completed',
        payoutReady: false, settledAt: null },
      payoutBatch: { id: 'cashless-batch', status: 'cashless_completed',
        netAmount: '0.00', createdAt: '2026-06-20T10:00:00Z', paidAt: null,
        paymentReference: null },
    });
    expect(projection.settlementState).toBe('Completed by offsets');
    expect(projection.payoutState).toBe('Completed by verified offsets (no EFT)');
  });
  it('separates settlement, payout, and blocker states for payable rows', () => {
    const projection = getFinanceOperationalProjection(baseSale);

    expect(projection.legacyStatusLabel).toBe('Pending review');
    expect(projection.settlementState).toBe('Review pending');
    expect(projection.payoutState).toBe('Ready for review');
    expect(projection.blockerState).toBe('None');
    expect(projection.payoutReadiness).toBe('Ready for settlement review');
  });

  it('marks vendor-blocked rows as payout blocked without changing the underlying ledger state', () => {
    const projection = getFinanceOperationalProjection({
      ...baseSale,
      settlement: {
        ...baseSale.settlement!,
        status: 'held',
        payoutReady: false,
        holdReason: VENDOR_BLOCKED_FINANCE_HOLD_REASON,
      },
    });

    expect(projection.legacyStatusLabel).toBe('On hold');
    expect(projection.settlementState).toBe('Held');
    expect(projection.payoutState).toBe('Not eligible');
    expect(projection.blockerState).toBe('Vendor blocked');
    expect(projection.payoutReadiness).toBe('Blocked by vendor allocation');
  });

  it('detects shipping reconciliation as action-required only from existing calculation fields', () => {
    const projection = getFinanceOperationalProjection({
      ...baseSale,
      payoutCalculation: {
        ...baseSale.payoutCalculation!,
        shippingMode: 'external_provider',
        shippingDeductionSource: 'external_provider',
        shippingCostStatus: 'pending_provider_cost',
      },
    });

    expect(projection.shippingImpact.state).toBe('required');
    expect(projection.shippingImpact.label).toBe('Shipping reconciliation required');
  });

  it('builds a partial needs-review breakdown without inventing unavailable categories', () => {
    const failedRefund: FinanceTransaction = {
      ...baseSale,
      id: 'ledger-refund-failed',
      category: 'Refund',
      amount: 'TRY 250.00',
      status: 'Failed',
      payoutCalculation: undefined,
      settlement: undefined,
    };
    const dashboardSummary: FinanceDashboard['summary'] = {
      grossSales: 'TRY 1,000.00',
      refunds: 'TRY 250.00',
      netRevenue: 'TRY 750.00',
      platformFee: 'TRY 100.00',
      payoutEstimate: 'TRY 650.00',
      totalRevenue: 'TRY 1,000.00',
      availableBalance: 'TRY 650.00',
      pendingPayouts: 'TRY 650.00',
      refundsThisMonth: 'TRY 250.00',
      outstandingVendorDebt: 'TRY 50.00',
    };

    const breakdown = getFinanceNeedsReviewBreakdown(
      [baseSale, failedRefund],
      {
        eligibleRowCount: 1,
        eligibleNetAmount: 'TRY 900.00',
        blockedRowCount: 2,
        outstandingDebtAmount: 'TRY 50.00',
        debtOffsetPreviewAmount: 'TRY 50.00',
        netEligibleAfterDebtOffset: 'TRY 850.00',
        latestBatch: null,
      },
      dashboardSummary,
    );

    expect(breakdown.needsReviewTotal).toBe(3);
    expect(breakdown.settlementReview).toBe(1);
    expect(breakdown.blockedRows).toBe(2);
    expect(breakdown.debtReview).toBe(1);
    expect(breakdown.unknownCategoriesLabel).toContain('Unknown categories');
  });
});
