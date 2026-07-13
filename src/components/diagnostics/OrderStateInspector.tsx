import { useEffect, useState, type FormEvent } from 'react';
import { ActionFeedback } from '../ActionFeedback';
import { useMutationAction } from '../../hooks/useMutationAction';
import { useQueryResource } from '../../hooks/useQueryResource';
import { queryKeys } from '../../lib/api/queryKeys';
import { runtimeServices } from '../../services/runtime-services';
import { formatDateTime, toTitleCaseLabel } from '../../services/real/formatting';
import type { CurrentStateOrderRepairResult } from '../../services/real/diagnostics';
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
};

function plannedAction(value: 'Created' | 'Existing') {
  return value === 'Created' ? 'CREATE' : 'REUSE';
}

function currentRecordState(value: 'Created' | 'Existing') {
  return value === 'Created' ? 'Missing' : 'Existing';
}

export function OrderStateInspector({ onRepairCandidateChange }: OrderStateInspectorProps = {}) {
  const [orderNumber, setOrderNumber] = useState('');
  const [inspectedOrderNumber, setInspectedOrderNumber] = useState('');
  const [dryRunResult, setDryRunResult] = useState<CurrentStateOrderRepairResult | null>(null);
  const [executeConfirmationOpen, setExecuteConfirmationOpen] = useState(false);
  const [repairFeedback, setRepairFeedback] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const normalizedOrderNumber = inspectedOrderNumber.trim();
  const inspectorQuery = useQueryResource(
    queryKeys.admin.diagnostics.orderState(normalizedOrderNumber || 'idle'),
    ({ signal }) => runtimeServices.diagnostics.inspectOrderState(normalizedOrderNumber, { signal }),
    { enabled: Boolean(normalizedOrderNumber) },
  );

  const isMissingLocalOrder = Boolean(normalizedOrderNumber) && (
    inspectorQuery.diagnostics?.status === 404 || inspectorQuery.error?.trim().toLowerCase() === 'order not found.'
  );

  useEffect(() => {
    onRepairCandidateChange?.(isMissingLocalOrder);
  }, [isMissingLocalOrder, onRepairCandidateChange]);

  useEffect(() => {
    setDryRunResult(null);
    setExecuteConfirmationOpen(false);
    setRepairFeedback(null);
  }, [normalizedOrderNumber]);

  const dryRunMutation = useMutationAction(
    async (orderIdentifier: string) => runtimeServices.diagnostics.repairMissingShopifyOrder(orderIdentifier, false),
    {
      onSuccess: (repairResult) => {
        setDryRunResult(repairResult);
        setRepairFeedback({ message: 'Dry run complete. Review the current-state plan before execution.', tone: 'info' });
      },
      onError: (error) => {
        setRepairFeedback({
          message: error instanceof Error ? error.message : 'Current-state repair dry run failed.',
          tone: 'error',
        });
      },
    },
  );

  const executeMutation = useMutationAction(
    async (orderIdentifier: string) => runtimeServices.diagnostics.repairMissingShopifyOrder(orderIdentifier, true),
    {
      onSuccess: async () => {
        setExecuteConfirmationOpen(false);
        setRepairFeedback({ message: 'Current-state repair completed. The inspector is refreshing persisted evidence.', tone: 'success' });
        await inspectorQuery.refetch();
      },
      onError: (error) => {
        setExecuteConfirmationOpen(false);
        setRepairFeedback({
          message: error instanceof Error ? error.message : 'Current-state order repair failed.',
          tone: 'error',
        });
      },
    },
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextOrderNumber = orderNumber.trim();
    if (!nextOrderNumber) {
      return;
    }

    if (nextOrderNumber === normalizedOrderNumber) {
      void inspectorQuery.refetch();
      return;
    }
    setInspectedOrderNumber(nextOrderNumber);
  }

  const result = isMissingLocalOrder ? null : inspectorQuery.data;

  return (
    <section className="order-state-inspector" aria-labelledby="order-state-inspector-title">
      <div className="order-state-inspector-heading">
        <div>
          <h3 id="order-state-inspector-title">Order State Inspector</h3>
          <p>Inspect persisted lifecycle evidence for one order. Inspection is read-only; a missing local order can continue into guarded current-state repair.</p>
        </div>
        <StatusBadge tone="info">Tier-1 operational tool</StatusBadge>
      </div>
      <form className="order-state-inspector-form" onSubmit={handleSubmit}>
        <label htmlFor="order-state-inspector-number">
          Order number
          <input
            id="order-state-inspector-number"
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            placeholder="1108 or #1108"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="button button-primary" disabled={!orderNumber.trim() || inspectorQuery.isLoading}>
          Inspect
        </button>
      </form>

      {!normalizedOrderNumber ? (
        <EmptyStatePanel
          title="Enter an order number"
          description="The inspector reads only the requested order and its directly related operational records."
        />
      ) : null}

      {inspectorQuery.isLoading ? (
        <SectionSkeleton title="Inspecting order state" description="Collecting persisted evidence for the requested order." />
      ) : null}

      {inspectorQuery.isError ? (
        <SectionErrorRetry
          title="Order state unavailable"
          description={inspectorQuery.error ?? 'Order state could not be loaded.'}
          onRetry={() => void inspectorQuery.refetch()}
        />
      ) : null}

      {isMissingLocalOrder ? (
        <OperationalSection
          title="Repair Missing Shopify Order"
          description="Fetch current Shopify truth for this one order. The first request is always a dry run and performs no local mutation."
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

          {repairFeedback ? <ActionFeedback tone={repairFeedback.tone} message={repairFeedback.message} /> : null}

          {dryRunResult?.dryRun ? (
            <div className="current-state-repair-plan" aria-label="Current-state repair dry-run plan">
              <div className="order-state-inspector-grid">
                <MetadataGroup title="Canonical Shopify state">
                  <MetadataRow label="Order number" value={dryRunResult.shopifyOrderNumber} />
                  <MetadataRow label="Shopify order ID" value={dryRunResult.shopifyOrderId} />
                  <MetadataRow label="Source" value="Current Shopify Admin state" />
                  <MetadataRow label="Cancellation evidence" value={dryRunResult.summary.cancellationApplied ? 'Present' : 'Not present'} />
                  <MetadataRow label="Refund evidence" value={dryRunResult.summary.refundApplied ? 'Present' : 'Not present'} />
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

              <OperationalSection title="Planned mutations" description="The execute step will use this reviewed one-order plan.">
                <div className="order-state-action-grid">
                  {[
                    ['ShopifyOrder and line items', plannedAction(dryRunResult.summary.shopifyOrder)],
                    ['VendorAllocation', plannedAction(dryRunResult.summary.allocation)],
                    ['FinanceLedgerEntry sale evidence', plannedAction(dryRunResult.summary.finance)],
                    ['Full-order cancellation lifecycle', dryRunResult.summary.cancellationApplied ? 'APPLY' : 'SKIP'],
                    ['Refund lifecycle', dryRunResult.summary.refundApplied ? 'APPLY' : 'SKIP'],
                    ['Return lifecycle', dryRunResult.summary.returnApplied ? 'APPLY' : 'SKIP'],
                  ].map(([entity, action]) => (
                    <div key={entity} className="order-state-action-row">
                      <span>{entity}</span>
                      <StatusBadge tone={action === 'SKIP' ? 'neutral' : 'attention'}>{action}</StatusBadge>
                      <small>Current-state repair transaction</small>
                    </div>
                  ))}
                </div>
              </OperationalSection>

              <OperationalSection title="Warnings" description="Execution should stop if the backend reports an unsafe or unsupported state.">
                <EvidenceList items={dryRunResult.summary.warnings} />
              </OperationalSection>

              <div className="current-state-repair-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={executeMutation.isPending}
                  onClick={() => setExecuteConfirmationOpen(true)}
                >
                  Execute Repair
                </button>
                <a className="button button-secondary" href="#order-state-inspector-title">Back to Order State Inspector</a>
              </div>
            </div>
          ) : null}
        </OperationalSection>
      ) : null}

      {result ? (
        <div className="order-state-inspector-results">
          <article className="order-state-summary">
            <div>
              <p className="eyebrow">Current state summary</p>
              <h3>{result.orderIdentity.orderNumber}</h3>
              <p>{result.currentStateSummary}</p>
            </div>
            <div className="order-state-summary-badges">
              <StatusBadge tone={result.localOrderState.isCancelled ? 'warning' : 'success'}>
                {result.projectionExplanation.orderStatus.label}
              </StatusBadge>
              <StatusBadge tone={result.localOrderState.hasOperationalConflict ? 'danger' : 'neutral'}>
                {result.localOrderState.hasOperationalConflict ? 'Conflict evidence' : 'No conflict evidence'}
              </StatusBadge>
            </div>
          </article>

          <div className="order-state-inspector-grid">
            <OperationalSection title="Identity" description="Safe local and Shopify identifiers.">
              <MetadataGroup>
                <MetadataRow label="Order number" value={result.orderIdentity.orderNumber} />
                <MetadataRow label="Local order ID" value={result.orderIdentity.localOrderId} />
                <MetadataRow label="Shopify order ID" value={result.orderIdentity.shopifyOrderId} />
                <MetadataRow label="Shopify created" value={formatDate(result.orderIdentity.shopifyCreatedAt)} />
                <MetadataRow label="Local created" value={formatDate(result.orderIdentity.createdAt)} />
                <MetadataRow label="Local updated" value={formatDate(result.orderIdentity.updatedAt)} />
                <MetadataRow
                  label="Vendors"
                  value={result.orderIdentity.vendors.map((vendor) => `${vendor.vendorName} (${vendor.vendorId})`).join(', ') || 'None'}
                />
              </MetadataGroup>
            </OperationalSection>

            <OperationalSection title="Order state" description="Persisted local canonical Shopify state.">
              <MetadataGroup>
                <MetadataRow label="Truth source" value="Persisted local truth" />
                <MetadataRow label="Financial status" value={result.shopifyState.financialStatus ?? 'Unknown'} />
                <MetadataRow label="Cancelled at" value={formatDate(result.shopifyState.cancelledAt)} />
                <MetadataRow label="Cancel reason" value={result.shopifyState.cancelReason ?? 'Not recorded'} />
                <MetadataRow label="Line items" value={result.shopifyState.lineItemCount} />
                <MetadataRow label="Mapped line items" value={result.shopifyState.mappedLineItemCount} />
                <MetadataRow label="Unmapped line items" value={result.shopifyState.unmappedLineItemCount} />
              </MetadataGroup>
            </OperationalSection>
          </div>

          <OperationalSection
            title="Allocations"
            description="Vendor ownership and preserved operational history. Full-order cancellation eligibility comes from ShopifyOrder.cancelledAt."
          >
            {result.allocations.length ? (
              <div className="order-state-record-grid">
                {result.allocations.map((allocation) => (
                  <article key={allocation.allocationId} className="order-state-record">
                    <strong>{allocation.assignedVendor.vendorName}</strong>
                    <small>{allocation.allocationId}</small>
                    <MetadataGroup>
                      <MetadataRow label="Original vendor" value={allocation.originalVendor.vendorId} />
                      <MetadataRow label="Assigned vendor" value={allocation.assignedVendor.vendorId} />
                      <MetadataRow label="Allocation" value={toTitleCaseLabel(allocation.allocationStatus)} />
                      <MetadataRow label="Fulfillment" value={allocation.fulfillmentStatus} />
                      <MetadataRow label="Shipping" value={allocation.shippingStatus} />
                      <MetadataRow label="Cancellation reason" value={allocation.cancellationReason ?? 'None'} />
                      <MetadataRow label="Tracking present" value={yesNo(allocation.trackingPresent)} />
                      <MetadataRow label="Carrier present" value={yesNo(allocation.carrierPresent)} />
                    </MetadataGroup>
                  </article>
                ))}
              </div>
            ) : <EmptyStatePanel title="No local allocations" description="The local order exists without a VendorAllocation." />}
          </OperationalSection>

          <OperationalSection title="Shipping" description="Persisted shipment evidence and order-state eligibility only.">
            {result.shippingState.length ? (
              <div className="order-state-record-grid">
                {result.shippingState.map((shipping) => (
                  <article key={shipping.allocationId} className="order-state-record">
                    <strong>{shipping.allocationId}</strong>
                    <MetadataGroup>
                      <MetadataRow label="Shipment records" value={shipping.shipmentRecordCount} />
                      <MetadataRow label="Label exists" value={yesNo(shipping.labelExists)} />
                      <MetadataRow label="Tracking present" value={yesNo(shipping.trackingPresent)} />
                      <MetadataRow label="Carrier" value={shipping.carrier ?? 'Not recorded'} />
                      <MetadataRow
                        label="Order-state eligible"
                        value={shipping.eligibility.eligibleFromPersistedOrderState ? 'Yes' : 'No'}
                      />
                      <MetadataRow label="Blocked reason" value={shipping.eligibility.blockedReason ?? 'None'} />
                    </MetadataGroup>
                    {shipping.providerStatuses.map((provider) => (
                      <small key={`${provider.provider}-${provider.createdAt}`}>{provider.provider}: {provider.status}</small>
                    ))}
                  </article>
                ))}
              </div>
            ) : <EmptyStatePanel title="No shipping state" description="No vendor allocation exists for shipping inspection." />}
          </OperationalSection>

          <OperationalSection title="Returns / refunds" description="Return requests and refund-derived evidence remain distinct.">
            <div className="order-state-record-grid">
              <article className="order-state-record">
                <strong>Shopify return requests</strong>
                {result.returnRefundState.returnRequests.length ? result.returnRefundState.returnRequests.map((record) => (
                  <div key={record.id} className="order-state-compact-row">
                    <span>{record.status}</span>
                    <small>{record.sourceShopifyReturnId ?? record.id} · {formatDate(record.requestedAt ?? record.createdAt)}</small>
                  </div>
                )) : <span className="muted">None</span>}
              </article>
              <article className="order-state-record">
                <strong>Refund-derived return evidence</strong>
                {result.returnRefundState.refundDerivedReturns.length ? result.returnRefundState.refundDerivedReturns.map((record) => (
                  <div key={record.id} className="order-state-compact-row">
                    <span>{record.status}</span>
                    <small>{record.sourceShopifyRefundId ?? record.id} · {formatDate(record.createdAt)}</small>
                  </div>
                )) : <span className="muted">None</span>}
              </article>
              <article className="order-state-record">
                <strong>Shopify refund records</strong>
                {result.returnRefundState.refundRecords.length ? result.returnRefundState.refundRecords.map((record) => (
                  <div key={record.id} className="order-state-compact-row">
                    <span>{record.status}</span>
                    <small>{record.sourceShopifyRefundId} · {formatDate(record.createdAt)}</small>
                  </div>
                )) : <span className="muted">None</span>}
              </article>
            </div>
          </OperationalSection>

          <OperationalSection title="Finance" description="Order-scoped ledger and payment evidence without payment references or bank data.">
            <div className="order-state-inspector-grid">
              <MetadataGroup>
                <MetadataRow label="Ledger rows" value={result.financeState.ledgerCount} />
                <MetadataRow label="Sale ledger rows" value={result.financeState.saleLedgerCount} />
                <MetadataRow label="Finance review required" value={yesNo(result.financeState.financeReviewRequired)} />
                <MetadataRow label="Finance events" value={result.financeState.events.length} />
              </MetadataGroup>
              <div className="order-state-record-grid">
                {result.financeState.ledgers.map((ledger) => (
                  <article key={ledger.id} className="order-state-record">
                    <strong>{toTitleCaseLabel(ledger.entryType)}</strong>
                    <small>{ledger.id}</small>
                    <MetadataGroup>
                      <MetadataRow label="Payout" value={ledger.payoutStatus} />
                      <MetadataRow label="Settlement" value={ledger.settlementStatus} />
                      <MetadataRow label="Voided at" value={formatDate(ledger.voidedAt)} />
                      <MetadataRow label="Void reason" value={ledger.voidReason ?? 'None'} />
                      <MetadataRow label="Approved settlement" value={yesNo(ledger.approvedSettlementPresent)} />
                      <MetadataRow label="Payout batch" value={yesNo(ledger.payoutBatchPresent)} />
                      <MetadataRow label="Paid evidence" value={yesNo(ledger.paidEvidencePresent)} />
                    </MetadataGroup>
                  </article>
                ))}
              </div>
            </div>
          </OperationalSection>

          <OperationalSection title="Operational signals" description="Sanitized signals directly scoped to this order's allocations.">
            {result.operationalSignals.length ? (
              <div className="order-state-record-grid">
                {result.operationalSignals.map((signal) => (
                  <article key={signal.id} className="order-state-record">
                    <div className="order-state-record-heading">
                      <strong>{signal.title}</strong>
                      <StatusBadge tone={signal.severity === 'CRITICAL' || signal.severity === 'HIGH' ? 'danger' : 'warning'}>
                        {signal.status}
                      </StatusBadge>
                    </div>
                    <p>{signal.description}</p>
                    <small>{signal.sourceArea} · {formatDate(signal.triggeredAt)}</small>
                  </article>
                ))}
              </div>
            ) : <EmptyStatePanel title="No operational signals" description="No scoped signal records were found." />}
          </OperationalSection>

          <OperationalSection title="Webhook history" description={`Chronological safe event history, limited to ${result.limits.webhookHistory} records.`}>
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
                    <small>Payload available: {yesNo(event.payloadAvailable)}</small>
                    {event.errorMessage ? <p>{event.errorMessage}</p> : null}
                  </article>
                ))}
              </div>
            ) : <EmptyStatePanel title="No webhook history" description="No stored webhook event matched this order." />}
          </OperationalSection>

          <OperationalSection title="Repair history" description={`Executed current-state repairs, limited to ${result.limits.repairHistory} records. Dry runs never persist data.`}>
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
                    <small>Dry run: {yesNo(repair.dryRun)}</small>
                    <small>Executed: {yesNo(repair.executed)}</small>
                    <small>Actor: {repair.actorEmail ?? repair.actorUserId ?? 'Not recorded'}</small>
                    {repair.errorSummary ? <p>{repair.errorSummary}</p> : null}
                  </article>
                ))}
              </div>
            ) : <EmptyStatePanel title="No repair history" description="No executed current-state repair was recorded for this order." />}
          </OperationalSection>

          <OperationalSection title="Projection explanation" description="Deterministic reasons for current operational labels and action state.">
            <div className="order-state-projection-grid">
              {([
                ['Order status', result.projectionExplanation.orderStatus],
                ['Fulfillment', result.projectionExplanation.fulfillment],
                ['Shipment', result.projectionExplanation.shipment],
                ['Tracking', result.projectionExplanation.tracking],
                ['Finance', result.projectionExplanation.finance],
              ] as const).map(([title, projection]) => (
                <article key={title} className="order-state-record">
                  <small>{title}</small>
                  <strong>{projection.label}</strong>
                  <EvidenceList items={projection.reasons} />
                </article>
              ))}
              <article className="order-state-record">
                <small>Queue state</small>
                <strong>{result.projectionExplanation.queueState.included ? 'Included' : 'Excluded'}</strong>
                <EvidenceList items={result.projectionExplanation.queueState.reasons} />
              </article>
            </div>
            <div className="order-state-action-grid">
              {result.projectionExplanation.actions.map((action) => (
                <div key={action.action} className="order-state-action-row">
                  <span>{toTitleCaseLabel(action.action)}</span>
                  <StatusBadge tone={action.available ? 'success' : 'neutral'}>
                    {action.available ? 'Available' : 'Blocked'}
                  </StatusBadge>
                  <small>{action.blockedReason ?? 'No lifecycle blocker'}</small>
                </div>
              ))}
            </div>
          </OperationalSection>

          <OperationalSection title="Repair readiness" description="Read-only classification for an existing local order; missing-order repair is not offered here.">
            <MetadataGroup>
              <MetadataRow label="Repair needed" value={yesNo(result.repairReadiness.repairNeeded)} />
              <MetadataRow label="Repair supported" value={yesNo(result.repairReadiness.repairSupported)} />
              <MetadataRow label="Classification" value={toTitleCaseLabel(result.repairReadiness.repairClassification)} />
              <MetadataRow label="Recommended next step" value={result.repairReadiness.recommendedNextStep} />
            </MetadataGroup>
            <EvidenceList items={result.repairReadiness.blockers} />
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
