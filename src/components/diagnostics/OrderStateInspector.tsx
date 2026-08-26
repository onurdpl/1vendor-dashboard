import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ActionFeedback } from '../ActionFeedback';
import { useMutationAction } from '../../hooks/useMutationAction';
import { useQueryResource } from '../../hooks/useQueryResource';
import { queryKeys } from '../../lib/api/queryKeys';
import { runtimeServices } from '../../services/runtime-services';
import { formatDateTime, toTitleCaseLabel } from '../../services/real/formatting';
import type { CurrentStateOrderRepairResult, OrderStateInspectorDiagnostic } from '../../services/real/diagnostics';
import { DiagnosticsActionPanel, DiagnosticsEmptyState, DiagnosticsTechnicalDetails } from './DiagnosticsPresentation';
import {
  EmptyStatePanel,
  MetadataGroup,
  MetadataRow,
  OperationalSection,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../OperationalPrimitives';

function formatDate(value: string | null | undefined) {
  return value ? formatDateTime(value, undefined, 'Not recorded') : 'Not recorded';
}

function yesNo(value: boolean) {
  return value ? 'Yes' : 'No';
}

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention' | 'stale';

type Projection = OrderStateInspectorDiagnostic['projectionExplanation']['orderStatus'];
type Ledger = OrderStateInspectorDiagnostic['financeState']['ledgers'][number];
type Signal = OrderStateInspectorDiagnostic['operationalSignals'][number];

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function conflictTone(hasConflict: boolean): StatusTone {
  return hasConflict ? 'danger' : 'success';
}

function financeTone(financeReviewRequired: boolean): StatusTone {
  return financeReviewRequired ? 'warning' : 'success';
}

function currentSignal(signal: Signal) {
  const status = signal.status.trim().toLowerCase();
  return !signal.resolvedAt && !['resolved', 'closed', 'completed'].includes(status);
}

function SummaryCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: StatusTone;
}) {
  return (
    <article className={`order-state-overview-card op-tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function ProjectionCard({ title, projection }: { title: string; projection: Projection }) {
  const [primaryReason, ...supportingReasons] = projection.reasons;

  return (
    <article className="order-state-record order-state-projection-card">
      <small>{title}</small>
      <strong>{projection.label}</strong>
      <p>{primaryReason ?? 'No deterministic reason recorded.'}</p>
      {supportingReasons.length ? (
        <DiagnosticsTechnicalDetails label="Preserved supporting evidence">
          <EvidenceList items={supportingReasons} />
        </DiagnosticsTechnicalDetails>
      ) : null}
    </article>
  );
}

function LedgerCard({ ledger }: { ledger: Ledger }) {
  return (
    <article className="order-state-record order-state-ledger-card">
      <div className="order-state-record-heading">
        <strong>{toTitleCaseLabel(ledger.entryType)}</strong>
        <StatusBadge status={ledger.settlementStatus}>{ledger.settlementStatus}</StatusBadge>
      </div>
      <div className="order-state-ledger-safety-grid">
        <MetadataRow label="Payout" value={ledger.payoutStatus} />
        <MetadataRow label="Settlement" value={ledger.settlementStatus} />
        <MetadataRow label="Voided" value={ledger.voidedAt ? 'Yes' : 'No'} />
        <MetadataRow label="Approved settlement" value={yesNo(ledger.approvedSettlementPresent)} />
        <MetadataRow label="Payout batch" value={yesNo(ledger.payoutBatchPresent)} />
        <MetadataRow label="Paid evidence" value={yesNo(ledger.paidEvidencePresent)} />
      </div>
      <DiagnosticsTechnicalDetails label="Ledger technical evidence">
        <MetadataGroup>
          <MetadataRow label="Ledger ID" value={<code className="diagnostics-id-block">{ledger.id}</code>} />
          <MetadataRow label="Allocation ID" value={ledger.allocationId ? <code className="diagnostics-id-block">{ledger.allocationId}</code> : 'Not recorded'} />
          <MetadataRow label="Vendor ID" value={ledger.vendorId} />
          <MetadataRow label="Voided at" value={formatDate(ledger.voidedAt)} />
          <MetadataRow label="Void reason" value={ledger.voidReason ?? 'None'} />
          <MetadataRow label="Created" value={formatDate(ledger.createdAt)} />
          <MetadataRow label="Updated" value={formatDate(ledger.updatedAt)} />
        </MetadataGroup>
      </DiagnosticsTechnicalDetails>
    </article>
  );
}

function EvidenceList({ items }: { items: string[] }) {
  if (!items.length) {
    return <span className="muted">No evidence recorded.</span>;
  }

  return (
    <ul className="order-state-inspector-reasons">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

type OrderStateInspectorProps = {
  onRepairCandidateChange?: (isCandidate: boolean) => void;
  initialOrderIdentifier?: string;
};

type RepairFeedback = {
  message: string;
  tone: 'success' | 'error' | 'info';
};

function plannedAction(value: 'Created' | 'Existing') {
  return value === 'Created' ? 'CREATE' : 'REUSE';
}

function currentRecordState(value: 'Created' | 'Existing') {
  return value === 'Created' ? 'Missing' : 'Existing';
}

function normalizeRepairOrderNumber(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export function OrderStateInspector({ onRepairCandidateChange, initialOrderIdentifier }: OrderStateInspectorProps = {}) {
  const [orderNumber, setOrderNumber] = useState('');
  const [inspectedOrderNumber, setInspectedOrderNumber] = useState('');
  const [dryRunResult, setDryRunResult] = useState<CurrentStateOrderRepairResult | null>(null);
  const [executeConfirmationOpen, setExecuteConfirmationOpen] = useState(false);
  const [dryRunFeedback, setDryRunFeedback] = useState<RepairFeedback | null>(null);
  const [executeFeedback, setExecuteFeedback] = useState<RepairFeedback | null>(null);
  const currentInputOrderNumberRef = useRef('');
  const normalizedOrderNumber = inspectedOrderNumber.trim();
  const inspectorQuery = useQueryResource(
    queryKeys.admin.diagnostics.orderState(normalizedOrderNumber || 'idle'),
    ({ signal }) => runtimeServices.diagnostics.inspectOrderState(normalizedOrderNumber, { signal }),
    { enabled: Boolean(normalizedOrderNumber) },
  );

  const isMissingLocalOrder = Boolean(normalizedOrderNumber) && (
    inspectorQuery.diagnostics?.status === 404 || inspectorQuery.error?.trim().toLowerCase() === 'order not found.'
  );

  const dryRunMutation = useMutationAction(
    async (orderNumber: string) => runtimeServices.diagnostics.repairMissingShopifyOrder(
      normalizeRepairOrderNumber(orderNumber),
      false,
    ),
    {
      onMutate: () => {
        setDryRunResult(null);
        setExecuteConfirmationOpen(false);
        setDryRunFeedback(null);
        setExecuteFeedback(null);
      },
      onSuccess: (repairResult, requestedOrderNumber) => {
        if (normalizeRepairOrderNumber(requestedOrderNumber) !== normalizeRepairOrderNumber(currentInputOrderNumberRef.current)) {
          return;
        }
        setDryRunResult(repairResult);
        setDryRunFeedback({ message: 'Dry run complete. Review the current-state plan before execution.', tone: 'info' });
      },
      onError: (error, requestedOrderNumber) => {
        if (normalizeRepairOrderNumber(requestedOrderNumber) !== normalizeRepairOrderNumber(currentInputOrderNumberRef.current)) {
          return;
        }
        setDryRunResult(null);
        setExecuteConfirmationOpen(false);
        setDryRunFeedback({
          message: error instanceof Error ? error.message : 'Current-state repair dry run failed.',
          tone: 'error',
        });
      },
    },
  );

  const executeMutation = useMutationAction(
    async (orderNumber: string) => runtimeServices.diagnostics.repairMissingShopifyOrder(
      normalizeRepairOrderNumber(orderNumber),
      true,
    ),
    {
      onMutate: () => {
        setExecuteFeedback(null);
      },
      onSuccess: async () => {
        setExecuteConfirmationOpen(false);
        setExecuteFeedback({ message: 'Current-state repair completed. The inspector is refreshing persisted evidence.', tone: 'success' });
        await inspectorQuery.refetch();
      },
      onError: (error) => {
        setExecuteConfirmationOpen(false);
        setExecuteFeedback({
          message: error instanceof Error ? error.message : 'Current-state order repair failed.',
          tone: 'error',
        });
      },
    },
  );

  function clearRepairState() {
    setDryRunResult(null);
    setExecuteConfirmationOpen(false);
    setDryRunFeedback(null);
    setExecuteFeedback(null);
    dryRunMutation.reset();
    executeMutation.reset();
  }

  useEffect(() => {
    onRepairCandidateChange?.(isMissingLocalOrder);
  }, [isMissingLocalOrder, onRepairCandidateChange]);

  useEffect(() => {
    const identifier = initialOrderIdentifier?.trim();
    if (!identifier) return;
    currentInputOrderNumberRef.current = identifier;
    setOrderNumber(identifier);
    setInspectedOrderNumber(identifier);
  }, [initialOrderIdentifier]);

  useEffect(() => {
    clearRepairState();
  }, [normalizedOrderNumber]);

  function handleOrderNumberChange(value: string) {
    currentInputOrderNumberRef.current = value.trim();
    setOrderNumber(value);
    if (value.trim() !== normalizedOrderNumber) {
      clearRepairState();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextOrderNumber = orderNumber.trim();
    if (!nextOrderNumber) {
      return;
    }

    if (nextOrderNumber === normalizedOrderNumber) {
      clearRepairState();
      void inspectorQuery.refetch();
      return;
    }
    setInspectedOrderNumber(nextOrderNumber);
  }

  function handleInspectorRetry() {
    clearRepairState();
    void inspectorQuery.refetch();
  }

  const result = isMissingLocalOrder ? null : inspectorQuery.data;
  const currentSignals = result?.operationalSignals.filter(currentSignal) ?? [];
  const historicalSignals = result?.operationalSignals.filter((signal) => !currentSignal(signal)) ?? [];
  const returnRequestCount = result?.returnRefundState.returnRequests.length ?? 0;
  const refundDerivedReturnCount = result?.returnRefundState.refundDerivedReturns.length ?? 0;
  const refundRecordCount = result?.returnRefundState.refundRecords.length ?? 0;
  const conflictReasons = result?.projectionExplanation.cancellationConflict.reasons ?? [];
  const repairReadinessTone: StatusTone = result?.repairReadiness.repairNeeded
    ? (result.repairReadiness.repairSupported ? 'attention' : 'warning')
    : 'success';

  return (
    <section className="order-state-inspector" aria-labelledby="order-state-inspector-title">
      <div className="order-state-inspector-heading">
        <div>
          <h3 id="order-state-inspector-title">Order State Inspector</h3>
          <p>One order, its related records, and the guarded missing-order repair path.</p>
        </div>
      </div>
      <form className="order-state-inspector-form" onSubmit={handleSubmit}>
        <label htmlFor="order-state-inspector-number">
          Order number
          <input
            id="order-state-inspector-number"
            value={orderNumber}
            onChange={(event) => handleOrderNumberChange(event.target.value)}
            placeholder="1108 or #1108"
            autoComplete="off"
            aria-label="Order number"
            aria-describedby="order-state-inspector-number-help"
          />
          <small id="order-state-inspector-number-help">Enter Shopify order number, for example 1105 or #1105.</small>
        </label>
        <button type="submit" className="button button-primary" disabled={!orderNumber.trim() || inspectorQuery.isLoading}>
          Inspect
        </button>
      </form>

      {!normalizedOrderNumber ? (
        <EmptyStatePanel
          title="Enter an order number"
          description="Related records appear after inspection."
        />
      ) : null}

      {inspectorQuery.isLoading ? (
        <SectionSkeleton title="Inspecting order state" description="Collecting persisted evidence." />
      ) : null}

      {inspectorQuery.isError && !isMissingLocalOrder ? (
        <SectionErrorRetry
          title="Order state unavailable"
          description={inspectorQuery.error ?? 'Order state could not be loaded.'}
          onRetry={handleInspectorRetry}
        />
      ) : null}

      {isMissingLocalOrder ? (
        <OperationalSection
          title="Repair Missing Shopify Order"
          description="Starts with a dry run; execution stays separate."
        >
          <div className="current-state-repair-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={dryRunMutation.isPending || executeMutation.isPending}
              onClick={() => dryRunMutation.mutate(normalizedOrderNumber)}
            >
              {dryRunMutation.isPending ? 'Running Dry Run...' : 'Repair Missing Shopify Order'}
            </button>
            <span>One explicit Shopify order only. Bulk or range repair is unavailable.</span>
          </div>

          {dryRunFeedback ? <ActionFeedback tone={dryRunFeedback.tone} message={dryRunFeedback.message} /> : null}
          {executeFeedback ? <ActionFeedback tone={executeFeedback.tone} message={executeFeedback.message} /> : null}

          {dryRunResult?.dryRun ? (
            <div className="current-state-repair-plan" aria-label="Current-state repair dry-run plan">
              <div className="order-state-inspector-grid">
                <MetadataGroup title="Canonical Shopify state">
                  <MetadataRow label="Order number" value={dryRunResult.shopifyOrderNumber} />
                  <MetadataRow label="Shopify order ID" value={dryRunResult.shopifyOrderId} />
                  <MetadataRow label="Source" value="Current Shopify Admin state" />
                  <MetadataRow label="Cancellation evidence" value={dryRunResult.summary.cancellationApplied ? 'Present' : 'Not present'} />
                  <MetadataRow
                    label="Refund classification"
                    value={dryRunResult.summary.refundEvidence?.classification ?? 'No refund object'}
                  />
                  <MetadataRow
                    label="Monetary refund amount"
                    value={dryRunResult.summary.refundEvidence
                      ? `${dryRunResult.summary.refundEvidence.monetaryRefundAmount}${dryRunResult.summary.refundEvidence.currency ? ` ${dryRunResult.summary.refundEvidence.currency}` : ''}`
                      : 'Not present'}
                  />
                  <MetadataRow
                    label="Successful refund transactions"
                    value={String(dryRunResult.summary.refundEvidence?.successfulRefundTransactionCount ?? 0)}
                  />
                  <MetadataRow
                    label="Successful void transactions"
                    value={String(dryRunResult.summary.refundEvidence?.successfulVoidTransactionCount ?? 0)}
                  />
                  <MetadataRow
                    label="Classification reason"
                    value={dryRunResult.summary.refundEvidence?.reasonCode ?? 'not_applicable'}
                  />
                  <MetadataRow label="Return evidence" value={dryRunResult.summary.returnApplied ? 'Present' : 'Not present'} />
                </MetadataGroup>
                <MetadataGroup title="Current local state">
                  <MetadataRow label="Shopify order" value={currentRecordState(dryRunResult.summary.shopifyOrder)} />
                  <MetadataRow label="Vendor allocation" value={currentRecordState(dryRunResult.summary.allocation)} />
                  <MetadataRow label="Finance ledger" value={currentRecordState(dryRunResult.summary.finance)} />
                  <MetadataRow label="Dry run" value="Yes" />
                  <MetadataRow label="Executed" value="No" />
                  <MetadataRow label="Skipped if executed" value={yesNo(dryRunResult.summary.skipped)} />
                </MetadataGroup>
              </div>

              <OperationalSection title="Planned mutations">
                <div className="order-state-action-grid">
                  {[
                    ['ShopifyOrder and line items', plannedAction(dryRunResult.summary.shopifyOrder)],
                    ['Vendor allocation', plannedAction(dryRunResult.summary.allocation)],
                    ['FinanceLedgerEntry sale evidence', plannedAction(dryRunResult.summary.finance)],
                    ['Full-order cancellation lifecycle', dryRunResult.summary.cancellationApplied ? 'APPLY' : 'SKIP'],
                    ['Refund lifecycle', dryRunResult.summary.refundApplied ? 'APPLY' : 'SKIP'],
                    ['Return lifecycle', dryRunResult.summary.returnApplied ? 'APPLY' : 'SKIP'],
                  ].map(([entity, action]) => (
                    <div key={entity} className="order-state-action-row">
                      <span>{entity}</span>
                      <StatusBadge tone={action === 'SKIP' ? 'neutral' : 'attention'}>{action}</StatusBadge>
                    </div>
                  ))}
                </div>
              </OperationalSection>

              <OperationalSection title="Warnings">
                <EvidenceList items={dryRunResult.summary.warnings} />
              </OperationalSection>

              <div className="current-state-repair-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={executeMutation.isPending || dryRunResult.summary.executionBlocked}
                  onClick={() => setExecuteConfirmationOpen(true)}
                >
                  {dryRunResult.summary.executionBlocked ? 'Execution Blocked' : 'Execute Repair'}
                </button>
                <a className="button button-secondary" href="#order-state-inspector-title">Back to Order State Inspector</a>
              </div>
            </div>
          ) : null}
        </OperationalSection>
      ) : null}

      {result ? (
        <div className="order-state-inspector-results">
          <OperationalSection title="Current state">
            <article className="order-state-summary">
              <div>
                <h3>{result.orderIdentity.orderNumber}</h3>
                <p>{result.currentStateSummary}</p>
              </div>
            </article>

            <div className="order-state-overview-grid">
              <SummaryCard
                label="Order"
                value={result.projectionExplanation.orderStatus.label}
                detail={`Financial status: ${result.shopifyState.financialStatus ?? 'Unknown'}`}
                tone={result.localOrderState.isCancelled ? 'warning' : 'success'}
              />
              <SummaryCard
                label="Finance"
                value={result.projectionExplanation.finance.label}
                detail={result.financeState.financeReviewRequired ? 'Existing finance state' : 'Clear'}
                tone={financeTone(result.financeState.financeReviewRequired)}
              />
              <SummaryCard
                label="Operations"
                value={result.projectionExplanation.queueState.included ? 'Queue included' : 'Queue excluded'}
                detail={`${result.projectionExplanation.fulfillment.label} / ${result.projectionExplanation.shipment.label}`}
                tone={result.projectionExplanation.queueState.included ? 'attention' : 'neutral'}
              />
              <SummaryCard
                label="Conflict"
                value={result.localOrderState.hasOperationalConflict ? 'Existing evidence' : 'No conflict'}
                detail={conflictReasons[0] ?? 'No conflict reason recorded'}
                tone={conflictTone(result.localOrderState.hasOperationalConflict)}
              />
            </div>

            <DiagnosticsActionPanel
              id="order-state-inspector-next-action"
              recommendation={result.repairReadiness.recommendedNextStep}
              stateLabel={toTitleCaseLabel(result.repairReadiness.repairClassification)}
              tone={repairReadinessTone}
            />

            <div className="order-state-inspector-grid">
              <MetadataGroup title="Order state">
                <MetadataRow label="Truth source" value="Persisted local truth" />
                <MetadataRow label="Financial status" value={result.shopifyState.financialStatus ?? 'Unknown'} />
                <MetadataRow label="Cancelled at" value={formatDate(result.shopifyState.cancelledAt)} />
                <MetadataRow label="Cancel reason" value={result.shopifyState.cancelReason ?? 'Not recorded'} />
                <MetadataRow label="Line items" value={result.shopifyState.lineItemCount} />
                <MetadataRow label="Mapped line items" value={result.shopifyState.mappedLineItemCount} />
                <MetadataRow label="Unmapped line items" value={result.shopifyState.unmappedLineItemCount} />
              </MetadataGroup>
              <MetadataGroup title="Ownership">
                <MetadataRow label="Order number" value={result.orderIdentity.orderNumber} />
                <MetadataRow
                  label="Vendors"
                  value={result.orderIdentity.vendors.map((vendor) => `${vendor.vendorName} (${vendor.vendorId})`).join(', ') || 'None'}
                />
                <MetadataRow label="Allocation count" value={result.localOrderState.allocationCount} />
                <MetadataRow label="Local order exists" value={yesNo(result.localOrderState.exists)} />
              </MetadataGroup>
            </div>
          </OperationalSection>

          <OperationalSection title="Finance and payment safety">
            <div className="order-state-overview-grid order-state-finance-metrics">
              <SummaryCard label="Ledgers" value={String(result.financeState.ledgerCount)} detail={countLabel(result.financeState.saleLedgerCount, 'sale ledger')} />
              <SummaryCard
                label="Finance review"
                value={result.financeState.financeReviewRequired ? 'Required' : 'Not required'}
                tone={financeTone(result.financeState.financeReviewRequired)}
              />
              <SummaryCard label="Finance events" value={String(result.financeState.events.length)} detail="Historical event count" />
            </div>
            {result.financeState.ledgers.length ? (
              <div className="order-state-record-grid order-state-ledger-grid">
                {result.financeState.ledgers.map((ledger) => <LedgerCard key={ledger.id} ledger={ledger} />)}
              </div>
            ) : (
              <DiagnosticsEmptyState title="No finance ledger rows" description="No ledger rows were returned." status="No ledger rows" />
            )}
          </OperationalSection>

          <OperationalSection
            title="Allocation and shipping evidence"
          >
            <div className="order-state-section-stack">
              <div>
                <h4>Allocations</h4>
                {result.allocations.length ? (
                  <div className="order-state-record-grid">
                    {result.allocations.map((allocation) => (
                      <article key={allocation.allocationId} className="order-state-record">
                        <div className="order-state-record-heading">
                          <strong>{allocation.assignedVendor.vendorName}</strong>
                          <StatusBadge status={allocation.allocationStatus}>{toTitleCaseLabel(allocation.allocationStatus)}</StatusBadge>
                        </div>
                        <MetadataGroup>
                          <MetadataRow label="Fulfillment" value={allocation.fulfillmentStatus} />
                          <MetadataRow label="Shipping" value={allocation.shippingStatus} />
                          <MetadataRow label="Cancellation reason" value={allocation.cancellationReason ?? 'None'} />
                          <MetadataRow label="Tracking present" value={yesNo(allocation.trackingPresent)} />
                          <MetadataRow label="Carrier present" value={yesNo(allocation.carrierPresent)} />
                        </MetadataGroup>
                        <DiagnosticsTechnicalDetails label="Allocation technical evidence">
                          <MetadataGroup>
                            <MetadataRow label="Allocation ID" value={<code className="diagnostics-id-block">{allocation.allocationId}</code>} />
                            <MetadataRow label="Original vendor" value={`${allocation.originalVendor.vendorName} (${allocation.originalVendor.vendorId})`} />
                            <MetadataRow label="Assigned vendor" value={`${allocation.assignedVendor.vendorName} (${allocation.assignedVendor.vendorId})`} />
                            <MetadataRow label="Created" value={formatDate(allocation.createdAt)} />
                            <MetadataRow label="Updated" value={formatDate(allocation.updatedAt)} />
                          </MetadataGroup>
                        </DiagnosticsTechnicalDetails>
                      </article>
                    ))}
                  </div>
                ) : <DiagnosticsEmptyState title="No local allocations" description="No vendor allocation was returned." status="No allocations" />}
              </div>

              <div>
                <h4>Shipping evidence</h4>
                {result.shippingState.length ? (
                  <div className="order-state-record-grid">
                    {result.shippingState.map((shipping) => (
                      <article key={shipping.allocationId} className="order-state-record">
                        <div className="order-state-record-heading">
                          <strong>Shipment evidence</strong>
                          <StatusBadge tone={shipping.eligibility.eligibleFromPersistedOrderState ? 'success' : 'neutral'}>
                            {shipping.eligibility.eligibleFromPersistedOrderState ? 'Shipping eligible' : 'Shipping blocked'}
                          </StatusBadge>
                        </div>
                        <MetadataGroup>
                          <MetadataRow label="Shipment records" value={shipping.shipmentRecordCount} />
                          <MetadataRow label="Label exists" value={yesNo(shipping.labelExists)} />
                          <MetadataRow label="Tracking present" value={yesNo(shipping.trackingPresent)} />
                          <MetadataRow label="Carrier" value={shipping.carrier ?? 'Not recorded'} />
                          <MetadataRow label="Order-state eligible" value={shipping.eligibility.eligibleFromPersistedOrderState ? 'Yes' : 'No'} />
                          <MetadataRow label="Blocked reason" value={shipping.eligibility.blockedReason ?? 'None'} />
                        </MetadataGroup>
                        {shipping.providerStatuses.length ? (
                          <DiagnosticsTechnicalDetails label="Provider status history">
                            {shipping.providerStatuses.map((provider) => (
                              <div key={`${provider.provider}-${provider.createdAt}`} className="order-state-compact-row">
                                <span>{provider.provider}: {provider.status}</span>
                                <small>{formatDate(provider.createdAt)} / updated {formatDate(provider.updatedAt)}</small>
                              </div>
                            ))}
                          </DiagnosticsTechnicalDetails>
                        ) : null}
                        <DiagnosticsTechnicalDetails label="Shipping technical evidence">
                          <MetadataGroup>
                            <MetadataRow label="Allocation ID" value={<code className="diagnostics-id-block">{shipping.allocationId}</code>} />
                            <MetadataRow label="Eligibility scope" value={shipping.eligibility.scope} />
                          </MetadataGroup>
                        </DiagnosticsTechnicalDetails>
                      </article>
                    ))}
                  </div>
                ) : <DiagnosticsEmptyState title="No shipment records" description="No shipment evidence was returned." status="No shipment records" />}
              </div>
            </div>
          </OperationalSection>

          <OperationalSection title="Returns and refunds">
            <div className="order-state-record-grid">
              <article className="order-state-record">
                <div className="order-state-record-heading">
                  <strong>Shopify return requests</strong>
                  <StatusBadge tone={returnRequestCount ? 'attention' : 'neutral'}>{returnRequestCount}</StatusBadge>
                </div>
                {result.returnRefundState.returnRequests.length ? result.returnRefundState.returnRequests.map((record) => (
                  <div key={record.id} className="order-state-compact-row">
                    <span>{record.status}</span>
                    <small>{record.sourceShopifyReturnId ?? record.id} · {formatDate(record.requestedAt ?? record.createdAt)}</small>
                    <DiagnosticsTechnicalDetails label="Return request technical evidence">
                      <MetadataGroup>
                        <MetadataRow label="ReturnRecord ID" value={<code className="diagnostics-id-block">{record.id}</code>} />
                        <MetadataRow label="Allocation ID" value={<code className="diagnostics-id-block">{record.allocationId}</code>} />
                        <MetadataRow label="Vendor ID" value={record.vendorId ?? 'Not recorded'} />
                        <MetadataRow label="Source type" value={record.sourceType} />
                        <MetadataRow label="Updated" value={formatDate(record.updatedAt)} />
                      </MetadataGroup>
                    </DiagnosticsTechnicalDetails>
                  </div>
                )) : <DiagnosticsEmptyState title="No Shopify return request" description="None returned for this order." status="No return request" />}
              </article>
              <article className="order-state-record">
                <div className="order-state-record-heading">
                  <strong>Refund-derived return evidence</strong>
                  <StatusBadge tone={refundDerivedReturnCount ? 'attention' : 'neutral'}>{refundDerivedReturnCount}</StatusBadge>
                </div>
                {result.returnRefundState.refundDerivedReturns.length ? result.returnRefundState.refundDerivedReturns.map((record) => (
                  <div key={record.id} className="order-state-compact-row">
                    <span>{record.status}</span>
                    <small>{record.sourceShopifyRefundId ?? record.id} · {formatDate(record.createdAt)}</small>
                    <DiagnosticsTechnicalDetails label="Refund-derived return technical evidence">
                      <MetadataGroup>
                        <MetadataRow label="ReturnRecord ID" value={<code className="diagnostics-id-block">{record.id}</code>} />
                        <MetadataRow label="Allocation ID" value={<code className="diagnostics-id-block">{record.allocationId}</code>} />
                        <MetadataRow label="Vendor ID" value={record.vendorId ?? 'Not recorded'} />
                        <MetadataRow label="Source type" value={record.sourceType} />
                        <MetadataRow label="Requested at" value={formatDate(record.requestedAt)} />
                        <MetadataRow label="Updated" value={formatDate(record.updatedAt)} />
                      </MetadataGroup>
                    </DiagnosticsTechnicalDetails>
                  </div>
                )) : <DiagnosticsEmptyState title="No refund-derived return evidence" description="None returned for this order." status="No refund-derived return" />}
              </article>
              <article className="order-state-record">
                <div className="order-state-record-heading">
                  <strong>Shopify refund records</strong>
                  <StatusBadge tone={refundRecordCount ? 'attention' : 'neutral'}>{refundRecordCount}</StatusBadge>
                </div>
                {result.returnRefundState.refundRecords.length ? result.returnRefundState.refundRecords.map((record) => (
                  <div key={record.id} className="order-state-compact-row">
                    <span>{record.status}</span>
                    <small>{record.sourceShopifyRefundId} · {formatDate(record.createdAt)}</small>
                    <DiagnosticsTechnicalDetails label="Refund record technical evidence">
                      <MetadataGroup>
                        <MetadataRow label="RefundRecord ID" value={<code className="diagnostics-id-block">{record.id}</code>} />
                        <MetadataRow label="Allocation ID" value={<code className="diagnostics-id-block">{record.allocationId}</code>} />
                        <MetadataRow label="Updated" value={formatDate(record.updatedAt)} />
                      </MetadataGroup>
                    </DiagnosticsTechnicalDetails>
                  </div>
                )) : <DiagnosticsEmptyState title="No Shopify refund record" description="None returned for this order." status="No refund record" />}
              </article>
            </div>
          </OperationalSection>

          <OperationalSection title="History and signals">
            <div className="order-state-section-stack">
              <div>
                <h4>Current operational signals</h4>
                {currentSignals.length ? (
                  <div className="order-state-record-grid">
                    {currentSignals.map((signal) => (
                      <article key={signal.id} className="order-state-record">
                        <div className="order-state-record-heading">
                          <strong>{signal.title}</strong>
                          <StatusBadge tone={signal.severity === 'CRITICAL' || signal.severity === 'HIGH' ? 'danger' : 'warning'}>
                            {signal.status}
                          </StatusBadge>
                        </div>
                        <p>{signal.description}</p>
                        <small>{signal.sourceArea} · {formatDate(signal.triggeredAt)}</small>
                        <DiagnosticsTechnicalDetails label="Signal technical evidence">
                          <MetadataGroup>
                            <MetadataRow label="Signal ID" value={<code className="diagnostics-id-block">{signal.id}</code>} />
                            <MetadataRow label="Allocation ID" value={signal.allocationId ? <code className="diagnostics-id-block">{signal.allocationId}</code> : 'Not recorded'} />
                            <MetadataRow label="Finance ledger ID" value={signal.financeLedgerEntryId ? <code className="diagnostics-id-block">{signal.financeLedgerEntryId}</code> : 'Not recorded'} />
                            <MetadataRow label="Type" value={signal.type} />
                            <MetadataRow label="Suggested action" value={signal.suggestedAction ?? 'Not recorded'} />
                            <MetadataRow label="Resolved at" value={formatDate(signal.resolvedAt)} />
                          </MetadataGroup>
                        </DiagnosticsTechnicalDetails>
                      </article>
                    ))}
                  </div>
                ) : <DiagnosticsEmptyState title="No signals" description="No active signal records were returned." status="No active signals" />}
              </div>

              {historicalSignals.length ? (
                <DiagnosticsTechnicalDetails label="Resolved signal history">
                  <div className="order-state-record-grid">
                    {historicalSignals.map((signal) => (
                      <article key={signal.id} className="order-state-record">
                        <div className="order-state-record-heading">
                          <strong>{signal.title}</strong>
                          <StatusBadge status={signal.status}>{signal.status}</StatusBadge>
                        </div>
                        <p>{signal.description}</p>
                        <small>{signal.sourceArea} · {formatDate(signal.triggeredAt)}</small>
                      </article>
                    ))}
                  </div>
                </DiagnosticsTechnicalDetails>
              ) : null}

              <div>
                <h4>Repair history</h4>
                {result.repairHistory.length ? (
                  <div className="order-state-record-grid">
                    {result.repairHistory.map((repair) => (
                      <article key={repair.jobId} className="order-state-record">
                        <div className="order-state-record-heading">
                          <strong>{toTitleCaseLabel(repair.repairSource)}</strong>
                          <StatusBadge tone={repair.status === 'COMPLETED' ? 'success' : 'danger'}>
                            {repair.status}
                          </StatusBadge>
                        </div>
                        <small>Timestamp {formatDate(repair.repairTimestamp)}</small>
                        <small>Dry run: {yesNo(repair.dryRun)} · Executed: {yesNo(repair.executed)}</small>
                        {repair.errorSummary ? <p>{repair.errorSummary}</p> : null}
                        <DiagnosticsTechnicalDetails label="Repair technical evidence">
                          <MetadataGroup>
                            <MetadataRow label="Repair job ID" value={<code className="diagnostics-id-block">{repair.jobId}</code>} />
                            <MetadataRow label="Actor" value={repair.actorEmail ?? repair.actorUserId ?? 'Not recorded'} />
                          </MetadataGroup>
                        </DiagnosticsTechnicalDetails>
                      </article>
                    ))}
                  </div>
                ) : <DiagnosticsEmptyState title="No repair history" description="No executed repair was recorded." status="No repair history" />}
              </div>

              <div>
                <h4>Webhook history</h4>
                {result.webhookHistory.length ? (
                  <div className="order-state-record-grid">
                    {result.webhookHistory.map((event) => (
                      <article key={event.webhookEventId} className="order-state-record">
                        <div className="order-state-record-heading">
                          <strong>{event.topic}</strong>
                          <StatusBadge tone={event.status === 'PROCESSED' ? 'success' : event.status === 'FAILED' ? 'danger' : 'attention'}>
                            {event.status}
                          </StatusBadge>
                        </div>
                        <small>Received {formatDate(event.receivedAt)}</small>
                        <small>Processed {formatDate(event.processedAt)}</small>
                        <small>Stored payload: {yesNo(event.payloadAvailable)}</small>
                        {event.errorMessage ? <p>{event.errorMessage}</p> : null}
                        <DiagnosticsTechnicalDetails label="Webhook technical evidence">
                          <MetadataGroup>
                            <MetadataRow label="WebhookEvent ID" value={<code className="diagnostics-id-block">{event.webhookEventId}</code>} />
                            <MetadataRow label="Shopify order ID" value={event.shopifyOrderId ? <code className="diagnostics-id-block">{event.shopifyOrderId}</code> : 'Not recorded'} />
                            <MetadataRow label="Shopify order number" value={event.shopifyOrderNumber ?? 'Not recorded'} />
                            <MetadataRow label="Shopify webhook ID" value={event.webhookId ? <code className="diagnostics-id-block">{event.webhookId}</code> : 'Not recorded'} />
                          </MetadataGroup>
                        </DiagnosticsTechnicalDetails>
                      </article>
                    ))}
                  </div>
                ) : <DiagnosticsEmptyState title="No webhook history" description={`No stored webhook event matched. Limit: ${result.limits.webhookHistory}.`} status="No webhook history" />}
              </div>
            </div>
          </OperationalSection>

          <OperationalSection title="Lifecycle conclusions">
            <div className="order-state-projection-grid">
              <ProjectionCard title="Order" projection={result.projectionExplanation.orderStatus} />
              <ProjectionCard title="Fulfillment" projection={result.projectionExplanation.fulfillment} />
              <ProjectionCard title="Shipment" projection={result.projectionExplanation.shipment} />
              <ProjectionCard title="Tracking" projection={result.projectionExplanation.tracking} />
              <ProjectionCard title="Finance" projection={result.projectionExplanation.finance} />
              <article className="order-state-record order-state-projection-card">
                <small>Queue</small>
                <strong>{result.projectionExplanation.queueState.included ? 'Included' : 'Excluded'}</strong>
                <p>{result.projectionExplanation.queueState.reasons[0] ?? 'No deterministic reason recorded.'}</p>
                {result.projectionExplanation.queueState.reasons.length > 1 ? (
                  <DiagnosticsTechnicalDetails label="Preserved supporting evidence">
                    <EvidenceList items={result.projectionExplanation.queueState.reasons.slice(1)} />
                  </DiagnosticsTechnicalDetails>
                ) : null}
              </article>
            </div>
            <DiagnosticsTechnicalDetails label="Action eligibility details">
              <div className="order-state-action-grid">
                {result.projectionExplanation.actions.map((action) => (
                  <div key={action.action} className="order-state-action-row">
                    <span>{toTitleCaseLabel(action.action)}</span>
                    <StatusBadge tone={action.available ? 'success' : 'neutral'}>
                      {action.available ? 'Action available' : 'Action blocked'}
                    </StatusBadge>
                    <small>{action.blockedReason ?? 'No lifecycle blocker'}</small>
                  </div>
                ))}
              </div>
            </DiagnosticsTechnicalDetails>
          </OperationalSection>

          <OperationalSection title="Repair readiness">
            <div className="order-state-overview-grid">
              <SummaryCard label="Repair needed" value={yesNo(result.repairReadiness.repairNeeded)} tone={result.repairReadiness.repairNeeded ? 'attention' : 'success'} />
              <SummaryCard label="Repair supported" value={yesNo(result.repairReadiness.repairSupported)} tone={result.repairReadiness.repairSupported ? 'attention' : 'neutral'} />
              <SummaryCard label="Classification" value={toTitleCaseLabel(result.repairReadiness.repairClassification)} />
            </div>
            <EvidenceList items={result.repairReadiness.blockers} />
          </OperationalSection>

          <OperationalSection title="Advanced technical details">
            <DiagnosticsTechnicalDetails label="Order identity and timestamps">
              <MetadataGroup>
                <MetadataRow label="Local order ID" value={<code className="diagnostics-id-block">{result.orderIdentity.localOrderId}</code>} />
                <MetadataRow label="Shopify order ID" value={<code className="diagnostics-id-block">{result.orderIdentity.shopifyOrderId}</code>} />
                <MetadataRow label="Shopify created" value={formatDate(result.orderIdentity.shopifyCreatedAt)} />
                <MetadataRow label="Local created" value={formatDate(result.orderIdentity.createdAt)} />
                <MetadataRow label="Local updated" value={formatDate(result.orderIdentity.updatedAt)} />
              </MetadataGroup>
            </DiagnosticsTechnicalDetails>
            <DiagnosticsTechnicalDetails label="Inspector limits">
              <MetadataGroup>
                <MetadataRow label="Webhook history limit" value={result.limits.webhookHistory} />
                <MetadataRow label="Operational signals limit" value={result.limits.operationalSignals} />
                <MetadataRow label="Finance events limit" value={result.limits.financeEvents} />
                <MetadataRow label="Repair history limit" value={result.limits.repairHistory} />
              </MetadataGroup>
            </DiagnosticsTechnicalDetails>
          </OperationalSection>
        </div>
      ) : null}

      {executeConfirmationOpen && dryRunResult ? (
        <div className="support-modal-backdrop" role="presentation">
          <section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="current-state-repair-confirmation-title">
            <div className="support-modal-header">
              <div>
                <p className="eyebrow">Production recovery</p>
                <h3 id="current-state-repair-confirmation-title">Execute Current-State Repair?</h3>
              </div>
              <button
                type="button"
                className="support-modal-close"
                aria-label="Close repair confirmation"
                onClick={() => setExecuteConfirmationOpen(false)}
              >
                X
              </button>
            </div>
            <p>Current Shopify state will be fetched. Missing local records may be created for {dryRunResult.shopifyOrderNumber}.</p>
            <p>This executes only the reviewed single-order plan. It does not replay a stored webhook or enable bulk repair.</p>
            <div className="support-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setExecuteConfirmationOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={executeMutation.isPending}
                onClick={() => executeMutation.mutate(dryRunResult.orderIdentifier)}
              >
                {executeMutation.isPending ? 'Executing...' : 'Execute Repair'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
