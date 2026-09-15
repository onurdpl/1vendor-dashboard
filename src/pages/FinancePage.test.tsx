import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancePage } from './FinancePage';
import type { FinanceDashboard, FinanceTransaction, SupportTicket } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getFinanceDashboardMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<FinanceDashboard>>();
const getVendorDebtHistoryMock = vi.fn();
const preparePayoutBatchMock = vi.fn();
const listAdminSupportTicketsMock = vi.fn();
const listVendorSupportTicketsMock = vi.fn();

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: (options?: { vendorId?: string | null }) => getFinanceDashboardMock(options),
    getVendorDebtHistory: (...args: unknown[]) => getVendorDebtHistoryMock(...args),
    preparePayoutBatch: (...args: unknown[]) => preparePayoutBatchMock(...args),
  };
});

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

const financeDashboard: FinanceDashboard = {
  summary: {
    grossSales: '$4,000.00',
    refunds: '$725.00',
    netRevenue: '$3,275.00',
    platformFee: '$327.50',
    payoutEstimate: '$2,947.50',
    totalRevenue: '$4,000.00',
    availableBalance: '$2,947.50',
    pendingPayouts: '$0.00',
    refundsThisMonth: '$725.00',
  },
  payoutBatchSummary: {
    eligibleRowCount: 1,
    eligibleNetAmount: '$3,059.10',
    blockedRowCount: 1,
    latestBatch: {
      id: 'batch-demo-vendor-a',
      vendorId: 'demo-vendor-a',
      status: 'draft',
      grossAmount: '$3,399.00',
      commissionAmount: '$339.90',
      commissionVatAmount: '$0.00',
      shippingDeductionAmount: '$0.00',
      refundAmount: '$0.00',
      netAmount: '$3,059.10',
      currency: 'TRY',
      createdByUserId: 'admin',
      createdAt: '2026-05-13T12:00:00Z',
      updatedAt: '2026-05-13T12:00:00Z',
      lineCount: 1,
      warning: null,
    },
  },
  profile: {
    vendorId: 'demo-vendor-a',
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
  transactions: [
    {
      id: 'ledger-sale-recorded',
      date: '2026-05-10T09:15:00Z',
      description: 'Shopify order sale recorded',
      counterparty: 'gid://shopify/Order/1021',
      category: 'Invoice',
      amount: '$3,399.00',
      status: 'Recorded',
      shopifyOrderNumber: '1021',
      shopifyOrderId: '7616544244049',
      payoutCalculation: {
        grossAmount: '$3,399.00',
        commission: '$339.90',
        commissionVat: '$0.00',
        shippingDeduction: '$0.00',
        refundImpact: '$0.00',
        estimatedPayout: '$3,059.10',
        shippingApplied: false,
        shippingMode: 'disabled',
        profileSource: 'snapshot',
        commissionPercent: '10.00',
        commissionVatPercent: '0.00',
      },
      settlement: {
        status: 'payable',
        payoutReady: true,
        eligibleAt: '2026-05-10T09:15:00Z',
        accruedAt: '2026-05-10T09:15:00Z',
        payableAt: '2026-05-10T09:45:00Z',
        settledAt: null,
        holdReason: null,
        note: 'Fulfilled or shipped sale is payout-ready.',
      },
      payoutBatch: {
        id: 'batch-demo-vendor-a',
        status: 'draft',
        netAmount: '$3,059.10',
        createdAt: '2026-05-13T12:00:00Z',
      },
    },
    {
      id: 'ledger-refund-recorded',
      date: '2026-05-11T10:30:00Z',
      description: 'Shopify refund recorded',
      counterparty: 'Acme Supply Co.',
      category: 'Refund',
      amount: '$425.00',
      status: 'Recorded',
      shopifyOrderNumber: '1001',
      shopifyOrderId: 'gid://shopify/Order/1001',
      shopifyRefundId: 'gid://shopify/Refund/501',
      payoutCalculation: {
        grossAmount: '$0.00',
        commission: '$0.00',
        commissionVat: '$0.00',
        shippingDeduction: '$0.00',
        refundImpact: '$425.00',
        estimatedPayout: '-$425.00',
        shippingApplied: false,
        shippingMode: 'disabled',
        profileSource: 'snapshot',
        commissionPercent: '10.00',
        commissionVatPercent: '0.00',
      },
    },
    {
      id: 'ledger-refund-failed',
      date: '2026-05-12T12:00:00Z',
      description: 'Refund ledger write failed',
      counterparty: 'Northwind Retail',
      category: 'Refund',
      amount: '$300.00',
      status: 'Failed',
      shopifyOrderNumber: '1002',
      shopifyOrderId: 'gid://shopify/Order/1002',
      shopifyRefundId: 'gid://shopify/Refund/502',
    },
  ],
};

const financeDashboardWithOrderSettlementRoute: FinanceDashboard = {
  ...financeDashboard,
  transactions: [
    {
      ...financeDashboard.transactions[0],
      ...({ allocationId: 'alloc-finance-1021' } as Record<string, string>),
    },
    ...financeDashboard.transactions.slice(1),
  ],
};

const splitFinanceSummaryBase: NonNullable<FinanceTransaction['splitFinanceSummary']> = {
  splitEventId: 'split-1097',
  sourceAllocationId: 'alloc-source-1097',
  childAllocationId: 'alloc-child-1097',
  sourceFinanceLedgerEntryId: 'ledger-split-source-original',
  remainingFinanceLedgerEntryId: 'ledger-split-source-remaining',
  childFinanceLedgerEntryId: 'ledger-split-child',
  lineageRole: 'source',
  splitReason: 'OUT_OF_STOCK',
  splitCreatedAt: '2026-06-20T08:55:00Z',
};

const emptyVendorDebtHistory = {
  ok: true,
  writesPerformed: false,
  vendorId: 'demo-vendor-a',
  currency: 'TRY',
  summary: {
    outstandingDebtMinor: 0,
    totalDebtCreatedMinor: 0,
    totalDebtOffsetMinor: 0,
    remainingDebtMinor: 0,
    lastDebtActivityAt: null,
  },
  events: [],
};

const vendorDebtHistory = {
  ok: true,
  writesPerformed: false,
  vendorId: 'demo-vendor-a',
  currency: 'TRY',
  summary: {
    outstandingDebtMinor: 264000,
    totalDebtCreatedMinor: 300000,
    totalDebtOffsetMinor: 36000,
    remainingDebtMinor: 264000,
    lastDebtActivityAt: '2026-05-18T10:00:00.000Z',
  },
  events: [
    {
      id: 'vendor-debt-offset-1',
      createdAt: '2026-05-18T10:00:00.000Z',
      type: 'VENDOR_DEBT_OFFSET',
      label: 'Debt Offset Applied',
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
      orderNumber: null,
      shopifyOrderId: null,
      orderCreatedAt: null,
      refundReference: null,
      refundRecordId: null,
      payoutBatchId: 'payout-batch-1',
      payoutBatchStatus: 'DRAFT',
      itemCount: 0,
      productCount: 0,
      products: [],
      amountMinor: 36000,
      debtAmountMinor: -36000,
      remainingDebtAfterEventMinor: 264000,
      sourceReference: 'payout-batch-1',
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
          id: 'vendor-debt-offset-1',
          createdAt: '2026-05-18T10:00:00.000Z',
          payoutBatchId: 'payout-batch-1',
          payoutBatchStatus: 'DRAFT',
          offsetAmountMinor: 36000,
          remainingDebtAfterEventMinor: 264000,
        },
      ],
    },
    {
      id: 'vendor-debt-created-1',
      createdAt: '2026-05-15T10:00:00.000Z',
      type: 'VENDOR_DEBT_CREATED',
      label: 'Debt Created',
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
      orderNumber: '#1082',
      shopifyOrderId: 'gid://shopify/Order/1082',
      orderCreatedAt: '2026-05-10T09:00:00.000Z',
      refundReference: 'gid://shopify/Refund/9001',
      refundRecordId: 'refund-record-9001',
      payoutBatchId: null,
      payoutBatchStatus: null,
      itemCount: 2,
      productCount: 1,
      products: [
        {
          title: 'Nike Test Shoe',
          sku: 'NIKE-42',
          quantity: 2,
        },
      ],
      amountMinor: -300000,
      debtAmountMinor: 300000,
      remainingDebtAfterEventMinor: 300000,
      sourceReference: 'gid://shopify/Refund/9001',
      financeLedgerEntryId: 'ledger-refund-9001',
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
          id: 'vendor-debt-offset-1',
          createdAt: '2026-05-18T10:00:00.000Z',
          payoutBatchId: 'payout-batch-1',
          payoutBatchStatus: 'DRAFT',
          offsetAmountMinor: 36000,
          remainingDebtAfterEventMinor: 264000,
        },
      ],
    },
  ],
} as const;

function supportTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-finance-1',
    createdAt: '2026-05-13T10:00:00Z',
    updatedAt: '2026-05-13T10:00:00Z',
    createdByUserId: 'vendor-user',
    createdByRole: 'VENDOR',
    vendorId: 'demo-vendor-a',
    vendorName: 'Demo Vendor A',
    subject: 'Help with order #1021',
    message: 'Finance review request',
    priority: 'normal',
    status: 'OPEN',
    category: 'PAYOUT',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 0,
    lastReplyAt: null,
    lastReplyByRole: null,
    firstResponseDueAt: null,
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    contextType: 'general',
    contextId: null,
    contextSummary: {
      orderNumber: '1021',
    },
    contextSnapshot: {
      financeLedgerEntryId: 'ledger-sale-recorded',
      orderNumber: '1021',
    },
    resolvedAt: null,
    closedAt: null,
    notes: [],
    replies: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderFinancePage(initialEntries = ['/finance']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <FinancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));

  return result;
}

function renderFinanceOverviewPage(initialEntries = ['/finance']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <FinancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setVendorFinanceUser() {
  setCurrentUser({
    email: 'vendor@demo.com',
    name: 'Demo Vendor',
    role: 'vendor',
    vendorAccess: ['demo-vendor-a'],
    vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
    canSwitchVendors: false,
    defaultVendorId: 'demo-vendor-a',
  });
}

function FinanceNavigationHarness({ target }: { target: string }) {
  const navigate = useNavigate();

  return (
    <>
      <button type="button" onClick={() => navigate(target)}>
        Navigate to linked finance row
      </button>
      <FinancePage />
    </>
  );
}

function renderFinanceNavigationHarness(target: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/finance']}>
        <FinanceNavigationHarness target={target} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));

  return result;
}

function getSidePanel(container: HTMLElement) {
  const panel = container.querySelector('.op-side-panel');
  expect(panel).not.toBeNull();
  return within(panel as HTMLElement);
}

