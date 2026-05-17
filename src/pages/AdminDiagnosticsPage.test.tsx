import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setToken } from '../lib/auth';
import { AdminDiagnosticsPage } from './AdminDiagnosticsPage';

const diagnosticsMocks = vi.hoisted(() => ({
  webhooks: vi.fn(),
  webhookDetail: vi.fn(),
  syncEvents: vi.fn(),
  reconciliation: vi.fn(),
  replay: vi.fn(),
  recover: vi.fn(),
  retryOperationalJob: vi.fn(),
  reconcileAllocation: vi.fn(),
  reconcileShopifyOrder: vi.fn(),
  observabilitySummary: vi.fn(),
  runtimeHealth: vi.fn(),
}));

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
  status: 'RECEIVED',
  processingStatus: 'received',
  payloadAvailable: true,
  replayEligible: true,
  replayBlockedReason: null,
  recoverEligible: true,
  recoverBlockedReason: null,
  recommendedAction: 'Replay or recover this stuck event.',
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
    diagnosticsMocks.syncEvents.mockReset();
    diagnosticsMocks.reconciliation.mockReset();
    diagnosticsMocks.replay.mockReset();
    diagnosticsMocks.recover.mockReset();
    diagnosticsMocks.retryOperationalJob.mockReset();
    diagnosticsMocks.reconcileAllocation.mockReset();
    diagnosticsMocks.reconcileShopifyOrder.mockReset();
    diagnosticsMocks.observabilitySummary.mockReset();
    diagnosticsMocks.runtimeHealth.mockReset();

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

    expect(await screen.findByRole('heading', { name: /webhook recovery command center/i })).toBeInTheDocument();
    expect((await screen.findAllByText(/Replay blocked: Payload unavailable/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recover blocked: Already processed/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Refund Sync')).toBeInTheDocument();
    expect(screen.getByText(/Retry 1\/3/i)).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
    expect(screen.getByText('Stale allocation detected')).toBeInTheDocument();
    expect(screen.getByText('Health warning')).toBeInTheDocument();
    expect(screen.getByText('Retry pressure')).toBeInTheDocument();
  });

  it('renders safe deployment runtime diagnostics without exposing secrets', async () => {
    renderDiagnosticsPage();

    expect(await screen.findByText('Deployment runtime')).toBeInTheDocument();
    expect(screen.getAllByText('http://127.0.0.1:4000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('def5678').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reachable').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('link', { name: 'Orders' })[0]).toHaveAttribute('href', '/orders');

    const deploymentSectionText = screen.getAllByText('Deployment runtime')[0].closest('section')?.textContent ?? '';
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

  it('shows replay action feedback without changing the backend action contract', async () => {
    renderDiagnosticsPage();

    expect((await screen.findAllByText('event-replayable')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'Replay' })[1]);

    expect(await screen.findByText('Replay accepted')).toBeInTheDocument();
    expect(diagnosticsMocks.replay).toHaveBeenCalledWith('webhook-replayable');
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

    expect(await screen.findByRole('button', { name: 'Show payload preview' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Payload preview')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show payload preview' }));

    expect(await screen.findByLabelText('Payload preview')).toHaveTextContent('"id":501');

    await userEvent.click(screen.getByRole('button', { name: 'Hide payload preview' }));

    expect(screen.queryByLabelText('Payload preview')).not.toBeInTheDocument();
  });
});
