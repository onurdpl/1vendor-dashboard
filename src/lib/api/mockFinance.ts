import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import type { FinanceDashboard, FinanceTransaction } from './contracts';

type VendorFinanceDashboard = FinanceDashboard & {
  vendorId: VendorId;
};

const financeDashboards: Record<VendorId, VendorFinanceDashboard> = {
  'demo-vendor-a': {
    vendorId: 'demo-vendor-a',
    summary: {
      totalRevenue: '$184,200.00',
      availableBalance: '$61,840.00',
      pendingPayouts: '$14,920.00',
      refundsThisMonth: '$4,860.00',
    },
    transactions: [
      {
        id: 'FIN-A-5001',
        date: '2026-05-10T09:25:00Z',
        description: 'Vendor payout batch',
        counterparty: 'Northwind Retail',
        category: 'Payout',
        amount: '$8,400.00',
        status: 'Completed',
      },
      {
        id: 'FIN-A-5002',
        date: '2026-05-10T11:10:00Z',
        description: 'Customer refund',
        counterparty: 'Acme Supply Co.',
        category: 'Refund',
        amount: '$420.00',
        status: 'Pending',
      },
      {
        id: 'FIN-A-5003',
        date: '2026-05-09T16:50:00Z',
        description: 'Monthly service invoice',
        counterparty: 'Northwind Retail',
        category: 'Invoice',
        amount: '$7,240.00',
        status: 'Reconciled',
      },
      {
        id: 'FIN-A-5004',
        date: '2026-05-08T10:05:00Z',
        description: 'Vendor payout batch',
        counterparty: 'Acme Supply Co.',
        category: 'Payout',
        amount: '$12,180.00',
        status: 'Completed',
      },
    ],
  },
  'demo-vendor-b': {
    vendorId: 'demo-vendor-b',
    summary: {
      totalRevenue: '$298,600.00',
      availableBalance: '$84,300.00',
      pendingPayouts: '$22,500.00',
      refundsThisMonth: '$6,140.00',
    },
    transactions: [
      {
        id: 'FIN-B-6001',
        date: '2026-05-10T08:55:00Z',
        description: 'Vendor payout batch',
        counterparty: 'Warehouse One',
        category: 'Payout',
        amount: '$16,200.00',
        status: 'Completed',
      },
      {
        id: 'FIN-B-6002',
        date: '2026-05-09T13:10:00Z',
        description: 'Customer refund',
        counterparty: 'Cobalt Logistics',
        category: 'Refund',
        amount: '$680.00',
        status: 'Pending',
      },
      {
        id: 'FIN-B-6003',
        date: '2026-05-09T15:20:00Z',
        description: 'Monthly service invoice',
        counterparty: 'Warehouse One',
        category: 'Invoice',
        amount: '$9,740.00',
        status: 'Reconciled',
      },
      {
        id: 'FIN-B-6004',
        date: '2026-05-08T17:05:00Z',
        description: 'Payment correction',
        counterparty: 'Operations ledger',
        category: 'Adjustment',
        amount: '$1,050.00',
        status: 'Completed',
      },
    ],
  },
};

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

export function getMockFinanceDashboard(vendorId?: VendorId): FinanceDashboard {
  const currentVendorId = resolveVendorId(vendorId);
  const dashboard = financeDashboards[currentVendorId];

  return {
    summary: dashboard.summary,
    transactions: dashboard.transactions,
  };
}

export function listMockFinanceTransactions(vendorId?: VendorId): FinanceTransaction[] {
  return getMockFinanceDashboard(vendorId).transactions;
}
