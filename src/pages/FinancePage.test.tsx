import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancePage } from './FinancePage';
import type { FinanceDashboard, SupportTicket } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getFinanceDashboardMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<FinanceDashboard>>();
const getVendorDebtHistoryMock = vi.fn();
const updateVendorFinancialProfileMock = vi.fn();
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
    updateVendorFinancialProfile: (...args: unknown[]) => updateVendorFinancialProfileMock(...args),
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

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <FinancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/finance']}>
        <FinanceNavigationHarness target={target} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
    updateVendorFinancialProfileMock.mockReset();
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

    expect(screen.getByRole('heading', { name: /finance control center/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by order #, type, status, amount...')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Settlement impact' })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.queryByText('Finance unavailable')).not.toBeInTheDocument();
  });

  it('renders recorded and failed finance statuses with operational hierarchy', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: /finance control center/i })).toBeInTheDocument();
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund impact').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(screen.getByText('Refund deductions')).toBeInTheDocument();
    expect(screen.getAllByText('Settlement estimate').length).toBeGreaterThan(0);
    expect(screen.getByText('Values may change after refunds, shipping reconciliation, manual review, or settlement adjustments.')).toBeInTheDocument();
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
    const card = screen.getByText('Vendor balance').closest('.finance-kpi-card');
    expect(card).toHaveClass('op-tone-success');
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
    const card = screen.getByText('Vendor balance').closest('.finance-kpi-card');
    expect(card).toHaveClass('op-tone-danger');
    expect(screen.getByText('Debt open: $300.00')).toBeInTheDocument();
  });

  it('renders vendor debt history summary and event rows', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    getVendorDebtHistoryMock.mockResolvedValue(vendorDebtHistory);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Vendor Debt History' })).toBeInTheDocument();
    expect(screen.getByText('Outstanding Debt')).toBeInTheDocument();
    expect(screen.getByText('Total Debt Created')).toBeInTheDocument();
    expect(screen.getByText('Total Debt Offset')).toBeInTheDocument();
    expect(screen.getByText('Remaining Debt')).toBeInTheDocument();
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
    expect(screen.getByText('Vendor debt created')).toBeInTheDocument();
    expect(screen.getByText('vendorDebtMinor = refundMinor - commissionReversalMinor - commissionVatReversalMinor')).toBeInTheDocument();
    expect(screen.getAllByText(/payout-batch-1/).length).toBeGreaterThan(0);
  });

  it('renders vendor debt empty state', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    getVendorDebtHistoryMock.mockResolvedValue(emptyVendorDebtHistory);

    renderFinancePage();

    expect(await screen.findByText('No vendor debt history')).toBeInTheDocument();
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
    await userEvent.click(screen.getAllByRole('button', { name: 'View' })[2]);

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
    await userEvent.click(screen.getAllByRole('button', { name: 'View' })[2]);

    expect(await screen.findByText('Review status')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settlement impact').length).toBeGreaterThan(0);
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

    expect(await screen.findByText('Linked finance record unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order #1021' })).not.toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
  });

  it('clears stale selected finance state when a linked target changes', async () => {
    const user = userEvent.setup();
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinanceNavigationHarness('/finance?ledgerId=ledger-refund-failed');

    await user.click((await screen.findAllByRole('button', { name: 'View' }))[1]);
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

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[1]);

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

    expect(await screen.findByRole('heading', { name: 'Finance timeline' })).toBeInTheDocument();
    expect(screen.getByText('Order captured')).toBeInTheDocument();
    expect(screen.getByText('Settlement awaiting review')).toBeInTheDocument();
    expect(screen.getByText('Finance events are previews until settlement review is completed.')).toBeInTheDocument();
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

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[1]);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Order #1001' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('No actions available')).not.toBeInTheDocument();
  });

  it('shows vendor-friendly commission and tax deductions in compact ledger detail', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);

    expect((await screen.findAllByText(/Commission \(/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tax \(/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Shipping fee').length).toBeGreaterThan(0);
    expect(screen.queryByText('Snapshot at sale creation')).not.toBeInTheDocument();
    expect(screen.queryByText('Current vendor profile')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View' }).length).toBeGreaterThan(0);
  });

  it('does not render legacy invoice accounting diagnostics in the active finance workflow', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: 'Finance control center' })).toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Finance control center' })).toBeInTheDocument();
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

  it('shows editable vendor profile controls once for admins', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    expect(screen.getByText('Demo Vendor A marketplace terms')).toBeInTheDocument();
    expect(within(profilePanel).getAllByLabelText(/commission %/i)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /save vendor profile/i })).toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Draft payout review' })).toBeInTheDocument();
    expect(screen.getAllByText('Rows pending review').length).toBeGreaterThan(0);
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

    expect(await screen.findByRole('heading', { name: /finance control center/i })).toBeInTheDocument();
    expect(screen.getAllByText('Settlement estimate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settlement review').length).toBeGreaterThan(0);
    expect(screen.getByText('Refund deductions')).toBeInTheDocument();
    expect(await screen.findByText('Read-only vendor profile')).toBeInTheDocument();
    expect(screen.getByText('Read-only settlement preview')).toBeInTheDocument();
    expect(screen.getByText('Latest review status')).toBeInTheDocument();
    expect(screen.queryByText('Latest review artifact')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft payout review')).not.toBeInTheDocument();
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

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);

    expect(await screen.findByRole('heading', { name: 'Order #1021' })).toBeInTheDocument();
    expect(screen.getAllByText('Settlement estimate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settlement review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$3,059.10').length).toBeGreaterThan(0);
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
    expect(screen.queryByText('Accounting sync')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment evidence pending')).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed|Final payout/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Current vendor-scoped finance query')).not.toBeInTheDocument();
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

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);

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
    expect(screen.getByText('Read-only settlement preview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prepare draft review/i })).not.toBeInTheDocument();
  });

  it('refetches finance data after saving the vendor profile', async () => {
    updateVendorFinancialProfileMock.mockResolvedValue({
      ...financeDashboard.profile,
      commissionPercent: '15.00',
    });
    getFinanceDashboardMock
      .mockResolvedValueOnce(financeDashboard)
      .mockResolvedValueOnce({
        ...financeDashboard,
        summary: {
          ...financeDashboard.summary,
          platformFee: '$491.25',
          payoutEstimate: '$2,783.75',
        },
        profile: {
          ...financeDashboard.profile!,
          commissionPercent: '15.00',
        },
        transactions: [
          financeDashboard.transactions[0],
          {
            ...financeDashboard.transactions[1],
            payoutCalculation: {
              ...financeDashboard.transactions[1].payoutCalculation!,
              commission: '$63.75',
              estimatedPayout: '-$488.75',
            },
          },
          financeDashboard.transactions[2],
        ],
      });

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[1]);
    expect((await screen.findAllByText('-$425.00')).length).toBeGreaterThan(0);
    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    const commissionInput = within(profilePanel).getByLabelText(/commission %/i);
    await userEvent.clear(commissionInput);
    await userEvent.type(commissionInput, '15');
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    await waitFor(() => expect(updateVendorFinancialProfileMock).toHaveBeenCalled());
    await waitFor(() => expect(getFinanceDashboardMock).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('15.00%')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('-$488.75')).length).toBeGreaterThan(0);
  });

  it('refreshes selected invoice payout detail after saving commission and VAT profile changes', async () => {
    updateVendorFinancialProfileMock.mockResolvedValue({
      ...financeDashboard.profile,
      commissionPercent: '15.00',
      commissionVatPercent: '18.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: '88.00',
      source: 'configured',
    });
    getFinanceDashboardMock
      .mockResolvedValueOnce(financeDashboard)
      .mockResolvedValueOnce({
        ...financeDashboard,
        summary: {
          ...financeDashboard.summary,
          platformFee: '$509.85',
          commissionVat: '$91.77',
          shippingDeductions: '$0.00',
          payoutEstimate: '$2,797.38',
        },
        profile: {
          ...financeDashboard.profile!,
          commissionPercent: '15.00',
          commissionVatPercent: '18.00',
          deductShippingEnabled: true,
          shippingMode: 'external_provider',
          fixedShippingFee: '88.00',
          source: 'configured',
        },
        transactions: [
          {
            ...financeDashboard.transactions[0],
            payoutCalculation: {
              ...financeDashboard.transactions[0].payoutCalculation!,
              commission: '$509.85',
              commissionVat: '$91.77',
              shippingDeduction: '$0.00',
              estimatedPayout: '$2,797.38',
              shippingApplied: false,
              shippingMode: 'external_provider',
            },
          },
          financeDashboard.transactions[1],
          financeDashboard.transactions[2],
        ],
      });

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);
    expect((await screen.findAllByText((content) => content.includes('339.90'))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('$0.00')).length).toBeGreaterThan(0);

    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    await userEvent.clear(within(profilePanel).getByLabelText(/^commission %$/i));
    await userEvent.type(within(profilePanel).getByLabelText(/^commission %$/i), '15');
    await userEvent.clear(within(profilePanel).getByLabelText(/commission VAT %/i));
    await userEvent.type(within(profilePanel).getByLabelText(/commission VAT %/i), '18');
    await userEvent.selectOptions(within(profilePanel).getByLabelText(/shipping mode/i), 'external_provider');
    await userEvent.clear(within(profilePanel).getByLabelText(/fixed shipping fee/i));
    await userEvent.type(within(profilePanel).getByLabelText(/fixed shipping fee/i), '88');
    await userEvent.click(within(profilePanel).getByLabelText(/deduct shipping after fulfillment/i));
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    await waitFor(() =>
      expect(updateVendorFinancialProfileMock).toHaveBeenCalledWith('demo-vendor-a', {
        commissionPercent: 15,
        commissionVatPercent: 18,
        deductShippingEnabled: true,
        shippingMode: 'external_provider',
        fixedShippingFee: 88,
        settlementDelayDays: 21,
      }),
    );
    await waitFor(() => expect(getFinanceDashboardMock).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('15.00%')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText((content) => content.includes('509.85'))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText((content) => content.includes('91.77'))).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    expect((await screen.findAllByText('$2,797.38')).length).toBeGreaterThan(0);
  });

  it('sends edited form values when changing a persisted profile from 15/18 to 12/20', async () => {
    const configuredDashboard: FinanceDashboard = {
      ...financeDashboard,
      summary: {
        ...financeDashboard.summary,
        platformFee: '$509.85',
        commissionVat: '$91.77',
        payoutEstimate: '$2,797.38',
      },
      profile: {
        ...financeDashboard.profile!,
        commissionPercent: '15.00',
        commissionVatPercent: '18.00',
        deductShippingEnabled: true,
        shippingMode: 'external_provider',
        fixedShippingFee: '88.00',
        source: 'configured',
      },
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            commission: '$509.85',
            commissionVat: '$91.77',
            estimatedPayout: '$2,797.38',
            shippingMode: 'external_provider',
          },
        },
        financeDashboard.transactions[1],
        financeDashboard.transactions[2],
      ],
    };
    updateVendorFinancialProfileMock.mockResolvedValue({
      ...configuredDashboard.profile!,
      commissionPercent: '12.00',
      commissionVatPercent: '20.00',
    });
    getFinanceDashboardMock
      .mockResolvedValueOnce(configuredDashboard)
      .mockResolvedValueOnce({
        ...configuredDashboard,
        summary: {
          ...configuredDashboard.summary,
          platformFee: '$407.88',
          commissionVat: '$81.58',
          payoutEstimate: '$2,909.54',
        },
        profile: {
          ...configuredDashboard.profile!,
          commissionPercent: '12.00',
          commissionVatPercent: '20.00',
        },
        transactions: [
          {
            ...configuredDashboard.transactions[0],
            payoutCalculation: {
              ...configuredDashboard.transactions[0].payoutCalculation!,
              commission: '$407.88',
              commissionVat: '$81.58',
              estimatedPayout: '$2,909.54',
            },
          },
          configuredDashboard.transactions[1],
          configuredDashboard.transactions[2],
        ],
      });

    renderFinancePage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);
    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    await userEvent.clear(within(profilePanel).getByLabelText(/^commission %$/i));
    await userEvent.type(within(profilePanel).getByLabelText(/^commission %$/i), '12');
    await userEvent.clear(within(profilePanel).getByLabelText(/commission VAT %/i));
    await userEvent.type(within(profilePanel).getByLabelText(/commission VAT %/i), '20');
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    await waitFor(() =>
      expect(updateVendorFinancialProfileMock).toHaveBeenCalledWith('demo-vendor-a', {
        commissionPercent: 12,
        commissionVatPercent: 20,
        deductShippingEnabled: true,
        shippingMode: 'external_provider',
        fixedShippingFee: 88,
        settlementDelayDays: 21,
      }),
    );
    expect((await screen.findAllByText('12.00%')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText((content) => content.includes('407.88'))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText((content) => content.includes('81.58'))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('$2,909.54')).length).toBeGreaterThan(0);
  });

  it('surfaces vendor profile save failures', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    updateVendorFinancialProfileMock.mockRejectedValue(new Error('Profile save failed'));

    renderFinancePage();

    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    await userEvent.clear(within(profilePanel).getByLabelText(/^commission %$/i));
    await userEvent.type(within(profilePanel).getByLabelText(/^commission %$/i), '12');
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    expect(await screen.findByText('Profile save failed')).toBeInTheDocument();
  });
});
