import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import type { FinanceDashboard, FinanceTransaction, VendorDebtHistory } from './contracts';
import { listMockOrders } from './mockOrders';
import { listMockReturns } from './mockReturns';

type VendorFinanceDashboard = FinanceDashboard & {
  vendorId: VendorId;
};

function parseMoneyToCents(value: string) {
  return Math.round(Number(value.replace(/[^0-9.-]/g, '')) * 100);
}

function formatMoneyFromCents(value: number) {
  return (value / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

function latestDate(...dates: string[]) {
  return dates
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? '2026-05-01T00:00:00Z';
}

function mapOrderStatusToTransactionStatus(status: string): FinanceTransaction['status'] {
  if (status === 'Delivered') {
    return 'Completed';
  }

  if (status === 'Shipped') {
    return 'Reconciled';
  }

  if (status === 'On Hold') {
    return 'Failed';
  }

  return 'Pending';
}

function mapReturnStatusToTransactionStatus(status: string): FinanceTransaction['status'] {
  if (status === 'Refunded') {
    return 'Completed';
  }

  if (status === 'Approved') {
    return 'Reconciled';
  }

  if (status === 'Rejected') {
    return 'Failed';
  }

  return 'Pending';
}

function buildVendorFinance(vendorId: VendorId): VendorFinanceDashboard {
  const orders = listMockOrders(vendorId);
  const returns = listMockReturns(vendorId);

  const grossSalesCents = orders.reduce((total, order) => total + parseMoneyToCents(order.amount), 0);
  const refundsCents = returns.reduce((total, returnRequest) => total + parseMoneyToCents(returnRequest.amount), 0);
  const netRevenueCents = grossSalesCents - refundsCents;
  const platformFeeCents = Math.round(netRevenueCents * 0.1);
  const payoutEstimateCents = netRevenueCents - platformFeeCents;
  const pendingPayoutsCents = orders
    .filter((order) => order.status !== 'Delivered')
    .reduce((total, order) => total + parseMoneyToCents(order.amount), 0);

  const orderTransactions: FinanceTransaction[] = orders.map((order) => ({
    id: `FIN-${vendorId === 'demo-vendor-a' ? 'A' : 'B'}-ORDER-${order.id}`,
    date: order.date,
    description: `Allocated order revenue for Shopify order ${order.sourceShopifyOrderNumber}`,
    counterparty: order.customer,
    category: 'Invoice',
    amount: order.amount,
    status: mapOrderStatusToTransactionStatus(order.status),
    shopifyOrderNumber: String(order.sourceShopifyOrderNumber),
    shopifyOrderId: order.sourceShopifyOrderId,
  }));

  const refundTransactions: FinanceTransaction[] = returns.map((returnRequest) => ({
    id: `FIN-${vendorId === 'demo-vendor-a' ? 'A' : 'B'}-REFUND-${returnRequest.id}`,
    date: returnRequest.date,
    description: `Allocated refund for Shopify refund ${returnRequest.sourceShopifyRefundId.split('/').pop()}`,
    counterparty: returnRequest.customer,
    category: 'Refund',
    amount: returnRequest.amount,
    status: mapReturnStatusToTransactionStatus(returnRequest.status),
    shopifyOrderNumber: String(returnRequest.sourceShopifyOrderNumber),
    shopifyOrderId: returnRequest.sourceShopifyOrderId,
    shopifyRefundId: returnRequest.sourceShopifyRefundId,
  }));

  const feeTransaction: FinanceTransaction = {
    id: `FIN-${vendorId === 'demo-vendor-a' ? 'A' : 'B'}-FEE`,
    date: latestDate(...orders.map((order) => order.date), ...returns.map((item) => item.date)),
    description: 'Platform fee reserve',
    counterparty: 'Platform ledger',
    category: 'Adjustment',
    amount: formatMoneyFromCents(platformFeeCents),
    status: 'Reconciled',
  };

  const payoutTransaction: FinanceTransaction = {
    id: `FIN-${vendorId === 'demo-vendor-a' ? 'A' : 'B'}-PAYOUT`,
    date: latestDate(...orders.map((order) => order.date), ...returns.map((item) => item.date)),
    description: 'Estimated vendor payout',
    counterparty: 'Vendor balance',
    category: 'Payout',
    amount: formatMoneyFromCents(payoutEstimateCents),
    status: 'Pending',
  };

  return {
    vendorId,
    summary: {
      grossSales: formatMoneyFromCents(grossSalesCents),
      refunds: formatMoneyFromCents(refundsCents),
      netRevenue: formatMoneyFromCents(netRevenueCents),
      platformFee: formatMoneyFromCents(platformFeeCents),
      payoutEstimate: formatMoneyFromCents(payoutEstimateCents),
      totalRevenue: formatMoneyFromCents(grossSalesCents),
      availableBalance: formatMoneyFromCents(payoutEstimateCents),
      pendingPayouts: formatMoneyFromCents(pendingPayoutsCents),
      refundsThisMonth: formatMoneyFromCents(refundsCents),
      payableBalance: formatMoneyFromCents(payoutEstimateCents),
      accruedBalance: formatMoneyFromCents(pendingPayoutsCents),
    },
    profile: {
      vendorId,
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: false,
      shippingMode: 'disabled',
      fixedShippingFee: null,
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'default',
    },
    payoutBatchSummary: {
      eligibleRowCount: orders.filter((order) => order.status === 'Delivered' || order.status === 'Shipped').length,
      eligibleNetAmount: formatMoneyFromCents(payoutEstimateCents),
      blockedRowCount: orders.filter((order) => order.status !== 'Delivered' && order.status !== 'Shipped').length,
      latestBatch: null,
    },
    transactions: [...orderTransactions, ...refundTransactions, feeTransaction, payoutTransaction].sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    ),
  };
}

export function getMockFinanceDashboard(vendorId?: VendorId): FinanceDashboard {
  const currentVendorId = resolveVendorId(vendorId);
  const dashboard = buildVendorFinance(currentVendorId);

  return {
    summary: dashboard.summary,
    profile: dashboard.profile,
    payoutBatchSummary: dashboard.payoutBatchSummary,
    transactions: dashboard.transactions,
  };
}

export function listMockFinanceTransactions(vendorId?: VendorId): FinanceTransaction[] {
  return getMockFinanceDashboard(vendorId).transactions;
}

export function getMockVendorDebtHistory(vendorId?: VendorId): VendorDebtHistory {
  const currentVendorId = resolveVendorId(vendorId);
  const createdAt = '2026-05-15T10:00:00.000Z';
  const offsetAt = '2026-05-18T10:00:00.000Z';
  return {
    ok: true,
    writesPerformed: false,
    vendorId: currentVendorId,
    currency: 'TRY',
    summary: {
      outstandingDebtMinor: 264000,
      totalDebtCreatedMinor: 300000,
      totalDebtOffsetMinor: 36000,
      remainingDebtMinor: 264000,
      lastDebtActivityAt: offsetAt,
    },
    events: [
      {
        id: 'mock-vendor-debt-offset-1',
        createdAt: offsetAt,
        type: 'VENDOR_DEBT_OFFSET',
        label: 'Debt Offset Applied',
        vendorId: currentVendorId,
        vendorName: currentVendorId === 'demo-vendor-a' ? 'Demo Vendor A' : 'Demo Vendor B',
        orderNumber: null,
        shopifyOrderId: null,
        orderCreatedAt: null,
        refundReference: null,
        refundRecordId: null,
        payoutBatchId: 'mock-payout-batch-1',
        payoutBatchStatus: 'DRAFT',
        itemCount: 0,
        productCount: 0,
        products: [],
        amountMinor: 36000,
        debtAmountMinor: -36000,
        remainingDebtAfterEventMinor: 264000,
        sourceReference: 'mock-payout-batch-1',
        financeLedgerEntryId: null,
        calculation: {
          refundMinor: null,
          commissionReversalMinor: null,
          commissionVatReversalMinor: null,
          vendorDebtMinor: null,
          debtOffsetMinor: 36000,
          formula: null,
        },
        offsetHistory: [
          {
            id: 'mock-vendor-debt-offset-1',
            createdAt: offsetAt,
            payoutBatchId: 'mock-payout-batch-1',
            payoutBatchStatus: 'DRAFT',
            offsetAmountMinor: 36000,
            remainingDebtAfterEventMinor: 264000,
          },
        ],
      },
      {
        id: 'mock-vendor-debt-created-1',
        createdAt,
        type: 'VENDOR_DEBT_CREATED',
        label: 'Debt Created',
        vendorId: currentVendorId,
        vendorName: currentVendorId === 'demo-vendor-a' ? 'Demo Vendor A' : 'Demo Vendor B',
        orderNumber: '#1082',
        shopifyOrderId: 'gid://shopify/Order/1082',
        orderCreatedAt: '2026-05-10T09:00:00.000Z',
        refundReference: 'gid://shopify/Refund/9001',
        refundRecordId: 'mock-refund-record-1',
        payoutBatchId: null,
        payoutBatchStatus: null,
        itemCount: 2,
        productCount: 1,
        products: [
          {
            title: 'Mock running shoe',
            sku: 'MOCK-SHOE-42',
            quantity: 2,
          },
        ],
        amountMinor: -300000,
        debtAmountMinor: 300000,
        remainingDebtAfterEventMinor: 300000,
        sourceReference: 'gid://shopify/Refund/9001',
        financeLedgerEntryId: 'mock-ledger-refund-1',
        calculation: {
          refundMinor: 340000,
          commissionReversalMinor: 34000,
          commissionVatReversalMinor: 6000,
          vendorDebtMinor: 300000,
          debtOffsetMinor: null,
          formula: 'vendorDebtMinor = refundMinor - commissionReversalMinor - commissionVatReversalMinor',
        },
        offsetHistory: [
          {
            id: 'mock-vendor-debt-offset-1',
            createdAt: offsetAt,
            payoutBatchId: 'mock-payout-batch-1',
            payoutBatchStatus: 'DRAFT',
            offsetAmountMinor: 36000,
            remainingDebtAfterEventMinor: 264000,
          },
        ],
      },
    ],
  };
}
