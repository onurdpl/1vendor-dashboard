import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setToken } from '../lib/auth';
import { AdminDiagnosticsPage } from './AdminDiagnosticsPage';

const diagnosticsMocks = vi.hoisted(() => ({
  webhooks: vi.fn(),
  webhookDetail: vi.fn(),
  inspectOrderState: vi.fn(),
  repairMissingShopifyOrder: vi.fn(),
  syncEvents: vi.fn(),
  reconciliation: vi.fn(),
  replay: vi.fn(),
  recover: vi.fn(),
  retryOperationalJob: vi.fn(),
  reconcileAllocation: vi.fn(),
  reconcileShopifyOrder: vi.fn(),
  canonicalReconciliationSummary: vi.fn(),
  observabilitySummary: vi.fn(),
  runtimeHealth: vi.fn(),
}));

afterEach(cleanup);

vi.mock('../config/runtime', () => ({
  runtimeConfig: {
    apiMode: 'real',
    apiBaseUrl: 'http://127.0.0.1:4000',
    apiBaseOrigin: 'http://127.0.0.1:4000',
    appEnvironment: 'test',
    appVersion: '0.1.0',
    buildTimestamp: '2026-05-17T10:00:00.000Z',
    gitCommit: 'abc1234',
    startupIssues: [],
  },
}));

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    diagnostics: diagnosticsMocks,
    observability: {
      summary: diagnosticsMocks.observabilitySummary,
    },
    runtime: {
      health: diagnosticsMocks.runtimeHealth,
    },
  },
}));

const blockedEvent = {
  id: 'webhook-blocked',
  topic: 'refunds/create',
  shopDomain: 'onevendor.myshopify.com',
  shopifyWebhookId: 'wh-blocked',
  eventId: 'event-blocked',
  idempotencyKey: 'idem-blocked',
  payloadHash: null,
  status: 'FAILED',
  processingStatus: 'failed',
  receivedAt: '2026-05-12T10:00:00Z',
  processedAt: '2026-05-12T10:01:00Z',
  errorMessage: 'Payload was not stored for this event.',
  lastErrorSummary: 'Payload missing',
  duplicate: false,
  payloadAvailable: false,
  replayEligible: false,
  replayBlockedReason: 'Payload unavailable',
  recoverEligible: false,
  recoverBlockedReason: 'Already processed',
  recommendedAction: 'Use manual Shopify reconciliation.',
  affectedEntities: {
    shopifyOrderId: 'gid://shopify/Order/1001',
    shopifyOrderNumber: '1001',
    shopifyReturnId: null,
    shopifyRefundId: 'gid://shopify/Refund/501',
    shopifyFulfillmentId: null,
    vendorId: 'demo-vendor-a',
  },
  relatedJobs: [
    {
      id: 'job-failed-refund',
      jobType: 'refund_sync',
      status: 'failed',
      payloadRef: 'sha256:refund',
      webhookEventId: 'webhook-blocked',
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      vendorAllocationId: null,
      refundRecordId: null,
      returnRecordId: null,
      priority: 0,
      retryCount: 1,
      maxRetries: 3,
      scheduledAt: '2026-05-12T10:00:00Z',
      nextRetryAt: '2026-05-12T10:05:00Z',
      lastAttemptAt: '2026-05-12T10:01:00Z',
      retryBackoffMs: 300000,
      startedAt: '2026-05-12T10:00:30Z',
      completedAt: null,
      failedAt: '2026-05-12T10:01:00Z',
      errorSummary: 'Payload missing',
      failureCategory: 'validation',
      escalationReason: 'Validation failure is not automatically retryable.',
      createdAt: '2026-05-12T10:00:00Z',
      updatedAt: '2026-05-12T10:01:00Z',
    },
  ],
  createdAt: '2026-05-12T10:00:00Z',
  updatedAt: '2026-05-12T10:01:00Z',
};

const replayableEvent = {
  ...blockedEvent,
  id: 'webhook-replayable',
  shopifyWebhookId: 'wh-replayable',
  eventId: 'event-replayable',
  payloadHash: 'sha256:abc123',
  status: 'FAILED',
  processingStatus: 'failed',
  payloadAvailable: true,
  replayEligible: true,
  replayBlockedReason: null,
  recoverEligible: true,
  recoverBlockedReason: null,
  recommendedAction: 'Recover this failed event after confirming the root cause is resolved.',
  lastErrorSummary: null,
};

const blockedDetail = {
  ...blockedEvent,
  payloadPreview: null,
  payloadPreviewTruncated: false,
  relatedShopifyOrderId: 'gid://shopify/Order/1001',
};

const replayableDetail = {
  ...replayableEvent,
  payloadPreview: '{"id":501}',
  payloadPreviewTruncated: false,
  relatedShopifyOrderId: 'gid://shopify/Order/1001',
};

const processedEvent = {
  ...replayableEvent,
  id: 'webhook-processed',
  shopifyWebhookId: 'wh-processed',
  eventId: 'event-processed',
  status: 'PROCESSED',
  processingStatus: 'processed',
  processedAt: '2026-05-12T10:02:00Z',
  replayEligible: false,
  replayBlockedReason: 'Event already processed',
  recoverEligible: false,
  recoverBlockedReason: 'Event already processed',
  recommendedAction: 'No action required.',
  relatedJobs: [],
};

