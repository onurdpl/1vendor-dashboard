import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import type { FinanceDashboard, FinanceTransaction } from './contracts';
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
  }));

  const refundTransactions: FinanceTransaction[] = returns.map((returnRequest) => ({
    id: `FIN-${vendorId === 'demo-vendor-a' ? 'A' : 'B'}-REFUND-${returnRequest.id}`,
    date: returnRequest.date,
    description: `Allocated refund for Shopify refund ${returnRequest.sourceShopifyRefundId.split('/').pop()}`,
    counterparty: returnRequest.customer,
    category: 'Refund',
    amount: returnRequest.amount,
    status: mapReturnStatusToTransactionStatus(returnRequest.status),
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
