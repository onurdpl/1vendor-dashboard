import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { SectionErrorRetry, SectionSkeleton } from '../components/OperationalPrimitives';
import {
  addAdminAllocationResolutionNote,
  createParatikaHostedPaymentLink,
  executeAdminShopifyRefund,
  getAdminShopifyOrderBreakdown,
  previewAdminShopifyRefund,
  requestAdminCancelRefundReview,
  returnAdminBlockedAllocationToVendor,
  transferAdminAllocationEconomics,
  type ParatikaSessionTokenLiveProbeResult,
  type ShopifyRefundExecutionPayload,
  type ShopifyRefundPreviewResult,
  type ShopifyOrderBreakdown,
} from '../features/orders/api';
import {
  acknowledgeFinanceIntegrityAlert,
  getTransferRecoveryDiagnostics,
  rescanFinanceIntegrityAlert,
  resolveFinanceIntegrityAlert,
} from '../features/finance/api';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { useActionFeedback } from '../lib/ui';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { formatDateTime } from '../services/real/formatting';

function formatDate(value: string) {
  return formatDateTime(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getClassToken(value: string | null | undefined) {
  return (value ?? 'unknown').toLowerCase().replace(/\s+/g, '-');
}

function getSafeProbeText(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  return value
    .replace(/((?:access|refresh|session)[_-]?token|token|password|secret|merchantpassword|merchantuser)\s*[:=]\s*[^&\s,}]+/gi, '$1=[redacted]')
    .slice(0, 180);
}

function getProbeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return getSafeProbeText(error.message) ?? 'Paratika probe failed.';
  }

  return 'Paratika probe failed.';
}