const processedDetail = {
  ...processedEvent,
  payloadPreview: '{"id":501}',
  payloadPreviewTruncated: false,
  relatedShopifyOrderId: 'gid://shopify/Order/1001',
};

function orderStateInspectorResult() {
  return {
    orderIdentity: {
      localOrderId: 'order-db-1108',
      shopifyOrderId: '7856124985681',
      orderNumber: '#1108',
      createdAt: '2026-07-11T16:07:00Z',
      updatedAt: '2026-07-11T18:07:00Z',
      shopifyCreatedAt: '2026-07-11T16:07:00Z',
      vendors: [{ vendorId: 'yalispor', vendorName: 'Yali Spor' }],
    },
    shopifyState: {
      source: 'persisted_local_truth',
      financialStatus: 'voided',
      cancelledAt: '2026-07-11T18:07:00Z',
      cancelReason: 'customer',
      currency: 'TRY',
      lineItemCount: 1,
      mappedLineItemCount: 1,
      unmappedLineItemCount: 0,
      vendorMapping: [{ vendorId: 'yalispor', lineItemCount: 1 }],
    },
    localOrderState: {
      exists: true,
      allocationCount: 1,
      isCancelled: true,
      hasOperationalConflict: true,
    },
    allocations: [{
      allocationId: 'allocation-1108',
      originalVendor: { vendorId: 'yalispor', vendorName: 'Yali Spor' },
      assignedVendor: { vendorId: 'yalispor', vendorName: 'Yali Spor' },
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      cancellationReason: 'VENDOR_CANCELLED',
      trackingPresent: false,
      carrierPresent: false,
      createdAt: '2026-07-11T16:07:00Z',
      updatedAt: '2026-07-11T18:07:00Z',
    }],
    shippingState: [{
      allocationId: 'allocation-1108',
      shipmentRecordCount: 0,
      labelExists: false,
      trackingPresent: false,
      carrier: null,
      providerStatuses: [],
      eligibility: {
        eligibleFromPersistedOrderState: false,
        blockedReason: 'full_order_cancelled',
        scope: 'persisted_order_state_only',
      },
    }],
    returnRefundState: {
      returnRequests: [{
        id: 'return-1',
        allocationId: 'allocation-1108',
        vendorId: 'yalispor',
        sourceType: 'shopify_return_request',
        sourceShopifyReturnId: 'shopify-return-1',
        status: 'Requested',
        requestedAt: '2026-07-11T19:00:00Z',
        createdAt: '2026-07-11T19:00:00Z',
        updatedAt: '2026-07-11T19:00:00Z',
      }],
      refundDerivedReturns: [{
        id: 'return-refund-1',
        allocationId: 'allocation-1108',
        vendorId: 'yalispor',
        sourceType: 'shopify_refund_derived',
        sourceShopifyRefundId: 'refund-1',
        status: 'Refunded',
        requestedAt: null,
        createdAt: '2026-07-11T19:10:00Z',
        updatedAt: '2026-07-11T19:10:00Z',
      }],
      refundRecords: [{
        id: 'refund-record-1',
        allocationId: 'allocation-1108',
        sourceShopifyRefundId: 'refund-1',
        status: 'Processed',
        createdAt: '2026-07-11T19:10:00Z',
        updatedAt: '2026-07-11T19:10:00Z',
      }],
    },
    financeState: {
      ledgerCount: 1,
      saleLedgerCount: 1,
      financeReviewRequired: true,
      ledgers: [{
        id: 'ledger-1',
        allocationId: 'allocation-1108',
        vendorId: 'yalispor',
        entryType: 'sale',
        payoutStatus: 'HOLD',
        settlementStatus: 'HELD',
        voidedAt: '2026-07-11T18:07:00Z',
        voidReason: 'shopify_order_cancelled',
        approvedSettlementPresent: false,
        payoutBatchPresent: false,
        paidEvidencePresent: false,
        createdAt: '2026-07-11T16:07:00Z',
        updatedAt: '2026-07-11T18:07:00Z',
      }],
      events: [],
    },
    operationalSignals: [{
      id: 'signal-1',
      allocationId: 'allocation-1108',
      financeLedgerEntryId: null,
      type: 'canonical_cancellation_conflict',
      severity: 'HIGH',
      status: 'ACTIVE',
      sourceArea: 'RECONCILIATION',
      title: 'Cancellation conflict',
      description: 'Existing refund evidence requires review.',
      suggestedAction: 'Review evidence.',
      triggeredAt: '2026-07-11T18:07:00Z',
      resolvedAt: null,
      metadata: { conflictType: 'refund_evidence' },
    }],
    webhookHistory: [{
      webhookEventId: 'webhook-1',
      topic: 'orders/cancelled',
      status: 'PROCESSED',
      receivedAt: '2026-07-11T18:07:00Z',
      processedAt: '2026-07-11T18:07:01Z',
      errorMessage: null,
      shopifyOrderId: '7856124985681',
      shopifyOrderNumber: '#1108',
      webhookId: 'shopify-webhook-1',
      payloadAvailable: true,
    }],
    projectionExplanation: {
      orderStatus: {
        label: 'Cancelled',
        reasons: [
          'ShopifyOrder.cancelledAt is the canonical full-order cancellation source.',
          'Raw allocation, fulfillment, and shipping values are preserved as ownership and history; they do not grant operational eligibility.',
        ],
      },
      fulfillment: { label: 'Pending', reasons: ['1 refund evidence record is persisted.'] },
      shipment: { label: 'Awaiting Shipment', reasons: ['1 refund evidence record is persisted.'] },
      tracking: { label: 'Tracking pending', reasons: ['1 refund evidence record is persisted.'] },
      finance: { label: 'Review required', reasons: ['Cancellation conflict is active.'] },
      cancellationConflict: { active: true, reasons: ['refund:1'] },
      operationalEvidence: [{ type: 'refund', source: 'RefundRecord', recordCount: 1 }],
      queueState: { included: false, reasons: ['Full-cancelled orders are excluded from active operational queues.'] },
      actions: [{ action: 'create_shipment', available: false, blockedReason: 'full_order_cancelled' }],
    },
    currentStateSummary: 'This order is cancelled, but existing operational evidence requires review.',
    repairReadiness: {
      repairNeeded: false,
      repairSupported: false,
      repairClassification: 'cancellation_conflict_review_required',
      blockers: ['Refund evidence is persisted.'],
      recommendedNextStep: 'Review the preserved operational evidence.',
    },
    repairHistory: [],
    limits: { webhookHistory: 50, operationalSignals: 50, financeEvents: 100, repairHistory: 20 },
  };
}

