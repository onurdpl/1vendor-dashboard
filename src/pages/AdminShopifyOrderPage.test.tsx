import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import type { ShopifyOrderBreakdown } from '../features/orders/api';
import { formatDateTime } from '../services/real/formatting';
import { AdminShopifyOrderPage } from './AdminShopifyOrderPage';

const getAdminShopifyOrderBreakdownMock = vi.fn<() => Promise<ShopifyOrderBreakdown>>();
const sendAdminProductPanelVariantDisableDryRunMock = vi.fn();
const previewAdminShopifyRefundMock = vi.fn();
const executeAdminShopifyRefundMock = vi.fn();

vi.mock('../features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/orders/api')>();
  return {
    ...actual,
    executeAdminShopifyRefund: (...args: unknown[]) => executeAdminShopifyRefundMock(...args),
    getAdminShopifyOrderBreakdown: () => getAdminShopifyOrderBreakdownMock(),
    previewAdminShopifyRefund: (...args: unknown[]) => previewAdminShopifyRefundMock(...args),
    sendAdminProductPanelVariantDisableDryRun: (shopifyOrderId: string) =>
      sendAdminProductPanelVariantDisableDryRunMock(shopifyOrderId),
  };
});

vi.mock('../features/finance/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/finance/api')>();
  return {
    ...actual,
    acknowledgeFinanceIntegrityAlert: vi.fn(),
    getTransferRecoveryDiagnostics: vi.fn(),
    rescanFinanceIntegrityAlert: vi.fn(),
    retryEconomicTransfer: vi.fn(),
    resolveFinanceIntegrityAlert: vi.fn(),
  };
});

function buildLineItem(overrides: Partial<ShopifyOrderBreakdown['allocations'][number]['lineItems'][number]> = {}) {
  return {
    originalVendorId: 'yalispor',
    assignedVendorId: 'yalispor',
    id: 'allocation-line-1',
    sku: 'SKU-1088',
    variantTitle: 'Default',
    name: 'Split item',
    imageUrl: null,
    quantity: 1,
    price: '250.00',
    shopifyProductId: null,
    unitPriceVatIncluded: null,
    lineTotalVatIncluded: null,
    lineTaxAmount: null,
    vatRate: null,
    vendorId: 'yalispor',
    fulfillmentStatus: 'Pending',
    allocationStatus: 'vendor_blocked',
    reassignmentRequired: true,
    fulfillmentActionState: 'blocked',
    fulfillmentActionAvailable: false,
    shippingStatus: 'Awaiting Shipment',
    ...overrides,
  };
}

function buildAllocation(
  overrides: Partial<ShopifyOrderBreakdown['allocations'][number]> = {},
): ShopifyOrderBreakdown['allocations'][number] {
  return {
    originalVendorId: 'yalispor',
    assignedVendorId: 'yalispor',
    vendorId: 'yalispor',
    vendorName: 'Yalı Spor',
    allocationOrderId: 'alloc-child',
    status: 'blocked',
    allocationStatus: 'vendor_blocked',
    cancellationReason: 'OUT_OF_STOCK',
    reassignmentRequired: true,
    assignmentHistory: [],
    reassignmentCandidateVendorIds: [],
    fulfillmentActionState: 'blocked',
    fulfillmentActionAvailable: false,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    allocationTotal: '250.00',
    lineItems: [buildLineItem()],
    refundedItems: [],
    refundTotal: '0.00',
    financeIntegrityAlerts: [],
    transferSummary: null,
    cancelRefundReview: null,
    outboundRefundAttemptSummary: null,
    productPanelVariantDisableEvents: [],
    splitSummary: {
      splitEventId: 'split-event-1',
      sourceAllocationId: 'alloc-source',
      childAllocationId: 'alloc-child',
      reason: 'OUT_OF_STOCK',
      note: 'Selected size is unavailable.',
      createdAt: '2026-06-21T12:45:00.000Z',
      actorUserId: 'vendor-user-1',
      actorName: 'Vendor User',
      lineageRole: 'child',
      movedItems: [
        {
          vendorAllocationLineItemId: 'allocation-line-1',
          shopifyLineItemId: 'gid://shopify/LineItem/1',
          sku: 'SKU-1088',
          title: 'Split item',
          quantity: 1,
          lineAmount: 250,
        },
      ],
    },
    ...overrides,
  };
}