function formatFinanceAlertCategory(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatTransferStatus(value: string) {
  const normalized = value.trim().toLowerCase().replace(/_/g, ' ');
  if (!normalized) {
    return 'Unknown';
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatTransferRecoveryClassification(value: string) {
  return formatTransferStatus(value);
}

function formatCancelRefundReviewStatus(value: string) {
  return formatTransferStatus(value);
}

function formatLedgerDiagnosticState(ledger: {
  id: string | null;
  exists: boolean;
  active: boolean;
  voided: boolean;
  supersededByLedgerId?: string | null;
}) {
  if (!ledger.exists) {
    return `Missing${ledger.id ? ` (${ledger.id})` : ''}`;
  }
  if (ledger.active) {
    return `Active · ${ledger.id}`;
  }
  if (ledger.voided) {
    return `Voided · ${ledger.id}${ledger.supersededByLedgerId ? ` → ${ledger.supersededByLedgerId}` : ''}`;
  }
  return `Inactive · ${ledger.id}`;
}

function getActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

type AdminAllocationResolutionAction = {
  type: 'return_to_vendor' | 'add_note';
  allocation: ShopifyOrderBreakdown['allocations'][number];
};

type AdminEconomicTransferAction = {
  allocation: ShopifyOrderBreakdown['allocations'][number];
};

type AdminCancelRefundReviewAction = {
  allocation: ShopifyOrderBreakdown['allocations'][number];
};

type AdminShopifyRefundExecutionAction = {
  allocation: ShopifyOrderBreakdown['allocations'][number];
  preview: ShopifyRefundPreviewResult;
};

type FinanceIntegrityAlertAcknowledgeAction = {
  allocation: ShopifyOrderBreakdown['allocations'][number];
  alert: NonNullable<ShopifyOrderBreakdown['allocations'][number]['financeIntegrityAlerts']>[number];
};

type FinanceIntegrityAlertResolveAction = FinanceIntegrityAlertAcknowledgeAction;

type FinanceIntegrityAlertRescanSummary = {
  tone: 'success' | 'info' | 'error';
  message: string;
};

function formatPreviewMoney(amount: string | null | undefined, currencyCode: string | null | undefined) {
  if (!amount) {
    return currencyCode ? `0.00 ${currencyCode}` : 'Not returned';
  }
  return currencyCode ? `${amount} ${currencyCode}` : amount;
}

function TransferDiagnosticsCard({ transferId }: { transferId: string }) {
  const { data, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.admin.financeIntegrity.transferDiagnostics(transferId),
    ({ signal }) => getTransferRecoveryDiagnostics(transferId, { signal }),
    {
      enabled: Boolean(transferId),
    },
  );

  if (isLoading && !data) {
    return (
      <section className="economic-transfer-summary-card" aria-label="Transfer diagnostics">
        <SectionSkeleton title="Loading transfer diagnostics" description="Reading transfer, ledger, assignment, and alert state." />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="economic-transfer-summary-card" aria-label="Transfer diagnostics">
        <SectionErrorRetry
          title="Transfer diagnostics unavailable"
          description={error ?? 'Transfer recovery diagnostics could not be loaded.'}
          onRetry={() => void refetch()}
        />
      </section>
    );
  }

  return (
    <section className="economic-transfer-summary-card" aria-label="Transfer diagnostics">
      <div className="economic-transfer-summary-header">
        <div>
          <p className="eyebrow">Transfer diagnostics</p>
          <h3>Recovery diagnostics</h3>
        </div>
        <span className={`status-badge status-${getClassToken(data.recoveryClassification)}`}>
          {formatTransferRecoveryClassification(data.recoveryClassification)}
        </span>
      </div>
      <div className="compact-meta-grid">
        <div className="meta-item">
          <span>Transfer status</span>
          <strong>{formatTransferStatus(data.transferStatus)}</strong>
        </div>
        <div className="meta-item">
          <span>Source ledger</span>
          <strong>{formatLedgerDiagnosticState(data.sourceLedger)}</strong>
        </div>
        <div className="meta-item">
          <span>Target ledger</span>
          <strong>{formatLedgerDiagnosticState(data.targetLedger)}</strong>
        </div>
        <div className="meta-item">
          <span>Assignment</span>
          <strong>
            {data.assignment.consistent ? 'Consistent' : 'Mismatch'} · {data.assignment.assignedVendorId ?? 'Unknown'} / expected {data.assignment.expectedVendorId}
          </strong>
        </div>
        <div className="meta-item">
          <span>Active economic owner</span>
          <strong>
            {data.economicOwner.ownerVendorId ?? 'Unresolved'} · {formatTransferStatus(data.economicOwner.resolutionStatus)}
          </strong>
        </div>
        <div className="meta-item">
          <span>Blocking alerts</span>
          <strong>{data.financeIntegrityAlerts.length}</strong>
        </div>
      </div>
      <p className="page-description">{data.recommendedAction}</p>
    </section>
  );
}

function normalizeStateToken(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

function hasBlockingFinanceAlert(allocation: ShopifyOrderBreakdown['allocations'][number]) {
  return allocation.financeIntegrityAlerts?.some((alert) => {
    const status = normalizeStateToken(alert.status);
    return status === 'open' || status === 'acknowledged';
  }) ?? false;
}

function hasVisibleTransferBlockerEvidence(allocation: ShopifyOrderBreakdown['allocations'][number]) {
  const fulfillmentStatus = normalizeStateToken(allocation.fulfillmentStatus);
  const shippingStatus = normalizeStateToken(allocation.shippingStatus);

  return Boolean(
    allocation.trackingNumber ||
      allocation.carrier ||
      allocation.fulfilledAt ||
      allocation.shipmentCreatedAt ||
      allocation.shipmentUpdatedAt ||
      allocation.refundedItems.length > 0 ||
      (allocation.returnRecordCount ?? 0) > 0 ||
      fulfillmentStatus === 'fulfilled' ||
      fulfillmentStatus === 'partially_fulfilled' ||
      shippingStatus === 'in_transit' ||
      shippingStatus === 'delivered' ||
      shippingStatus === 'label_created',
  );
}

function canShowEconomicTransferAction(allocation: ShopifyOrderBreakdown['allocations'][number]) {
  return (
    normalizeStateToken(allocation.allocationStatus) === 'vendor_blocked' &&
    allocation.reassignmentRequired &&
    !hasBlockingFinanceAlert(allocation) &&
    !hasVisibleTransferBlockerEvidence(allocation)
  );
}

function canShowCancelRefundReviewAction(allocation: ShopifyOrderBreakdown['allocations'][number]) {
  return (
    normalizeStateToken(allocation.allocationStatus) === 'vendor_blocked' &&
    allocation.reassignmentRequired &&
    !allocation.transferSummary &&
    !allocation.cancelRefundReview &&
    !hasVisibleTransferBlockerEvidence(allocation)
  );
}

function isRefundReviewEligibleForShopifyExecution(allocation: ShopifyOrderBreakdown['allocations'][number]) {
  const reviewStatus = normalizeStateToken(allocation.cancelRefundReview?.status);
  return reviewStatus === 'pending_review' || reviewStatus === 'customer_contacted';
}

function isOutboundRefundPending(allocation: ShopifyOrderBreakdown['allocations'][number]) {
  return normalizeStateToken(allocation.outboundRefundAttemptSummary?.status) === 'shopify_action_pending';
}

function hasExecutableShopifyRefundPreview(preview: ShopifyRefundPreviewResult | undefined) {
  if (!preview || preview.blockers.length > 0 || !preview.suggestedRefund) {
    return false;
  }

  const transactions = preview.suggestedRefund.suggestedTransactions;
  const hasMappedTransactions =
    transactions.length > 0 && transactions.every((transaction) => Boolean(transaction.parentTransactionId?.trim()));
  const fulfillmentOrderState = normalizeStateToken(preview.fulfillmentOrderCancellation.overallClassification);

  return (
    hasMappedTransactions &&
    (fulfillmentOrderState === 'safe_to_cancel' || fulfillmentOrderState === 'no_cancellation_needed')
  );
}

function canShowShopifyRefundExecutionAction(
  allocation: ShopifyOrderBreakdown['allocations'][number],
  preview: ShopifyRefundPreviewResult | undefined,
) {
  return (
    isRefundReviewEligibleForShopifyExecution(allocation) &&
    hasExecutableShopifyRefundPreview(preview) &&
    !isOutboundRefundPending(allocation) &&
    !hasVisibleTransferBlockerEvidence(allocation) &&
    !hasBlockingFinanceAlert(allocation)
  );
}

const CANCEL_REFUND_REVIEW_REASONS = [
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'VENDOR_CANCELLED', label: 'Vendor cancelled' },
  { value: 'DAMAGED_INVENTORY', label: 'Damaged inventory' },
  { value: 'FULFILLMENT_ISSUE', label: 'Fulfillment issue' },
] as const;

export function AdminShopifyOrderPage() {
  const { shopifyOrderId } = useParams();
  const queryClient = useQueryClient();
  const appReadiness = useAppReadiness();
  const { message, tone, showFeedback } = useActionFeedback();
  const [paratikaProbeResult, setParatikaProbeResult] = useState<ParatikaSessionTokenLiveProbeResult | null>(null);
  const [resolutionAction, setResolutionAction] = useState<AdminAllocationResolutionAction | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [transferAction, setTransferAction] = useState<AdminEconomicTransferAction | null>(null);
  const [replacementVendorId, setReplacementVendorId] = useState('');
  const [economicTransferReason, setEconomicTransferReason] = useState('');
  const [replacementFulfillmentConfirmed, setReplacementFulfillmentConfirmed] = useState(false);
  const [originalPriceConfirmed, setOriginalPriceConfirmed] = useState(false);
  const [cancelRefundReviewAction, setCancelRefundReviewAction] = useState<AdminCancelRefundReviewAction | null>(null);
  const [cancelRefundReviewReason, setCancelRefundReviewReason] = useState('');
  const [cancelRefundReviewNote, setCancelRefundReviewNote] = useState('');
  const [cancelRefundReviewConfirmed, setCancelRefundReviewConfirmed] = useState(false);
  const [shopifyRefundAction, setShopifyRefundAction] = useState<AdminShopifyRefundExecutionAction | null>(null);
  const [shopifyRefundNote, setShopifyRefundNote] = useState('');
  const [shopifyRefundNotifyCustomer, setShopifyRefundNotifyCustomer] = useState(false);
  const [shopifyRefundPaymentConfirmed, setShopifyRefundPaymentConfirmed] = useState(false);
  const [shopifyRefundWebhookConfirmed, setShopifyRefundWebhookConfirmed] = useState(false);
  const [acknowledgeAction, setAcknowledgeAction] = useState<FinanceIntegrityAlertAcknowledgeAction | null>(null);
  const [acknowledgmentNote, setAcknowledgmentNote] = useState('');
  const [resolveAction, setResolveAction] = useState<FinanceIntegrityAlertResolveAction | null>(null);
  const [alertResolutionNote, setAlertResolutionNote] = useState('');
  const [rescanSummaries, setRescanSummaries] = useState<Record<string, FinanceIntegrityAlertRescanSummary>>({});
  const [shopifyRefundPreviews, setShopifyRefundPreviews] = useState<Record<string, ShopifyRefundPreviewResult>>({});
  const paratikaLiveProbe = useMutationAction(
    async () => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return createParatikaHostedPaymentLink(shopifyOrderId);
    },
    {
      onSuccess: (result) => {
        setParatikaProbeResult(result);
        showFeedback(
          result.hostedPaymentUrl
            ? 'Paratika hosted payment link created for manual testing.'
            : 'Paratika SESSIONTOKEN probe completed without a hosted link.',
          result.hostedPaymentUrl ? 'success' : 'info',
        );
      },
      onError: (error) => {
        setParatikaProbeResult(null);
        showFeedback(getProbeErrorMessage(error), 'error');
      },
    },
  );
  const { data: breakdown, isLoading, isError, error, refetch } = useQueryResource(
    shopifyOrderId ? queryKeys.admin.orders.breakdown(shopifyOrderId) : queryKeys.orders.list(),
    ({ signal }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order not found.');
      }

      return getAdminShopifyOrderBreakdown(shopifyOrderId, { signal });
    },
    {
      enabled: appReadiness.ready && Boolean(shopifyOrderId),
    },
  );
  const returnToVendorMutation = useMutationAction(
    async (payload: { allocationId: string; note: string }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return returnAdminBlockedAllocationToVendor(shopifyOrderId, payload.allocationId, {
        confirmReturnToVendor: true,
        note: payload.note,
      });
    },
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Allocation could not be returned to vendor.'), 'error');
      },
    },
  );
  const addResolutionNoteMutation = useMutationAction(
    async (payload: { allocationId: string; note: string }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return addAdminAllocationResolutionNote(shopifyOrderId, payload.allocationId, {
        note: payload.note,
      });
    },
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Admin note could not be saved.'), 'error');
      },
    },
  );
  const isResolutionPending = returnToVendorMutation.isPending || addResolutionNoteMutation.isPending;
  const transferEconomicsMutation = useMutationAction(
    async (payload: { allocationId: string; toVendorId: string; reason: string }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return transferAdminAllocationEconomics(shopifyOrderId, payload.allocationId, {
        toVendorId: payload.toVendorId,
        reason: payload.reason,
        confirmTransfer: true,
      });
    },
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Economic transfer could not be completed.'), 'error');
      },
    },
  );
  const cancelRefundReviewMutation = useMutationAction(
    async (payload: { allocationId: string; reason: typeof CANCEL_REFUND_REVIEW_REASONS[number]['value']; note: string }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return requestAdminCancelRefundReview(shopifyOrderId, payload.allocationId, {
        reason: payload.reason,
        note: payload.note,
        confirmReview: true,
      });
    },
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Cancel/refund review could not be requested.'), 'error');
      },
    },
  );
  const shopifyRefundPreviewMutation = useMutationAction(
    async (payload: { allocationId: string }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return previewAdminShopifyRefund(shopifyOrderId, payload.allocationId, {
        restockType: 'CANCEL',
        refundShipping: false,
      });
    },
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Shopify refund preview could not be loaded.'), 'error');
      },
    },
  );
  const shopifyRefundExecutionMutation = useMutationAction(
    async (payload: { allocationId: string; refund: ShopifyRefundExecutionPayload }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return executeAdminShopifyRefund(shopifyOrderId, payload.allocationId, payload.refund);
    },
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Shopify refund could not be submitted.'), 'error');
      },
    },
  );
  const acknowledgeAlertMutation = useMutationAction(
    async (payload: { alertId: string; note: string }) => acknowledgeFinanceIntegrityAlert(payload.alertId, { note: payload.note }),
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Finance integrity alert could not be acknowledged.'), 'error');
      },
    },
  );
  const rescanAlertMutation = useMutationAction(
    async (payload: { alertId: string }) => rescanFinanceIntegrityAlert(payload.alertId, { dryRun: true }),
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Finance integrity alert could not be rescanned.'), 'error');
      },
    },
  );
  const resolveAlertMutation = useMutationAction(
    async (payload: { alertId: string; note: string }) =>
      resolveFinanceIntegrityAlert(payload.alertId, {
        note: payload.note,
        confirmResolve: true,
      }),
    {
      onError: (mutationError) => {
        showFeedback(getActionErrorMessage(mutationError, 'Finance integrity alert could not be resolved.'), 'error');
      },
    },
  );

  async function handleResolutionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolutionAction) {
      return;
    }

    const note = resolutionNote.trim();
    if (!note) {
      showFeedback('Admin note is required.', 'error');
      return;
    }

    try {
      if (resolutionAction.type === 'return_to_vendor') {
        await returnToVendorMutation.mutateAsync({
          allocationId: resolutionAction.allocation.allocationOrderId,
          note,
        });
        showFeedback('Allocation returned to vendor. Fulfillment is available again.', 'success');
      } else {
        await addResolutionNoteMutation.mutateAsync({
          allocationId: resolutionAction.allocation.allocationOrderId,
          note,
        });
        showFeedback('Admin note added to allocation history.', 'success');
      }
      setResolutionAction(null);
      setResolutionNote('');
      await refetch();
    } catch {
      // The mutation onError handler owns user-facing feedback.
    }
  }

  async function handleEconomicTransferSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transferAction) {
      return;
    }

    const reason = economicTransferReason.trim();
    if (!replacementVendorId) {
      showFeedback('Replacement vendor is required.', 'error');
      return;
    }
    if (!reason) {
      showFeedback('Economic transfer reason is required.', 'error');
      return;
    }
    if (!replacementFulfillmentConfirmed || !originalPriceConfirmed) {
      showFeedback('Both economic transfer confirmations are required.', 'error');
      return;
    }

    try {
      const result = await transferEconomicsMutation.mutateAsync({
        allocationId: transferAction.allocation.allocationOrderId,
        toVendorId: replacementVendorId,
        reason,
      });
      if (result.order && shopifyOrderId) {
        queryClient.setQueryData(queryKeys.admin.orders.breakdown(shopifyOrderId), result.order);
      } else {
        await refetch();
      }
      showFeedback('Allocation economics transferred to the replacement vendor.', 'success');
      setTransferAction(null);
      setReplacementVendorId('');
      setEconomicTransferReason('');
      setReplacementFulfillmentConfirmed(false);
      setOriginalPriceConfirmed(false);
    } catch {
      // The mutation onError handler owns user-facing feedback.
    }
  }

  async function handleCancelRefundReviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cancelRefundReviewAction) {
      return;
    }

    const note = cancelRefundReviewNote.trim();
    if (!cancelRefundReviewReason) {
      showFeedback('Cancel/refund review reason is required.', 'error');
      return;
    }
    if (!note) {
      showFeedback('Cancel/refund review note is required.', 'error');
      return;
    }
    if (!cancelRefundReviewConfirmed) {
      showFeedback('Cancel/refund review confirmation is required.', 'error');
      return;
    }

    try {
      const result = await cancelRefundReviewMutation.mutateAsync({
        allocationId: cancelRefundReviewAction.allocation.allocationOrderId,
        reason: cancelRefundReviewReason as typeof CANCEL_REFUND_REVIEW_REASONS[number]['value'],
        note,
      });
      if (shopifyOrderId) {
        queryClient.setQueryData(queryKeys.admin.orders.breakdown(shopifyOrderId), result);
      } else {
        await refetch();
      }
      showFeedback('Allocation moved to cancel/refund review. Shopify and refund state were not changed.', 'success');
      setCancelRefundReviewAction(null);
      setCancelRefundReviewReason('');
      setCancelRefundReviewNote('');
      setCancelRefundReviewConfirmed(false);
    } catch {
      // The mutation onError handler owns user-facing feedback.
    }
  }

  async function handleShopifyRefundPreview(allocation: ShopifyOrderBreakdown['allocations'][number]) {
    try {
      const result = await shopifyRefundPreviewMutation.mutateAsync({
        allocationId: allocation.allocationOrderId,
      });
      setShopifyRefundPreviews((current) => ({
        ...current,
        [allocation.allocationOrderId]: result,
      }));
      const blockerCount = result.blockers.length;
      const warningCount = result.warnings.length;
      if (blockerCount > 0) {
        showFeedback(`Shopify refund preview loaded with ${blockerCount} blocker${blockerCount === 1 ? '' : 's'}.`, 'info');
      } else if (warningCount > 0) {
        showFeedback(`Shopify refund preview loaded with ${warningCount} warning${warningCount === 1 ? '' : 's'}.`, 'info');
      } else {
        showFeedback('Shopify refund preview loaded. No local state was changed.', 'success');
      }
    } catch {
      // The mutation onError handler owns user-facing feedback.
    }
  }

  async function handleShopifyRefundExecutionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shopifyRefundAction) {
      return;
    }

    const note = shopifyRefundNote.trim();
    if (!note) {
      showFeedback('Refund note is required.', 'error');
      return;
    }
    if (note.length > 1000) {
      showFeedback('Refund note must be 1000 characters or fewer.', 'error');
      return;
    }
    if (!shopifyRefundPaymentConfirmed || !shopifyRefundWebhookConfirmed) {
      showFeedback('Both refund confirmations are required.', 'error');
      return;
    }
    if (!canShowShopifyRefundExecutionAction(shopifyRefundAction.allocation, shopifyRefundAction.preview)) {
      showFeedback('Shopify refund execution is blocked by the current preview or allocation state.', 'error');
      return;
    }

    const restockType = shopifyRefundAction.preview.refundLineItemsPreview[0]?.restockType ?? 'CANCEL';

    try {
      const result = await shopifyRefundExecutionMutation.mutateAsync({
        allocationId: shopifyRefundAction.allocation.allocationOrderId,
        refund: {
          restockType,
          refundShipping: false,
          notifyCustomer: shopifyRefundNotifyCustomer,
          note,
          confirmRefund: true,
        },
      });

      setShopifyRefundPreviews((current) => {
        const next = { ...current };
        delete next[shopifyRefundAction.allocation.allocationOrderId];
        return next;
      });
      setShopifyRefundAction(null);
      setShopifyRefundNote('');
      setShopifyRefundNotifyCustomer(false);
      setShopifyRefundPaymentConfirmed(false);
      setShopifyRefundWebhookConfirmed(false);
      await refetch();
      showFeedback(result.message || 'Shopify refund submitted. Waiting for refunds/create webhook.', 'success');
    } catch {
      await refetch();
      // The mutation onError handler owns user-facing feedback.
    }
  }

  async function handleAcknowledgeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!acknowledgeAction) {
      return;
    }

    const note = acknowledgmentNote.trim();
    if (!note) {
      showFeedback('Acknowledgment note is required.', 'error');
      return;
    }

    try {
      await acknowledgeAlertMutation.mutateAsync({
        alertId: acknowledgeAction.alert.id,
        note,
      });
      showFeedback('Finance integrity alert acknowledged. Money movement remains blocked until the alert is resolved.', 'success');
      setAcknowledgeAction(null);
      setAcknowledgmentNote('');
      await refetch();
    } catch {
      // The mutation onError handler owns user-facing feedback.
    }
  }

  async function handleRescanAlert(alert: NonNullable<ShopifyOrderBreakdown['allocations'][number]['financeIntegrityAlerts']>[number]) {
    setRescanSummaries((current) => {
      const next = { ...current };
      delete next[alert.id];
      return next;
    });

    try {
      const result = await rescanAlertMutation.mutateAsync({ alertId: alert.id });
      const findingCount = result.findings.length;
      const message = result.matchingAlertStillDetected
        ? `Issue still detected. ${findingCount} finding${findingCount === 1 ? '' : 's'} returned.`
        : `No matching issue detected. ${findingCount} finding${findingCount === 1 ? '' : 's'} returned.`;
      const tone = result.matchingAlertStillDetected ? 'info' : 'success';
      setRescanSummaries((current) => ({
        ...current,
        [alert.id]: {
          tone,
          message,
        },
      }));
      showFeedback(message, tone);
    } catch {
      // The mutation onError handler owns user-facing feedback.
    }
  }

  async function handleResolveSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolveAction) {
      return;
    }

    const note = alertResolutionNote.trim();
    if (!note) {
      showFeedback('Resolution note is required.', 'error');
      return;
    }

    try {
      await resolveAlertMutation.mutateAsync({
        alertId: resolveAction.alert.id,
        note,
      });
      showFeedback('Finance integrity alert resolved after scanner validation.', 'success');
      setResolveAction(null);
      setAlertResolutionNote('');
      await refetch();
    } catch {
      // The mutation onError handler owns user-facing feedback.
    }
  }

  if (!appReadiness.ready || (isLoading && !breakdown)) {
    return (
      <section className="dashboard order-detail">
        <div className="hero-card operational-card">
          <div>
            <p className="eyebrow">Admin orders</p>
            <h2>Shopify order breakdown</h2>
            <p className="page-description">Preparing cross-vendor order allocations for operations review.</p>
          </div>
        </div>
        <SectionSkeleton title="Loading Shopify breakdown" description="Fetching allocation data in the background." />
      </section>
    );
  }

  if (isError || !breakdown) {
    return (
      <section className="dashboard order-detail">
        <div className="hero-card operational-card">
          <div>
            <p className="eyebrow">Admin orders</p>
            <h2>Shopify order breakdown</h2>
            <p className="page-description">The requested Shopify order could not be loaded.</p>
          </div>
          <Link className="button button-secondary" to="/orders">
            Back to orders
          </Link>
        </div>
        <SectionErrorRetry
          title="Breakdown unavailable"
          description={error ?? 'The requested Shopify order could not be loaded.'}
          onRetry={() => void refetch()}
        />
      </section>
    );
  }

  return (
    <section className="dashboard order-detail">
      <div className="hero-card operational-card">
        <div>
          <p className="eyebrow">Admin orders</p>
          <h2>Shopify Order {formatShopifyOrderNumber(breakdown.sourceShopifyOrderNumber)}</h2>
          <p className="page-description">Operational allocation overview across assigned vendors.</p>
        </div>
        <div className="operational-meta-grid">
          <div className="meta-item">
            <span>Source order</span>
            <strong>{breakdown.sourceShopifyOrderId}</strong>
          </div>
          <div className="meta-item">
            <span>Customer</span>
            <strong>{breakdown.customer}</strong>
          </div>
          <div className="meta-item">
            <span>Created</span>
            <strong>{formatDate(breakdown.createdAt)}</strong>
          </div>
          <div className="meta-item">
            <span>Allocations</span>
            <strong>{breakdown.allocations.length}</strong>
          </div>
        </div>
      </div>

      <article className="panel operational-card paratika-probe-card">
        <header className="allocation-header">
          <div>
            <p className="eyebrow">Paratika diagnostics</p>
            <h3>Create hosted payment link</h3>
            <p className="page-description">
              Runs the guarded SESSIONTOKEN live probe for this Shopify order. It does not mark the order paid, call Shopify, or create accounting records.
            </p>
          </div>
          <button
            className="button button-primary"
            type="button"
            disabled={paratikaLiveProbe.isPending}
            onClick={() => paratikaLiveProbe.mutate(undefined)}
          >
            {paratikaLiveProbe.isPending ? 'Creating link...' : 'Create Paratika hosted payment link'}
          </button>
        </header>

        {paratikaProbeResult ? (
          <div className="paratika-probe-result">
            <div className="compact-meta-grid">
              <div className="meta-item">
                <span>Response</span>
                <strong>{getSafeProbeText(paratikaProbeResult.responseCode) ?? 'Unknown'}</strong>
              </div>
              <div className="meta-item">
                <span>Message</span>
                <strong>{getSafeProbeText(paratikaProbeResult.responseMsg) ?? 'No message'}</strong>
              </div>
              <div className="meta-item">
                <span>Payment reference</span>
                <strong>{getSafeProbeText(paratikaProbeResult.paymentReference) ?? 'Not returned'}</strong>
              </div>
              <div className="meta-item">
                <span>Mutation status</span>
                <strong>No payment state changed</strong>
              </div>
              {paratikaProbeResult.errorCode ? (
                <div className="meta-item">
                  <span>Error code</span>
                  <strong>{getSafeProbeText(paratikaProbeResult.errorCode)}</strong>
                </div>
              ) : null}
              {paratikaProbeResult.violatorParam ? (
                <div className="meta-item">
                  <span>Violator param</span>
                  <strong>{getSafeProbeText(paratikaProbeResult.violatorParam)}</strong>
                </div>
              ) : null}
            </div>

            {paratikaProbeResult.errorMsg ? (
              <ActionFeedback tone="error" message={getSafeProbeText(paratikaProbeResult.errorMsg) ?? 'Paratika returned an error.'} />
            ) : null}

            {paratikaProbeResult.hostedPaymentUrl ? (
              <a
                className="button button-secondary paratika-probe-link"
                href={paratikaProbeResult.hostedPaymentUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Paratika payment page
              </a>
            ) : null}
          </div>
        ) : null}
      </article>

      {breakdown.allocations.map((allocation) => {
        const replacementVendorOptions = (appReadiness.currentUser?.vendorDetails ?? []).filter(
          (vendor) => vendor.vendorId !== allocation.assignedVendorId,
        );
        const showEconomicTransferAction = canShowEconomicTransferAction(allocation);
        const showCancelRefundReviewAction = canShowCancelRefundReviewAction(allocation);
        const shopifyRefundPreview = shopifyRefundPreviews[allocation.allocationOrderId];
        const showShopifyRefundExecutionAction = canShowShopifyRefundExecutionAction(allocation, shopifyRefundPreview);
        const outboundRefundPending = isOutboundRefundPending(allocation);

        return (
        <article key={allocation.vendorId} className="panel allocation-card operational-card">
          <header className="allocation-header">
            <div>
              <p className="eyebrow">Vendor allocation</p>
              <h3>{allocation.vendorName}</h3>
            </div>
            <div className="chip-row">
              <span className={`status-badge status-${allocation.allocationStatus}`}>{allocation.allocationStatus}</span>
              <span
                className={`status-badge status-${getClassToken(allocation.fulfillmentActionState)}`}
              >
                {allocation.fulfillmentActionState}
              </span>
              <span className={`status-badge status-${getClassToken(allocation.shippingStatus)}`}>
                {allocation.shippingStatus}
              </span>
            </div>
          </header>

          {allocation.financeIntegrityAlerts?.length ? (
            <section className="finance-integrity-alerts" aria-label="Finance integrity alerts">
              {allocation.financeIntegrityAlerts.map((alert) => {
                const normalizedAlertStatus = alert.status.toLowerCase();
                const rescanSummary = rescanSummaries[alert.id];
                const canAcknowledge = normalizedAlertStatus === 'open';
                const canRescan = normalizedAlertStatus === 'open' || normalizedAlertStatus === 'acknowledged';
                const canResolve = normalizedAlertStatus === 'open' || normalizedAlertStatus === 'acknowledged';

                return (
                  <article
                    key={alert.id}
                    className={`finance-integrity-alert finance-integrity-alert-${getClassToken(alert.severity)}`}
                  >
                    <div className="finance-integrity-alert-header">
                      <div>
                        <p className="eyebrow">Finance integrity alert</p>
                        <h4>{formatFinanceAlertCategory(alert.category)}</h4>
                      </div>
                      <div className="chip-row">
                        <span className={`status-badge status-${getClassToken(alert.severity)}`}>{alert.severity}</span>
                        <span className={`status-badge status-${getClassToken(alert.status)}`}>{alert.status}</span>
                      </div>
                    </div>
                    <p>{alert.reason}</p>
                    <div className="finance-integrity-alert-meta">
                      <span>Detected {formatDate(alert.detectedAt)}</span>
                      {alert.vendorAllocationId ? <span>Allocation {alert.vendorAllocationId}</span> : null}
                      {alert.allocationEconomicTransferId ? (
                        <span>Economic transfer {alert.allocationEconomicTransferId}</span>
                      ) : null}
                    </div>
                    {canAcknowledge || canRescan || canResolve ? (
                      <div className="support-modal-actions finance-integrity-alert-actions">
                        {canAcknowledge ? (
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            onClick={() => {
                              setAcknowledgeAction({ allocation, alert });
                              setAcknowledgmentNote('');
                            }}
                          >
                            Acknowledge
                          </button>
                        ) : null}
                        {canRescan ? (
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            disabled={rescanAlertMutation.isPending}
                            onClick={() => void handleRescanAlert(alert)}
                          >
                            {rescanAlertMutation.isPending ? 'Rescanning...' : 'Rescan'}
                          </button>
                        ) : null}
                        {canResolve ? (
                          <button
                            type="button"
                            className="button button-primary button-compact"
                            disabled={resolveAlertMutation.isPending}
                            onClick={() => {
                              setResolveAction({ allocation, alert });
                              setAlertResolutionNote('');
                            }}
                          >
                            Resolve
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {rescanSummary ? <ActionFeedback tone={rescanSummary.tone} message={rescanSummary.message} /> : null}
                  </article>
                );
              })}
            </section>
          ) : null}

          <div className="allocation-summary-grid">
            <div className="summary-row">
              <span>Original vendor</span>
              <strong>{allocation.originalVendorId}</strong>
            </div>
            <div className="summary-row">
              <span>Assigned vendor</span>
              <strong>{allocation.assignedVendorId}</strong>
            </div>
            <div className="summary-row">
              <span>Allocation order</span>
              <strong>{allocation.allocationOrderId}</strong>
            </div>
            <div className="summary-row">
              <span>Total</span>
              <strong>{allocation.allocationTotal}</strong>
            </div>
            <div className="summary-row">
              <span>Refund impact</span>
              <strong>{allocation.refundTotal}</strong>
            </div>
            <div className="summary-row">
              <span>Fulfillment</span>
              <strong>{allocation.fulfillmentStatus}</strong>
            </div>
          </div>

          <section className="compact-meta-grid">
            <div className="meta-item">
              <span>Cancellation reason</span>
              <strong className={allocation.cancellationReason ? '' : 'muted'}>{allocation.cancellationReason ?? 'None'}</strong>
            </div>
            <div className="meta-item">
              <span>Reassignment required</span>
              <strong>{allocation.reassignmentRequired ? 'Yes' : 'No'}</strong>
            </div>
            <div className="meta-item">
              <span>Assignment blocked</span>
              <strong className={allocation.assignmentBlockedAt ? '' : 'muted'}>
                {allocation.assignmentBlockedAt ? formatDate(allocation.assignmentBlockedAt) : 'Not blocked'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Reassigned by</span>
              <strong className={allocation.reassignedBy ? '' : 'muted'}>{allocation.reassignedBy ?? 'Not reassigned'}</strong>
            </div>
            <div className="meta-item">
              <span>Carrier</span>
              <strong className={allocation.carrier ? '' : 'muted'}>{allocation.carrier ?? 'Not assigned'}</strong>
            </div>
            <div className="meta-item">
              <span>Tracking</span>
              <strong className={allocation.trackingNumber ? '' : 'muted'}>
                {allocation.trackingNumber ?? 'Not assigned'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Tracking URL</span>
              {allocation.trackingUrl ? (
                <a className="inline-link" href={allocation.trackingUrl} target="_blank" rel="noreferrer">
                  Open tracking
                </a>
              ) : (
                <strong className="muted">Not synced</strong>
              )}
            </div>
            <div className="meta-item">
              <span>Fulfilled at</span>
              <strong className={allocation.fulfilledAt ? '' : 'muted'}>
                {allocation.fulfilledAt ? formatDate(allocation.fulfilledAt) : 'Not fulfilled'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Shipment created</span>
              <strong className={allocation.shipmentCreatedAt ? '' : 'muted'}>
                {allocation.shipmentCreatedAt ? formatDate(allocation.shipmentCreatedAt) : 'Not created'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Shipment updated</span>
              <strong className={allocation.shipmentUpdatedAt ? '' : 'muted'}>
                {allocation.shipmentUpdatedAt ? formatDate(allocation.shipmentUpdatedAt) : 'Not updated'}
              </strong>
            </div>
          </section>

          {allocation.transferSummary ? (
            <>
              <section className="economic-transfer-summary-card" aria-label="Economic transfer summary">
                <div className="economic-transfer-summary-header">
                  <div>
                    <p className="eyebrow">Economic transfer</p>
                    <h3>Economics transferred</h3>
                  </div>
                  <span className={`status-badge status-${getClassToken(allocation.transferSummary.status)}`}>
                    {formatTransferStatus(allocation.transferSummary.status)}
                  </span>
                </div>
                <p className="economic-transfer-route">
                  <strong>{allocation.transferSummary.fromVendorId}</strong>
                  <span aria-hidden="true">→</span>
                  <strong>{allocation.transferSummary.toVendorId}</strong>
                </p>
                <div className="compact-meta-grid">
                  <div className="meta-item">
                    <span>Reason</span>
                    <strong>{allocation.transferSummary.reason ?? 'No reason recorded'}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Completed</span>
                    <strong>
                      {allocation.transferSummary.completedAt
                        ? formatDate(allocation.transferSummary.completedAt)
                        : 'Completion date unavailable'}
                    </strong>
                  </div>
                  <div className="meta-item">
                    <span>Admin</span>
                    <strong>{allocation.transferSummary.adminActorUserId ?? 'Not recorded'}</strong>
                  </div>
                </div>
              </section>
              <TransferDiagnosticsCard transferId={allocation.transferSummary.id} />
            </>
          ) : null}

          {allocation.cancelRefundReview ? (
            <section className="economic-transfer-summary-card" aria-label="Cancel refund review summary">
              <div className="economic-transfer-summary-header">
                <div>
                  <p className="eyebrow">Cancel / refund review</p>
                  <h3>
                    {allocation.cancelRefundReview.status === 'PENDING_REVIEW'
                      ? 'Cancel / Refund Review Pending'
                      : formatCancelRefundReviewStatus(allocation.cancelRefundReview.status)}
                  </h3>
                </div>
                <span className={`status-badge status-${getClassToken(allocation.cancelRefundReview.status)}`}>
                  {formatCancelRefundReviewStatus(allocation.cancelRefundReview.status)}
                </span>
              </div>
              <p className="page-description">
                This is a local admin review hold. It does not mean the Shopify order was cancelled or refunded.
              </p>
              <div className="compact-meta-grid">
                <div className="meta-item">
                  <span>Reason</span>
                  <strong>{allocation.cancelRefundReview.reason ?? 'Not recorded'}</strong>
                </div>
                <div className="meta-item">
                  <span>Note</span>
                  <strong>{allocation.cancelRefundReview.note ?? 'No note recorded'}</strong>
                </div>
                <div className="meta-item">
                  <span>Requested</span>
                  <strong>
                    {allocation.cancelRefundReview.requestedAt
                      ? formatDate(allocation.cancelRefundReview.requestedAt)
                      : 'Not recorded'}
                  </strong>
                </div>
                <div className="meta-item">
                  <span>Admin</span>
                  <strong>{allocation.cancelRefundReview.requestedByUserId ?? 'Not recorded'}</strong>
                </div>
              </div>
              {allocation.outboundRefundAttemptSummary ? (
                <section className="shopify-refund-preview-card" aria-label="Outbound Shopify refund attempt summary">
                  <div className="economic-transfer-summary-header">
                    <div>
                      <p className="eyebrow">Outbound refund attempt</p>
                      <h4>{formatTransferStatus(allocation.outboundRefundAttemptSummary.status)}</h4>
                    </div>
                    <span className={`status-badge status-${getClassToken(allocation.outboundRefundAttemptSummary.status)}`}>
                      {formatTransferStatus(allocation.outboundRefundAttemptSummary.status)}
                    </span>
                  </div>
                  <div className="compact-meta-grid">
                    <div className="meta-item">
                      <span>Previewed</span>
                      <strong>
                        {allocation.outboundRefundAttemptSummary.previewedAt
                          ? formatDate(allocation.outboundRefundAttemptSummary.previewedAt)
                          : 'Not recorded'}
                      </strong>
                    </div>
                    <div className="meta-item">
                      <span>Submitted</span>
                      <strong>
                        {allocation.outboundRefundAttemptSummary.submittedAt
                          ? formatDate(allocation.outboundRefundAttemptSummary.submittedAt)
                          : 'Not submitted'}
                      </strong>
                    </div>
                    <div className="meta-item">
                      <span>Resolved</span>
                      <strong>
                        {allocation.outboundRefundAttemptSummary.resolvedAt
                          ? formatDate(allocation.outboundRefundAttemptSummary.resolvedAt)
                          : 'Not resolved'}
                      </strong>
                    </div>
                    <div className="meta-item">
                      <span>Failed</span>
                      <strong>
                        {allocation.outboundRefundAttemptSummary.failedAt
                          ? formatDate(allocation.outboundRefundAttemptSummary.failedAt)
                          : 'No failure recorded'}
                      </strong>
                    </div>
                    <div className="meta-item">
                      <span>Failure reason</span>
                      <strong>{allocation.outboundRefundAttemptSummary.failureReason ?? 'None'}</strong>
                    </div>
                  </div>
                </section>
              ) : null}
              <div className="support-modal-actions refund-preview-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={shopifyRefundPreviewMutation.isPending || outboundRefundPending}
                  onClick={() => void handleShopifyRefundPreview(allocation)}
                >
                  {outboundRefundPending
                    ? 'Refund pending'
                    : shopifyRefundPreviewMutation.isPending
                      ? 'Previewing...'
                      : 'Preview Shopify refund'}
                </button>
                {showShopifyRefundExecutionAction ? (
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={shopifyRefundExecutionMutation.isPending}
                    onClick={() => {
                      if (!shopifyRefundPreview) {
                        return;
                      }
                      setShopifyRefundAction({
                        allocation,
                        preview: shopifyRefundPreview,
                      });
                      setShopifyRefundNote('');
                      setShopifyRefundNotifyCustomer(false);
                      setShopifyRefundPaymentConfirmed(false);
                      setShopifyRefundWebhookConfirmed(false);
                    }}
                  >
                    Refund in Shopify
                  </button>
                ) : null}
              </div>
              {shopifyRefundPreview ? (
                <section className="shopify-refund-preview-card" aria-label="Shopify suggested refund preview">
                  <div className="economic-transfer-summary-header">
                    <div>
                      <p className="eyebrow">Shopify suggested refund</p>
                      <h4>Preview only</h4>
                    </div>
                    <span className="status-badge status-info">No writes</span>
                  </div>
                  <div className="compact-meta-grid">
                    <div className="meta-item">
                      <span>Total refund</span>
                      <strong>
                        {formatPreviewMoney(
                          shopifyRefundPreview.suggestedRefund?.totalRefundAmount,
                          shopifyRefundPreview.suggestedRefund?.currencyCode,
                        )}
                      </strong>
                    </div>
                    <div className="meta-item">
                      <span>Tax</span>
                      <strong>
                        {formatPreviewMoney(
                          shopifyRefundPreview.suggestedRefund?.totalTaxAmount,
                          shopifyRefundPreview.suggestedRefund?.currencyCode,
                        )}
                      </strong>
                    </div>
                    <div className="meta-item">
                      <span>Shipping refund</span>
                      <strong>
                        {formatPreviewMoney(
                          shopifyRefundPreview.suggestedRefund?.shippingAmount,
                          shopifyRefundPreview.suggestedRefund?.currencyCode,
                        )}
                      </strong>
                    </div>
                    <div className="meta-item">
                      <span>Suggested transactions</span>
                      <strong>{shopifyRefundPreview.suggestedRefund?.suggestedTransactions.length ?? 0}</strong>
                    </div>
                  </div>
                  <p className="page-description">
                    Shopify remains canonical for actual refund creation. This preview did not create local refund, finance, or review-state records.
                  </p>
                  {shopifyRefundPreview.blockers.length ? (
                    <div className="refund-preview-message refund-preview-message-blocker">
                      <strong>Blockers</strong>
                      <ul>
                        {shopifyRefundPreview.blockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {shopifyRefundPreview.warnings.length ? (
                    <div className="refund-preview-message refund-preview-message-warning">
                      <strong>Warnings</strong>
                      <ul>
                        {shopifyRefundPreview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </section>
          ) : null}

          {allocation.allocationStatus === 'vendor_blocked' ? (
            <section className="action-row">
              <p className="page-description">
                Admin resolution is required. Return keeps the same vendor and does not reassign, refund, mutate Shopify, or change finance.
              </p>
              <div className="detail-actions">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => {
                    setResolutionAction({ type: 'return_to_vendor', allocation });
                    setResolutionNote('');
                  }}
                >
                  Return to vendor
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setResolutionAction({ type: 'add_note', allocation });
                    setResolutionNote('');
                  }}
                >
                  Add note
                </button>
                {showEconomicTransferAction ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={replacementVendorOptions.length === 0}
                    title={replacementVendorOptions.length === 0 ? 'No replacement vendors are available from the admin vendor directory.' : undefined}
                    onClick={() => {
                      setTransferAction({ allocation });
                      setReplacementVendorId(replacementVendorOptions[0]?.vendorId ?? '');
                      setEconomicTransferReason('');
                      setReplacementFulfillmentConfirmed(false);
                      setOriginalPriceConfirmed(false);
                    }}
                  >
                    Transfer economics
                  </button>
                ) : null}
                {showCancelRefundReviewAction ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      setCancelRefundReviewAction({ allocation });
                      setCancelRefundReviewReason('OUT_OF_STOCK');
                      setCancelRefundReviewNote('');
                      setCancelRefundReviewConfirmed(false);
                    }}
                  >
                    Cancel / Refund Review
                  </button>
                ) : null}
              </div>
            </section>
          ) : allocation.reassignmentRequired ? (
            <section className="action-row">
              <p className="page-description">
                Manual reassignment is not implemented in this phase. Review the allocation state before taking external action.
              </p>
            </section>
          ) : null}

          <h3 className="section-header">Allocated line items</h3>
          <div className="line-item-table">
            <div className="line-item-head">
              <span>SKU</span>
              <span>Variant</span>
              <span>Item</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Fulfillment</span>
            </div>
            {allocation.lineItems.map((item) => (
              <div key={item.id} className="line-item-row">
                <span>{item.sku}</span>
                <span>{item.variantTitle}</span>
                <span>{item.name}</span>
                <span>{item.quantity}</span>
                <span>{item.price}</span>
                <span className="order-state-stack">
                  <span className={`status-badge status-${getClassToken(item.fulfillmentStatus)}`}>
                    {item.fulfillmentStatus}
                  </span>
                  <span className={`status-badge status-${getClassToken(item.shippingStatus)}`}>
                    {item.shippingStatus}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <h3 className="section-header">Allocated refunded items</h3>
          {allocation.refundedItems.length === 0 ? (
            <p className="page-description">No refunded items in this vendor allocation.</p>
          ) : (
            <div className="line-item-table">
              <div className="line-item-head">
                <span>SKU</span>
                <span>Variant</span>
                <span>Item</span>
                <span>Quantity</span>
                <span>Refund</span>
                <span>Condition</span>
              </div>
              {allocation.refundedItems.map((item) => (
                <div key={item.id} className="line-item-row">
                  <span>{item.sku}</span>
                  <span>{item.variantTitle}</span>
                  <span>{item.name}</span>
                  <span>{item.quantity}</span>
                  <span>{item.refundAmount}</span>
                  <span>{item.condition}</span>
                </div>
              ))}
            </div>
          )}

          <h3 className="section-header">Assignment timeline</h3>
          <div className="timeline-block">
            {allocation.assignmentHistory.map((entry, index) => (
              <div key={`${allocation.vendorId}-${entry.action}-${entry.createdAt}-${index}`} className="timeline-event">
                <div className="timeline-dot" aria-hidden="true" />
                <div>
                  <p className="timeline-title">
                    {entry.action.replace(/_/g, ' ')} · {entry.toVendorId}
                  </p>
                  <p className="timeline-meta">
                    {entry.fromVendorId ? `From ${entry.fromVendorId} · ` : ''}
                    {entry.reason ?? 'No reason provided'} · {entry.actorName} ({entry.actorRole}) ·{' '}
                    {formatDate(entry.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>
        );
      })}

      <article className="panel">
        {message ? <ActionFeedback tone={tone} message={message} /> : null}
        <Link className="button button-secondary" to="/orders">
          Back to vendor orders
        </Link>
      </article>

      {resolutionAction ? (
        <div className="support-modal-backdrop" role="presentation">
          <section
            className="support-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-allocation-resolution-title"
          >
            <div className="support-modal-header">
              <div>
                <h2 id="admin-allocation-resolution-title">
                  {resolutionAction.type === 'return_to_vendor' ? 'Return to vendor' : 'Add admin note'}
                </h2>
                <p>
                  {resolutionAction.allocation.vendorName} · {resolutionAction.allocation.allocationOrderId}
                </p>
              </div>
              <button
                type="button"
                className="support-modal-close"
                onClick={() => {
                  if (!isResolutionPending) {
                    setResolutionAction(null);
                    setResolutionNote('');
                  }
                }}
                aria-label="Close allocation resolution form"
              >
                ×
              </button>
            </div>
            <form className="support-ticket-form" onSubmit={handleResolutionSubmit}>
              <p className="support-context-note">
                {resolutionAction.type === 'return_to_vendor'
                  ? 'This restores the allocation to the same vendor and allows fulfillment again. It does not reassign, refund, or change finance.'
                  : 'This only adds an admin note. The allocation remains blocked.'}
              </p>
              <label>
                Admin note
                <textarea
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  maxLength={500}
                  rows={5}
                  required
                  placeholder={
                    resolutionAction.type === 'return_to_vendor'
                      ? 'Explain why this allocation can return to the vendor.'
                      : 'Add operational context for the blocked allocation.'
                  }
                />
              </label>
              <div className="support-modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setResolutionAction(null);
                    setResolutionNote('');
                  }}
                  disabled={isResolutionPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={resolutionAction.type === 'return_to_vendor' ? 'button button-primary' : 'button button-secondary'}
                  disabled={isResolutionPending}
                >
                  {isResolutionPending
                    ? 'Saving...'
                    : resolutionAction.type === 'return_to_vendor'
                      ? 'Return to vendor'
                      : 'Add note'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {transferAction ? (() => {
        const replacementVendorOptions = (appReadiness.currentUser?.vendorDetails ?? []).filter(
          (vendor) => vendor.vendorId !== transferAction.allocation.assignedVendorId,
        );
        const reason = economicTransferReason.trim();
        const transferReady = Boolean(
          replacementVendorId &&
            reason &&
            reason.length <= 500 &&
            replacementFulfillmentConfirmed &&
            originalPriceConfirmed &&
            !transferEconomicsMutation.isPending,
        );

        return (
          <div className="support-modal-backdrop" role="presentation">
            <section
              className="support-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-economic-transfer-title"
            >
              <div className="support-modal-header">
                <div>
                  <h2 id="admin-economic-transfer-title">Transfer economics</h2>
                  <p>
                    {transferAction.allocation.vendorName} · {transferAction.allocation.allocationOrderId}
                  </p>
                </div>
                <button
                  type="button"
                  className="support-modal-close"
                  onClick={() => {
                    if (!transferEconomicsMutation.isPending) {
                      setTransferAction(null);
                      setReplacementVendorId('');
                      setEconomicTransferReason('');
                      setReplacementFulfillmentConfirmed(false);
                      setOriginalPriceConfirmed(false);
                    }
                  }}
                  aria-label="Close economic transfer form"
                >
                  ×
                </button>
              </div>
              <form className="support-ticket-form" onSubmit={handleEconomicTransferSubmit}>
                <p className="support-context-note">
                  This transfers fulfillment and economics to a replacement vendor while keeping the original customer-paid price.
                </p>
                <p className="support-context-note economic-transfer-warning">
                  If the replacement vendor requires a higher price or customer approval is needed, do not transfer. Cancel/refund or contact the customer first.
                </p>
                <label>
                  Replacement vendor
                  <select
                    value={replacementVendorId}
                    onChange={(event) => setReplacementVendorId(event.target.value)}
                    required
                    disabled={replacementVendorOptions.length === 0 || transferEconomicsMutation.isPending}
                  >
                    <option value="">Select replacement vendor</option>
                    {replacementVendorOptions.map((vendor) => (
                      <option key={vendor.vendorId} value={vendor.vendorId}>
                        {vendor.vendorName}
                      </option>
                    ))}
                  </select>
                </label>
                {replacementVendorOptions.length === 0 ? (
                  <p className="support-context-note">
                    No replacement vendors are available from the current admin vendor directory.
                  </p>
                ) : null}
                <label>
                  Reason
                  <textarea
                    value={economicTransferReason}
                    onChange={(event) => setEconomicTransferReason(event.target.value)}
                    maxLength={500}
                    rows={5}
                    required
                    placeholder="Explain why economics are moving to the replacement vendor."
                    disabled={transferEconomicsMutation.isPending}
                  />
                </label>
                <label className="checkbox-field economic-transfer-confirmation">
                  <input
                    type="checkbox"
                    checked={replacementFulfillmentConfirmed}
                    onChange={(event) => setReplacementFulfillmentConfirmed(event.target.checked)}
                    disabled={transferEconomicsMutation.isPending}
                  />
                  <span>Replacement vendor confirmed it can fulfill this order.</span>
                </label>
                <label className="checkbox-field economic-transfer-confirmation">
                  <input
                    type="checkbox"
                    checked={originalPriceConfirmed}
                    onChange={(event) => setOriginalPriceConfirmed(event.target.checked)}
                    disabled={transferEconomicsMutation.isPending}
                  />
                  <span>I understand this transfer keeps the original customer-paid price and does not charge the customer more.</span>
                </label>
                <div className="support-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setTransferAction(null);
                      setReplacementVendorId('');
                      setEconomicTransferReason('');
                      setReplacementFulfillmentConfirmed(false);
                      setOriginalPriceConfirmed(false);
                    }}
                    disabled={transferEconomicsMutation.isPending}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary" disabled={!transferReady}>
                    {transferEconomicsMutation.isPending ? 'Transferring...' : 'Transfer economics'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        );
      })() : null}

      {cancelRefundReviewAction ? (() => {
        const note = cancelRefundReviewNote.trim();
        const reviewReady = Boolean(
          cancelRefundReviewReason &&
            note &&
            note.length <= 1000 &&
            cancelRefundReviewConfirmed &&
            !cancelRefundReviewMutation.isPending,
        );

        return (
          <div className="support-modal-backdrop" role="presentation">
            <section
              className="support-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-cancel-refund-review-title"
            >
              <div className="support-modal-header">
                <div>
                  <h2 id="admin-cancel-refund-review-title">Cancel / Refund Review</h2>
                  <p>
                    {cancelRefundReviewAction.allocation.vendorName} · {cancelRefundReviewAction.allocation.allocationOrderId}
                  </p>
                </div>
                <button
                  type="button"
                  className="support-modal-close"
                  onClick={() => {
                    if (!cancelRefundReviewMutation.isPending) {
                      setCancelRefundReviewAction(null);
                      setCancelRefundReviewReason('');
                      setCancelRefundReviewNote('');
                      setCancelRefundReviewConfirmed(false);
                    }
                  }}
                  aria-label="Close cancel refund review form"
                >
                  ×
                </button>
              </div>
              <form className="support-ticket-form" onSubmit={handleCancelRefundReviewSubmit}>
                <p className="support-context-note economic-transfer-warning">
                  This only places the allocation under admin cancel/refund review and blocks finance movement. Shopify refund/cancel must be handled separately after confirmation.
                </p>
                <label>
                  Reason
                  <select
                    value={cancelRefundReviewReason}
                    onChange={(event) => setCancelRefundReviewReason(event.target.value)}
                    required
                    disabled={cancelRefundReviewMutation.isPending}
                  >
                    {CANCEL_REFUND_REVIEW_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Review note
                  <textarea
                    value={cancelRefundReviewNote}
                    onChange={(event) => setCancelRefundReviewNote(event.target.value)}
                    maxLength={1000}
                    rows={5}
                    required
                    placeholder="Explain why transfer is not being used and what customer follow-up is planned."
                    disabled={cancelRefundReviewMutation.isPending}
                  />
                </label>
                <label className="checkbox-field economic-transfer-confirmation">
                  <input
                    type="checkbox"
                    checked={cancelRefundReviewConfirmed}
                    onChange={(event) => setCancelRefundReviewConfirmed(event.target.checked)}
                    disabled={cancelRefundReviewMutation.isPending}
                  />
                  <span>I understand this does not refund the customer or cancel the Shopify order.</span>
                </label>
                <div className="support-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setCancelRefundReviewAction(null);
                      setCancelRefundReviewReason('');
                      setCancelRefundReviewNote('');
                      setCancelRefundReviewConfirmed(false);
                    }}
                    disabled={cancelRefundReviewMutation.isPending}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary" disabled={!reviewReady}>
                    {cancelRefundReviewMutation.isPending ? 'Saving review...' : 'Start review'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        );
      })() : null}

      {shopifyRefundAction ? (() => {
        const note = shopifyRefundNote.trim();
        const preview = shopifyRefundAction.preview;
        const transactions = preview.suggestedRefund?.suggestedTransactions ?? [];
        const refundReady = Boolean(
          note &&
            note.length <= 1000 &&
            shopifyRefundPaymentConfirmed &&
            shopifyRefundWebhookConfirmed &&
            canShowShopifyRefundExecutionAction(shopifyRefundAction.allocation, preview) &&
            !shopifyRefundExecutionMutation.isPending,
        );

        return (
          <div className="support-modal-backdrop" role="presentation">
            <section
              className="support-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-shopify-refund-execution-title"
            >
              <div className="support-modal-header">
                <div>
                  <h2 id="admin-shopify-refund-execution-title">Refund in Shopify</h2>
                  <p>
                    {shopifyRefundAction.allocation.vendorName} · {shopifyRefundAction.allocation.allocationOrderId}
                  </p>
                </div>
                <button
                  type="button"
                  className="support-modal-close"
                  onClick={() => {
                    if (!shopifyRefundExecutionMutation.isPending) {
                      setShopifyRefundAction(null);
                      setShopifyRefundNote('');
                      setShopifyRefundNotifyCustomer(false);
                      setShopifyRefundPaymentConfirmed(false);
                      setShopifyRefundWebhookConfirmed(false);
                    }
                  }}
                  aria-label="Close Shopify refund form"
                >
                  ×
                </button>
              </div>
              <form className="support-ticket-form" onSubmit={handleShopifyRefundExecutionSubmit}>
                <p className="support-context-note economic-transfer-warning">
                  This action will call Shopify refundCreate and may cancel affected Shopify fulfillment orders first. It triggers a real payment refund in Shopify. Sporgym finance records are not created immediately; finance updates only after the Shopify refunds/create webhook is received and processed. Do not proceed unless the customer has approved the refund or policy allows it.
                </p>

                <section className="shopify-refund-preview-card" aria-label="Shopify refund execution summary">
                  <div className="economic-transfer-summary-header">
                    <div>
                      <p className="eyebrow">Execution summary</p>
                      <h4>
                        {formatPreviewMoney(
                          preview.suggestedRefund?.totalRefundAmount,
                          preview.suggestedRefund?.currencyCode,
                        )}
                      </h4>
                    </div>
                    <span className={`status-badge status-${getClassToken(preview.fulfillmentOrderCancellation.overallClassification)}`}>
                      {formatTransferStatus(preview.fulfillmentOrderCancellation.overallClassification)}
                    </span>
                  </div>
                  <div className="compact-meta-grid">
                    <div className="meta-item">
                      <span>Suggested transactions</span>
                      <strong>{transactions.length}</strong>
                    </div>
                    <div className="meta-item">
                      <span>Fulfillment orders</span>
                      <strong>{preview.fulfillmentOrderCancellation.affectedFulfillmentOrders.length}</strong>
                    </div>
                    <div className="meta-item">
                      <span>Shipping refund</span>
                      <strong>No</strong>
                    </div>
                    <div className="meta-item">
                      <span>Restock type</span>
                      <strong>{preview.refundLineItemsPreview[0]?.restockType ?? 'CANCEL'}</strong>
                    </div>
                  </div>
                  <div className="refund-preview-message">
                    <strong>Line items</strong>
                    <ul>
                      {preview.refundLineItemsPreview.map((lineItem) => (
                        <li key={`${lineItem.lineItemId}-${lineItem.quantity}`}>
                          {lineItem.lineItemId} · Quantity {lineItem.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {preview.warnings.length || preview.fulfillmentOrderCancellation.warnings.length ? (
                    <div className="refund-preview-message refund-preview-message-warning">
                      <strong>Warnings</strong>
                      <ul>
                        {[...preview.warnings, ...preview.fulfillmentOrderCancellation.warnings].map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <label>
                  Refund note
                  <textarea
                    value={shopifyRefundNote}
                    onChange={(event) => setShopifyRefundNote(event.target.value)}
                    maxLength={1000}
                    rows={5}
                    required
                    placeholder="Record the customer approval or policy reason for the Shopify refund."
                    disabled={shopifyRefundExecutionMutation.isPending}
                  />
                </label>
                <label className="checkbox-field economic-transfer-confirmation">
                  <input
                    type="checkbox"
                    checked={shopifyRefundNotifyCustomer}
                    onChange={(event) => setShopifyRefundNotifyCustomer(event.target.checked)}
                    disabled={shopifyRefundExecutionMutation.isPending}
                  />
                  <span>Notify customer through Shopify.</span>
                </label>
                <label className="checkbox-field economic-transfer-confirmation">
                  <input
                    type="checkbox"
                    checked={shopifyRefundPaymentConfirmed}
                    onChange={(event) => setShopifyRefundPaymentConfirmed(event.target.checked)}
                    disabled={shopifyRefundExecutionMutation.isPending}
                  />
                  <span>I understand this will trigger a real Shopify payment refund.</span>
                </label>
                <label className="checkbox-field economic-transfer-confirmation">
                  <input
                    type="checkbox"
                    checked={shopifyRefundWebhookConfirmed}
                    onChange={(event) => setShopifyRefundWebhookConfirmed(event.target.checked)}
                    disabled={shopifyRefundExecutionMutation.isPending}
                  />
                  <span>I understand Sporgym finance updates only after the refunds/create webhook.</span>
                </label>
                <div className="support-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setShopifyRefundAction(null);
                      setShopifyRefundNote('');
                      setShopifyRefundNotifyCustomer(false);
                      setShopifyRefundPaymentConfirmed(false);
                      setShopifyRefundWebhookConfirmed(false);
                    }}
                    disabled={shopifyRefundExecutionMutation.isPending}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary" disabled={!refundReady}>
                    {shopifyRefundExecutionMutation.isPending ? 'Submitting refund...' : 'Refund in Shopify'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        );
      })() : null}

      {acknowledgeAction ? (
        <div className="support-modal-backdrop" role="presentation">
          <section
            className="support-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finance-integrity-acknowledge-title"
          >
            <div className="support-modal-header">
              <div>
                <h2 id="finance-integrity-acknowledge-title">Acknowledge finance alert</h2>
                <p>
                  {acknowledgeAction.allocation.vendorName} · {formatFinanceAlertCategory(acknowledgeAction.alert.category)}
                </p>
              </div>
              <button
                type="button"
                className="support-modal-close"
                onClick={() => {
                  if (!acknowledgeAlertMutation.isPending) {
                    setAcknowledgeAction(null);
                    setAcknowledgmentNote('');
                  }
                }}
                aria-label="Close finance alert acknowledgment form"
              >
                ×
              </button>
            </div>
            <form className="support-ticket-form" onSubmit={handleAcknowledgeSubmit}>
              <p className="support-context-note">
                Acknowledging records that finance has reviewed this alert. It does not unblock settlement, payout, or refund movement.
              </p>
              <label>
                Acknowledgment note
                <textarea
                  value={acknowledgmentNote}
                  onChange={(event) => setAcknowledgmentNote(event.target.value)}
                  maxLength={500}
                  rows={5}
                  required
                  placeholder="Record who reviewed this alert and what follow-up is planned."
                />
              </label>
              <div className="support-modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setAcknowledgeAction(null);
                    setAcknowledgmentNote('');
                  }}
                  disabled={acknowledgeAlertMutation.isPending}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={acknowledgeAlertMutation.isPending}>
                  {acknowledgeAlertMutation.isPending ? 'Acknowledging...' : 'Acknowledge'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {resolveAction ? (
        <div className="support-modal-backdrop" role="presentation">
          <section
            className="support-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finance-integrity-resolve-title"
          >
            <div className="support-modal-header">
              <div>
                <h2 id="finance-integrity-resolve-title">Resolve finance alert</h2>
                <p>
                  {resolveAction.allocation.vendorName} · {formatFinanceAlertCategory(resolveAction.alert.category)}
                </p>
              </div>
              <button
                type="button"
                className="support-modal-close"
                onClick={() => {
                  if (!resolveAlertMutation.isPending) {
                    setResolveAction(null);
                    setAlertResolutionNote('');
                  }
                }}
                aria-label="Close finance alert resolution form"
              >
                ×
              </button>
            </div>
            <form className="support-ticket-form" onSubmit={handleResolveSubmit}>
              <p className="support-context-note">
                This action will re-run finance integrity validation. The alert can only be resolved if the issue is no longer detected.
              </p>
              <label>
                Resolution note
                <textarea
                  value={alertResolutionNote}
                  onChange={(event) => setAlertResolutionNote(event.target.value)}
                  maxLength={500}
                  rows={5}
                  required
                  placeholder="Record the evidence reviewed before resolving this alert."
                />
              </label>
              <div className="support-modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setResolveAction(null);
                    setAlertResolutionNote('');
                  }}
                  disabled={resolveAlertMutation.isPending}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={resolveAlertMutation.isPending}>
                  {resolveAlertMutation.isPending ? 'Validating...' : 'Resolve alert'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