function currentStateRepairResult(orderIdentifier: string, execute: boolean) {
  return {
    ok: true,
    orderIdentifier,
    shopifyOrderId: '7856043819345',
    shopifyOrderNumber: '#1105',
    repairSource: 'shopify_admin_current_state',
    repairTimestamp: '2026-07-13T10:00:00.000Z',
    dryRun: !execute,
    executed: execute,
    summary: {
      shopifyOrder: 'Created',
      allocation: 'Created',
      finance: 'Created',
      cancellationApplied: true,
      refundApplied: true,
      returnApplied: false,
      warnings: [],
      skipped: false,
    },
  } as const;
}

function renderDiagnosticsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminDiagnosticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminDiagnosticsPage control center', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    diagnosticsMocks.webhooks.mockReset();
    diagnosticsMocks.webhookDetail.mockReset();
    diagnosticsMocks.inspectOrderState.mockReset();
    diagnosticsMocks.repairMissingShopifyOrder.mockReset();
    diagnosticsMocks.syncEvents.mockReset();
    diagnosticsMocks.reconciliation.mockReset();
    diagnosticsMocks.replay.mockReset();
    diagnosticsMocks.recover.mockReset();
    diagnosticsMocks.retryOperationalJob.mockReset();
    diagnosticsMocks.reconcileAllocation.mockReset();
    diagnosticsMocks.reconcileShopifyOrder.mockReset();
    diagnosticsMocks.canonicalReconciliationSummary.mockReset();
    diagnosticsMocks.observabilitySummary.mockReset();
    diagnosticsMocks.runtimeHealth.mockReset();

    diagnosticsMocks.inspectOrderState.mockResolvedValue(orderStateInspectorResult());
    diagnosticsMocks.repairMissingShopifyOrder.mockImplementation(async (orderIdentifier: string, execute: boolean) =>
      currentStateRepairResult(orderIdentifier, execute)
    );

    diagnosticsMocks.webhooks.mockResolvedValue({
      summary: {
        total: 2,
        received: 1,
        processed: 0,
        failed: 1,
        duplicates: 0,
        needsAttention: 2,
      },
      events: [blockedEvent, replayableEvent],
    });
    diagnosticsMocks.webhookDetail.mockImplementation(async (id: string) =>
      id === 'webhook-replayable' ? replayableDetail : blockedDetail,
    );
    diagnosticsMocks.syncEvents.mockResolvedValue({
      items: [
        {
          id: 'sync-1',
          type: 'fulfillment_sync_failed',
          severity: 'warning',
          title: 'Fulfillment sync failed',
          description: 'Tracking sync should be inspected.',
          createdAt: '2026-05-12T10:02:00Z',
        },
      ],
    });
    diagnosticsMocks.reconciliation.mockResolvedValue({
      summary: {
        stuckReceived: 1,
        failedWebhooks: 1,
        fulfillmentSyncFailures: 1,
        missingPayload: 1,
        staleAllocations: 1,
        scheduledReconciliationJobs: 0,
        total: 2,
      },
      items: [
        {
          id: 'reconcile-1',
          type: 'stale_allocation',
          title: 'Stale allocation detected',
          description: 'Local allocation differs from Shopify canonical state.',
          relatedWebhookEventId: null,
          relatedShopifyOrderId: 'gid://shopify/Order/1001',
          relatedAllocationId: 'alloc-1',
          severity: 'attention',
          status: 'open',
          createdAt: '2026-05-12T10:05:00Z',
          suggestedAction: 'Reconcile allocation against Shopify.',
          payloadAvailable: null,
        },
      ],
    });
    diagnosticsMocks.replay.mockResolvedValue({
      ok: true,
      topic: 'refunds/create',
      action: 'replay',
      processingStatus: 'processed',
      message: 'Replay accepted',
    });
    diagnosticsMocks.retryOperationalJob.mockResolvedValue({
      ok: true,
      operationalJobId: 'job-failed-refund',
      webhookEventId: 'webhook-blocked',
      jobStatus: 'retry_scheduled',
      retryStatus: 'failed',
      processingStatus: 'needs_attention',
      message: 'Retry scheduled after transient failure.',
    });
    diagnosticsMocks.canonicalReconciliationSummary.mockResolvedValue({
      lastRun: {
        id: 'canonical-run-1',
        mode: 'dry-run',
        status: 'COMPLETED',
        startedAt: '2026-05-12T03:00:00Z',
        finishedAt: '2026-05-12T03:00:08Z',
        durationMs: 8000,
        lookbackDays: 3,
        orderLimit: 500,
        ordersScanned: 42,
        repairOpportunities: 3,
        wouldRepairOrders: 1,
        wouldRepairFulfillment: 0,
        wouldRepairRefunds: 1,
        wouldRepairReturns: 1,
        wouldRepairCancellations: 0,
        wouldCreateSignals: 1,
        wouldRepairLedgers: 1,
        wouldRepairFinanceEvents: 1,
        errors: [],
        perOrderDetails: [],
      },
    });
    diagnosticsMocks.observabilitySummary.mockResolvedValue({
      health: 'warning',
      generatedAt: '2026-05-12T10:05:00Z',
      windows: [],
      retryPressure: {
        retryScheduled: 2,
        retrying: 0,
        deadLetterReady: 1,
        permanentlyFailed: 0,
        pressureScore: 5,
      },
      reconciliation: {
        pending: 1,
        processing: 0,
        completed24h: 2,
        failed24h: 0,
        scheduled: 1,
        staleStateCount: 3,
      },
      webhookHealth: {
        received: 1,
        processing: 0,
        processed24h: 10,
        failed24h: 1,
        successRate24h: 0.91,
      },
      staleStates: {
        stuckReceived: 1,
        fulfillmentSyncFailures: 1,
        missingPayload: 1,
        staleAllocations: 1,
        scheduledReconciliationJobs: 1,
        total: 4,
      },
      notes: ['1 operational job is dead-letter ready.'],
    });
    diagnosticsMocks.runtimeHealth.mockResolvedValue({
      ok: true,
      status: 'ok',
      service: 'vendor-dashboard-backend',
      version: '0.1.0',
      gitCommit: 'def5678',
      environment: 'production',
      timestamp: '2026-05-12T10:06:00Z',
      dbReachable: true,
      migrationsReachable: true,
    });
  });

  it('surfaces blocked replay and recover reasons in the event detail panel', async () => {
    renderDiagnosticsPage();

    expect(await screen.findByRole('heading', { name: /production recovery center/i })).toBeInTheDocument();
    expect((await screen.findAllByText(/Stored replay blocked: Payload unavailable/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Failed webhook recovery blocked: Already processed/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Refund Sync')).toBeInTheDocument();
    expect(screen.getByText(/Attempts 1\/3/i)).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
    expect(screen.getByText('Stale allocation detected')).toBeInTheDocument();
    expect(screen.getByText('Operational health')).toBeInTheDocument();
    expect(screen.getAllByText('warning').length).toBeGreaterThan(0);
    expect(screen.getByText('Retry pressure')).toBeInTheDocument();
    expect(screen.getAllByText('Canonical reconciliation').length).toBeGreaterThan(0);
    expect(screen.getByText('Showing 2 webhook events')).toBeInTheDocument();
    expect(screen.getByText('No active filters')).toBeInTheDocument();
    expect(screen.queryByText('All webhook topics')).not.toBeInTheDocument();
    expect(screen.getByText('Dry-run reports are persisted for audit only. They do not mutate orders, refunds, returns, ledgers, payouts, settlements, or operational signals.')).toBeInTheDocument();
  });

  it('separates webhook result count from non-default active filters', async () => {
    renderDiagnosticsPage();

    expect(await screen.findByText('Showing 2 webhook events')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByDisplayValue('All payloads'), 'available');

    expect(screen.getByText('Showing 1 webhook event')).toBeInTheDocument();
    expect(screen.getByText('Active filters')).toBeInTheDocument();
    expect(screen.getByText('Stored payload: Stored')).toBeInTheDocument();
    expect(screen.queryByText('All payload states')).not.toBeInTheDocument();
    expect(diagnosticsMocks.replay).not.toHaveBeenCalled();
    expect(diagnosticsMocks.recover).not.toHaveBeenCalled();
  });

  it('renders safe deployment runtime diagnostics without exposing secrets', async () => {
    renderDiagnosticsPage();

    expect(await screen.findByText('Deployment/runtime verification')).toBeInTheDocument();
    expect(screen.getAllByText('Reachable').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('link', { name: 'Orders' })[0]).toHaveAttribute('href', '/orders');

    const technicalLabel = screen.getAllByText('Advanced technical details').at(-1) as HTMLElement;
    const technicalDisclosure = technicalLabel.closest('details') as HTMLDetailsElement;
    expect(technicalDisclosure.open).toBe(false);
    await userEvent.click(technicalLabel);

    expect(technicalDisclosure.open).toBe(true);
    expect(screen.getAllByText('http://127.0.0.1:4000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('def5678').length).toBeGreaterThan(0);
    const deploymentSectionText = screen.getByText('Technical deployment details').closest('section')?.textContent ?? '';
    expect(deploymentSectionText).not.toContain('Bearer');
    expect(deploymentSectionText).not.toContain('token');
  });

  it('shows operational retry action feedback for retryable jobs', async () => {
    renderDiagnosticsPage();

    expect((await screen.findAllByText('Refund Sync')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);

    expect(await screen.findByText('Retry scheduled after transient failure.')).toBeInTheDocument();
    expect(diagnosticsMocks.retryOperationalJob).toHaveBeenCalledWith('job-failed-refund');
  });

  it('renders webhook detail when older diagnostics responses omit related job records', async () => {
    diagnosticsMocks.webhooks.mockResolvedValueOnce({
      summary: {
        total: 1,
        received: 0,
        processed: 0,
        failed: 1,
        duplicates: 0,
        needsAttention: 1,
      },
      events: [{ ...blockedEvent, relatedJobs: undefined }],
    });
    diagnosticsMocks.webhookDetail.mockResolvedValueOnce({ ...blockedDetail, relatedJobs: undefined });

    renderDiagnosticsPage();

    expect((await screen.findAllByText('Payload unavailable')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Use manual Shopify reconciliation.').length).toBeGreaterThan(0);
  });

  it('confirms stored refund replay and explains canonical monetary verification', async () => {
    renderDiagnosticsPage();

    const replayButtons = await screen.findAllByRole('button', { name: 'Replay Stored Webhook' });
    const enabledReplayButton = replayButtons.find((button) => !(button as HTMLButtonElement).disabled);
    expect(enabledReplayButton).toBeDefined();
    await userEvent.click(enabledReplayButton as HTMLButtonElement);

    expect(diagnosticsMocks.replay).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Replay Stored Webhook?' });
    expect(dialog).toHaveTextContent('Historical payload will be replayed.');
    expect(dialog).toHaveTextContent('Current Shopify monetary evidence will be verified before any refund finance mutation.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replay Stored Webhook' }));

    expect(await screen.findByText('Replay accepted')).toBeInTheDocument();
    expect(diagnosticsMocks.replay).toHaveBeenCalledWith('webhook-replayable');
  });

  it('confirms failed webhook recovery and explains stored-payload processing', async () => {
    diagnosticsMocks.recover.mockResolvedValueOnce({
      ok: true,
      topic: 'refunds/create',
      action: 'recover',
      processingStatus: 'processed',
      recoveryStatus: 'recovered',
      message: 'Recovery accepted',
    });
    renderDiagnosticsPage();

    const recoverButtons = await screen.findAllByRole('button', { name: 'Recover Failed Webhook' });
    const enabledRecoverButton = recoverButtons.find((button) => !(button as HTMLButtonElement).disabled);
    expect(enabledRecoverButton).toBeDefined();
    await userEvent.click(enabledRecoverButton as HTMLButtonElement);

    expect(diagnosticsMocks.recover).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Recover Failed Webhook?' });
    expect(dialog).toHaveTextContent('Stored webhook processing will resume.');
    expect(dialog).toHaveTextContent('The stored payload will be reprocessed only after current Shopify monetary evidence is verified.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Recover Failed Webhook' }));

    expect(await screen.findByText('Recovery accepted')).toBeInTheDocument();
    expect(diagnosticsMocks.recover).toHaveBeenCalledWith('webhook-replayable');
  });

  it('keeps safe payload preview collapsed until explicitly opened', async () => {
    diagnosticsMocks.webhooks.mockResolvedValueOnce({
      summary: {
        total: 1,
        received: 1,
        processed: 0,
        failed: 0,
        duplicates: 0,
        needsAttention: 1,
      },
      events: [replayableEvent],
    });
    diagnosticsMocks.webhookDetail.mockResolvedValueOnce(replayableDetail);

    renderDiagnosticsPage();

    await screen.findByText('Current conclusion');
    expect(screen.queryByLabelText('Payload preview')).not.toBeInTheDocument();

    const payloadLabel = screen.getByText('Stored payload details');
    const payloadDisclosure = payloadLabel.closest('details') as HTMLDetailsElement;
    expect(payloadDisclosure.open).toBe(false);
    await userEvent.click(payloadLabel);
    expect(payloadDisclosure.open).toBe(true);
    expect(await screen.findByRole('button', { name: 'Show payload preview' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show payload preview' }));

    expect(await screen.findByLabelText('Payload preview')).toHaveTextContent('"id":501');

    await userEvent.click(screen.getByRole('button', { name: 'Hide payload preview' }));

    expect(screen.queryByLabelText('Payload preview')).not.toBeInTheDocument();
  });

  it('keeps technical identifiers collapsed but accessible on demand', async () => {
    renderDiagnosticsPage();

    const detailPanel = (await screen.findByText('Webhook detail')).closest('aside');
    expect(detailPanel).not.toBeNull();

    const disclosureLabel = within(detailPanel as HTMLElement).getByText('Technical webhook identifiers');
    const disclosure = disclosureLabel.closest('details') as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);

    await userEvent.click(disclosureLabel);

    expect(disclosure.open).toBe(true);
    expect(within(detailPanel as HTMLElement).getByText('webhook-blocked')).toBeInTheDocument();
    expect(within(detailPanel as HTMLElement).getByText('idem-blocked')).toBeInTheDocument();
  });

  it('renders a processed event as informational with no primary recovery action', async () => {
    diagnosticsMocks.webhooks.mockResolvedValueOnce({
      summary: { total: 1, received: 0, processed: 1, failed: 0, duplicates: 0, needsAttention: 0 },
      events: [processedEvent],
    });
    diagnosticsMocks.webhookDetail.mockResolvedValueOnce(processedDetail);

    renderDiagnosticsPage();

    expect(await screen.findByText('No action required.')).toBeInTheDocument();
    expect(screen.getAllByText('No recovery action needed').length).toBeGreaterThan(0);
    const detailPanel = screen.getByText('Webhook detail').closest('aside') as HTMLElement;
    const recoverButton = within(detailPanel).getByRole('button', { name: 'Recover Failed Webhook' });
    const replayButton = within(detailPanel).getByRole('button', { name: 'Replay Stored Webhook' });
    expect(recoverButton).toBeDisabled();
    expect(replayButton).toBeDisabled();
    expect(recoverButton).toHaveClass('button-secondary');
    expect(recoverButton).not.toHaveClass('button-primary');
  });

  it('presents unknown runtime state neutrally instead of as healthy', async () => {
    diagnosticsMocks.runtimeHealth.mockResolvedValueOnce({
      ok: false,
      status: 'unknown',
      service: 'vendor-dashboard-backend',
      version: null,
      gitCommit: null,
      environment: null,
      timestamp: '2026-05-12T10:06:00Z',
      dbReachable: false,
      migrationsReachable: false,
    });

    renderDiagnosticsPage();

    const runtimeSection = (await screen.findByText('Deployment/runtime verification')).closest('section') as HTMLElement;
    expect(within(runtimeSection).getByText('unknown').tagName).toBe('STRONG');
    expect(within(runtimeSection).getByText('Not confirmed').tagName).toBe('STRONG');
    expect(within(runtimeSection).getByText('unknown').closest('.op-kpi')).not.toHaveClass('op-tone-success');
    expect(within(runtimeSection).getByText('Not confirmed').closest('.op-kpi')).not.toHaveClass('op-tone-success');
  });

  it('uses a compact neutral empty state when canonical history is not recorded', async () => {
    diagnosticsMocks.canonicalReconciliationSummary.mockResolvedValueOnce({ lastRun: null });

    renderDiagnosticsPage();

    const title = await screen.findByText('No canonical reconciliation run yet');
    expect(title.closest('.diagnostics-empty-state')).not.toBeNull();
    expect(screen.getAllByText('No run yet').length).toBeGreaterThan(0);
  });

  it('inspects an explicit order and renders source-specific operational evidence', async () => {
    renderDiagnosticsPage();
    expect(await screen.findByRole('heading', { name: 'Order State Inspector' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Order number'), '  #1108  ');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    expect(diagnosticsMocks.inspectOrderState).toHaveBeenCalledWith('#1108', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await screen.findByText('This order is cancelled, but existing operational evidence requires review.')).toBeInTheDocument();
    expect(screen.getByText('Current state')).toBeInTheDocument();
    expect(screen.getByText('Finance and payment safety')).toBeInTheDocument();
    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0);
    expect(screen.getByText('Review the preserved operational evidence.')).toBeInTheDocument();
    expect(screen.getByText('Finance review required')).toBeInTheDocument();
    expect(screen.getByText('Existing evidence')).toBeInTheDocument();
    expect(screen.getByText('Shopify return requests')).toBeInTheDocument();
    expect(screen.getByText('Refund-derived return evidence')).toBeInTheDocument();
    expect(screen.getByText('Shopify refund records')).toBeInTheDocument();
    expect(screen.getByText('Paid evidence')).toBeInTheDocument();
    expect(screen.getAllByText('No').length).toBeGreaterThan(0);
    expect(screen.getByText('Projection explanation')).toBeInTheDocument();
    expect(screen.getByText(/Full-order cancellation eligibility comes from ShopifyOrder.cancelledAt/)).toBeInTheDocument();
    expect(screen.getByText('ShopifyOrder.cancelledAt is the canonical full-order cancellation source.')).toBeInTheDocument();
    expect(screen.getByText('Repair readiness')).toBeInTheDocument();

    const inspector = screen.getByRole('heading', { name: 'Order State Inspector' }).closest('section');
    expect(inspector).not.toBeNull();
    expect(within(inspector as HTMLElement).queryByRole('button', { name: /repair/i })).not.toBeInTheDocument();
    expect(within(inspector as HTMLElement).queryByRole('button', { name: /replay/i })).not.toBeInTheDocument();
  });

  it('renders compact no-conflict and empty return/refund states from existing values', async () => {
    const noConflictOrder = orderStateInspectorResult();
    noConflictOrder.localOrderState.hasOperationalConflict = false;
    noConflictOrder.financeState.financeReviewRequired = false;
    noConflictOrder.returnRefundState.returnRequests = [];
    noConflictOrder.returnRefundState.refundDerivedReturns = [];
    noConflictOrder.returnRefundState.refundRecords = [];
    noConflictOrder.operationalSignals = [];
    noConflictOrder.webhookHistory = [];
    noConflictOrder.repairHistory = [];
    noConflictOrder.projectionExplanation.cancellationConflict = { active: false, reasons: [] };
    noConflictOrder.projectionExplanation.finance = { label: 'No review required', reasons: ['No conflict evidence is persisted.'] };
    noConflictOrder.currentStateSummary = 'This order is cancelled with no persisted conflict evidence.';
    noConflictOrder.repairReadiness = {
      repairNeeded: false,
      repairSupported: false,
      repairClassification: 'no_repair_needed',
      blockers: [],
      recommendedNextStep: 'No action required.',
    };
    diagnosticsMocks.inspectOrderState.mockResolvedValueOnce(noConflictOrder);

    renderDiagnosticsPage();
    await userEvent.type(await screen.findByLabelText('Order number'), '#1108');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    expect(await screen.findByText('This order is cancelled with no persisted conflict evidence.')).toBeInTheDocument();
    expect(screen.getByText('No conflict evidence')).toBeInTheDocument();
    expect(screen.getByText('No action required.')).toBeInTheDocument();
    expect(screen.getByText('No Shopify return request')).toBeInTheDocument();
    expect(screen.getByText('No refund-derived return evidence')).toBeInTheDocument();
    expect(screen.getByText('No Shopify refund record')).toBeInTheDocument();
    expect(screen.getByText('No signals')).toBeInTheDocument();
    expect(screen.getAllByText('No repair history').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No webhook history').length).toBeGreaterThan(0);
  });

  it('keeps Inspector technical identifiers accessible only through disclosures and preserves action blockers', async () => {
    renderDiagnosticsPage();
    await userEvent.type(await screen.findByLabelText('Order number'), '#1108');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    await screen.findByText('Current state');
    const orderDetailsLabel = screen.getByText('Order identity and timestamps');
    const orderDetails = orderDetailsLabel.closest('details') as HTMLDetailsElement;
    expect(orderDetails.open).toBe(false);
    await userEvent.click(orderDetailsLabel);
    expect(orderDetails.open).toBe(true);
    expect(screen.getByText('order-db-1108')).toBeInTheDocument();
    expect(screen.getAllByText('7856124985681').length).toBeGreaterThan(0);

    const ledgerDetailsLabel = screen.getByText('Ledger technical evidence');
    const ledgerDetails = ledgerDetailsLabel.closest('details') as HTMLDetailsElement;
    expect(ledgerDetails.open).toBe(false);
    await userEvent.click(ledgerDetailsLabel);
    expect(ledgerDetails.open).toBe(true);
    expect(screen.getByText('ledger-1')).toBeInTheDocument();

    const actionDetailsLabel = screen.getByText('Action eligibility details');
    const actionDetails = actionDetailsLabel.closest('details') as HTMLDetailsElement;
    expect(actionDetails.open).toBe(false);
    await userEvent.click(actionDetailsLabel);
    expect(actionDetails.open).toBe(true);
    expect(screen.getByText('Create Shipment')).toBeInTheDocument();
    expect(screen.getAllByText('full_order_cancelled').length).toBeGreaterThan(0);
    expect(diagnosticsMocks.repairMissingShopifyOrder).not.toHaveBeenCalled();
  });

  it('normalizes a plain Shopify order number before the repair dry run', async () => {
    diagnosticsMocks.inspectOrderState.mockReset().mockRejectedValueOnce(new Error('Order not found.'));

    renderDiagnosticsPage();
    await userEvent.type(await screen.findByLabelText('Order number'), '  1105  ');
    expect(screen.getByText('Enter Shopify order number, for example 1105 or #1105.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    expect(diagnosticsMocks.inspectOrderState).toHaveBeenCalledWith('1105', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Shopify Order' }));

    expect(diagnosticsMocks.repairMissingShopifyOrder).toHaveBeenCalledWith('#1105', false);
    expect(diagnosticsMocks.repairMissingShopifyOrder).not.toHaveBeenCalledWith(expect.any(String), true);
  });

  it('replaces a failed repair dry run with the later successful plan', async () => {
    diagnosticsMocks.inspectOrderState.mockReset().mockRejectedValue(new Error('Order not found.'));
    diagnosticsMocks.repairMissingShopifyOrder.mockRejectedValueOnce(new Error('Shopify order was not found.'));

    renderDiagnosticsPage();
    await userEvent.type(await screen.findByLabelText('Order number'), '1105');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Shopify Order' }));

    const staleError = await screen.findByText('Shopify order was not found.');
    expect(staleError).toHaveClass('action-error');
    expect(screen.queryByText('Order state unavailable')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Current-state repair dry-run plan')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Repair Missing Shopify Order' }));

    const plan = await screen.findByLabelText('Current-state repair dry-run plan');
    expect(screen.getByText('Dry run complete. Review the current-state plan before execution.')).toBeInTheDocument();
    expect(screen.queryByText('Shopify order was not found.')).not.toBeInTheDocument();
    expect(within(plan).getByText('#1105')).toBeInTheDocument();
    expect(within(plan).getByText('7856043819345')).toBeInTheDocument();
    expect(diagnosticsMocks.repairMissingShopifyOrder).not.toHaveBeenCalledWith(expect.any(String), true);
  });

  it('clears a successful plan and execute confirmation as soon as the identifier changes', async () => {
    diagnosticsMocks.inspectOrderState.mockReset().mockRejectedValue(new Error('Order not found.'));

    renderDiagnosticsPage();
    const orderNumberInput = await screen.findByLabelText('Order number');
    await userEvent.type(orderNumberInput, '1105');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Shopify Order' }));
    await screen.findByLabelText('Current-state repair dry-run plan');
    await userEvent.click(screen.getByRole('button', { name: 'Execute Repair' }));
    expect(screen.getByRole('dialog', { name: 'Execute Current-State Repair?' })).toBeInTheDocument();

    await userEvent.clear(orderNumberInput);
    await userEvent.type(orderNumberInput, '1106');

    expect(screen.queryByLabelText('Current-state repair dry-run plan')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Execute Current-State Repair?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute Repair' })).not.toBeInTheDocument();
    expect(diagnosticsMocks.repairMissingShopifyOrder).not.toHaveBeenCalledWith(expect.any(String), true);
  });

  it('does not restore a late dry-run result after the identifier changes', async () => {
    let resolveDryRun: ((result: ReturnType<typeof currentStateRepairResult>) => void) | null = null;
    diagnosticsMocks.inspectOrderState.mockReset().mockRejectedValue(new Error('Order not found.'));
    diagnosticsMocks.repairMissingShopifyOrder.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDryRun = resolve;
    }));

    renderDiagnosticsPage();
    const orderNumberInput = await screen.findByLabelText('Order number');
    await userEvent.type(orderNumberInput, '1105');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Shopify Order' }));
    expect(await screen.findByRole('button', { name: 'Running Dry Run...' })).toBeDisabled();

    await userEvent.clear(orderNumberInput);
    await userEvent.type(orderNumberInput, '1106');
    await act(async () => {
      resolveDryRun?.(currentStateRepairResult('#1105', false));
      await Promise.resolve();
    });

    expect(screen.queryByLabelText('Current-state repair dry-run plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Dry run complete. Review the current-state plan before execution.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute Repair' })).not.toBeInTheDocument();
    expect(diagnosticsMocks.repairMissingShopifyOrder).not.toHaveBeenCalledWith(expect.any(String), true);
  });

  it('clears a repair error when the operator changes identifiers', async () => {
    diagnosticsMocks.inspectOrderState.mockReset().mockRejectedValue(new Error('Order not found.'));
    diagnosticsMocks.repairMissingShopifyOrder.mockRejectedValueOnce(new Error('Shopify order was not found.'));

    renderDiagnosticsPage();
    const orderNumberInput = await screen.findByLabelText('Order number');
    await userEvent.type(orderNumberInput, '1105');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Shopify Order' }));
    expect(await screen.findByText('Shopify order was not found.')).toBeInTheDocument();

    await userEvent.clear(orderNumberInput);
    await userEvent.type(orderNumberInput, '1106');

    expect(screen.queryByText('Shopify order was not found.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Current-state repair dry-run plan')).not.toBeInTheDocument();
    expect(diagnosticsMocks.repairMissingShopifyOrder).not.toHaveBeenCalledWith(expect.any(String), true);
  });

  it('offers one-order current-state repair only after a missing-order inspection and requires dry-run review', async () => {
    const repairedOrder = orderStateInspectorResult();
    repairedOrder.orderIdentity = {
      ...repairedOrder.orderIdentity,
      orderNumber: '#1105',
      shopifyOrderId: '7856043819345',
    };
    repairedOrder.repairHistory = [{
      jobId: 'repair-job-1105',
      repairSource: 'shopify_admin_current_state',
      repairTimestamp: '2026-07-13T10:01:00.000Z',
      dryRun: false,
      executed: true,
      status: 'COMPLETED',
      actorUserId: 'admin-1',
      actorEmail: 'admin@example.com',
      errorSummary: null,
    }];
    diagnosticsMocks.inspectOrderState
      .mockReset()
      .mockRejectedValueOnce(new Error('Order not found.'))
      .mockResolvedValue(repairedOrder);

    renderDiagnosticsPage();
    await userEvent.type(await screen.findByLabelText('Order number'), '#1105');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    expect(await screen.findByRole('button', { name: 'Repair Missing Shopify Order' })).toBeInTheDocument();
    expect(screen.getByText('One explicit Shopify order only. Bulk or range repair is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute Repair' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Repair Missing Shopify Order' }));

    expect(diagnosticsMocks.repairMissingShopifyOrder).toHaveBeenCalledWith('#1105', false);
    expect(await screen.findByLabelText('Current-state repair dry-run plan')).toBeInTheDocument();
    expect(screen.getByText('Canonical Shopify state')).toBeInTheDocument();
    expect(screen.getByText('Current local state')).toBeInTheDocument();
    expect(screen.getByText('Planned mutations')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Execute Repair' }));
    expect(diagnosticsMocks.repairMissingShopifyOrder).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog', { name: 'Execute Current-State Repair?' });
    expect(dialog).toHaveTextContent('Current Shopify state will be fetched. Missing local records may be created');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Execute Repair' }));

    expect(diagnosticsMocks.repairMissingShopifyOrder).toHaveBeenLastCalledWith('#1105', true);
    expect(await screen.findByText('Repair history')).toBeInTheDocument();
    const repairDetailsLabel = screen.getByText('Repair technical evidence');
    const repairDetails = repairDetailsLabel.closest('details') as HTMLDetailsElement;
    expect(repairDetails.open).toBe(false);
    await userEvent.click(repairDetailsLabel);
    expect(repairDetails.open).toBe(true);
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
  });

  it('renders loading and safe not-found states without changing the data path on narrow screens', async () => {
    let rejectInspection: ((reason?: unknown) => void) | null = null;
    diagnosticsMocks.inspectOrderState.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectInspection = reject;
    }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    renderDiagnosticsPage();

    await screen.findByRole('heading', { name: 'Order State Inspector' });
    await userEvent.type(screen.getByLabelText('Order number'), '1108');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(await screen.findByText('Inspecting order state')).toBeInTheDocument();
    expect(diagnosticsMocks.inspectOrderState).toHaveBeenCalledTimes(1);

    rejectInspection?.(new Error('Order not found.'));
    expect(await screen.findByRole('button', { name: 'Repair Missing Shopify Order' })).toBeInTheDocument();
    expect(screen.queryByText('Order state unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Order not found.')).not.toBeInTheDocument();
  });
});
