export type FinanceTransactionStatus = 'Completed' | 'Pending' | 'Reconciled' | 'Failed';

export type FinanceSummary = {
  totalRevenue: string;
  availableBalance: string;
  pendingPayouts: string;
  refundsThisMonth: string;
};

export type FinanceTransaction = {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  category: 'Payout' | 'Refund' | 'Invoice' | 'Adjustment';
  amount: string;
  status: FinanceTransactionStatus;
};

export type FinanceDashboard = {
  summary: FinanceSummary;
  transactions: FinanceTransaction[];
};

const financeDashboard: FinanceDashboard = {
  summary: {
    totalRevenue: '$482,400.00',
    availableBalance: '$126,840.00',
    pendingPayouts: '$31,920.00',
    refundsThisMonth: '$8,640.00',
  },
  transactions: [
    {
      id: 'FIN-90041',
      date: '2026-05-10T09:25:00Z',
      description: 'Vendor payout batch',
      counterparty: 'Northwind Retail',
      category: 'Payout',
      amount: '$18,400.00',
      status: 'Completed',
    },
    {
      id: 'FIN-90042',
      date: '2026-05-10T11:10:00Z',
      description: 'Customer refund',
      counterparty: 'Acme Supply Co.',
      category: 'Refund',
      amount: '$420.00',
      status: 'Pending',
    },
    {
      id: 'FIN-90043',
      date: '2026-05-09T16:50:00Z',
      description: 'Monthly service invoice',
      counterparty: 'Cobalt Logistics',
      category: 'Invoice',
      amount: '$9,740.00',
      status: 'Reconciled',
    },
    {
      id: 'FIN-90044',
      date: '2026-05-09T14:20:00Z',
      description: 'Payment correction',
      counterparty: 'Operations ledger',
      category: 'Adjustment',
      amount: '$1,200.00',
      status: 'Completed',
    },
    {
      id: 'FIN-90045',
      date: '2026-05-08T10:05:00Z',
      description: 'Vendor payout batch',
      counterparty: 'Warehouse One',
      category: 'Payout',
      amount: '$22,180.00',
      status: 'Completed',
    },
    {
      id: 'FIN-90046',
      date: '2026-05-07T15:40:00Z',
      description: 'Refund reversal',
      counterparty: 'Cobalt Logistics',
      category: 'Refund',
      amount: '$680.00',
      status: 'Failed',
    },
  ],
};

export function getMockFinanceDashboard(): FinanceDashboard {
  return financeDashboard;
}