describe('FinancePage control center', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockReset();
    getVendorDebtHistoryMock.mockReset();
    getVendorDebtHistoryMock.mockResolvedValue(emptyVendorDebtHistory);
    preparePayoutBatchMock.mockReset();
    listAdminSupportTicketsMock.mockReset();
    listAdminSupportTicketsMock.mockResolvedValue([]);
    listVendorSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockResolvedValue([]);
  });

  it('renders filters and ledger table frame before finance data hydrates', () => {
    const financeResult = deferred<FinanceDashboard>();
    getFinanceDashboardMock.mockReturnValue(financeResult.promise);

    renderFinancePage();

    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by order #, type, status, amount...')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Source amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Settlement impact' })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.queryByText('Finance unavailable')).not.toBeInTheDocument();
  });

  it('renders recorded and failed finance statuses with operational hierarchy', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    const financeHeading = await screen.findByRole('heading', { name: 'Finance' });
    const financeHeader = financeHeading.closest('.finance-page-header');
    expect(financeHeader).not.toBeNull();
    expect(within(financeHeader as HTMLElement).queryByText('FINANCE')).not.toBeInTheDocument();
    expect(within(financeHeader as HTMLElement).queryByText('Finance workspace')).not.toBeInTheDocument();
    expect(within(financeHeader as HTMLElement).queryByText('Track balances, upcoming payments, and recent finance activity for your marketplace sales.')).not.toBeInTheDocument();
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    const summary = await screen.findByLabelText('Finance workflow summary');
    expect(summary).not.toHaveTextContent('Action required');
    expect(summary).not.toHaveTextContent('Breakdown:');
    expect(screen.queryByLabelText('Financial Totals')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Needs review breakdown')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Needs attention')).toHaveTextContent('1 Failed rows');
    expect(screen.getByLabelText('Needs attention')).not.toHaveTextContent('Blocked rows');
    expect(screen.getByLabelText('Needs attention')).not.toHaveTextContent('Refund reviews');
    expect(screen.getByLabelText('Needs attention')).not.toHaveTextContent('Shipping reconciliation');
    expect(screen.getByLabelText('Settlement')).toHaveTextContent('Review-ready rows');
    expect(screen.getByLabelText('Settlement')).toHaveTextContent('Eligible net estimate');
    expect(screen.getByLabelText('Settlement')).toHaveTextContent('$3,059.10');
    expect(screen.getByLabelText('Financial summary')).not.toHaveTextContent('Estimated balance');
    expect(screen.getByLabelText('Financial summary')).toHaveTextContent('Refund deductions total');
    expect(screen.getByLabelText('Vendor balance')).toHaveTextContent('Vendor balance');
    expect(screen.getByLabelText('Vendor balance')).not.toHaveTextContent('Outstanding adjustment');
    expect(screen.getByLabelText('Draft status')).toHaveTextContent('Latest draft date');
    expect(screen.getByLabelText('Draft status')).toHaveTextContent('May 13, 2026');
    expect(summary.querySelectorAll('.finance-compact-card')).toHaveLength(5);
    expect(screen.getByLabelText('Needs attention')).toHaveClass('finance-compact-card-attention');
    expect(screen.getByLabelText('Settlement')).toHaveClass('finance-compact-card-primary');
    expect(screen.getByLabelText('Financial summary')).toHaveClass('finance-compact-card-secondary');
    expect(screen.getByLabelText('Vendor balance')).toHaveClass('finance-compact-card-secondary');
    expect(screen.getByLabelText('Draft status')).toHaveClass('finance-compact-card-reference');
    expect(screen.queryByLabelText('Action Required')).not.toBeInTheDocument();
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund impact').length).toBeGreaterThan(0);
    expect(screen.queryByText('Action required')).not.toBeInTheDocument();
    expect(screen.queryByText('This period')).not.toBeInTheDocument();
    expect(summary).not.toHaveTextContent('settlement estimate');
    expect(screen.queryByText('Track balances, upcoming payments, and recent finance activity for your marketplace sales.')).not.toBeInTheDocument();
    expect(screen.queryByText('Values update as orders become eligible, refunds are processed, or reviews are completed.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveValue('week');
    expect(screen.getByRole('option', { name: 'This week' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'This month' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All time' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeInTheDocument();
  });

  it('renders non-zero refund and shipping attention metrics without an aggregate total', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            shippingDeduction: '$80.00',
            shippingDeductionSource: 'external_provider',
            shippingCostStatus: 'pending_provider_cost',
            shippingMode: 'external_provider',
            shippingApplied: false,
          },
        },
        {
          ...financeDashboard.transactions[1],
          settlement: {
            status: 'partially_refunded',
            payoutReady: true,
            eligibleAt: '2026-05-11T10:30:00Z',
            accruedAt: '2026-05-11T10:30:00Z',
            payableAt: '2026-05-11T10:30:00Z',
            settledAt: null,
            holdReason: null,
            note: 'Refund impact is ready for offset review.',
          },
        },
      ],
    });

    renderFinancePage();

    const needsAttention = await screen.findByLabelText('Needs attention');
    await waitFor(() => expect(needsAttention).toHaveTextContent('Refund reviews'));
    expect(needsAttention).not.toHaveTextContent('Failed rows');
    expect(needsAttention).not.toHaveTextContent('Blocked rows');
    expect(needsAttention).toHaveTextContent('Shipping reconciliation');
    expect(needsAttention).not.toHaveTextContent('Action required');
    expect(needsAttention).not.toHaveTextContent('Breakdown:');
  });

  it('does not substitute estimated balance when eligible net estimate is absent', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        eligibleNetAmount: undefined as unknown as string,
      },
    });

    renderFinancePage();

    const settlement = await screen.findByLabelText('Settlement');
    await waitFor(() => expect(settlement).toHaveTextContent('1 Review-ready rows'));
    expect(settlement).toHaveTextContent('Review-ready rows');
    expect(settlement).not.toHaveTextContent('Eligible net estimate');
    expect(settlement).not.toHaveTextContent(financeDashboard.summary.payoutEstimate);
  });

  it('hides draft status instead of making a no-draft claim when no latest batch exists', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        latestBatch: null,
      },
    });

    renderFinancePage();

    await waitFor(() => expect(screen.getByLabelText('Settlement')).toHaveTextContent('1 Review-ready rows'));
    expect(screen.queryByLabelText('Draft status')).not.toBeInTheDocument();
    expect(screen.queryByText('No draft')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Finance workflow summary').querySelectorAll('.finance-compact-card')).toHaveLength(4);
  });

  it('hides secondary zero-value summary noise', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      summary: {
        ...financeDashboard.summary,
        refunds: '$0.00',
        refundsThisMonth: '$0.00',
        vendorBalance: '$0.00',
        outstandingVendorDebt: '$0.00',
      },
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        eligibleRowCount: 0,
        eligibleNetAmount: '$0.00',
        blockedRowCount: 3,
        outstandingDebtAmount: '$0.00',
        latestBatch: null,
      },
      transactions: [financeDashboard.transactions[0]],
    });

    renderFinancePage();

    expect(await screen.findByLabelText('Finance workflow summary')).toBeInTheDocument();
    expect(screen.queryByLabelText('Financial summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated balance')).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked rows')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Needs attention')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Draft status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Vendor balance')).not.toHaveTextContent('Outstanding adjustment');
    await waitFor(() => expect(within(screen.getByLabelText('Vendor balance')).getByText('$0.00')).toBeInTheDocument());
    const summary = screen.getByLabelText('Finance workflow summary');
    expect(summary.querySelectorAll('.finance-compact-card')).toHaveLength(2);
    const settlement = screen.getByLabelText('Settlement');
    expect(within(settlement).getByText('0')).toHaveClass('finance-summary-value-muted');
    expect(within(settlement).getByText('$0.00')).toHaveClass('finance-summary-value-muted');
    expect(within(screen.getByLabelText('Vendor balance')).getByText('$0.00')).toHaveClass('finance-summary-value-muted');
  });

  it('keeps refund deductions as the only financial summary metric', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        latestBatch: null,
      },
      transactions: [financeDashboard.transactions[0]],
    });

    renderFinancePage();

    const financialSummary = await screen.findByLabelText('Financial summary');
    expect(financialSummary).toHaveTextContent('Refund deductions total');
    expect(financialSummary).toHaveTextContent('-$725.00');
    expect(financialSummary).not.toHaveTextContent('Estimated balance');
    expect(screen.queryByLabelText('Needs attention')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Draft status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Finance workflow summary').querySelectorAll('.finance-compact-card')).toHaveLength(3);
  });

  it.each(['review', 'approved', 'cancelled', 'execution_pending', 'paid', 'paid_placeholder'] as const)(
    'hides draft status when the latest payout batch is %s',
    async (status) => {
      getFinanceDashboardMock.mockResolvedValue({
        ...financeDashboard,
        payoutBatchSummary: {
          ...financeDashboard.payoutBatchSummary!,
          latestBatch: {
            ...financeDashboard.payoutBatchSummary!.latestBatch!,
            status,
          },
        },
      });

      renderFinancePage();

      const summary = await screen.findByLabelText('Finance workflow summary');
      await waitFor(() => expect(summary.querySelectorAll('.finance-compact-card')).toHaveLength(4));
      expect(screen.queryByLabelText('Draft status')).not.toBeInTheDocument();
      expect(screen.queryByText('No draft')).not.toBeInTheDocument();
    },
  );

  it('renders positive vendor balance in green', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      summary: {
        ...financeDashboard.summary,
        vendorBalance: '$250.00',
        outstandingVendorDebt: '$0.00',
        netPayableAfterDebt: '$3,059.10',
      },
    });

    renderFinancePage();

    expect(await screen.findByText('$250.00')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor balance')).toHaveTextContent('Vendor balance');
    expect(screen.getByLabelText('Vendor balance')).not.toHaveTextContent('Outstanding adjustment');
  });

  it('renders negative vendor balance in red', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      summary: {
        ...financeDashboard.summary,
        vendorBalance: '-$300.00',
        outstandingVendorDebt: '$300.00',
        netPayableAfterDebt: '$2,759.10',
      },
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        outstandingDebtAmount: '$300.00',
        debtOffsetPreviewAmount: '$300.00',
        netEligibleAfterDebtOffset: '$2,759.10',
        remainingDebtAfterPreview: '$0.00',
      },
    });

    renderFinancePage();

    expect((await screen.findAllByText('-$300.00')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Vendor balance')).toHaveTextContent('Vendor balance');
    expect(screen.getByLabelText('Vendor balance')).toHaveTextContent('Outstanding adjustment');
    expect(screen.getByLabelText('Vendor balance')).toHaveTextContent('$300.00');
    expect(screen.getByLabelText('Vendor balance')).not.toHaveTextContent('Outstanding adjustment1');
  });

  it('renders vendor debt history summary and event rows', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    getVendorDebtHistoryMock.mockResolvedValue(vendorDebtHistory);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Balance Adjustment History' })).toBeInTheDocument();
    expect(screen.getByText('Outstanding Adjustment')).toBeInTheDocument();
    expect(screen.getByText('Total Adjustment Created')).toBeInTheDocument();
    expect(screen.getByText('Total Adjustment Applied')).toBeInTheDocument();
    expect(screen.getByText('Remaining Adjustment')).toBeInTheDocument();
    expect(await screen.findByText('Debt Created')).toBeInTheDocument();
    expect(screen.getAllByText('Debt Offset Applied').length).toBeGreaterThan(0);
    expect(screen.getByText('#1082')).toBeInTheDocument();
    expect(screen.getByText('gid://shopify/Refund/9001')).toBeInTheDocument();
    expect(screen.getAllByText('payout-batch-1').length).toBeGreaterThan(0);
    expect(screen.getByText('1 products')).toBeInTheDocument();
  });

  it('opens a vendor debt detail panel with order, refund, products, calculation, and offsets', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    getVendorDebtHistoryMock.mockResolvedValue(vendorDebtHistory);

    renderFinancePage();

    const debtCreatedRow = (await screen.findByText('Debt Created')).closest('[role="button"]');
    expect(debtCreatedRow).not.toBeNull();
    await userEvent.click(debtCreatedRow!);

    expect(screen.getByRole('heading', { name: 'Debt Created' })).toBeInTheDocument();
    expect(screen.getByText('Shopify order id')).toBeInTheDocument();
    expect(screen.getAllByText('gid://shopify/Order/1082').length).toBeGreaterThan(0);
    expect(screen.getByText('Refund reference')).toBeInTheDocument();
    expect(screen.getAllByText('gid://shopify/Refund/9001').length).toBeGreaterThan(0);
    expect(screen.getByText('Nike Test Shoe')).toBeInTheDocument();
    expect(screen.getByText('NIKE-42 · Qty 2')).toBeInTheDocument();
    expect(screen.getByText('Commission reversal')).toBeInTheDocument();
    expect(screen.getByText('Commission VAT reversal')).toBeInTheDocument();
    expect(screen.getByText('Balance adjustment created')).toBeInTheDocument();
    expect(screen.getByText('vendorDebtMinor = refundMinor - commissionReversalMinor - commissionVatReversalMinor')).toBeInTheDocument();
    expect(screen.getAllByText(/payout-batch-1/).length).toBeGreaterThan(0);
  });

  it('renders vendor debt empty state', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    getVendorDebtHistoryMock.mockResolvedValue(emptyVendorDebtHistory);

    renderFinancePage();

    expect(await screen.findByText('No balance adjustment history')).toBeInTheDocument();
  });

  it('uses workflow query params to open settlement review rows and allows reset', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage(['/finance?workflow=settlement-review']);

    expect(await screen.findByLabelText('Active workflow filter')).toHaveTextContent('Settlement review');
    expect((await screen.findAllByText('#1021')).length).toBeGreaterThan(0);
    expect(screen.queryByText('#1001')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear workflow' }));

    expect(await screen.findByText('#1001')).toBeInTheDocument();
  });

  it('preserves reset behavior without changing the date range control', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    const searchInput = screen.getByPlaceholderText('Search by order #, type, status, amount...');
    const [statusFilter, categoryFilter, dateRange] = screen.getAllByRole('combobox');

    await userEvent.type(searchInput, '1021');
    await userEvent.selectOptions(statusFilter, 'Blocked');
    await userEvent.selectOptions(categoryFilter, 'Refund');
    await userEvent.selectOptions(dateRange, 'all');

    expect(searchInput).toHaveValue('1021');
    expect(statusFilter).toHaveValue('Blocked');
    expect(categoryFilter).toHaveValue('Refund');
    expect(dateRange).toHaveValue('all');

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(searchInput).toHaveValue('');
    expect(statusFilter).toHaveValue('all');
    expect(categoryFilter).toHaveValue('all');
    expect(dateRange).toHaveValue('all');
  });

  it('renders an honest empty state for empty settlement workflow queues', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [financeDashboard.transactions[1], financeDashboard.transactions[2]],
    });

    renderFinancePage(['/finance?workflow=settlement-review']);

    expect(await screen.findByText('No settlement review rows currently pending')).toBeInTheDocument();
    expect(screen.getByText('This workflow queue has no settlement rows waiting for review. Clear the workflow to inspect all finance activity.')).toBeInTheDocument();
    expect(screen.getByLabelText('Active workflow filter')).toHaveTextContent('Settlement review');
  });

  it('shows approved commission-invoiced finance rows as locked instead of pending review', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          status: 'Pending',
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            payoutReady: false,
            review: {
              approvalId: 'approval-1087',
              approvalStatus: 'approved',
              commissionInvoiceId: 'commission-invoice-1087',
              commissionInvoiceStatus: 'created',
              invoiceNo: null,
              providerUuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
            },
          },
        },
      ],
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        eligibleRowCount: 0,
        eligibleNetAmount: '$0.00',
        blockedRowCount: 0,
        latestBatch: null,
      },
    });

    renderFinancePage();

    expect((await screen.findAllByText('Commission invoiced')).length).toBeGreaterThan(0);
    expect(screen.getByText('Logo commission invoice created')).toBeInTheDocument();
    expect(screen.getByText('Review commission invoice')).toBeInTheDocument();
    expect(screen.getByText('82691C7B-28D6-4E30-95C9-C0658E90F090')).toBeInTheDocument();
    expect(screen.queryByText('Settlement awaiting review')).not.toBeInTheDocument();
    expect(screen.queryByText('Inspect review state before draft preparation or reconciliation.')).not.toBeInTheDocument();
  });

  it('excludes approved commission-invoiced rows from the settlement review workflow queue', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          status: 'Pending',
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            payoutReady: false,
            review: {
              approvalId: 'approval-1087',
              approvalStatus: 'approved',
              commissionInvoiceId: 'commission-invoice-1087',
              commissionInvoiceStatus: 'created',
              invoiceNo: 'REE2026000000068',
              providerUuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
            },
          },
        },
      ],
    });

    renderFinancePage(['/finance?workflow=settlement-review']);

    expect(await screen.findByText('No settlement review rows currently pending')).toBeInTheDocument();
    expect(screen.queryByText('#1021')).not.toBeInTheDocument();
  });

  it('renders order settlement deep links for finance rows with order detail route ids', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboardWithOrderSettlementRoute);

    const { container } = renderFinancePage();

    expect((await screen.findAllByText('#1021')).length).toBeGreaterThan(0);
    const financeTable = container.querySelector('.finance-op-table');
    expect(financeTable).toBeTruthy();
    const rowSettlementLink = within(financeTable as HTMLElement).getByRole('link', { name: 'View order settlement' });
    expect(rowSettlementLink).toHaveAttribute('href', '/orders/alloc-finance-1021#settlement-preview');

    const inspector = container.querySelector('.op-side-panel');
    expect(inspector).toBeTruthy();
    expect(within(inspector as HTMLElement).getByRole('link', { name: 'View order settlement' })).toHaveAttribute(
      'href',
      '/orders/alloc-finance-1021#settlement-preview',
    );
  });

  it('formats prefixed and unprefixed Shopify order numbers without duplicate prefixes', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-prefixed-order',
          shopifyOrderNumber: '#1132',
          payoutBatch: null,
        },
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-unprefixed-order',
          shopifyOrderNumber: '1133',
          payoutBatch: null,
        },
      ],
    });

    const { container } = renderFinancePage();

    const table = within(container.querySelector('.finance-op-table') as HTMLElement);
    expect(await table.findByText('#1132')).toBeInTheDocument();
    expect(table.getByText('#1133')).toBeInTheDocument();
    expect(table.queryByText('##1132')).not.toBeInTheDocument();

    const panel = getSidePanel(container);
    const transactionCard = panel.getByText('Transaction').closest('.finance-selected-summary-card');
    expect(transactionCard).not.toBeNull();
    expect(within(transactionCard as HTMLElement).getByText('#1132')).toBeInTheDocument();
    expect(within(transactionCard as HTMLElement).queryByText('##1132')).not.toBeInTheDocument();
  });

  it('keeps the existing missing order-number fallbacks', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-missing-order-number',
          shopifyOrderNumber: undefined,
          shopifyOrderId: undefined,
          payoutBatch: null,
        },
      ],
    });

    const { container } = renderFinancePage();

    const table = within(container.querySelector('.finance-op-table') as HTMLElement);
    expect((await table.findAllByText('—')).length).toBeGreaterThan(0);
    const panel = getSidePanel(container);
    const transactionCard = panel.getByText('Transaction').closest('.finance-selected-summary-card');
    expect(transactionCard).not.toBeNull();
    expect(within(transactionCard as HTMLElement).getByText('Unknown')).toBeInTheDocument();
  });

  it('opens the finance detail panel for a selected ledger row', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    const { container } = renderFinancePage();

    await screen.findByText('#1002');
    await userEvent.click(screen.getAllByRole('button', { name: 'View details' })[2]);

    expect(await screen.findByText('Transaction')).toBeInTheDocument();
    const panel = getSidePanel(container);
    const transactionCard = panel.getByText('Transaction').closest('.finance-selected-summary-card');
    expect(transactionCard).not.toBeNull();
    expect(within(transactionCard as HTMLElement).getByText('Order')).toBeInTheDocument();
    expect(within(transactionCard as HTMLElement).getByText('Type')).toBeInTheDocument();
    expect(within(transactionCard as HTMLElement).queryByText('Payment impact')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment readiness')).not.toBeInTheDocument();
    expect(screen.queryByText('Balance adjustment impact on payment')).not.toBeInTheDocument();
    expect(screen.getByText('Internal notes')).toBeInTheDocument();
    expect(screen.getByText('No notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add an internal note/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Settlement')).toBeInTheDocument();
    expect(screen.getByText('Financial preview')).toBeInTheDocument();
    expect(screen.queryByText('Shipping cost review')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Order #1002' })).toBeInTheDocument();
    expect(screen.queryByText('Deductions')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sync accounting draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry accounting sync/i })).not.toBeInTheDocument();
    const inspectorBody = container.querySelector('.finance-control-center .op-side-panel-body');
    expect(inspectorBody?.querySelector(':scope > .admin-collab-card')).toBeTruthy();
    expect(inspectorBody?.querySelector(':scope > .finance-invoice-card')).toBeFalsy();
    expect(inspectorBody?.querySelectorAll(':scope > .finance-detail-card').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Shopify identifiers')).not.toBeInTheDocument();
  });

  it('renders unknown instead of fake zero when a row has no calculation snapshot', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    const { container } = renderFinancePage();

    await screen.findByText('#1002');
    await userEvent.click(screen.getAllByRole('button', { name: 'View details' })[2]);

    expect((await screen.findAllByText('Status')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    const panel = getSidePanel(container);
    const transactionCard = panel.getByText('Transaction').closest('.finance-selected-summary-card');
    expect(transactionCard).not.toBeNull();
    expect(within(transactionCard as HTMLElement).queryByText('Payment impact')).not.toBeInTheDocument();
  });

  it('shows only the existing refund impact for the guarded canonical refund preview', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [financeDashboard.transactions[1]],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);
    const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);

    expect(within(preview.getByText('Refund impact').closest('.op-meta-row') as HTMLElement).getByText('-$425.00')).toBeInTheDocument();
    expect(preview.queryByText('Gross allocation amount')).not.toBeInTheDocument();
    expect(preview.queryByText(/^Commission \(/)).not.toBeInTheDocument();
    expect(preview.queryByText(/^Commission VAT \(/)).not.toBeInTheDocument();
    expect(preview.queryByText('Estimated vendor payable')).not.toBeInTheDocument();
    expect(preview.queryByText('This amount is not currently payable.')).not.toBeInTheDocument();
  });

  it('suppresses only a negative Sale estimate when finite refund evidence is present', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-sale-refund-negative-preview',
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            grossAmount: 'TRY 4,199.00',
            commission: 'TRY 629.85',
            commissionVat: 'TRY 125.97',
            shippingDeduction: 'TRY 80.00',
            refundImpact: 'TRY 4,199.00',
            estimatedPayout: '-TRY 835.82',
            shippingApplied: true,
          },
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'partially_refunded',
            payoutReady: true,
          },
          splitFinanceSummary: null,
        },
      ],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);
    const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);

    expect(within(preview.getByText('Gross allocation amount').closest('.op-meta-row') as HTMLElement).getByText('TRY 4,199.00')).toBeInTheDocument();
    expect(within(preview.getByText(/^Commission \(/).closest('.op-meta-row') as HTMLElement).getByText('-TRY 629.85')).toBeInTheDocument();
    expect(within(preview.getByText(/^Commission VAT \(/).closest('.op-meta-row') as HTMLElement).getByText('-TRY 125.97')).toBeInTheDocument();
    expect(within(preview.getByText('Shipping fee').closest('.op-meta-row') as HTMLElement).getByText('-TRY 80.00')).toBeInTheDocument();
    expect(within(preview.getByText('Refund impact').closest('.op-meta-row') as HTMLElement).getByText('-TRY 4,199.00')).toBeInTheDocument();
    expect(preview.queryByText('Estimated vendor payable')).not.toBeInTheDocument();
    expect(preview.queryByText('This amount is not currently payable.')).not.toBeInTheDocument();
    expect(panel.getByText('Payment eligibility')).toBeInTheDocument();
    expect(panel.getByText('Eligible')).toBeInTheDocument();
  });

  it('suppresses the amount-dependent helper with a guarded negative Sale estimate', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-sale-refund-negative-not-eligible',
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            refundImpact: '$3,399.00',
            estimatedPayout: '-$339.90',
          },
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'accruing',
            payoutReady: false,
          },
          payoutBatch: null,
          splitFinanceSummary: null,
        },
      ],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);
    const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);

    expect(panel.getByText('Not eligible')).toBeInTheDocument();
    expect(preview.getByText('Refund impact')).toBeInTheDocument();
    expect(preview.queryByText('Estimated vendor payable')).not.toBeInTheDocument();
    expect(preview.queryByText('This amount is not currently payable.')).not.toBeInTheDocument();
  });

  it('preserves Sale estimates outside the guarded negative refund projection', async () => {
    const cases: Array<{ name: string; transaction: FinanceTransaction; expectedEstimate: string }> = [
      {
        name: 'ordinary Sale without refund evidence',
        transaction: { ...financeDashboard.transactions[0], splitFinanceSummary: null },
        expectedEstimate: '$3,059.10',
      },
      {
        name: 'partial refund with a positive estimate',
        transaction: {
          ...financeDashboard.transactions[0],
          id: 'ledger-sale-partial-refund-positive',
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            refundImpact: '$500.00',
            estimatedPayout: '$2,559.10',
          },
          splitFinanceSummary: null,
        },
        expectedEstimate: '$2,559.10',
      },
      {
        name: 'Sale with a nonnumeric calculation value',
        transaction: {
          ...financeDashboard.transactions[0],
          id: 'ledger-sale-refund-unknown-calculation',
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            commission: 'Unknown',
            refundImpact: '$3,399.00',
            estimatedPayout: '-$339.90',
          },
          splitFinanceSummary: null,
        },
        expectedEstimate: '-$339.90',
      },
      {
        name: 'split Sale with a negative refund projection',
        transaction: {
          ...financeDashboard.transactions[0],
          id: 'ledger-split-sale-refund-negative',
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            refundImpact: '$3,399.00',
            estimatedPayout: '-$339.90',
          },
          splitFinanceSummary: splitFinanceSummaryBase,
        },
        expectedEstimate: '-$339.90',
      },
    ];

    for (const previewCase of cases) {
      getFinanceDashboardMock.mockResolvedValue({
        ...financeDashboard,
        transactions: [previewCase.transaction],
      });

      const { container, unmount } = renderFinancePage();
      const panel = getSidePanel(container);
      const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
      expect(previewCard, previewCase.name).not.toBeNull();
      const preview = within(previewCard as HTMLElement);
      expect(preview.getByText('Estimated vendor payable'), previewCase.name).toBeInTheDocument();
      expect(
        within(preview.getByText('Estimated vendor payable').closest('.op-meta-row') as HTMLElement).getByText(previewCase.expectedEstimate),
        previewCase.name,
      ).toBeInTheDocument();
      unmount();
      cleanup();
    }
  });

  it('applies the guarded negative Sale estimate cleanup to the existing finance-role rail', async () => {
    setCurrentUser({
      email: 'finance@demo.com',
      name: 'Demo Finance',
      role: 'finance',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-sale-refund-negative-finance-role',
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            refundImpact: '$3,399.00',
            estimatedPayout: '-$339.90',
          },
          splitFinanceSummary: null,
        },
      ],
    });

    const { container } = renderFinancePage();
    const financeHeading = await screen.findByRole('heading', { name: 'Finance' });
    const financeHeader = financeHeading.closest('.finance-page-header');
    expect(financeHeader).not.toBeNull();
    expect(within(financeHeader as HTMLElement).queryByText('FINANCE')).not.toBeInTheDocument();
    expect(within(financeHeader as HTMLElement).queryByText('Finance workspace')).not.toBeInTheDocument();
    expect(within(financeHeader as HTMLElement).queryByText('Track balances, upcoming payments, and recent finance activity for your marketplace sales.')).not.toBeInTheDocument();
    const panel = getSidePanel(container);
    const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);

    expect(preview.getByText('Refund impact')).toBeInTheDocument();
    expect(preview.queryByText('Estimated vendor payable')).not.toBeInTheDocument();
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect(screen.queryByLabelText('Finance workflow summary')).not.toBeInTheDocument();
  });

  it('applies the guarded refund preview cleanup to the existing finance-role rail', async () => {
    setCurrentUser({
      email: 'finance@demo.com',
      name: 'Demo Finance',
      role: 'finance',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [financeDashboard.transactions[1]],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);
    const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);

    expect(within(preview.getByText('Refund impact').closest('.op-meta-row') as HTMLElement).getByText('-$425.00')).toBeInTheDocument();
    expect(preview.queryByText('Gross allocation amount')).not.toBeInTheDocument();
    expect(preview.queryByText('Estimated vendor payable')).not.toBeInTheDocument();
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('preserves distinct refund preview values when a shipping deduction changes the net result', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[1],
          payoutCalculation: {
            ...financeDashboard.transactions[1].payoutCalculation!,
            shippingDeduction: '$80.00',
            estimatedPayout: '-$505.00',
            shippingApplied: true,
            shippingMode: 'external_provider',
            shippingDeductionSource: 'external_provider',
            shippingCostStatus: 'snapshot',
          },
        },
      ],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);
    const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);

    expect(preview.getByText('Gross allocation amount')).toBeInTheDocument();
    expect(preview.getByText(/^Commission \(/)).toBeInTheDocument();
    expect(preview.getByText(/^Commission VAT \(/)).toBeInTheDocument();
    expect(within(preview.getByText('Shipping fee').closest('.op-meta-row') as HTMLElement).getByText('-$80.00')).toBeInTheDocument();
    expect(within(preview.getByText('Refund impact').closest('.op-meta-row') as HTMLElement).getByText('-$425.00')).toBeInTheDocument();
    expect(within(preview.getByText('Estimated vendor payable').closest('.op-meta-row') as HTMLElement).getByText('-$505.00')).toBeInTheDocument();
  });

  it('preserves noncanonical and missing-calculation refund preview compatibility', async () => {
    const cases: Array<{ name: string; transaction: FinanceTransaction; expectedGross: string; expectedEstimate: string }> = [
      {
        name: 'nonzero gross and commission',
        transaction: {
          ...financeDashboard.transactions[1],
          id: 'ledger-refund-noncanonical-preview',
          payoutCalculation: {
            ...financeDashboard.transactions[1].payoutCalculation!,
            grossAmount: '$100.00',
            commission: '$10.00',
            commissionVat: '$2.00',
            estimatedPayout: '-$337.00',
          },
        },
        expectedGross: '$100.00',
        expectedEstimate: '-$337.00',
      },
      {
        name: 'missing calculation',
        transaction: {
          ...financeDashboard.transactions[1],
          id: 'ledger-refund-missing-preview',
          payoutCalculation: undefined,
        },
        expectedGross: '$425.00',
        expectedEstimate: '$425.00',
      },
      {
        name: 'unknown gross calculation input',
        transaction: {
          ...financeDashboard.transactions[1],
          id: 'ledger-refund-unknown-gross-preview',
          payoutCalculation: {
            ...financeDashboard.transactions[1].payoutCalculation!,
            grossAmount: 'Unknown',
          },
        },
        expectedGross: 'Unknown',
        expectedEstimate: '-$425.00',
      },
    ];

    for (const previewCase of cases) {
      getFinanceDashboardMock.mockResolvedValue({
        ...financeDashboard,
        transactions: [previewCase.transaction],
      });

      const { container, unmount } = renderFinancePage();
      const panel = getSidePanel(container);
      const previewCard = (await panel.findByText('Financial preview')).closest('.finance-detail-card');
      expect(previewCard, previewCase.name).not.toBeNull();
      const preview = within(previewCard as HTMLElement);

      expect(within(preview.getByText('Gross allocation amount').closest('.op-meta-row') as HTMLElement).getByText(previewCase.expectedGross), previewCase.name).toBeInTheDocument();
      expect(preview.getByText(/^Commission \(/), previewCase.name).toBeInTheDocument();
      expect(preview.getByText(/^Commission VAT \(/), previewCase.name).toBeInTheDocument();
      expect(within(preview.getByText('Estimated vendor payable').closest('.op-meta-row') as HTMLElement).getByText(previewCase.expectedEstimate), previewCase.name).toBeInTheDocument();

      unmount();
      cleanup();
    }
  });

  it('renders a compact finance state column while detailed lifecycle states stay in the panel', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutBatch: null,
        },
        ...financeDashboard.transactions.slice(1),
      ],
    });

    const { container } = renderFinancePage();

    expect(await screen.findByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Settlement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Payout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Hold / Blocker' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Source amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Settlement impact' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.finance-queue-state').length).toBeGreaterThan(0));

    await userEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);

    expect((await screen.findAllByText('Payment eligibility')).length).toBeGreaterThan(0);
    expect(screen.getByText('Eligible')).toBeInTheDocument();
    expect(screen.queryByText('Ready for review')).not.toBeInTheDocument();
    expect(screen.queryByText('Reason')).not.toBeInTheDocument();
    expect(screen.getByText('Next action')).toBeInTheDocument();
    expect(screen.getByText('Review settlement')).toBeInTheDocument();
    expect(screen.getByText('Settlement state')).toBeInTheDocument();
    expect(screen.getByText('Review pending')).toBeInTheDocument();
  });

  it('keeps structured Settlement status canonical across representative non-vendor states', async () => {
    const cases: Array<{
      name: string;
      transaction: FinanceTransaction;
      status: string;
      reason: string | null;
    }> = [
      {
        name: 'refund offset review',
        transaction: {
          ...financeDashboard.transactions[1],
          settlement: {
            status: 'partially_refunded',
            payoutReady: true,
            eligibleAt: '2026-06-21T09:15:00Z',
            accruedAt: '2026-06-21T09:15:00Z',
            payableAt: '2026-06-21T09:15:00Z',
            settledAt: null,
            holdReason: null,
            note: 'Refund impact is reducing the vendor balance.',
          },
        },
        status: 'Refund offset review',
        reason: null,
      },
      {
        name: 'ordinary payable sale',
        transaction: { ...financeDashboard.transactions[0], payoutBatch: null },
        status: 'Pending review',
        reason: null,
      },
      {
        name: 'vendor-blocked hold',
        transaction: {
          ...financeDashboard.transactions[0],
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'held',
            payoutReady: false,
            holdReason: 'Vendor allocation is blocked and awaiting admin resolution.',
          },
        },
        status: 'On hold',
        reason: 'Vendor blocked',
      },
      {
        name: 'failed ledger',
        transaction: financeDashboard.transactions[2],
        status: 'Blocked',
        reason: 'Finance issue',
      },
      {
        name: 'held settlement without a reason',
        transaction: {
          ...financeDashboard.transactions[0],
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'held',
            payoutReady: false,
            holdReason: null,
          },
        },
        status: 'Blocked',
        reason: 'Held',
      },
      {
        name: 'held settlement with an active reason',
        transaction: {
          ...financeDashboard.transactions[0],
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'held',
            payoutReady: false,
            holdReason: 'operator_review',
          },
        },
        status: 'Blocked',
        reason: 'Hold active',
      },
      {
        name: 'disputed settlement',
        transaction: {
          ...financeDashboard.transactions[0],
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'disputed',
            payoutReady: false,
            holdReason: null,
          },
        },
        status: 'Blocked',
        reason: 'Disputed',
      },
      {
        name: 'paid transaction',
        transaction: {
          ...financeDashboard.transactions[0],
          status: 'Completed',
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'settled',
            payoutReady: false,
            settledAt: '2026-06-22T09:15:00Z',
          },
          payoutBatch: {
            id: 'batch-paid-status-owner',
            status: 'paid',
            netAmount: '$3,059.10',
            createdAt: '2026-06-21T09:15:00Z',
            paidAt: '2026-06-22T09:15:00Z',
            paymentReference: 'EFT-STATUS-OWNER',
          },
        },
        status: 'Paid',
        reason: null,
      },
      {
        name: 'ordinary estimated fallback',
        transaction: {
          ...financeDashboard.transactions[0],
          payoutBatch: null,
          settlement: undefined,
        },
        status: 'Estimated',
        reason: null,
      },
    ];

    for (const statusCase of cases) {
      getFinanceDashboardMock.mockResolvedValue({ ...financeDashboard, transactions: [statusCase.transaction] });
      const { container, unmount } = renderFinancePage();
      const panel = getSidePanel(container);

      const transactionHeading = (await panel.findByText('Transaction')).closest('.finance-detail-card-heading');
      expect(transactionHeading, statusCase.name).not.toBeNull();
      expect(transactionHeading?.querySelector('.op-badge'), statusCase.name).toBeNull();

      const settlementCard = panel.getByText('Settlement').closest('.finance-detail-card');
      expect(settlementCard, statusCase.name).not.toBeNull();
      const settlementHeading = within(settlementCard as HTMLElement).getByText('Settlement').closest('.finance-detail-card-heading');
      expect(settlementHeading?.querySelector('.op-badge'), statusCase.name).toBeNull();

      const statusRow = within(settlementCard as HTMLElement).getByText('Status').closest('.op-meta-row');
      expect(statusRow, statusCase.name).not.toBeNull();
      expect(within(statusRow as HTMLElement).getByText(statusCase.status), statusCase.name).toBeInTheDocument();

      if (statusCase.reason === null) {
        expect(within(settlementCard as HTMLElement).queryByText('Reason'), statusCase.name).not.toBeInTheDocument();
      } else {
        const reasonRow = within(settlementCard as HTMLElement).getByText('Reason').closest('.op-meta-row');
        expect(reasonRow, statusCase.name).not.toBeNull();
        expect(within(reasonRow as HTMLElement).getByText(statusCase.reason), statusCase.name).toBeInTheDocument();
      }

      unmount();
      cleanup();
    }
  });

  it('hides only the absent Reason for an ordinary estimated sale', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-estimated-detail-cleanup',
          payoutBatch: null,
          settlement: undefined,
        },
      ],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);
    const settlementCard = (await panel.findByText('Settlement')).closest('.finance-detail-card');
    expect(settlementCard).not.toBeNull();
    const settlement = within(settlementCard as HTMLElement);

    expect(within(settlement.getByText('Status').closest('.op-meta-row') as HTMLElement).getByText('Estimated')).toBeInTheDocument();
    expect(settlement.queryByText('Reason')).not.toBeInTheDocument();
    expect(within(settlement.getByText('Payment eligibility').closest('.op-meta-row') as HTMLElement).getByText('Not eligible')).toBeInTheDocument();
    expect(within(settlement.getByText('Next action').closest('.op-meta-row') as HTMLElement).getByText('Monitor eligibility')).toBeInTheDocument();
    expect(panel.getByText('Financial preview')).toBeInTheDocument();
    expect(panel.getByText('Gross allocation amount')).toBeInTheDocument();
    expect(panel.getByText('Estimated vendor payable')).toBeInTheDocument();
    expect(panel.getByText('This amount is not currently payable.')).toBeInTheDocument();
  });

  it('suppresses Payment only when its final label exactly matches Status', async () => {
    const payoutCases = [
      ['draft', 'Estimated'],
      ['review', 'Pending review'],
      ['approved', 'Approved'],
      ['execution_pending', 'Scheduled'],
      ['paid', 'Paid'],
    ] as const;

    for (const [batchStatus, expectedStatus] of payoutCases) {
      getFinanceDashboardMock.mockResolvedValue({
        ...financeDashboard,
        transactions: [
          {
            ...financeDashboard.transactions[0],
            id: `ledger-${batchStatus}-detail-cleanup`,
            status: batchStatus === 'paid' ? 'Completed' : 'Recorded',
            settlement: {
              ...financeDashboard.transactions[0].settlement!,
              status: batchStatus === 'paid' ? 'settled' : 'payable',
              payoutReady: batchStatus !== 'paid',
              settledAt: batchStatus === 'paid' ? '2026-06-22T09:15:00Z' : null,
            },
            payoutBatch: {
              id: `batch-${batchStatus}-detail-cleanup`,
              status: batchStatus,
              netAmount: '$3,059.10',
              createdAt: '2026-06-21T09:15:00Z',
              paidAt: batchStatus === 'paid' ? '2026-06-22T09:15:00Z' : null,
              paymentReference: batchStatus === 'paid' ? 'EFT-DETAIL-CLEANUP' : null,
            },
          },
        ],
      });

      const { container, unmount } = renderFinancePage();
      const panel = getSidePanel(container);
      const settlementCard = (await panel.findByText('Settlement')).closest('.finance-detail-card');
      expect(settlementCard, batchStatus).not.toBeNull();
      const settlement = within(settlementCard as HTMLElement);
      const statusRow = settlement.getByText('Status').closest('.op-meta-row');
      expect(within(statusRow as HTMLElement).getByText(expectedStatus), batchStatus).toBeInTheDocument();
      expect(settlement.queryByText('Payment'), batchStatus).not.toBeInTheDocument();
      if (batchStatus === 'paid') {
        expect(within(settlement.getByText('Settlement state').closest('.op-meta-row') as HTMLElement).getByText('Settled')).toBeInTheDocument();
        expect(settlement.getByText('Not eligible')).toBeInTheDocument();
      }

      unmount();
      cleanup();
    }

    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-distinct-payment-detail-cleanup',
          status: 'Failed',
          payoutBatch: {
            id: 'batch-distinct-payment-detail-cleanup',
            status: 'approved',
            netAmount: '$3,059.10',
            createdAt: '2026-06-21T09:15:00Z',
          },
        },
      ],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);
    const settlementCard = (await panel.findByText('Settlement')).closest('.finance-detail-card');
    const settlement = within(settlementCard as HTMLElement);
    expect(within(settlement.getByText('Status').closest('.op-meta-row') as HTMLElement).getByText('Blocked')).toBeInTheDocument();
    expect(within(settlement.getByText('Reason').closest('.op-meta-row') as HTMLElement).getByText('Finance issue')).toBeInTheDocument();
    expect(within(settlement.getByText('Payment').closest('.op-meta-row') as HTMLElement).getByText('Approved')).toBeInTheDocument();
  });

  it('suppresses Review status only when its final label exactly matches Status', async () => {
    const reviewCases = [
      {
        name: 'draft',
        status: 'Settlement draft locked',
        review: {
          approvalId: 'approval-draft-detail-cleanup',
          approvalStatus: 'draft' as const,
          commissionInvoiceId: null,
          commissionInvoiceStatus: null,
          invoiceNo: null,
          providerUuid: null,
        },
        referenceLabel: 'Settlement reference',
        referenceValue: 'approval-draft-detail-cleanup',
      },
      {
        name: 'approved',
        status: 'Settlement approved',
        review: {
          approvalId: 'approval-approved-detail-cleanup',
          approvalStatus: 'approved' as const,
          commissionInvoiceId: null,
          commissionInvoiceStatus: null,
          invoiceNo: null,
          providerUuid: null,
        },
        referenceLabel: 'Settlement reference',
        referenceValue: 'approval-approved-detail-cleanup',
      },
      {
        name: 'commission invoiced',
        status: 'Commission invoiced',
        review: {
          approvalId: 'approval-invoiced-detail-cleanup',
          approvalStatus: 'approved' as const,
          commissionInvoiceId: 'commission-invoice-detail-cleanup',
          commissionInvoiceStatus: 'created',
          invoiceNo: 'INV-DETAIL-CLEANUP',
          providerUuid: 'provider-detail-cleanup',
        },
        referenceLabel: 'Commission invoice reference',
        referenceValue: 'INV-DETAIL-CLEANUP',
      },
    ];

    for (const reviewCase of reviewCases) {
      getFinanceDashboardMock.mockResolvedValue({
        ...financeDashboard,
        transactions: [
          {
            ...financeDashboard.transactions[0],
            id: `ledger-${reviewCase.name}-detail-cleanup`,
            payoutBatch: null,
            settlement: {
              ...financeDashboard.transactions[0].settlement!,
              review: reviewCase.review,
            },
          },
        ],
      });

      const { container, unmount } = renderFinancePage();
      const panel = getSidePanel(container);
      const settlementCard = (await panel.findByText('Settlement')).closest('.finance-detail-card');
      expect(settlementCard, reviewCase.name).not.toBeNull();
      const settlement = within(settlementCard as HTMLElement);
      expect(within(settlement.getByText('Status').closest('.op-meta-row') as HTMLElement).getByText(reviewCase.status), reviewCase.name).toBeInTheDocument();
      expect(settlement.queryByText('Review status'), reviewCase.name).not.toBeInTheDocument();
      expect(settlement.getByText('Approval'), reviewCase.name).toBeInTheDocument();
      expect(settlement.getByText(reviewCase.referenceLabel), reviewCase.name).toBeInTheDocument();
      expect(settlement.getAllByText(reviewCase.referenceValue).length, reviewCase.name).toBeGreaterThan(0);

      unmount();
      cleanup();
    }
  });

  it('keeps the existing finance-role audience projection while cleaning the non-vendor rail', async () => {
    setCurrentUser({
      email: 'finance@demo.com',
      name: 'Demo Finance',
      role: 'finance',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutBatch: {
            ...financeDashboard.transactions[0].payoutBatch!,
            status: 'paid_placeholder',
          },
        },
      ],
    });

    const { container } = renderFinancePage();
    const panel = getSidePanel(container);

    const transactionHeading = (await panel.findByText('Transaction')).closest('.finance-detail-card-heading');
    expect(transactionHeading?.querySelector('.op-badge')).toBeNull();
    const settlementCard = panel.getByText('Settlement').closest('.finance-detail-card');
    expect(settlementCard).not.toBeNull();
    const statusRow = within(settlementCard as HTMLElement).getByText('Status').closest('.op-meta-row');
    expect(statusRow).not.toBeNull();
    expect(within(statusRow as HTMLElement).getByText('Pending review')).toBeInTheDocument();
    expect(within(settlementCard as HTMLElement).queryByText('Payment evidence pending')).not.toBeInTheDocument();
    expect(within(settlementCard as HTMLElement).queryByText('Reason')).not.toBeInTheDocument();
    expect(within(settlementCard as HTMLElement).queryByText('Payment')).not.toBeInTheDocument();
  });

  it('uses stable source amount and settlement impact semantics in the admin transaction list', async () => {
    const blockedSale: FinanceTransaction = {
      ...financeDashboard.transactions[0],
      id: 'ledger-sale-blocked-list',
      shopifyOrderNumber: '1116',
      shopifyOrderId: '7819000001116',
      payoutBatch: null,
      settlement: {
        ...financeDashboard.transactions[0].settlement!,
        status: 'held',
        payoutReady: false,
        holdReason: 'Vendor allocation is blocked and awaiting admin resolution.',
      },
    };
    const adjustment: FinanceTransaction = {
      id: 'ledger-adjustment-list',
      date: '2026-05-13T10:00:00Z',
      description: 'Manual balance adjustment',
      counterparty: 'Demo Vendor A',
      category: 'Adjustment',
      amount: '$50.00',
      status: 'Recorded',
      shopifyOrderNumber: '1117',
      shopifyOrderId: '7819000001117',
    };
    const payout: FinanceTransaction = {
      id: 'ledger-payout-list',
      date: '2026-05-14T10:00:00Z',
      description: 'Vendor payout paid',
      counterparty: 'Demo Vendor A',
      category: 'Payout',
      amount: '$100.00',
      status: 'Completed',
      payoutStatus: 'paid',
      shopifyOrderNumber: '1118',
      shopifyOrderId: '7819000001118',
      payoutBatch: {
        id: 'batch-paid-list',
        status: 'paid',
        netAmount: '$100.00',
        createdAt: '2026-05-14T10:00:00Z',
        paidAt: '2026-05-15T10:00:00Z',
        paymentReference: 'EFT-1118',
      },
    };
    const fallbackSale: FinanceTransaction = {
      id: 'ledger-sale-no-impact-list',
      date: '2026-05-15T10:00:00Z',
      description: 'Sale without calculation snapshot',
      counterparty: 'Demo Vendor A',
      category: 'Invoice',
      amount: '$777.00',
      status: 'Recorded',
      shopifyOrderNumber: '1119',
      shopifyOrderId: '7819000001119',
    };
    const refundedSale: FinanceTransaction = {
      ...financeDashboard.transactions[0],
      id: 'ledger-sale-refunded-list',
      date: '2026-05-16T10:00:00Z',
      description: 'Sale estimate after refund',
      amount: 'TRY 2,399.50',
      shopifyOrderNumber: '1113',
      shopifyOrderId: '7819000001113',
      payoutBatch: null,
      payoutCalculation: {
        ...financeDashboard.transactions[0].payoutCalculation!,
        grossAmount: 'TRY 2,399.50',
        commission: 'TRY 431.92',
        commissionVat: 'TRY 0.00',
        refundImpact: 'TRY 2,399.50',
        estimatedPayout: '-TRY 431.92',
      },
      settlement: {
        ...financeDashboard.transactions[0].settlement!,
        status: 'partially_refunded',
        payoutReady: true,
        holdReason: null,
        note: 'Refund impact is reducing the vendor balance.',
      },
    };
    const refundDeduction: FinanceTransaction = {
      ...financeDashboard.transactions[1],
      id: 'ledger-refund-1113-list',
      date: '2026-05-16T10:30:00Z',
      amount: 'TRY 2,399.50',
      shopifyOrderNumber: '1113',
      shopifyOrderId: '7819000001113',
      payoutCalculation: {
        ...financeDashboard.transactions[1].payoutCalculation!,
        refundImpact: 'TRY 2,399.50',
        estimatedPayout: '-TRY 2,399.50',
      },
    };
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        financeDashboard.transactions[0],
        refundedSale,
        refundDeduction,
        blockedSale,
        financeDashboard.transactions[1],
        adjustment,
        payout,
        fallbackSale,
      ],
    });

    const { container } = renderFinancePage();
    const tableElement = container.querySelector('.finance-op-table') as HTMLElement;
    const table = within(tableElement);
    await table.findByText('#1021');
    const rowForOrder = (orderNumber: string) =>
      table.getByText(`#${orderNumber}`).closest('[role="button"]') as HTMLElement;
    const rowForOrderWithText = (orderNumber: string, text: string) =>
      Array.from(tableElement.querySelectorAll('.op-table-row')).find((row) =>
        row.textContent?.includes(`#${orderNumber}`) && row.textContent.includes(text),
      ) as HTMLElement;

    expect(await table.findByRole('columnheader', { name: 'Source amount' })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: 'Settlement impact' })).toBeInTheDocument();

    const normalSaleRow = within(rowForOrder('1021'));
    expect(normalSaleRow.getByText('$3,399.00')).toBeInTheDocument();
    expect(normalSaleRow.getByText('$3,059.10')).toBeInTheDocument();
    expect(normalSaleRow.queryByText('Held')).not.toBeInTheDocument();

    const blockedSaleRow = within(rowForOrder('1116'));
    expect(blockedSaleRow.getByText('$3,399.00')).toBeInTheDocument();
    expect(blockedSaleRow.getByText('Held')).toBeInTheDocument();
    expect(blockedSaleRow.getByRole('link', { name: 'Review assignment' })).toBeInTheDocument();
    expect(blockedSaleRow.queryByText('$3,059.10')).not.toBeInTheDocument();
    expect(blockedSaleRow.queryByText('Vendor blocked')).not.toBeInTheDocument();

    const refundRow = within(rowForOrder('1001'));
    expect(refundRow.getByText('-$425.00')).toBeInTheDocument();
    expect(refundRow.getByText('Deducts balance')).toBeInTheDocument();
    expect(refundRow.queryByText('$425.00')).not.toBeInTheDocument();

    const refund1113Row = within(rowForOrderWithText('1113', 'Refund deduction'));
    expect(refund1113Row.getByText('-TRY 2,399.50')).toBeInTheDocument();
    expect(refund1113Row.getByText('Deducts balance')).toBeInTheDocument();

    const refundedSaleRow = within(rowForOrderWithText('1113', 'Sale estimate'));
    expect(refundedSaleRow.getByText('TRY 2,399.50')).toBeInTheDocument();
    expect(refundedSaleRow.getByText('Refund recorded')).toBeInTheDocument();
    expect(refundedSaleRow.queryByText('-TRY 431.92')).not.toBeInTheDocument();

    const adjustmentRow = within(rowForOrder('1117'));
    expect(adjustmentRow.getByText('-$50.00')).toBeInTheDocument();
    expect(adjustmentRow.getByText('Balance adjustment')).toBeInTheDocument();
    expect(adjustmentRow.queryByText('$50.00')).not.toBeInTheDocument();

    const payoutRow = within(rowForOrder('1118'));
    expect(payoutRow.getByText('$100.00')).toBeInTheDocument();
    expect(payoutRow.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(payoutRow.queryByText('+$100.00')).not.toBeInTheDocument();

    const fallbackRow = within(rowForOrder('1119'));
    expect(fallbackRow.getByText('$777.00')).toBeInTheDocument();
    expect(fallbackRow.getByText('—')).toBeInTheDocument();
  });

  it('removes only generic transaction table subtitles while preserving distinct status and row behavior', async () => {
    const ordinarySale: FinanceTransaction = {
      ...financeDashboard.transactions[0],
      id: 'ledger-ordinary-sale-cleanup',
      shopifyOrderNumber: '1201',
      shopifyOrderId: '7819000001201',
      payoutBatch: null,
      settlement: {
        ...financeDashboard.transactions[0].settlement!,
        status: 'accruing',
        payoutReady: false,
        payableAt: null,
        settledAt: null,
        holdReason: null,
      },
    };
    const ordinaryRefund: FinanceTransaction = {
      ...financeDashboard.transactions[1],
      id: 'ledger-ordinary-refund-cleanup',
      shopifyOrderNumber: '1202',
      shopifyOrderId: '7819000001202',
    };
    const heldSale: FinanceTransaction = {
      ...ordinarySale,
      id: 'ledger-held-sale-cleanup',
      shopifyOrderNumber: '1203',
      shopifyOrderId: '7819000001203',
      settlement: {
        ...ordinarySale.settlement!,
        status: 'held',
      },
    };
    const disputedSale: FinanceTransaction = {
      ...ordinarySale,
      id: 'ledger-disputed-sale-cleanup',
      shopifyOrderNumber: '1204',
      shopifyOrderId: '7819000001204',
      settlement: {
        ...ordinarySale.settlement!,
        status: 'disputed',
      },
    };

    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [ordinarySale, ordinaryRefund, heldSale, disputedSale],
    });

    const { container } = renderFinancePage();
    const tableElement = container.querySelector('.finance-op-table') as HTMLElement;
    const table = within(tableElement);
    await table.findByText('#1201');
    const rowForOrder = (orderNumber: string) =>
      table.getByText(`#${orderNumber}`).closest('[role="button"]') as HTMLElement;

    const saleRow = within(rowForOrder('1201'));
    expect(saleRow.getByText('Sale estimate')).toBeInTheDocument();
    expect(saleRow.queryByText('Shopify order')).not.toBeInTheDocument();
    expect(saleRow.getByText('Estimated')).toBeInTheDocument();
    expect(saleRow.getByText('Not ready for payout')).toBeInTheDocument();
    expect(saleRow.getByText('$3,399.00')).toBeInTheDocument();
    expect(saleRow.getByText('$3,059.10')).toBeInTheDocument();
    expect(saleRow.getByRole('button', { name: 'View details' })).toBeInTheDocument();

    const refundRow = within(rowForOrder('1202'));
    expect(refundRow.getByText('Refund deduction')).toBeInTheDocument();
    expect(refundRow.queryByText('Customer return')).not.toBeInTheDocument();
    expect(refundRow.queryByText('Customer refund impact')).not.toBeInTheDocument();
    expect(refundRow.getByText('Refund impact')).toBeInTheDocument();
    expect(refundRow.getByText('Not ready for payout')).toBeInTheDocument();
    expect(refundRow.getByText('-$425.00')).toBeInTheDocument();
    expect(refundRow.getByText('Deducts balance')).toBeInTheDocument();
    expect(refundRow.getByRole('button', { name: 'View details' })).toBeInTheDocument();

    const heldStatus = within(rowForOrder('1203').querySelector('.finance-queue-state') as HTMLElement);
    expect(heldStatus.getByText('Blocked')).toBeInTheDocument();
    expect(heldStatus.getByText('Held')).toBeInTheDocument();

    const disputedStatus = within(rowForOrder('1204').querySelector('.finance-queue-state') as HTMLElement);
    expect(disputedStatus.getByText('Blocked')).toBeInTheDocument();
    expect(disputedStatus.getByText('Disputed')).toBeInTheDocument();
  });

  it('uses positive styling only for positive monetary settlement impact values', async () => {
    const saleWithRefundEvidence: FinanceTransaction = {
      ...financeDashboard.transactions[0],
      id: 'ledger-refund-recorded-impact-style',
      shopifyOrderNumber: '1210',
      shopifyOrderId: '7819000001210',
      payoutBatch: null,
      settlement: {
        ...financeDashboard.transactions[0].settlement!,
        status: 'partially_refunded',
        payoutReady: false,
        holdReason: null,
      },
      payoutCalculation: {
        ...financeDashboard.transactions[0].payoutCalculation!,
        refundImpact: '$100.00',
      },
    };
    const refundedSplit: FinanceTransaction = {
      ...saleWithRefundEvidence,
      id: 'ledger-refund-review-impact-style',
      shopifyOrderNumber: '1211',
      shopifyOrderId: '7819000001211',
      amount: '$4,213.50',
      payoutCalculation: {
        ...saleWithRefundEvidence.payoutCalculation!,
        grossAmount: '$4,213.50',
        refundImpact: '$4,213.50',
        estimatedPayout: '$0.00',
      },
      settlement: {
        ...saleWithRefundEvidence.settlement!,
        payoutReady: true,
      },
      splitFinanceSummary: {
        ...splitFinanceSummaryBase,
        lineageRole: 'child',
        refundedChildSaleBasis: true,
        refundOffsetStatus: 'settlement_review_pending',
      },
    };
    const payoutRecord = (id: string, orderNumber: string, status: string): FinanceTransaction => ({
      id,
      date: '2026-05-20T10:00:00Z',
      description: `Payout ${status}`,
      counterparty: 'Demo Vendor A',
      category: 'Payout',
      amount: '$100.00',
      status: 'Recorded',
      shopifyOrderNumber: orderNumber,
      shopifyOrderId: `781900000${orderNumber}`,
      payoutBatch: {
        id: `batch-${status}`,
        status,
        netAmount: '$100.00',
        createdAt: '2026-05-20T10:00:00Z',
      },
    });
    const records: FinanceTransaction[] = [
      {
        ...financeDashboard.transactions[0],
        id: 'ledger-positive-impact-style',
        shopifyOrderNumber: '1208',
        shopifyOrderId: '7819000001208',
        payoutBatch: null,
      },
      {
        ...financeDashboard.transactions[1],
        id: 'ledger-negative-impact-style',
        shopifyOrderNumber: '1209',
        shopifyOrderId: '7819000001209',
        payoutCalculation: {
          ...financeDashboard.transactions[1].payoutCalculation!,
          refundImpact: '$300.00',
        },
      },
      saleWithRefundEvidence,
      refundedSplit,
      payoutRecord('ledger-pending-review-impact-style', '1212', 'review'),
      payoutRecord('ledger-approved-impact-style', '1213', 'approved'),
      payoutRecord('ledger-scheduled-impact-style', '1214', 'execution_pending'),
      payoutRecord('ledger-payment-evidence-impact-style', '1215', 'paid_placeholder'),
      payoutRecord('ledger-blocked-impact-style', '1216', 'cancelled'),
      payoutRecord('ledger-unknown-impact-style', '1217', 'unrecognized'),
    ];
    getFinanceDashboardMock.mockResolvedValue({ ...financeDashboard, transactions: records });

    const { container } = renderFinancePage();
    const tableElement = container.querySelector('.finance-op-table') as HTMLElement;
    const table = within(tableElement);
    await table.findByText('#1208');
    const impactCellForOrder = (orderNumber: string) => {
      const row = table.getByText(`#${orderNumber}`).closest('[role="button"]') as HTMLElement;
      return row.children[5] as HTMLElement;
    };

    expect(impactCellForOrder('1208')).toHaveTextContent('$3,059.10');
    expect(impactCellForOrder('1208')).toHaveClass('finance-positive');
    expect(impactCellForOrder('1209')).toHaveTextContent('-$300.00');
    expect(impactCellForOrder('1209')).toHaveClass('finance-negative');

    const neutralImpacts = [
      ['1210', 'Refund recorded'],
      ['1211', 'Refund offset review'],
      ['1212', 'Pending review'],
      ['1213', 'Approved'],
      ['1214', 'Scheduled'],
      ['1215', 'Payment evidence pending'],
      ['1216', 'Blocked'],
      ['1217', 'Unknown'],
    ] as const;
    neutralImpacts.forEach(([orderNumber, label]) => {
      const impactCell = impactCellForOrder(orderNumber);
      expect(impactCell).toHaveTextContent(label);
      expect(impactCell).toHaveClass('finance-amount-emphasis');
      expect(impactCell).not.toHaveClass('finance-positive');
    });
  });

  it('shows shipping reconciliation as required only when the finance projection needs it', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            shippingDeduction: '$80.00',
            shippingDeductionSource: 'external_provider',
            shippingCostStatus: 'pending_provider_cost',
            shippingMode: 'external_provider',
            shippingApplied: false,
          },
        },
      ],
    });

    renderFinancePage();

    expect(await screen.findByText('Shipping cost review required')).toBeInTheDocument();
    expect(screen.getByText('Provider shipping cost is missing and may change settlement estimates.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save shipping cost' })).toBeInTheDocument();
  });

  it('keeps completed shipping cost review details visible', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            shippingDeduction: '$80.00',
            shippingDeductionSource: 'external_provider',
            shippingCostStatus: 'snapshot',
            shippingCostProvider: 'Kargonomi',
            shippingCostSnapshot: '$80.00',
            shippingApplied: true,
            shippingMode: 'external_provider',
          },
        },
      ],
    });

    renderFinancePage();

    expect(await screen.findByText('Shipping cost review')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Shipping cost status')).toBeInTheDocument();
    expect(screen.getByText('Kargonomi')).toBeInTheDocument();
  });

  it('renders recommendation and settlement sections in the same finance inspector stack', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          status: 'Pending',
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'held',
            payoutReady: false,
            holdReason: 'operator_review',
          },
        },
        financeDashboard.transactions[1],
        financeDashboard.transactions[2],
      ],
    });

    const { container } = renderFinancePage();

    expect(await screen.findByText('Settlement')).toBeInTheDocument();
    expect(screen.queryByText('Suggested next steps')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workflow action guidance')).not.toBeInTheDocument();
    expect(screen.getByText('Financial preview')).toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sync accounting draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry accounting sync/i })).not.toBeInTheDocument();

    const inspectorBody = container.querySelector('.finance-control-center .op-side-panel-body');
    expect(inspectorBody?.querySelector(':scope > .operational-recommendations-card')).toBeFalsy();
    expect(inspectorBody?.querySelector(':scope > .finance-invoice-card')).toBeFalsy();
    expect(
      Array.from(inspectorBody?.querySelectorAll(':scope > .finance-detail-card') ?? []).some((section) =>
        section.textContent?.includes('Settlement'),
      ),
    ).toBe(true);
  });

  it('maps vendor-blocked finance rows to on-hold review copy', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          shopifyOrderNumber: '1095',
          shopifyOrderId: '7819000001095',
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'held',
            payoutReady: false,
            holdReason: 'Vendor allocation is blocked and awaiting admin resolution.',
          },
        },
      ],
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        eligibleRowCount: 0,
        eligibleNetAmount: '$0.00',
        blockedRowCount: 1,
      },
    });

    const { container } = renderFinancePage();

    expect((await screen.findAllByText('#1095')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('On hold').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Held').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Review assignment' })[0]).toHaveAttribute(
      'href',
      '/orders?order=1095&shopifyOrderId=7819000001095',
    );

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    const panel = getSidePanel(container);
    expect(await panel.findByText('Reason')).toBeInTheDocument();
    expect(panel.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
    expect(panel.getByText('Payment eligibility')).toBeInTheDocument();
    expect(panel.getByText('Not eligible')).toBeInTheDocument();
    expect(panel.getByText('Next action')).toBeInTheDocument();
    expect(panel.getByText('Resolve vendor allocation')).toBeInTheDocument();
    const settlementCard = panel.getByText('Settlement').closest('.finance-detail-card');
    expect(settlementCard).not.toBeNull();
    expect(within(settlementCard as HTMLElement).queryByText('Settlement state')).not.toBeInTheDocument();
    expect(within(settlementCard as HTMLElement).queryByText('Payment')).not.toBeInTheDocument();
    const nextActionValue = panel.getByText('Resolve vendor allocation').closest('.finance-next-action-value');
    expect(nextActionValue).not.toBeNull();
    expect(within(nextActionValue as HTMLElement).getByRole('link', { name: 'Review assignment' })).toHaveAttribute(
      'href',
      '/orders?order=1095&shopifyOrderId=7819000001095',
    );
    expect(screen.getByText('Estimated vendor payable')).toBeInTheDocument();
    expect(screen.queryByText('Estimated payment')).not.toBeInTheDocument();
    expect(screen.getByText('This amount is not currently payable.')).toBeInTheDocument();
    expect(screen.queryByText('Review settlement status before draft preparation')).not.toBeInTheDocument();
  });

  it('shows split context for source replacement finance ledgers', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-split-source-remaining',
          shopifyOrderNumber: '1097',
          shopifyOrderId: '7819000001097',
          splitFinanceSummary: splitFinanceSummaryBase,
        },
      ],
    });

    renderFinancePage();

    expect((await screen.findAllByText('Split order assignment')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Remaining order assignment transaction').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(await screen.findByText('Split order context')).toBeInTheDocument();
    expect(screen.getByText('Original order assignment was split. Selected items moved into a blocked order assignment.')).toBeInTheDocument();
    expect(screen.getByText('alloc-source-1097')).toBeInTheDocument();
    expect(screen.getByText('alloc-child-1097')).toBeInTheDocument();
    expect(screen.getByText('ledger-split-source-remaining')).toBeInTheDocument();
    expect(screen.getByText('Allocation split created')).toBeInTheDocument();
    expect(screen.getByText('Source transaction replaced')).toBeInTheDocument();
  });

  it('shows split allocation hold context for child finance ledgers', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-split-child',
          shopifyOrderNumber: '1097',
          shopifyOrderId: '7819000001097',
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'held',
            payoutReady: false,
            holdReason: 'Vendor allocation is blocked and awaiting admin resolution.',
          },
          splitFinanceSummary: {
            ...splitFinanceSummaryBase,
            lineageRole: 'child',
          },
        },
      ],
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        eligibleRowCount: 0,
        eligibleNetAmount: '$0.00',
        blockedRowCount: 1,
      },
    });

    renderFinancePage();

    expect((await screen.findAllByText('Split order assignment hold')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('On hold').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Held').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(await screen.findByText('Split order context')).toBeInTheDocument();
    expect(screen.getAllByText('Blocked split order assignment transaction').length).toBeGreaterThan(0);
    expect(screen.getByText('Created from line-item reject split. Held until transfer, refund, or return resolution.')).toBeInTheDocument();
    expect(screen.getByText('Vendor rejected selected line items.')).toBeInTheDocument();
    expect(screen.getByText('Child held transaction created')).toBeInTheDocument();
  });

  it('clarifies refunded split child sale basis without changing finance values', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-split-child',
          shopifyOrderNumber: '1097',
          shopifyOrderId: '7819000001097',
          amount: '$4,213.50',
          payoutBatch: null,
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            grossAmount: '$4,213.50',
            refundImpact: '$4,213.50',
            estimatedPayout: '$0.00',
          },
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'partially_refunded',
            payoutReady: true,
            holdReason: null,
            note: 'Refund impact is reducing the vendor balance.',
          },
          splitFinanceSummary: {
            ...splitFinanceSummaryBase,
            lineageRole: 'child',
            refundedChildSaleBasis: true,
            refundOffsetStatus: 'settlement_review_pending',
          },
        },
      ],
    });

    renderFinancePage();

    expect((await screen.findAllByText('Refunded split sale basis')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Adjusted by Shopify refund').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund offset review').length).toBeGreaterThan(0);
    expect(screen.queryByText('Settlement review pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked split order assignment transaction')).not.toBeInTheDocument();
    expect(screen.queryByText('Split order assignment hold')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(screen.queryByText('Refund completed. The Shopify refund has been processed. This review only determines how the refund adjustment is recorded in settlement accounting. No shipment, refund, or vendor action is required.')).not.toBeInTheDocument();
    expect(screen.queryByText('No shipment, refund, or vendor action is required.')).not.toBeInTheDocument();
    expect(screen.getByText('Operational status')).toBeInTheDocument();
    expect(screen.getAllByText('Resolved').length).toBeGreaterThan(0);
    expect(screen.getByText('Settlement status')).toBeInTheDocument();
    expect(screen.getByText('Review pending')).toBeInTheDocument();
    expect(screen.getByText('Sale basis')).toBeInTheDocument();
    expect(screen.getByText('Refund adjustment')).toBeInTheDocument();
    expect(screen.getByText('Net child effect')).toBeInTheDocument();
    expect(screen.getAllByText('$4,213.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-$4,213.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Child order assignment operationally resolved')).toBeInTheDocument();
    const settlementReviewEvent = screen.getByText('Settlement adjustment awaiting review').closest('li');
    expect(settlementReviewEvent).not.toBeNull();
    expect(within(settlementReviewEvent as HTMLElement).getByText('Review')).toBeInTheDocument();
    expect(settlementReviewEvent?.querySelector('small')).not.toHaveTextContent('—');
    expect(within(settlementReviewEvent as HTMLElement).queryByText('Operational resolution completed. Only settlement accounting review remains.')).not.toBeInTheDocument();
    expect(within(settlementReviewEvent as HTMLElement).queryByText('Invoice')).not.toBeInTheDocument();
  });

  it('labels refund deduction settlement review separately from operational work', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[1],
          id: 'ledger-split-child-refund',
          shopifyOrderNumber: '1097',
          shopifyOrderId: '7819000001097',
          amount: '$4,213.50',
          status: 'Pending',
          payoutCalculation: {
            ...financeDashboard.transactions[1].payoutCalculation!,
            refundImpact: '$4,213.50',
            estimatedPayout: '-$4,213.50',
          },
          settlement: {
            status: 'partially_refunded',
            payoutReady: true,
            eligibleAt: '2026-06-21T09:15:00Z',
            accruedAt: '2026-06-21T09:15:00Z',
            payableAt: '2026-06-21T09:15:00Z',
            settledAt: null,
            holdReason: null,
            note: 'Refund impact is reducing the vendor balance.',
          },
        },
      ],
    });

    const { container } = renderFinancePage();

    expect((await screen.findAllByText('Refund deduction')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Refund recorded. Awaiting settlement adjustment review.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Refund offset review').length).toBeGreaterThan(0);
    expect(screen.queryByText('Settlement review pending')).not.toBeInTheDocument();

    const table = within(container.querySelector('.finance-op-table') as HTMLElement);
    const refundRow = table.getByText('#1097').closest('[role="button"]') as HTMLElement;
    const refundStatus = within(refundRow.querySelector('.finance-queue-state') as HTMLElement);
    expect(refundStatus.getAllByText('Refund offset review')).toHaveLength(1);
    expect(refundRow).toHaveTextContent('Refund deduction');
    expect(refundRow).not.toHaveTextContent('Customer return');
    expect(refundRow).not.toHaveTextContent('Refund recorded. Awaiting settlement adjustment review.');
    expect(refundRow).toHaveTextContent('-$4,213.50');
    expect(refundRow).toHaveTextContent('Deducts balance');
    expect(within(refundRow).getByRole('button', { name: 'View details' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect((await screen.findAllByText('Settlement adjustment review pending')).length).toBeGreaterThan(0);
    const settlementCard = screen.getByText('Settlement').closest('.finance-detail-card');
    expect(settlementCard).not.toBeNull();
    const settlement = within(settlementCard as HTMLElement);
    expect(within(settlement.getByText('Status').closest('.op-meta-row') as HTMLElement).getByText('Refund offset review')).toBeInTheDocument();
    expect(within(settlement.getByText('Review status').closest('.op-meta-row') as HTMLElement).getByText('Settlement adjustment review pending')).toBeInTheDocument();
    expect(settlement.getByText('Not eligible')).toBeInTheDocument();
    expect(settlement.getByText('Next action')).toBeInTheDocument();
    expect(screen.queryByText('Refund completed. The Shopify refund has been processed. This review only determines how the refund adjustment is recorded in settlement accounting. No shipment, refund, or vendor action is required.')).not.toBeInTheDocument();
    expect(screen.queryByText('No shipment, refund, or vendor action is required.')).not.toBeInTheDocument();
    const settlementReviewEvent = screen.getByText('Settlement adjustment awaiting review').closest('li');
    expect(settlementReviewEvent).not.toBeNull();
    expect(within(settlementReviewEvent as HTMLElement).getByText('Review')).toBeInTheDocument();
    expect(settlementReviewEvent?.querySelector('small')).not.toHaveTextContent('—');
    expect(within(settlementReviewEvent as HTMLElement).queryByText('Operational resolution completed. Only settlement accounting review remains.')).not.toBeInTheDocument();
    expect(within(settlementReviewEvent as HTMLElement).queryByText('Refund')).not.toBeInTheDocument();
  });

  it('selects a finance row by ledgerId deep link', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage(['/finance?ledgerId=ledger-refund-failed']);

    expect(await screen.findByRole('heading', { name: 'Order #1002' })).toBeInTheDocument();
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('selects a finance row by Shopify refund id numeric tail', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage(['/finance?refundId=501']);

    expect(await screen.findByRole('heading', { name: 'Order #1001' })).toBeInTheDocument();
    expect((await screen.findAllByText('-$425.00')).length).toBeGreaterThan(0);
  });

  it('selects a finance row by order number and Shopify order id', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    const { unmount } = renderFinancePage(['/finance?order=1002']);

    expect(await screen.findByRole('heading', { name: 'Order #1002' })).toBeInTheDocument();

    unmount();
    getFinanceDashboardMock.mockClear();
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage(['/finance?shopifyOrderId=1002']);

    expect(await screen.findByRole('heading', { name: 'Order #1002' })).toBeInTheDocument();
  });

  it('does not fall back to the first finance row when a linked target is unavailable', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage(['/finance?ledgerId=missing-ledger']);

    expect(await screen.findByText('Linked transaction unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order #1021' })).not.toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
  });

  it('clears stale selected finance state when a linked target changes', async () => {
    const user = userEvent.setup();
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinanceNavigationHarness('/finance?ledgerId=ledger-refund-failed');

    await user.click((await screen.findAllByRole('button', { name: 'View details' }))[1]);
    expect(await screen.findByRole('heading', { name: 'Order #1001' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Navigate to linked finance row' }));

    expect(await screen.findByRole('heading', { name: 'Order #1002' })).toBeInTheDocument();
  });

  it('links finance order records to the targeted orders workspace query', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Order #1021' })).toBeInTheDocument();
    const relatedCard = screen.getByRole('heading', { name: 'Related' }).closest('.finance-related-inline-card');

    expect(relatedCard).toBeTruthy();
    expect(within(relatedCard as HTMLElement).getByText('Order #1021')).toBeInTheDocument();
    expect(within(relatedCard as HTMLElement).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/orders?order=1021&shopifyOrderId=7616544244049',
    );
  });

  it('links finance refund records to the targeted returns workspace query', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[1]);

    const relatedReturn = await screen.findByText('Related return');
    const relatedRecordsCard = screen.getByRole('heading', { name: 'Related records' }).closest('.operational-links-card');
    expect(relatedRecordsCard).toBeTruthy();
    expect(within(relatedRecordsCard as HTMLElement).queryByText('Grouped order, return, and support context for this transaction.')).not.toBeInTheDocument();
    expect(relatedReturn.closest('a')).toHaveAttribute(
      'href',
      `/returns?refundId=${encodeURIComponent('gid://shopify/Refund/501')}`,
    );
  });

  it('groups duplicate support activity in finance timeline and linked records', async () => {
    listAdminSupportTicketsMock.mockResolvedValue([
      supportTicket({ id: 'ticket-finance-1', status: 'OPEN', updatedAt: '2026-05-13T10:30:00Z' }),
      supportTicket({ id: 'ticket-finance-2', status: 'IN_REVIEW', updatedAt: '2026-05-13T11:30:00Z' }),
      supportTicket({
        id: 'ticket-finance-3',
        priority: 'high',
        status: 'IN_REVIEW',
        updatedAt: '2026-05-13T12:30:00Z',
        lastReplyAt: '2026-05-13T12:35:00Z',
        lastReplyByRole: 'ADMIN',
      }),
    ]);
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Activity timeline' })).toBeInTheDocument();
    expect(screen.getByText('Order captured')).toBeInTheDocument();
    expect(screen.getByText('Settlement awaiting review')).toBeInTheDocument();
    expect(screen.getByText('Activity entries are previews until settlement review is completed.')).toBeInTheDocument();
    expect(screen.getAllByText('Support activity').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 linked tickets/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Support ticket opened')).not.toBeInTheDocument();
    expect(screen.queryByText('Support reply added')).not.toBeInTheDocument();

    const relatedRecordsCard = screen.getByRole('heading', { name: 'Related records' }).closest('.operational-links-card');
    expect(relatedRecordsCard).toBeTruthy();
    expect(within(relatedRecordsCard as HTMLElement).queryByText('Grouped order, return, and support context for this transaction.')).not.toBeInTheDocument();
    expect(within(relatedRecordsCard as HTMLElement).getByText('Support activity')).toBeInTheDocument();
    expect(within(relatedRecordsCard as HTMLElement).queryByText('Help with order #1021')).not.toBeInTheDocument();
    expect(screen.getByText('Support history')).toBeInTheDocument();
    expect(screen.getByText('Latest status: In Review')).toBeInTheDocument();
    expect(screen.getAllByText('3 linked tickets').length).toBeGreaterThan(0);
  });

  it('hides the empty finance actions section when no action is available', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[1]);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Order #1001' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('No actions available')).not.toBeInTheDocument();
  });

  it('shows vendor-friendly commission and tax deductions in compact ledger detail', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[0]);

    expect((await screen.findAllByText(/Commission \(/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Commission VAT \(/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Shipping fee')).not.toBeInTheDocument();
    expect(screen.queryByText('Snapshot at sale creation')).not.toBeInTheDocument();
    expect(screen.queryByText('Current vendor profile')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View details' }).length).toBeGreaterThan(0);
  });

  it('does not render legacy invoice accounting diagnostics in the active finance workflow', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.queryByText('Legacy invoice sync record')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Provider issue summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/BizimHesap/i)).not.toBeInTheDocument();
  });

  it('does not show provider issue internals to vendor users', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByText('Track balances, upcoming payments, and recent payment activity.')).toBeInTheDocument();
    expect(screen.queryByText('Invoice visibility incomplete')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoice visibility is reconciled from the merchant accounting workflow.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Provider issue summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/Content type:/)).not.toBeInTheDocument();
  });

  it('displays hold-equivalent refund ledger rows as Recorded instead of Failed', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          status: 'hold' as never,
        },
      ],
    });

    renderFinancePage();

    expect((await screen.findAllByText('Recorded')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
  });

  it('shows read-only finance policy context without duplicate edit controls', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(screen.getByText('Demo Vendor A marketplace terms')).toBeInTheDocument();
    expect(await screen.findByText('Finance policy is edited from Vendor Profile. New payment estimates use the saved policy snapshot.')).toBeInTheDocument();
    expect(screen.getByText('Commission VAT')).toBeInTheDocument();
    expect(screen.getByText('Shipping deduction mode')).toBeInTheDocument();
    expect(screen.getByText('Read-only finance policy')).toBeInTheDocument();
    expect(screen.queryByLabelText('Vendor finance profile settings')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /commission %/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /commission VAT %/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /shipping mode/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /fixed shipping fee/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /settlement delay days/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /deduct shipping after fulfillment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vendor profile/i })).not.toBeInTheDocument();
  });

  it('shows admin payout preparation controls and prepares a draft batch', async () => {
    preparePayoutBatchMock.mockResolvedValue({
      id: 'batch-demo-vendor-a',
      vendorId: 'demo-vendor-a',
      status: 'draft',
      grossAmount: '$3,399.00',
      commissionAmount: '$339.90',
      commissionVatAmount: '$0.00',
      shippingDeductionAmount: '$0.00',
      refundAmount: '$0.00',
      netAmount: '$3,059.10',
      currency: 'TRY',
      createdByUserId: 'admin',
      createdAt: '2026-05-13T12:00:00Z',
      updatedAt: '2026-05-13T12:00:00Z',
      lineCount: 1,
      warning: null,
    });
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Draft settlement payment review' })).toBeInTheDocument();
    expect(screen.getAllByText('Rows pending review').length).toBeGreaterThan(0);
    expect(screen.getByText('Estimated payment before adjustments')).toBeInTheDocument();
    expect(screen.getByText('Net after balance adjustment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prepare draft review/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /prepare draft review/i }));

    await waitFor(() => expect(preparePayoutBatchMock).toHaveBeenCalledWith('demo-vendor-a'));
  });

  it('shows vendor finance profile as read-only for vendor users', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Finance workflow summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Financial Totals')).not.toBeInTheDocument();
    expect(screen.getAllByText('İncelemede').length).toBeGreaterThan(0);
    expect(await screen.findByText('Salt okunur ödeme koşulları')).toBeInTheDocument();
    expect(screen.getByText('Salt okunur tahmini ödeme')).toBeInTheDocument();
    expect(screen.getByText('Son inceleme durumu')).toBeInTheDocument();
    expect(screen.queryByText('Latest review artifact')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft payout review')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft settlement payout review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vendor profile/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prepare draft review/i })).not.toBeInTheDocument();
  });

  it('normalizes prefixed Shopify order numbers in the shared vendor table without changing vendor detail markup', async () => {
    setVendorFinanceUser();
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'vendor-prefixed-order',
          shopifyOrderNumber: '#1132',
        },
      ],
    });

    const { container } = renderFinancePage();

    const table = within(container.querySelector('.finance-op-table') as HTMLElement);
    expect(await table.findByText('#1132')).toBeInTheDocument();
    expect(table.queryByText('##1132')).not.toBeInTheDocument();

    const panel = getSidePanel(container);
    const vendorSummary = panel.getByText('İşlem Özeti').closest('.finance-selected-summary-card');
    expect(vendorSummary).not.toBeNull();
    expect(within(vendorSummary as HTMLElement).getByText('##1132')).toBeInTheDocument();
  });

  it('shows vendor payout status and upcoming payout in read-only detail', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    const { container } = renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Aç' }))[0]);
    const panel = getSidePanel(container);

    expect(await screen.findByRole('heading', { name: 'Sipariş #1021' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Financial Totals')).not.toBeInTheDocument();
    expect(panel.getByText('İşlem Özeti')).toBeInTheDocument();
    expect(panel.getByText('Bu ödeme neden bekliyor?')).toBeInTheDocument();
    expect(panel.getByText('Sonraki Adım')).toBeInTheDocument();
    expect(panel.queryByRole('heading', { name: 'Ödeme Etkisi' })).not.toBeInTheDocument();
    expect(panel.getByRole('heading', { name: 'İlgili Kayıtlar' })).toBeInTheDocument();
    expect(panel.getByRole('heading', { name: 'Hareket Geçmişi' })).toBeInTheDocument();
    expect(panel.getAllByText('İşlem Gerekmiyor').length).toBeGreaterThan(0);
    expect(panel.getByText('İşlem Tipi')).toBeInTheDocument();
    expect(panel.getByText('Durum')).toBeInTheDocument();
    expect(panel.queryByText('Transaction type')).not.toBeInTheDocument();
    expect(panel.queryByText('Current status')).not.toBeInTheDocument();
    expect(panel.queryByText('Settlement Preview')).not.toBeInTheDocument();
    expect(panel.queryByText('Settlement preview')).not.toBeInTheDocument();
    expect(panel.queryByText('Selected Transaction')).not.toBeInTheDocument();
    expect(panel.queryByText('Settlement state')).not.toBeInTheDocument();
    expect(panel.queryByText('Payment readiness')).not.toBeInTheDocument();
    expect(panel.queryByText('Blocker')).not.toBeInTheDocument();
    expect(panel.queryByText('Suggested next steps')).not.toBeInTheDocument();
    expect(panel.queryByText('Finance investigation notes')).not.toBeInTheDocument();
    expect(panel.queryByText(/settlement/i)).not.toBeInTheDocument();
    expect(panel.queryByText(/reference id|approval id|commission invoice/i)).not.toBeInTheDocument();
    expect(panel.getAllByText('$3,059.10').length).toBeGreaterThan(0);
    const summaryCard = panel.getByText('İşlem Özeti').closest('.finance-selected-summary-card');
    expect(summaryCard).not.toBeNull();
    expect(within(summaryCard as HTMLElement).getAllByText('Ödeme Etkisi').length).toBeGreaterThan(0);
    expect(panel.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
    expect(panel.queryByText('Accounting sync')).not.toBeInTheDocument();
    expect(panel.queryByText('Payment evidence pending')).not.toBeInTheDocument();
    expect(panel.queryByText(/Confirmed|Final payout/i)).not.toBeInTheDocument();
    expect(panel.queryByText('Current vendor-scoped finance query')).not.toBeInTheDocument();
  });

  it('removes settlement and accounting language from the full vendor transactions screen', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'vendor-ready-payment',
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'payable',
            payoutReady: true,
            holdReason: null,
          },
        },
        {
          ...financeDashboard.transactions[0],
          id: 'vendor-payment-prep',
          shopifyOrderNumber: '1022',
          payoutBatch: {
            id: 'batch-demo-vendor-a',
            status: 'draft',
            netAmount: '$3,059.10',
            createdAt: '2026-05-13T12:00:00Z',
          },
        },
        {
          ...financeDashboard.transactions[1],
          id: 'vendor-refund-review',
          settlement: {
            status: 'partially_refunded',
            payoutReady: true,
            eligibleAt: '2026-05-11T10:30:00Z',
            accruedAt: '2026-05-11T10:30:00Z',
            payableAt: '2026-05-11T10:30:00Z',
            settledAt: null,
            holdReason: null,
            note: 'Refund impact is reducing the vendor balance.',
          },
        },
      ],
    });

    const { container } = renderFinancePage();

    expect((await screen.findAllByRole('button', { name: 'Aç' })).length).toBe(3);
    expect(screen.getAllByText('Hazır').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beklemede').length).toBeGreaterThan(0);
    expect(screen.getAllByText('İncelemede').length).toBeGreaterThan(0);
    expect(screen.getAllByText('İade').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ödeme Etkisi').length).toBeGreaterThan(0);
    const table = within(container.querySelector('.finance-op-table') as HTMLElement);
    expect(table.getAllByText('Hazır')).toHaveLength(1);
    expect(table.getAllByText('Beklemede')).toHaveLength(1);
    expect(table.getAllByText('İncelemede')).toHaveLength(1);
    expect(table.getAllByText('İade')).toHaveLength(1);
    expect(table.getAllByRole('button', { name: 'Aç' })).toHaveLength(3);
    const refundRow = table.getByText('#1001').closest('[role="button"]');
    expect(refundRow?.querySelector('.finance-negative')).not.toBeNull();
    expect(refundRow?.querySelector('.finance-deduction-value')).not.toBeNull();
    expect(table.queryByText('Order payment activity.')).not.toBeInTheDocument();
    expect(table.queryByText('Customer return')).not.toBeInTheDocument();
    expect(table.queryByText('Shopify order')).not.toBeInTheDocument();
    expect(table.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument();

    expect(container).not.toHaveTextContent('Settlement review pending');
    expect(container).not.toHaveTextContent('Refund recorded. Awaiting settlement adjustment review.');
    expect(container).not.toHaveTextContent('Refund recorded. Waiting for review.');
    expect(container).not.toHaveTextContent('Waiting for review.');
    expect(container).not.toHaveTextContent(/Ready for settlement/i);
    expect(container).not.toHaveTextContent('Ready for payment');
    expect(container).not.toHaveTextContent(/Waiting settlement/i);
    expect(container).not.toHaveTextContent('Settlement draft locked');
    expect(container).not.toHaveTextContent('Settlement adjustment awaiting review');
    expect(container).not.toHaveTextContent('Refund offset review');
    expect(container).not.toHaveTextContent('Blocked by refund offset');
    expect(container).not.toHaveTextContent('Review settlement');
    expect(container).not.toHaveTextContent('Refund review in progress');
    expect(container).not.toHaveTextContent('Payment preparation in progress');
    expect(container).not.toHaveTextContent('Customer refund impact');
    expect(container).not.toHaveTextContent('Shopify order');
    expect(container).not.toHaveTextContent('Customer return');
    expect(container).not.toHaveTextContent('View details');
    expect(container).not.toHaveTextContent('Review linked order');
    expect(container).not.toHaveTextContent('Review assignment');
    expect(container).not.toHaveTextContent('Open');
    expect(container).not.toHaveTextContent('Sale');
    expect(container).not.toHaveTextContent('Refund review');
    expect(container).not.toHaveTextContent('Refund deduction');
    expect(container).not.toHaveTextContent('İade Kesintisi');
    expect(container).not.toHaveTextContent('Ödeme Bekliyor');
    expect(container).not.toHaveTextContent('Ödemeye Hazır');
    expect(container).not.toHaveTextContent('Blokeli');
    expect(container).not.toHaveTextContent('Balance adjustment');
    expect(container).not.toHaveTextContent('Shipping cost');
    expect(container).not.toHaveTextContent('Ready');
    expect(container).not.toHaveTextContent('Review');
    expect(container).not.toHaveTextContent('Preparing');
    expect(container).not.toHaveTextContent('Estimated');
    expect(container).not.toHaveTextContent('Paid');
    expect(container).not.toHaveTextContent('On hold');
    expect(container).not.toHaveTextContent('Blocked');
    expect(container).not.toHaveTextContent('Transaction Summary');
    expect(container).not.toHaveTextContent('Why is this payment waiting?');
    expect(container).not.toHaveTextContent('Next Action');
    expect(container).not.toHaveTextContent('Payment Impact');
    expect(container).not.toHaveTextContent('Related records');
    expect(container).not.toHaveTextContent('Activity');
    expect(container).not.toHaveTextContent('Support');
    expect(container).not.toHaveTextContent('Linked order and return context for this transaction.');
    expect(container).not.toHaveTextContent('Recent payment activity for this transaction.');
    expect(container).not.toHaveTextContent('Transaction type');
    expect(container).not.toHaveTextContent('Current status');
    expect(container).not.toHaveTextContent(/settlement accounting/i);
    expect(container).not.toHaveTextContent(/payout accounting/i);
    expect(container).not.toHaveTextContent(/\bledger\b/i);
    expect(container).not.toHaveTextContent(/reference id/i);
    expect(container).not.toHaveTextContent(/approval id/i);
    expect(container).not.toHaveTextContent(/commission invoice/i);
    expect(container).not.toHaveTextContent(/\bsettlement\b/i);
  });

  it('maps pending sale rows to calculating vendor payment state', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'vendor-sale-accruing',
          payoutBatch: null,
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'accruing',
            payoutReady: false,
            payableAt: null,
            settledAt: null,
            holdReason: null,
          },
        },
      ],
    });

    const { container } = renderFinancePage();
    await screen.findByRole('button', { name: 'Aç' });
    const table = within(container.querySelector('.finance-op-table') as HTMLElement);

    expect(table.getByText('Sipariş Geliri')).toBeInTheDocument();
    expect(table.getByText('Hesaplanıyor')).toBeInTheDocument();
    expect(table.queryByText('Ödeme Bekliyor')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Aç' }));
    const panel = getSidePanel(container);
    expect(panel.getAllByText('Hesaplanıyor').length).toBeGreaterThan(0);
    expect(panel.getAllByText('İşlem Gerekmiyor').length).toBeGreaterThan(0);
    expect(panel.queryByText('Bu ödeme neden bekliyor?')).not.toBeInTheDocument();
  });

  it('does not repeat vendor review explanations across the finance detail panel', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[1],
          id: 'vendor-refund-review',
          settlement: {
            status: 'partially_refunded',
            payoutReady: true,
            eligibleAt: '2026-05-11T10:30:00Z',
            accruedAt: '2026-05-11T10:30:00Z',
            payableAt: '2026-05-11T10:30:00Z',
            settledAt: null,
            holdReason: null,
            note: 'Refund impact is reducing the vendor balance.',
          },
        },
      ],
    });

    const { container } = renderFinancePage();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Aç' }))[0]);
    const panel = getSidePanel(container);

    expect(await panel.findByText('Bu ödeme neden bekliyor?')).toBeInTheDocument();
    expect(panel.queryByRole('heading', { name: 'Ödeme Etkisi' })).not.toBeInTheDocument();
    expect(within(panel.getByText('İşlem Özeti').closest('.finance-selected-summary-card') as HTMLElement).getByText('Ödeme Etkisi')).toBeInTheDocument();
    expect(panel.getAllByText('Bu işlem inceleniyor.')).toHaveLength(1);
    expect(panel.queryByText('Linked order and return context for this transaction.')).not.toBeInTheDocument();
    expect(panel.queryByText('Recent payment activity for this transaction.')).not.toBeInTheDocument();
    expect(panel.queryByText('Linked')).not.toBeInTheDocument();
  });

  it('hides raw split and evidence identifiers from vendor finance detail', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-split-source-remaining',
          shopifyOrderNumber: '1097',
          shopifyOrderId: '7819000001097',
          amount: '$4,213.50',
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            grossAmount: '$4,213.50',
            refundImpact: '$4,213.50',
            estimatedPayout: '$0.00',
          },
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'partially_refunded',
            payoutReady: true,
            holdReason: null,
            note: 'Refund impact is reducing the vendor balance.',
          },
          splitFinanceSummary: {
            ...splitFinanceSummaryBase,
            lineageRole: 'child',
            refundedChildSaleBasis: true,
            refundOffsetStatus: 'settlement_review_pending',
          },
        },
      ],
    });

    const { container } = renderFinancePage();

    await userEvent.click(await screen.findByRole('button', { name: 'Aç' }));
    const panel = getSidePanel(container);

    expect(await panel.findByText('İşlem Özeti')).toBeInTheDocument();
    expect(panel.queryByRole('heading', { name: 'Ödeme Etkisi' })).not.toBeInTheDocument();
    expect(within(panel.getByText('İşlem Özeti').closest('.finance-selected-summary-card') as HTMLElement).getByText('Ödeme Etkisi')).toBeInTheDocument();
    expect(panel.getAllByText('İncelemede').length).toBeGreaterThan(0);
    expect(panel.queryByText('Settlement review pending')).not.toBeInTheDocument();
    expect(panel.queryByText('settlement accounting review')).not.toBeInTheDocument();
    expect(panel.queryByText('offset review pending')).not.toBeInTheDocument();
    expect(panel.queryByText(/settlement/i)).not.toBeInTheDocument();
    expect(panel.queryByText(/reference id|approval id|commission invoice/i)).not.toBeInTheDocument();
    expect(panel.queryByText('Split order context')).not.toBeInTheDocument();
    expect(panel.queryByText('Source order assignment')).not.toBeInTheDocument();
    expect(panel.queryByText('Child order assignment')).not.toBeInTheDocument();
    expect(panel.queryByText('Original source transaction')).not.toBeInTheDocument();
    expect(panel.queryByText('Remaining source transaction')).not.toBeInTheDocument();
    expect(panel.queryByText('Child held transaction')).not.toBeInTheDocument();
    expect(panel.queryByText('alloc-source-1097')).not.toBeInTheDocument();
    expect(panel.queryByText('alloc-child-1097')).not.toBeInTheDocument();
    expect(panel.queryByText('ledger-split-source-remaining')).not.toBeInTheDocument();
  });

  it('hides payment evidence internals from vendor finance timeline and statuses', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        latestBatch: {
          ...financeDashboard.payoutBatchSummary!.latestBatch!,
          status: 'paid_placeholder',
        },
      },
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutBatch: {
            ...financeDashboard.transactions[0].payoutBatch!,
            status: 'paid_placeholder',
          },
        },
        ...financeDashboard.transactions.slice(1),
      ],
    });

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Aç' }))[0]);

    expect(await screen.findByRole('heading', { name: 'Sipariş #1021' })).toBeInTheDocument();
    expect(screen.getAllByText('İncelemede').length).toBeGreaterThan(0);
    expect(screen.queryByText('Payment evidence pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Included in draft review')).not.toBeInTheDocument();
  });

  it('shows paid vendor overview activity only from real Mark Paid evidence', async () => {
    setVendorFinanceUser();
    const paidAt = '2026-07-04T11:30:00Z';
    const paidSale: FinanceTransaction = {
      ...financeDashboard.transactions[0],
      id: 'ledger-sale-paid',
      status: 'Completed',
      payoutStatus: 'paid',
      settlement: {
        ...financeDashboard.transactions[0].settlement!,
        status: 'settled',
        payoutReady: false,
        settledAt: paidAt,
        note: 'Manual EFT payment was confirmed.',
      },
      payoutBatch: {
        ...financeDashboard.transactions[0].payoutBatch!,
        status: 'paid',
        paidAt,
        paymentReference: 'EFT-2026-07-04',
      },
    };
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      summary: {
        ...financeDashboard.summary,
        availableBalance: '$0.00',
        payoutEstimate: '$0.00',
        pendingPayouts: '$0.00',
        payableBalance: '$0.00',
        accruedBalance: '$0.00',
        heldBalance: '$0.00',
        netPayableAfterDebt: '$0.00',
      },
      payoutBatchSummary: {
        ...financeDashboard.payoutBatchSummary!,
        eligibleRowCount: 0,
        eligibleNetAmount: '$0.00',
        blockedRowCount: 0,
        netEligibleAfterDebtOffset: '$0.00',
        latestBatch: {
          ...financeDashboard.payoutBatchSummary!.latestBatch!,
          status: 'paid',
          paidAt,
          paymentReference: 'EFT-2026-07-04',
        },
      },
      transactions: [paidSale],
    });

    renderFinanceOverviewPage();

    expect(await screen.findByText('Ödendi Jul 4, 2026')).toBeInTheDocument();
    expect(screen.getAllByText('Ödendi').length).toBeGreaterThan(0);
    expect(screen.getByText('Sipariş #1021 ödendi.')).toBeInTheDocument();
    expect(screen.queryByText('$3,059.10')).not.toBeInTheDocument();
  });

  it('keeps Finance Overview authority and navigation while removing static stage and last-check claims', async () => {
    const overviewTransactions = Array.from({ length: 6 }, (_, index) => ({
      ...financeDashboard.transactions[0],
      id: `ledger-overview-${index + 1}`,
      shopifyOrderNumber: String(2001 + index),
      shopifyOrderId: `gid://shopify/Order/${2001 + index}`,
      amount: `$${index + 1}.00`,
    }));
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      summary: {
        ...financeDashboard.summary,
        payableBalance: '$2,947.50',
        accruedBalance: '$250.00',
        heldBalance: '$75.00',
      },
      transactions: overviewTransactions,
    });

    renderFinanceOverviewPage();

    const moneySummary = await screen.findByLabelText('Finance money summary');
    expect(within(moneySummary).getByText('Available balance')).toBeInTheDocument();
    expect(within(moneySummary).getByText('Estimated payment')).toBeInTheDocument();
    expect(within(moneySummary).getByText('Waiting to become payable')).toBeInTheDocument();
    expect(within(moneySummary).getByText('Waiting for review')).toBeInTheDocument();

    expect(screen.queryByLabelText('Balance explanation')).not.toBeInTheDocument();
    expect(screen.queryByText('How your balance moves')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Payment stages' })).not.toBeInTheDocument();
    expect(screen.queryByText('Changed recently')).not.toBeInTheDocument();

    const recentActivity = screen.getByLabelText('Recent payment activity');
    expect(within(recentActivity).getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument();
    expect(within(recentActivity).queryByText('What changed since your last check')).not.toBeInTheDocument();
    await within(recentActivity).findByText('Order #2001 is now ready for payment review.');
    const recentRows = within(recentActivity).getAllByRole('listitem');
    expect(recentRows).toHaveLength(5);
    expect(recentRows[0]).toHaveTextContent('Order #2001');
    expect(recentRows[0]).toHaveTextContent('$1.00');
    expect(recentRows[4]).toHaveTextContent('Order #2005');
    expect(within(recentActivity).queryByText('Order #2006 is now ready for payment review.')).not.toBeInTheDocument();

    expect(screen.getByLabelText('Payment progress')).toHaveTextContent('How sales become money paid out');
    expect(screen.getByRole('tab', { name: 'Transactions' })).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(within(recentRows[0]).getByRole('button'));

    expect(screen.getByRole('tab', { name: 'Transactions' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Order #2001' })).toBeInTheDocument();
  });

  it('uses real payment evidence for vendor paid row status and paid date', async () => {
    setVendorFinanceUser();
    const paidAt = '2026-07-04T11:30:00Z';
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          id: 'ledger-sale-paid',
          status: 'Completed',
          payoutStatus: 'paid',
          settlement: {
            ...financeDashboard.transactions[0].settlement!,
            status: 'settled',
            payoutReady: false,
            settledAt: paidAt,
            note: 'Manual EFT payment was confirmed.',
          },
          payoutBatch: {
            ...financeDashboard.transactions[0].payoutBatch!,
            status: 'paid',
            paidAt,
            paymentReference: 'EFT-2026-07-04',
          },
        },
      ],
    });

    const { container } = renderFinancePage();
    const table = within(container.querySelector('.finance-op-table') as HTMLElement);

    expect(await table.findByText('Ödendi')).toBeInTheDocument();
    expect(table.getByText('Jul 4, 2026')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Aç' }));
    const panel = getSidePanel(container);
    expect(panel.getAllByText('Ödendi').length).toBeGreaterThan(0);
    expect(panel.getByText('Hareket Geçmişi')).toBeInTheDocument();
  });

  it('does not mark approved, prepared, review, or placeholder vendor rows paid without payment evidence', async () => {
    setVendorFinanceUser();
    const makeSaleRecord = (
      id: string,
      orderNumber: string,
      payoutBatch: FinanceTransaction['payoutBatch'],
      settlementReview: FinanceTransaction['settlement']['review'] = null,
    ): FinanceTransaction => ({
      ...financeDashboard.transactions[0],
      id,
      shopifyOrderNumber: orderNumber,
      status: 'Recorded',
      payoutStatus: 'pending',
      settlement: {
        ...financeDashboard.transactions[0].settlement!,
        status: 'payable',
        payoutReady: true,
        settledAt: null,
        review: settlementReview,
      },
      payoutBatch,
    });

    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        makeSaleRecord('approved-settlement-only', '1031', null, {
          approvalId: 'approval-1031',
          approvalStatus: 'approved',
          commissionInvoiceId: null,
          commissionInvoiceStatus: null,
          invoiceNo: null,
          providerUuid: null,
        }),
        makeSaleRecord('prepared-batch', '1032', {
          id: 'batch-prepared',
          status: 'draft',
          netAmount: '$100.00',
          createdAt: '2026-07-01T09:00:00Z',
        }),
        makeSaleRecord('review-batch', '1033', {
          id: 'batch-review',
          status: 'review',
          netAmount: '$100.00',
          createdAt: '2026-07-01T09:00:00Z',
        }),
        makeSaleRecord('placeholder-batch', '1034', {
          id: 'batch-placeholder',
          status: 'paid_placeholder',
          netAmount: '$100.00',
          createdAt: '2026-07-01T09:00:00Z',
        }),
      ],
    });

    const { container } = renderFinancePage();
    const table = within(container.querySelector('.finance-op-table') as HTMLElement);

    expect(await table.findByText('#1031')).toBeInTheDocument();
    expect(table.queryByText('Ödendi')).not.toBeInTheDocument();
    expect(table.getAllByText('Hazır')).toHaveLength(1);
    expect(table.getAllByText('Beklemede')).toHaveLength(2);
    expect(table.getAllByText('İncelemede')).toHaveLength(1);
  });

  it('communicates negative upcoming payout without enabling vendor actions', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      payoutBatchSummary: {
        eligibleRowCount: 1,
        eligibleNetAmount: '-$125.00',
        blockedRowCount: 0,
        latestBatch: {
          ...financeDashboard.payoutBatchSummary!.latestBatch!,
          netAmount: '-$125.00',
          warning: 'Negative payout draft requires operator review.',
        },
      },
    });

    renderFinancePage();

    expect((await screen.findAllByText('-$125.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('Salt okunur tahmini ödeme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prepare draft review/i })).not.toBeInTheDocument();
  });

});
