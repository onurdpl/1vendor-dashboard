import { describe, expect, it } from 'vitest';
import type { FinanceDashboard, FinanceTransaction } from './api/contracts';
import {
  VENDOR_BLOCKED_FINANCE_HOLD_REASON,
  getFinanceNeedsReviewBreakdown,
  getFinanceOperationalProjection,
} from './financeOperationalProjection';

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
