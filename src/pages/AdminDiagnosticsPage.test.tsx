import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminDiagnosticsPage } from './AdminDiagnosticsPage';

const diagnosticsMocks = vi.hoisted(() => ({
  webhooks: vi.fn(),
  webhookDetail: vi.fn(),
  syncEvents: vi.fn(),
  reconciliation: vi.fn(),
  replay: vi.fn(),
  recover: vi.fn(),
  reconcileAllocation: vi.fn(),
  reconcileShopifyOrder: vi.fn(),
}));

vi.mock('../config/runtime', () => ({
  runtimeConfig: {
    apiMode: 'real',
    apiBaseUrl: 'http://127.0.0.1:4000',
  },
}));

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    diagnostics: diagnosticsMocks,
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
    diagnosticsMocks.webhooks.mockReset();
    diagnosticsMocks.webhookDetail.mockReset();
    diagnosticsMocks.syncEvents.mockReset();
    diagnosticsMocks.reconciliation.mockReset();
    diagnosticsMocks.replay.mockReset();
    diagnosticsMocks.recover.mockReset();
    diagnosticsMocks.reconcileAllocation.mockReset();
    diagnosticsMocks.reconcileShopifyOrder.mockReset();

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
  });

  it('surfaces blocked replay and recover reasons in the event detail panel', async () => {
    renderDiagnosticsPage();

    expect(await screen.findByRole('heading', { name: /webhook recovery command center/i })).toBeInTheDocument();
    expect((await screen.findAllByText(/Replay blocked: Payload unavailable/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recover blocked: Already processed/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Stale allocation detected')).toBeInTheDocument();
  });

  it('shows replay action feedback without changing the backend action contract', async () => {
    renderDiagnosticsPage();

    await screen.findByText('event-replayable');
    await userEvent.click(screen.getAllByRole('button', { name: 'Replay' })[1]);

    expect(await screen.findByText('Replay accepted')).toBeInTheDocument();
    expect(diagnosticsMocks.replay).toHaveBeenCalledWith('webhook-replayable');
  });
});