function buildProductPanelEvent(
  overrides: Partial<NonNullable<ShopifyOrderBreakdown['allocations'][number]['productPanelVariantDisableEvents']>[number]> = {},
): NonNullable<ShopifyOrderBreakdown['allocations'][number]['productPanelVariantDisableEvents']>[number] {
  return {
    id: 'product-panel-event-1',
    status: 'CREATED',
    shopifyVariantId: 'gid://shopify/ProductVariant/111',
    shopifyLineItemId: 'gid://shopify/LineItem/1',
    variantSku: 'SKU-1088',
    reasonCode: 'OUT_OF_STOCK',
    reasonText: 'Selected size is unavailable.',
    quantity: 1,
    requestedAt: '2026-06-21T12:46:00.000Z',
    environment: 'test',
    dryRun: true,
    attemptCount: 0,
    error: null,
    resolvedAt: null,
    failedAt: null,
    response: null,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function buildRefundAttemptSummary(
  id: string,
  status: 'SHOPIFY_ACTION_PENDING' | 'RESOLVED' | 'FAILED',
  failureReason: string | null = null,
): NonNullable<ShopifyOrderBreakdown['allocations'][number]['outboundRefundAttemptSummary']> {
  return {
    id,
    status,
    restockType: 'CANCEL',
    refundShipping: false,
    notifyCustomer: false,
    shopifyRefundId: status === 'RESOLVED' ? 'gid://shopify/Refund/terminal' : null,
    previewedAt: '2026-08-12T10:00:00.000Z',
    requestedAt: '2026-08-12T10:01:00.000Z',
    submittedAt: '2026-08-12T10:01:01.000Z',
    resolvedAt: status === 'RESOLVED' ? '2026-08-12T10:01:02.000Z' : null,
    failedAt: status === 'FAILED' ? '2026-08-12T10:01:02.000Z' : null,
    failureReason,
    postRefundFulfillmentCheckStatus: status === 'RESOLVED' ? 'passed' : null,
    postRefundFulfillmentCheckMessage: status === 'RESOLVED' ? 'Selected lines are no longer fulfillable.' : null,
  };
}

function buildRefundExecutionBreakdown(
  attemptSummary: ShopifyOrderBreakdown['allocations'][number]['outboundRefundAttemptSummary'] = null,
  completed = false,
): ShopifyOrderBreakdown {
  return {
    sourceShopifyOrderId: '7817723773265',
    sourceShopifyOrderNumber: '#1117',
    customer: 'Customer',
    financialStatus: completed ? 'refunded' : 'pending',
    customerRefundCompletion: completed
      ? {
          status: 'VERIFIED_FULL_CUSTOMER_REFUND',
          reasonCode: 'canonical_full_customer_refund_verified',
          displayFinancialStatus: 'REFUNDED',
          currency: 'TRY',
          totalReceivedAmount: '250.00',
          totalRefundedAmount: '250.00',
          netPaymentAmount: '0.00',
          totalOutstandingAmount: '0.00',
          totalRefundedShippingAmount: '0.00',
        }
      : undefined,
    createdAt: '2026-08-12T09:00:00.000Z',
    allocations: [
      buildAllocation({
        cancelRefundReview: {
          status: 'PENDING_REVIEW',
          reason: 'OUT_OF_STOCK',
          note: 'Customer refund approved.',
          requestedAt: '2026-08-12T09:30:00.000Z',
          requestedByUserId: 'admin-1',
        },
        outboundRefundAttemptSummary: attemptSummary,
        refundTotal: completed ? '250.00' : '0.00',
        refundedItems: completed
          ? [{
              id: 'refund-line-terminal',
              originalVendorId: 'yalispor',
              assignedVendorId: 'yalispor',
              vendorId: 'yalispor',
              sku: 'SKU-1088',
              variantTitle: 'Refund',
              name: 'Split item',
              quantity: 1,
              condition: 'New',
              refundAmount: '250.00',
            }]
          : [],
      }),
    ],
  };
}

function buildExecutableRefundPreview() {
  return {
    ok: true,
    writesPerformed: false,
    allocationId: 'alloc-child',
    shopifyOrderId: '7817723773265',
    refundLineItemsPreview: [{
      lineItemId: 'gid://shopify/LineItem/1',
      quantity: 1,
      restockType: 'CANCEL',
    }],
    suggestedRefund: {
      totalRefundAmount: '250.00',
      productRefundAmount: '250.00',
      currencyCode: 'TRY',
      totalTaxAmount: '0.00',
      shippingAmount: null,
      shippingMaximumRefundableAmount: '0.00',
      suggestedTransactions: [{
        gateway: 'bogus',
        amount: '250.00',
        currencyCode: 'TRY',
        parentTransactionId: 'gid://shopify/OrderTransaction/1',
      }],
    },
    refundMode: 'PRODUCT_ONLY',
    shippingEligibility: {
      status: 'NOT_ELIGIBLE',
      reasonCode: 'not_requested',
    },
    fulfillmentOrderCancellation: {
      affectedFulfillmentOrders: [],
      overallClassification: 'no_cancellation_needed',
      blockers: [],
      warnings: [],
    },
    warnings: [],
    blockers: [],
    missingData: [],
  } as const;
}

async function openRefundExecutionDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Shopify refund' }));
  await screen.findByLabelText('Shopify suggested refund preview');
  fireEvent.click(screen.getByRole('button', { name: 'Refund in Shopify' }));

  const dialog = await screen.findByRole('dialog', { name: 'Refund in Shopify' });
  fireEvent.change(within(dialog).getByLabelText('Refund note'), {
    target: { value: 'Customer-approved refund.' },
  });
  fireEvent.click(within(dialog).getByLabelText('I understand this will trigger a real Shopify payment refund.'));
  fireEvent.click(within(dialog).getByLabelText('I understand Sporgym finance updates only after the refunds/create webhook.'));
  return dialog;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/orders/7817723773265']}>
        <Routes>
          <Route path="/admin/orders/:shopifyOrderId" element={<AdminShopifyOrderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function findLatestStatusAxes() {
  const statusAxes = await screen.findAllByLabelText('Admin allocation status axes');
  return statusAxes[statusAxes.length - 1];
}

describe('AdminShopifyOrderPage split visibility', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentVendorId('demo-vendor-a');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'replacement-vendor', vendorName: 'Replacement Vendor' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getAdminShopifyOrderBreakdownMock.mockReset();
    sendAdminProductPanelVariantDisableDryRunMock.mockReset();
    previewAdminShopifyRefundMock.mockReset();
    executeAdminShopifyRefundMock.mockReset();
  });

  it('uses current blocked state and latest history time without contradicting the status', async () => {
    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      financialStatus: 'pending',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [
        buildAllocation({
          splitSummary: null,
          assignmentHistory: [
            { action: 'vendor_blocked', fromVendorId: 'yalispor', toVendorId: 'yalispor', actorName: 'Vendor user', actorRole: 'vendor', createdAt: '2026-06-21T10:00:00.000Z' },
            { action: 'admin_returned_to_vendor', fromVendorId: 'yalispor', toVendorId: 'yalispor', actorName: 'Admin user', actorRole: 'admin', createdAt: '2026-06-21T11:00:00.000Z' },
            { action: 'vendor_blocked', fromVendorId: 'yalispor', toVendorId: 'yalispor', actorName: 'Vendor user', actorRole: 'vendor', createdAt: '2026-06-21T15:00:00.000Z' },
          ],
        }),
      ],
    });

    renderPage();

    await screen.findByText(/Blocked ·/);
    expect(screen.queryByText('Not blocked')).not.toBeInTheDocument();
    expect(screen.getByText(/Blocked ·/)).toHaveTextContent(formatDateTime('2026-06-21T15:00:00.000Z', { dateStyle: 'medium', timeStyle: 'short' }));
  });

  it('shows unavailable block time for blocked history gaps and hides old history for active state', async () => {
    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      financialStatus: 'pending',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [buildAllocation({ splitSummary: null, assignmentHistory: [] })],
    });

    const view = renderPage();
    expect(await screen.findByText('Blocked — time unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Not blocked')).not.toBeInTheDocument();

    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      financialStatus: 'pending',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [buildAllocation({ allocationStatus: 'active', status: 'Pending', reassignmentRequired: false, splitSummary: null, assignmentHistory: [{ action: 'vendor_blocked', fromVendorId: 'yalispor', toVendorId: 'yalispor', actorName: 'Vendor user', actorRole: 'vendor', createdAt: '2026-06-21T10:00:00.000Z' }] })],
    });
    view.unmount();
    renderPage();
    expect(await screen.findByText('Not blocked')).toBeInTheDocument();
    expect(screen.queryByText(/Blocked ·/)).not.toBeInTheDocument();
  });

  it('loads admin order detail for an authenticated admin even when vendor context is missing', async () => {
    setCurrentVendorId(null);
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    });
    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      financialStatus: 'pending',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [buildAllocation()],
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Line-item split allocation' })).toBeInTheDocument();
    expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Loading Shopify breakdown')).not.toBeInTheDocument();
  });

    it('renders child split summary card, moved items, and split timeline events', async () => {
    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      financialStatus: 'pending',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [
        buildAllocation({
          fulfillmentActionState: 'awaiting_shipment',
          productPanelVariantDisableEvents: [
            {
              id: 'product-panel-event-1',
              status: 'RESOLVED_DRY_RUN',
              shopifyVariantId: 'gid://shopify/ProductVariant/111',
              shopifyLineItemId: 'gid://shopify/LineItem/1',
              variantSku: 'SKU-1088',
              reasonCode: 'OUT_OF_STOCK',
              reasonText: 'Selected size is unavailable.',
              quantity: 1,
              requestedAt: '2026-06-21T12:46:00.000Z',
              environment: 'test',
              dryRun: true,
              attemptCount: 1,
              error: null,
              resolvedAt: '2026-06-21T12:47:00.000Z',
              failedAt: null,
              response: {
                accepted: true,
                dryRun: true,
                canResolve: true,
                parentSku: 'PARENT-SKU-1088',
                normalizedSize: '42',
                sizeKey: '42',
                resolutionMethod: 'shopify_variant_metafield',
                confidence: 'high',
                writesPerformed: false,
              },
            },
          ],
        }),
      ],
    });

    renderPage();

    const statusAxes = await findLatestStatusAxes();
    expect(within(statusAxes).getByText('Operational Status')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Fulfillment Status')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Awaiting Shipment')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Payment Status')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('vendor_blocked')).not.toBeInTheDocument();
    expect(screen.queryByText('awaiting_shipment')).not.toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Line-item split allocation' })).toBeInTheDocument();
    expect(screen.getByText('This allocation was created when the vendor rejected selected line items.')).toBeInTheDocument();
    expect(screen.getByText('alloc-source')).toBeInTheDocument();
    expect(screen.getAllByText('alloc-child').length).toBeGreaterThan(0);
    expect(screen.getByText(/Selected size is unavailable/)).toBeInTheDocument();

    const splitCard = screen.getByLabelText('Allocation split summary');
    expect(within(splitCard).getByText('SKU-1088')).toBeInTheDocument();
    expect(within(splitCard).getByText('Split item')).toBeInTheDocument();
    expect(within(splitCard).getByText('250.00')).toBeInTheDocument();

    expect(screen.getByText('Allocation split created')).toBeInTheDocument();
    expect(screen.getByText('Selected items moved to blocked allocation')).toBeInTheDocument();
      expect(screen.getByText('Child allocation awaiting admin resolution')).toBeInTheDocument();
    expect(screen.getByText('Variant Disable dry-run resolved')).toBeInTheDocument();
    expect(screen.getByText(/Parent SKU: PARENT-SKU-1088/)).toBeInTheDocument();
    expect(screen.getByText(/Size: 42/)).toBeInTheDocument();
    expect(screen.getByText(/Confidence: high/)).toBeInTheDocument();
    });

    it('renders Product Panel dry-run sending and success feedback, then refreshes detail', async () => {
      const sendResult = createDeferred<{
        ok: true;
        attempted: number;
        resolved: number;
        failed: number;
        skipped: number;
        latestEventStatuses: [];
      }>();
      getAdminShopifyOrderBreakdownMock
        .mockResolvedValueOnce({
          sourceShopifyOrderId: '7817723773265',
          sourceShopifyOrderNumber: '#1091',
          customer: 'Customer',
          financialStatus: 'pending',
          createdAt: '2026-06-21T08:00:00.000Z',
          allocations: [
            buildAllocation({
              productPanelVariantDisableEvents: [buildProductPanelEvent()],
            }),
          ],
        })
        .mockResolvedValueOnce({
          sourceShopifyOrderId: '7817723773265',
          sourceShopifyOrderNumber: '#1091',
          customer: 'Customer',
          financialStatus: 'pending',
          createdAt: '2026-06-21T08:00:00.000Z',
          allocations: [
            buildAllocation({
              productPanelVariantDisableEvents: [
                buildProductPanelEvent({
                  status: 'RESOLVED_DRY_RUN',
                  attemptCount: 1,
                  resolvedAt: '2026-06-21T12:47:00.000Z',
                  error: null,
                  response: {
                    accepted: true,
                    dryRun: true,
                    canResolve: true,
                    parentSku: 'PARENT-SKU-1088',
                    writesPerformed: false,
                  },
                }),
              ],
            }),
          ],
        });
      sendAdminProductPanelVariantDisableDryRunMock.mockReturnValueOnce(sendResult.promise);

      renderPage();

      expect(await screen.findByRole('heading', { name: 'Variant availability validation' })).toBeInTheDocument();
      expect(screen.getByText('Validates Product Panel resolver. Does not disable products or change Shopify inventory.')).toBeInTheDocument();
      const dryRunCard = screen.getByLabelText('Product Panel variant disable dry-run');
      expect(within(dryRunCard).getByText('Latest status')).toBeInTheDocument();
      expect(within(dryRunCard).getByText('Created')).toBeInTheDocument();
      expect(within(dryRunCard).getByText('Attempt count')).toBeInTheDocument();
      expect(within(dryRunCard).getByText('Not attempted')).toBeInTheDocument();
      const sendButton = within(dryRunCard).getByRole('button', { name: 'Send dry-run now' });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(sendAdminProductPanelVariantDisableDryRunMock).toHaveBeenCalledWith('7817723773265');
      });
      expect(within(dryRunCard).getByRole('button', { name: 'Sending dry-run...' })).toBeDisabled();
      expect(within(dryRunCard).getAllByText('Sending dry-run...').length).toBeGreaterThan(0);

      sendResult.resolve({
        ok: true,
        attempted: 1,
        resolved: 1,
        failed: 0,
        skipped: 0,
        latestEventStatuses: [],
      });

      await waitFor(() => {
        expect(screen.getAllByText('Dry-run sent. Refreshing validation status.').length).toBeGreaterThan(0);
      });
      const resultGrid = await screen.findByLabelText('Product Panel dry-run send result');
      expect(within(resultGrid).getByText('Attempted')).toBeInTheDocument();
      expect(within(resultGrid).getAllByText('1').length).toBeGreaterThanOrEqual(2);
      expect(within(resultGrid).getByText('Skipped')).toBeInTheDocument();
      await waitFor(() => {
        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);
      });
      expect(await screen.findByText('Variant Disable dry-run resolved')).toBeInTheDocument();
      expect(within(screen.getByLabelText('Product Panel variant disable dry-run')).getByText('Resolved Dry Run')).toBeInTheDocument();
    });

    it('hides manual Product Panel dry-run send action when no event is retryable', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1091',
        customer: 'Customer',
        financialStatus: 'pending',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            productPanelVariantDisableEvents: [
              buildProductPanelEvent({
                status: 'RESOLVED_DRY_RUN',
                attemptCount: 1,
                resolvedAt: '2026-06-21T12:47:00.000Z',
              }),
            ],
          }),
        ],
      });

      renderPage();

      expect(await screen.findByRole('heading', { name: 'Variant availability validation' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send dry-run now' })).not.toBeInTheDocument();
      expect(sendAdminProductPanelVariantDisableDryRunMock).not.toHaveBeenCalled();
    });

    it('renders inline Product Panel dry-run failure feedback with safe error detail', async () => {
      const initialBreakdown = {
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1091',
        customer: 'Customer',
        financialStatus: 'pending',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            productPanelVariantDisableEvents: [buildProductPanelEvent()],
          }),
        ],
      };
      getAdminShopifyOrderBreakdownMock
        .mockResolvedValueOnce(initialBreakdown)
        .mockResolvedValueOnce(initialBreakdown);
      sendAdminProductPanelVariantDisableDryRunMock.mockRejectedValueOnce(new Error('Product Panel route unavailable.'));

      renderPage();

      const dryRunCard = await screen.findByLabelText('Product Panel variant disable dry-run');
      fireEvent.click(within(dryRunCard).getByRole('button', { name: 'Send dry-run now' }));

      await waitFor(() => {
        expect(sendAdminProductPanelVariantDisableDryRunMock).toHaveBeenCalledWith('7817723773265');
      });
      await waitFor(() => {
        expect(screen.getAllByText('Dry-run delivery failed. No product availability changed.').length).toBeGreaterThan(0);
      });
      expect(screen.getAllByText('Product Panel route unavailable.').length).toBeGreaterThan(0);
      expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);
    });

    it('renders Product Panel response auth message as the latest error', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1091',
        customer: 'Customer',
        financialStatus: 'pending',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            productPanelVariantDisableEvents: [
              buildProductPanelEvent({
                status: 'FAILED',
                attemptCount: 1,
                error: 'Product Panel dry-run failed with status 401.',
                failedAt: '2026-06-21T12:47:00.000Z',
                response: {
                  error: 'unauthorized',
                  message: 'Invalid HMAC signature.',
                  missingHeaders: ['X-Sporgym-Signature'],
                },
              }),
            ],
          }),
        ],
      });

      renderPage();

      const dryRunCard = await screen.findByLabelText('Product Panel variant disable dry-run');
      expect(within(dryRunCard).getByText('Latest error')).toBeInTheDocument();
      expect(within(dryRunCard).getByText('Invalid HMAC signature.')).toBeInTheDocument();
      expect(screen.getByText(/Error: Invalid HMAC signature./)).toBeInTheDocument();
    });

    it('renders real Product Panel created and duplicate outcomes', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1091',
        customer: 'Customer',
        financialStatus: 'pending',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            productPanelVariantDisableEvents: [
              buildProductPanelEvent({
                id: 'product-panel-event-created',
                status: 'RESOLVED_DRY_RUN',
                dryRun: false,
                attemptCount: 1,
                error: null,
                resolvedAt: '2026-06-21T12:48:00.000Z',
                response: {
                  created: true,
                  duplicate: false,
                  ruleId: 'rule-123',
                  parentSku: 'PARENT-SKU-1088',
                  normalizedSize: '42',
                  writesPerformed: true,
                },
              }),
              buildProductPanelEvent({
                id: 'product-panel-event-duplicate',
                status: 'RESOLVED_DRY_RUN',
                dryRun: false,
                attemptCount: 1,
                error: null,
                resolvedAt: '2026-06-21T12:47:00.000Z',
                response: {
                  created: false,
                  duplicate: true,
                  ruleId: 'rule-123',
                  parentSku: 'PARENT-SKU-1088',
                  normalizedSize: '42',
                  writesPerformed: false,
                },
              }),
            ],
          }),
        ],
      });

      renderPage();

      const dryRunCard = await screen.findByLabelText('Product Panel variant disable dry-run');
      expect(within(dryRunCard).getByText('Product Panel disable')).toBeInTheDocument();
      expect(within(dryRunCard).getByText('Real disable enabled')).toBeInTheDocument();
      expect(within(dryRunCard).getByText('Latest outcome')).toBeInTheDocument();
      expect(within(dryRunCard).getByText('Disable rule created')).toBeInTheDocument();
      expect(screen.getByText(/Duplicate active rule accepted/)).toBeInTheDocument();
    });

    it('renders real Product Panel disable button copy from backend mode', async () => {
      const sendResult = createDeferred<{
        ok: true;
        attempted: number;
        resolved: number;
        failed: number;
        skipped: number;
        latestEventStatuses: [];
      }>();
      getAdminShopifyOrderBreakdownMock
        .mockResolvedValueOnce({
          sourceShopifyOrderId: '7817723773265',
          sourceShopifyOrderNumber: '#1091',
          customer: 'Customer',
          financialStatus: 'pending',
          createdAt: '2026-06-21T08:00:00.000Z',
          productPanelVariantDisableMode: {
            enabled: true,
            dryRun: false,
          },
          allocations: [
            buildAllocation({
              productPanelVariantDisableEvents: [buildProductPanelEvent()],
            }),
          ],
        })
        .mockResolvedValueOnce({
          sourceShopifyOrderId: '7817723773265',
          sourceShopifyOrderNumber: '#1091',
          customer: 'Customer',
          financialStatus: 'pending',
          createdAt: '2026-06-21T08:00:00.000Z',
          productPanelVariantDisableMode: {
            enabled: true,
            dryRun: false,
          },
          allocations: [
            buildAllocation({
              productPanelVariantDisableEvents: [
                buildProductPanelEvent({
                  status: 'RESOLVED',
                  dryRun: false,
                  attemptCount: 1,
                  resolvedAt: '2026-06-21T12:47:00.000Z',
                  error: null,
                  response: {
                    accepted: true,
                    dryRun: false,
                    canResolve: true,
                    writesPerformed: true,
                    created: false,
                    duplicate: true,
                    ruleId: 'pvd_123',
                    parentSku: 'PARENT-SKU-1088',
                    normalizedSize: '42',
                  },
                }),
              ],
            }),
          ],
        });
      sendAdminProductPanelVariantDisableDryRunMock.mockReturnValueOnce(sendResult.promise);

      renderPage();

      const card = await screen.findByLabelText('Product Panel variant disable dry-run');
      expect(within(card).getByRole('button', { name: 'Send disable now' })).toBeInTheDocument();
      fireEvent.click(within(card).getByRole('button', { name: 'Send disable now' }));

      await waitFor(() => {
        expect(sendAdminProductPanelVariantDisableDryRunMock).toHaveBeenCalledWith('7817723773265');
      });
      expect(within(card).getByRole('button', { name: 'Sending disable...' })).toBeDisabled();

      sendResult.resolve({
        ok: true,
        attempted: 1,
        resolved: 1,
        failed: 0,
        skipped: 0,
        latestEventStatuses: [],
      });

      await waitFor(() => {
        expect(screen.getAllByText('Disable request sent. Refreshing validation status.').length).toBeGreaterThan(0);
      });
      expect(await screen.findByText('Duplicate active rule accepted')).toBeInTheDocument();
      expect(screen.getByText('pvd_123')).toBeInTheDocument();
      expect(screen.getByText('PARENT-SKU-1088')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders inline Product Panel dry-run zero-attempt feedback', async () => {
      const initialBreakdown = {
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1091',
        customer: 'Customer',
        financialStatus: 'pending',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            productPanelVariantDisableEvents: [buildProductPanelEvent()],
          }),
        ],
      };
      getAdminShopifyOrderBreakdownMock
        .mockResolvedValueOnce(initialBreakdown)
        .mockResolvedValueOnce(initialBreakdown);
      sendAdminProductPanelVariantDisableDryRunMock.mockResolvedValueOnce({
        ok: true,
        attempted: 0,
        resolved: 0,
        failed: 0,
        skipped: 0,
        latestEventStatuses: [],
      });

      renderPage();

      const dryRunCard = await screen.findByLabelText('Product Panel variant disable dry-run');
      fireEvent.click(within(dryRunCard).getByRole('button', { name: 'Send dry-run now' }));

      await waitFor(() => {
        expect(sendAdminProductPanelVariantDisableDryRunMock).toHaveBeenCalledWith('7817723773265');
      });
      await waitFor(() => {
        expect(screen.getAllByText('No queued Product Panel dry-run events were eligible to send.').length).toBeGreaterThan(0);
      });
      const resultGrid = screen.getByLabelText('Product Panel dry-run send result');
      expect(within(resultGrid).getByText('Attempted')).toBeInTheDocument();
      expect(within(resultGrid).getAllByText('0').length).toBeGreaterThanOrEqual(4);
      expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);
    });

    it('renders return ownership context for allocations with return records', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1098',
        customer: 'Customer',
        financialStatus: 'paid',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            originalVendorId: 'yalispor',
            assignedVendorId: 'sporjinal',
            vendorId: 'sporjinal',
            vendorName: 'Sporjinal',
            returnRecordCount: 1,
            returnRecords: [
              {
                id: 'return-1098',
                status: 'closed',
                reason: 'Customer return closed after refund.',
                createdAt: '2026-06-20T10:00:00.000Z',
                updatedAt: '2026-06-20T10:15:00.000Z',
                returnOwnershipSummary: {
                  originalVendorId: 'yalispor',
                  originalVendorName: 'Yalı Spor',
                  assignedVendorId: 'sporjinal',
                  assignedVendorName: 'Sporjinal',
                  returnOwnerVendorId: 'sporjinal',
                  returnOwnerVendorName: 'Sporjinal',
                  refundFinanceOwnerVendorId: 'sporjinal',
                  refundFinanceOwnerVendorName: 'Sporjinal',
                  economicOwnerVendorId: 'sporjinal',
                  economicOwnerVendorName: 'Sporjinal',
                  ownershipSource: 'return_owner_snapshot',
                  transferSummary: {
                    fromVendorId: 'yalispor',
                    fromVendorName: 'Yalı Spor',
                    toVendorId: 'sporjinal',
                    toVendorName: 'Sporjinal',
                    transferCompletedAt: '2026-06-18T09:30:00.000Z',
                  },
                },
              },
            ],
          }),
        ],
      });

      renderPage();

      const ownershipContext = await screen.findByLabelText('Return ownership context');
      expect(within(ownershipContext).getByText('Return owner')).toBeInTheDocument();
      expect(within(ownershipContext).getByText('Current assigned vendor')).toBeInTheDocument();
      expect(within(ownershipContext).getByText('Original vendor')).toBeInTheDocument();
      expect(within(ownershipContext).getByText('Yalı Spor (yalispor)')).toBeInTheDocument();
      expect(within(ownershipContext).getAllByText('Sporjinal (sporjinal)').length).toBeGreaterThanOrEqual(2);
      expect(within(ownershipContext).getByText(/Transfer:/)).toHaveTextContent('Yalı Spor (yalispor) to Sporjinal (sporjinal)');
    });

    it('renders refunded allocations with separated operational, fulfillment, and payment axes', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1099',
        customer: 'Customer',
        financialStatus: 'refunded',
        customerRefundCompletion: {
          status: 'VERIFIED_FULL_CUSTOMER_REFUND',
          reasonCode: 'canonical_full_customer_refund_verified',
          displayFinancialStatus: 'REFUNDED',
          currency: 'TRY',
          totalReceivedAmount: '1249.00',
          totalRefundedAmount: '1249.00',
          netPaymentAmount: '0.00',
          totalOutstandingAmount: '0.00',
          totalRefundedShippingAmount: '0.00',
        },
        refundWebhookStatus: 'PROCESSED',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            allocationTotal: 'TRY\u00a01,249.00',
            lineItems: [buildLineItem({ price: 'TRY\u00a01,249.00' })],
            refundTotal: 'TRY\u00a01,249.00',
            cancelRefundReview: {
              status: 'RESOLVED',
              reason: 'OUT_OF_STOCK',
              note: 'Reviewed',
              requestedAt: '2026-06-21T11:00:00.000Z',
              requestedByUserId: 'admin-1',
            },
            refundedItems: [
              {
                id: 'refund-line-1',
                originalVendorId: 'yalispor',
                assignedVendorId: 'yalispor',
                vendorId: 'yalispor',
                sku: 'SKU-1088',
                variantTitle: 'Refund gid://shopify/Refund/1',
                name: 'Split item',
                quantity: 1,
                condition: 'New',
                refundAmount: 'TRY\u00a01,249.00',
              },
            ],
            outboundRefundAttemptSummary: {
              id: 'attempt-1',
              status: 'RESOLVED',
              restockType: 'CANCEL',
              refundShipping: false,
              notifyCustomer: false,
              shopifyRefundId: 'gid://shopify/Refund/1',
              previewedAt: '2026-06-21T12:00:00.000Z',
              requestedAt: '2026-06-21T12:05:00.000Z',
              submittedAt: '2026-06-21T12:06:00.000Z',
              resolvedAt: '2026-06-21T12:07:00.000Z',
              failedAt: null,
              failureReason: null,
              postRefundFulfillmentCheckStatus: 'passed',
              postRefundFulfillmentCheckMessage: 'Selected lines no longer fulfillable.',
            },
          }),
        ],
      });

      renderPage();

      const statusAxes = await findLatestStatusAxes();
      expect(within(statusAxes).getByText('Operational Status')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Refunded')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Fulfillment Status')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Fulfillment not required')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Payment Status')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Refund completed')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Historical Context')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Vendor blocked')).toBeInTheDocument();
      expect(screen.getByText('Product refund recorded')).toBeInTheDocument();
      const productRefundItem = screen.getByText('Product refund recorded').closest('.meta-item');
      expect(productRefundItem).not.toBeNull();
      expect(productRefundItem).toHaveTextContent('TRY 1,249.00');
      expect(screen.getByText('Latest order refund webhook')).toBeInTheDocument();
      expect(screen.getByText('Processed')).toBeInTheDocument();
      expect(screen.queryByText('Refund impact', { exact: false })).not.toBeInTheDocument();
      expect(screen.queryByText('Webhook received', { exact: false })).not.toBeInTheDocument();
      expect(screen.queryByText('vendor_blocked')).not.toBeInTheDocument();
    });

    it('keeps product refund recorded separate from a later checkout shipping-only refund', async () => {
      const breakdown = buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-shipping-only', 'RESOLVED'), true);
      breakdown.customerRefundCompletion = {
        status: 'VERIFIED_FULL_CUSTOMER_REFUND',
        reasonCode: 'canonical_full_customer_refund_verified',
        displayFinancialStatus: 'REFUNDED',
        currency: 'TRY',
        totalReceivedAmount: '2499.50',
        totalRefundedAmount: '2499.50',
        netPaymentAmount: '0.00',
        totalOutstandingAmount: '0.00',
        totalRefundedShippingAmount: '100.00',
      };
      breakdown.refundWebhookStatus = 'PROCESSED';
      breakdown.allocations[0]!.refundTotal = 'TRY\u00a02,399.50';
      breakdown.allocations[0]!.refundedItems[0]!.refundAmount = 'TRY\u00a02,399.50';
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce(breakdown);

      renderPage();

      const productRefundItem = (await screen.findByText('Product refund recorded')).closest('.meta-item');
      expect(productRefundItem).not.toBeNull();
      expect(productRefundItem).toHaveTextContent('TRY 2,399.50');
      expect(screen.queryByText('Refund impact', { exact: false })).not.toBeInTheDocument();
    });

    it('does not infer webhook receipt from canonical full refund completion', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce(
        buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-no-webhook', 'RESOLVED'), true),
      );

      renderPage();

      expect(await screen.findByText('Latest order refund webhook')).toBeInTheDocument();
      expect(screen.getByText('Not observed')).toBeInTheDocument();
      expect(screen.queryByText('Webhook received', { exact: false })).not.toBeInTheDocument();
    });

    it('shows a stored failed refunds/create webhook state without converting it to success', async () => {
      const breakdown = buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-failed-webhook', 'RESOLVED'), true);
      breakdown.refundWebhookStatus = 'FAILED';
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce(breakdown);

      renderPage();

      const webhookItem = (await screen.findByText('Latest order refund webhook')).closest('.meta-item');
      expect(webhookItem).not.toBeNull();
      expect(within(webhookItem as HTMLElement).getByText('Failed')).toBeInTheDocument();
      expect(screen.queryByText('Webhook received', { exact: false })).not.toBeInTheDocument();
    });

    it('keeps a resolved attempt and passed fulfillment post-check separate from a partial customer refund', async () => {
      previewAdminShopifyRefundMock.mockResolvedValueOnce({
        ok: true,
        writesPerformed: false,
        allocationId: 'alloc-child',
        shopifyOrderId: '7817723773266',
        refundLineItemsPreview: [],
        suggestedRefund: {
          totalRefundAmount: '100.00',
          productRefundAmount: null,
          currencyCode: 'TRY',
          totalTaxAmount: '0.00',
          shippingAmount: '100.00',
          shippingMaximumRefundableAmount: '100.00',
          suggestedTransactions: [{
            gateway: 'bogus',
            amount: '100.00',
            currencyCode: 'TRY',
            parentTransactionId: 'gid://shopify/OrderTransaction/1',
          }],
        },
        refundMode: 'SHIPPING_ONLY',
        shippingEligibility: {
          status: 'ELIGIBLE',
          reasonCode: 'all_allocations_vendor_blocked_pre_shipment',
        },
        fulfillmentOrderCancellation: {
          affectedFulfillmentOrders: [],
          overallClassification: 'no_cancellation_needed',
          blockers: [],
          warnings: [],
        },
        warnings: [],
        blockers: [],
        missingData: [],
        mixedFulfillmentOrderDirectRefundProbe: {
          eligible: false,
          code: 'not_eligible',
          message: 'Not required.',
          affectedFulfillmentOrderId: null,
          selectedLineItems: [],
          sourceLineItems: [],
          blockers: [],
          warnings: [],
        },
      });
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773266',
        sourceShopifyOrderNumber: '#1113',
        customer: 'Customer',
        financialStatus: 'partially_refunded',
        customerRefundCompletion: {
          status: 'VERIFIED_PARTIAL_CUSTOMER_REFUND',
          reasonCode: 'canonical_partial_customer_refund_verified',
          displayFinancialStatus: 'PARTIALLY_REFUNDED',
          currency: 'TRY',
          totalReceivedAmount: '2499.50',
          totalRefundedAmount: '2399.50',
          netPaymentAmount: '100.00',
          totalOutstandingAmount: '0.00',
          totalRefundedShippingAmount: '0.00',
        },
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [buildAllocation({
          refundTotal: '2399.50',
          refundedItems: [{
            id: 'refund-line-partial',
            originalVendorId: 'yalispor',
            assignedVendorId: 'yalispor',
            vendorId: 'yalispor',
            sku: 'SKU-1113',
            variantTitle: 'Refund',
            name: 'Product',
            quantity: 1,
            condition: 'New',
            refundAmount: '2399.50',
          }],
          cancelRefundReview: {
            status: 'RESOLVED',
            reason: 'OUT_OF_STOCK',
            note: 'Reviewed',
            requestedAt: '2026-06-21T11:00:00.000Z',
            requestedByUserId: 'admin-1',
          },
          outboundRefundAttemptSummary: {
            id: 'attempt-partial',
            status: 'RESOLVED',
            restockType: 'CANCEL',
            refundShipping: false,
            notifyCustomer: false,
            shopifyRefundId: 'gid://shopify/Refund/partial',
            previewedAt: '2026-06-21T12:00:00.000Z',
            requestedAt: '2026-06-21T12:05:00.000Z',
            submittedAt: '2026-06-21T12:06:00.000Z',
            resolvedAt: '2026-06-21T12:07:00.000Z',
            failedAt: null,
            failureReason: null,
            postRefundFulfillmentCheckStatus: 'passed',
            postRefundFulfillmentCheckMessage: 'Selected lines no longer fulfillable.',
          },
        })],
      });

      renderPage();

      const statusAxes = await findLatestStatusAxes();
      expect(within(statusAxes).getByText('Partially refunded')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Fulfillment not required')).toBeInTheDocument();
      expect(within(statusAxes).queryByText('Refund completed')).not.toBeInTheDocument();
      expect(screen.getByText('Customer refund review required')).toBeInTheDocument();
      expect(screen.getByText('Refund attempt resolved')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preview Shopify refund' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Preview Shopify refund' }));
      const refundPreview = await screen.findByLabelText('Shopify suggested refund preview');
      expect(within(refundPreview).getByText('Product refund')).toBeInTheDocument();
      expect(within(refundPreview).getByText('Customer checkout shipping refund')).toBeInTheDocument();
      expect(within(refundPreview).getByText('Shopify-suggested total refund')).toBeInTheDocument();
      expect(within(refundPreview).getAllByText('100.00 TRY')).toHaveLength(2);
      expect(within(refundPreview).getByText('Not included')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refund in Shopify' })).toBeInTheDocument();
      expect(previewAdminShopifyRefundMock).toHaveBeenCalledWith(
        '7817723773265',
        'alloc-child',
        { restockType: 'CANCEL', refundShipping: false },
      );
      expect(screen.queryByText('No action required')).not.toBeInTheDocument();
    });

    it('does not infer full completion from positive local refund totals or refunded items alone', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773267',
        sourceShopifyOrderNumber: '#1114',
        customer: 'Customer',
        financialStatus: 'partially_refunded',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [buildAllocation({
          refundTotal: '150.00',
          refundedItems: [{
            id: 'local-refund-only',
            originalVendorId: 'yalispor',
            assignedVendorId: 'yalispor',
            vendorId: 'yalispor',
            sku: 'SKU-1114',
            variantTitle: 'Refund',
            name: 'Product',
            quantity: 1,
            condition: 'New',
            refundAmount: '150.00',
          }],
        })],
      });

      renderPage();

      const statusAxes = await findLatestStatusAxes();
      expect(within(statusAxes).getByText('Refund review required')).toBeInTheDocument();
      expect(within(statusAxes).queryByText('Refund completed')).not.toBeInTheDocument();
      expect(within(statusAxes).queryByText('Fulfillment not required')).not.toBeInTheDocument();
    });

    describe('refund projection terminal convergence', () => {
      function arrangeRefundExecution() {
        previewAdminShopifyRefundMock.mockResolvedValueOnce(buildExecutableRefundPreview());
        executeAdminShopifyRefundMock.mockResolvedValueOnce({
          ok: true,
          writesPerformed: true,
          status: 'SHOPIFY_ACTION_PENDING',
          shopifyRefundId: null,
          attemptId: 'attempt-a',
          message: 'Shopify refund submitted. Waiting for refunds/create webhook.',
        });
      }

      async function submitRefund(dialog: HTMLElement) {
        await act(async () => {
          fireEvent.click(within(dialog).getByRole('button', { name: 'Refund in Shopify' }));
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
      }

      it('submits an unchecked optional customer notification as false', async () => {
        arrangeRefundExecution();
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValueOnce(buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'RESOLVED'), true));

        renderPage();
        const dialog = await openRefundExecutionDialog();
        const notifyCustomerCheckbox = within(dialog).getByLabelText('Notify customer through Shopify (optional)');

        expect(notifyCustomerCheckbox).not.toBeChecked();
        expect(within(dialog).getByText(
          'When unchecked, the refund is still processed but Shopify will not send the customer a notification.',
        )).toBeInTheDocument();

        await submitRefund(dialog);

        expect(executeAdminShopifyRefundMock).toHaveBeenCalledWith(
          '7817723773265',
          'alloc-child',
          expect.objectContaining({
            notifyCustomer: false,
            confirmRefund: true,
          }),
        );
      });

      it('submits a checked optional customer notification as true', async () => {
        arrangeRefundExecution();
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValueOnce(buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'RESOLVED'), true));

        renderPage();
        const dialog = await openRefundExecutionDialog();
        const notifyCustomerCheckbox = within(dialog).getByLabelText('Notify customer through Shopify (optional)');
        fireEvent.click(notifyCustomerCheckbox);

        expect(notifyCustomerCheckbox).toBeChecked();
        await submitRefund(dialog);

        expect(executeAdminShopifyRefundMock).toHaveBeenCalledWith(
          '7817723773265',
          'alloc-child',
          expect.objectContaining({
            notifyCustomer: true,
            confirmRefund: true,
          }),
        );
      });

      it('refetches a pending matching attempt until its authoritative projection resolves', async () => {
        arrangeRefundExecution();
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValueOnce(buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'SHOPIFY_ACTION_PENDING')))
          .mockResolvedValueOnce(buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'RESOLVED'), true));

        renderPage();
        const dialog = await openRefundExecutionDialog();
        vi.useFakeTimers();
        await submitRefund(dialog);

        expect(executeAdminShopifyRefundMock).toHaveBeenCalledTimes(1);
        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });

        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(3);
        expect(screen.getAllByText('Refund completed').length).toBeGreaterThan(0);
        expect(screen.getByText('Refund attempt resolved')).toBeInTheDocument();
        expect(within(screen.getByLabelText('Cancel refund review summary')).getByText('250.00')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Allocated refunded items' })).toBeInTheDocument();
        expect(screen.queryByText('Refund pending')).not.toBeInTheDocument();
        expect(screen.queryByText('Not resolved')).not.toBeInTheDocument();
        expect(screen.getByText('Shopify refund completed and the admin order view is up to date.')).toBeInTheDocument();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(7_500);
        });
        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(3);
      });

      it('does not schedule delayed refetches when the matching attempt is immediately resolved', async () => {
        arrangeRefundExecution();
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValueOnce(buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'RESOLVED'), true));

        renderPage();
        const dialog = await openRefundExecutionDialog();
        await submitRefund(dialog);

        expect(await screen.findByText('Shopify refund completed and the admin order view is up to date.')).toBeInTheDocument();
        expect(screen.getAllByText('Refund completed').length).toBeGreaterThan(0);
        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);
        expect(executeAdminShopifyRefundMock).toHaveBeenCalledTimes(1);
      });

      it('stops on a matching failed attempt without retrying the refund mutation', async () => {
        arrangeRefundExecution();
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValueOnce(buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'FAILED', 'Webhook reconciliation failed.')));

        renderPage();
        const dialog = await openRefundExecutionDialog();
        await submitRefund(dialog);

        expect(await screen.findByText('Shopify refund processing failed: Webhook reconciliation failed.')).toBeInTheDocument();
        expect(within(screen.getByLabelText('Outbound Shopify refund attempt summary')).getByText('Webhook reconciliation failed.')).toBeInTheDocument();
        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);
        expect(executeAdminShopifyRefundMock).toHaveBeenCalledTimes(1);
      });

      it('stops after the bounded window when the matching attempt remains pending', async () => {
        arrangeRefundExecution();
        const pendingBreakdown = buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'SHOPIFY_ACTION_PENDING'));
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValue(pendingBreakdown);

        renderPage();
        const dialog = await openRefundExecutionDialog();
        vi.useFakeTimers();
        await submitRefund(dialog);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(7_500);
        });

        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(7);
        expect(executeAdminShopifyRefundMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Shopify refund is still processing. Refresh the order to check for completion.')).toBeInTheDocument();
        expect(screen.queryByText('Shopify refund completed and the admin order view is up to date.')).not.toBeInTheDocument();
      });

      it('cleans up delayed convergence when the page unmounts', async () => {
        arrangeRefundExecution();
        const pendingBreakdown = buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-a', 'SHOPIFY_ACTION_PENDING'));
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValue(pendingBreakdown);

        const view = renderPage();
        const dialog = await openRefundExecutionDialog();
        vi.useFakeTimers();
        await submitRefund(dialog);
        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);

        view.unmount();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(7_500);
        });

        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(2);
        expect(executeAdminShopifyRefundMock).toHaveBeenCalledTimes(1);
      });

      it('does not treat a different latest terminal attempt as completion of the submitted attempt', async () => {
        arrangeRefundExecution();
        const differentAttempt = buildRefundExecutionBreakdown(buildRefundAttemptSummary('attempt-b', 'RESOLVED'), true);
        getAdminShopifyOrderBreakdownMock
          .mockResolvedValueOnce(buildRefundExecutionBreakdown())
          .mockResolvedValue(differentAttempt);

        renderPage();
        const dialog = await openRefundExecutionDialog();
        vi.useFakeTimers();
        await submitRefund(dialog);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(7_500);
        });

        expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(7);
        expect(executeAdminShopifyRefundMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Shopify refund is still processing. Refresh the order to check for completion.')).toBeInTheDocument();
        expect(screen.queryByText('Shopify refund completed and the admin order view is up to date.')).not.toBeInTheDocument();
      });
    });
  });
