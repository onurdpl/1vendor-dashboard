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

    expect(screen.getByRole('heading', { name: /finance workspace/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by order #, type, status, amount...')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Payment impact' })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.queryByText('Finance unavailable')).not.toBeInTheDocument();
  });

  it('renders recorded and failed finance statuses with operational hierarchy', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: /finance workspace/i })).toBeInTheDocument();
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect(await screen.findByLabelText('Finance workflow summary')).toHaveTextContent('Action required');
    expect(screen.getByLabelText('Financial Totals')).toHaveTextContent('settlement estimate');
    expect(screen.getByLabelText('Financial Totals')).toHaveTextContent('refund deductions');
    expect(screen.getByLabelText('Financial Totals')).toHaveTextContent('vendor balance');
    expect(screen.getByLabelText('Needs review breakdown')).toHaveTextContent('Breakdown: Refund 0 · Blocked 1 · Shipping 0 · Balance adjustment 0');
    expect(screen.queryByLabelText('Action Required')).not.toBeInTheDocument();
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund impact').length).toBeGreaterThan(0);
    expect(screen.getByText('Action required')).toBeInTheDocument();
    expect(screen.getByLabelText('Financial Totals')).toHaveTextContent('refund deductions');
    expect(screen.queryByText('This period')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Financial Totals')).toHaveTextContent('settlement estimate');
    expect(screen.getByText('Values update as orders become eligible, refunds are processed, or reviews are completed.')).toBeInTheDocument();
  });

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
    expect(screen.getByLabelText('Financial Totals')).toHaveTextContent('vendor balance');
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
    expect(screen.getByLabelText('Financial Totals')).toHaveTextContent('vendor balance');
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

  it('opens the finance detail panel for a selected ledger row', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    const { container } = renderFinancePage();

    await screen.findByText('#1002');
    await userEvent.click(screen.getAllByRole('button', { name: 'View details' })[2]);

    expect(await screen.findByText('Selected Transaction')).toBeInTheDocument();
    expect(screen.getByText('Current status')).toBeInTheDocument();
    expect(screen.getAllByText('Payment readiness').length).toBeGreaterThan(0);
    expect(screen.getByText('Balance adjustment impact on payment')).toBeInTheDocument();
    expect(screen.getByText('Finance investigation notes')).toBeInTheDocument();
    expect(screen.getByText('No finance investigation notes.')).toBeInTheDocument();
    expect(await screen.findByText('Settlement preview')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Order #1002' })).toBeInTheDocument();
    expect(screen.getByText('Deductions')).toBeInTheDocument();
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

    renderFinancePage();

    await screen.findByText('#1002');
    await userEvent.click(screen.getAllByRole('button', { name: 'View details' })[2]);

    expect(await screen.findByText('Review status')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Payment impact').length).toBeGreaterThan(0);
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
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Payment impact' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.finance-queue-state').length).toBeGreaterThan(0));

    await userEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);

    expect((await screen.findAllByText('Payment readiness')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText('Ready for review').length).toBeGreaterThan(0));
    expect(screen.getByText('Hold / blocker')).toBeInTheDocument();
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

    expect(await screen.findByText('Suggested next steps')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Review settlement');
    expect(screen.getByText('Settlement preview')).toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sync accounting draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry accounting sync/i })).not.toBeInTheDocument();

    const inspectorBody = container.querySelector('.finance-control-center .op-side-panel-body');
    expect(inspectorBody?.querySelector(':scope > .operational-recommendations-card')).toBeTruthy();
    expect(inspectorBody?.querySelector(':scope > .finance-invoice-card')).toBeFalsy();
    expect(
      Array.from(inspectorBody?.querySelectorAll(':scope > .finance-detail-card') ?? []).some((section) =>
        section.textContent?.includes('Settlement preview'),
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

    renderFinancePage();

    expect((await screen.findAllByText('#1095')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('On hold').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Held').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Review assignment' })).toHaveAttribute(
      'href',
      '/orders?order=1095&shopifyOrderId=7819000001095',
    );

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(await screen.findByText('Reason')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
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

    expect(await screen.findByText('Refunded split sale basis')).toBeInTheDocument();
    expect(screen.getAllByText('Adjusted by Shopify refund').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settlement review pending').length).toBeGreaterThan(0);
    expect(screen.queryByText('Blocked split order assignment transaction')).not.toBeInTheDocument();
    expect(screen.queryByText('Split order assignment hold')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(await screen.findByText('Refund completed. The Shopify refund has been processed. This review only determines how the refund adjustment is recorded in settlement accounting. No shipment, refund, or vendor action is required.')).toBeInTheDocument();
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
    expect(screen.getByText('Settlement adjustment awaiting review')).toBeInTheDocument();
    expect(screen.getByText('Operational resolution completed. Only settlement accounting review remains.')).toBeInTheDocument();
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

    renderFinancePage();

    expect(await screen.findByText('Refund deduction')).toBeInTheDocument();
    expect(screen.getAllByText('Refund recorded. Awaiting settlement adjustment review.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settlement review pending').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect((await screen.findAllByText('Settlement adjustment review pending')).length).toBeGreaterThan(0);
    expect(screen.getByText('Refund completed. The Shopify refund has been processed. This review only determines how the refund adjustment is recorded in settlement accounting. No shipment, refund, or vendor action is required.')).toBeInTheDocument();
    expect(screen.getByText('Settlement adjustment awaiting review')).toBeInTheDocument();
    expect(screen.getByText('Operational resolution completed. Only settlement accounting review remains.')).toBeInTheDocument();
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
    const linkedOrder = screen.getAllByText('Order #1021').find((node) => node.closest('a'));

    expect(linkedOrder?.closest('a')).toHaveAttribute('href', '/orders?order=1021&shopifyOrderId=7616544244049');
  });

  it('links finance refund records to the targeted returns workspace query', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[1]);

    const relatedReturn = await screen.findByText('Related return');
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
    expect(screen.getAllByText(/Tax \(/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Shipping fee').length).toBeGreaterThan(0);
    expect(screen.queryByText('Snapshot at sale creation')).not.toBeInTheDocument();
    expect(screen.queryByText('Current vendor profile')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View details' }).length).toBeGreaterThan(0);
  });

  it('does not render legacy invoice accounting diagnostics in the active finance workflow', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Finance workspace' })).toBeInTheDocument();
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
    expect(screen.getAllByText('Payment review').length).toBeGreaterThan(0);
    expect(await screen.findByText('Read-only finance policy')).toBeInTheDocument();
    expect(screen.getByText('Read-only payment preview')).toBeInTheDocument();
    expect(screen.getByText('Latest review status')).toBeInTheDocument();
    expect(screen.queryByText('Latest review artifact')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft payout review')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft settlement payout review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vendor profile/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prepare draft review/i })).not.toBeInTheDocument();
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

    await userEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[0]);
    const panel = getSidePanel(container);

    expect(await screen.findByRole('heading', { name: 'Order #1021' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Financial Totals')).not.toBeInTheDocument();
    expect(panel.getByText('Transaction Summary')).toBeInTheDocument();
    expect(panel.getByText('Why is this payment waiting?')).toBeInTheDocument();
    expect(panel.getByText('Next Action')).toBeInTheDocument();
    expect(panel.getByText('Payment Impact')).toBeInTheDocument();
    expect(panel.getByRole('heading', { name: 'Related records' })).toBeInTheDocument();
    expect(panel.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(panel.getAllByText('No action needed').length).toBeGreaterThan(0);
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

    expect((await screen.findAllByText('Ready for payment')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Payment preparation in progress').length).toBeGreaterThan(0);
    expect(screen.getByText('Refund review')).toBeInTheDocument();
    expect(screen.getByText('Refund recorded. Waiting for review.')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for review').length).toBeGreaterThan(0);
    expect(screen.getByText('Payment Impact')).toBeInTheDocument();
    expect(screen.getByText('Why is this payment waiting?')).toBeInTheDocument();
    const table = within(container.querySelector('.finance-op-table') as HTMLElement);
    expect(table.getAllByText('Ready for payment')).toHaveLength(1);
    expect(table.getAllByText('Payment preparation in progress')).toHaveLength(1);
    expect(table.getByText('Refund recorded. Waiting for review.')).toBeInTheDocument();
    expect(table.queryByText('Order payment activity.')).not.toBeInTheDocument();

    expect(container).not.toHaveTextContent('Settlement review pending');
    expect(container).not.toHaveTextContent('Refund recorded. Awaiting settlement adjustment review.');
    expect(container).not.toHaveTextContent(/Ready for settlement/i);
    expect(container).not.toHaveTextContent(/Waiting settlement/i);
    expect(container).not.toHaveTextContent('Settlement draft locked');
    expect(container).not.toHaveTextContent('Settlement adjustment awaiting review');
    expect(container).not.toHaveTextContent('Refund offset review');
    expect(container).not.toHaveTextContent('Blocked by refund offset');
    expect(container).not.toHaveTextContent('Review settlement');
    expect(container).not.toHaveTextContent(/settlement accounting/i);
    expect(container).not.toHaveTextContent(/payout accounting/i);
    expect(container).not.toHaveTextContent(/\bledger\b/i);
    expect(container).not.toHaveTextContent(/reference id/i);
    expect(container).not.toHaveTextContent(/approval id/i);
    expect(container).not.toHaveTextContent(/commission invoice/i);
    expect(container).not.toHaveTextContent(/\bsettlement\b/i);
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
    const panel = getSidePanel(container);

    expect(await panel.findByText('Why is this payment waiting?')).toBeInTheDocument();
    expect(panel.getByText('Payment Impact')).toBeInTheDocument();
    expect(panel.getAllByText(/Payment will continue after review/)).toHaveLength(1);
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

    await userEvent.click(await screen.findByRole('button', { name: 'View details' }));
    const panel = getSidePanel(container);

    expect(await panel.findByText('Transaction Summary')).toBeInTheDocument();
    expect(panel.getByText('Payment Impact')).toBeInTheDocument();
    expect(panel.getAllByText('Waiting for review').length).toBeGreaterThan(0);
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

    await userEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[0]);

    expect(await screen.findByRole('heading', { name: 'Order #1021' })).toBeInTheDocument();
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0);
    expect(screen.queryByText('Payment evidence pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Included in draft review')).not.toBeInTheDocument();
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
    expect(screen.getByText('Read-only payment preview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prepare draft review/i })).not.toBeInTheDocument();
  });

});
