import { useMemo, useState, type FormEvent } from 'react';
import { ProductImagePreview } from './ProductImagePreview';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { planAllocationSplit, splitAllocation, type OrderDetail } from '../features/orders/api';
import type { AllocationSplitExecutionResponse, AllocationSplitPlannerResponse } from '../lib/api/contracts';
import { formatCurrency, safeArray } from '../services/real/formatting';

type RejectOrderReason = 'OUT_OF_STOCK' | 'VENDOR_CANCELLED' | 'DAMAGED_INVENTORY' | 'FULFILLMENT_ISSUE';

const REJECT_REASONS: Array<{ value: RejectOrderReason; label: string }> = [
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'VENDOR_CANCELLED', label: 'Vendor cancelled' },
  { value: 'DAMAGED_INVENTORY', label: 'Damaged inventory' },
  { value: 'FULFILLMENT_ISSUE', label: 'Fulfillment issue' },
];

type AllocationSplitRejectModalProps = {
  order: OrderDetail;
  vendorId: string;
  onClose: () => void;
  onSuccess: (result: AllocationSplitExecutionResponse) => void | Promise<void>;
  onFullAllocationReject: (input: { orderId: string; reason: RejectOrderReason; note: string }) => void | Promise<void>;
};

function getItemInitials(name: string) {
  const [first = '', second = ''] = name.trim().split(/\s+/);
  return `${first[0] ?? 'I'}${second[0] ?? ''}`.toUpperCase();
}

function getLineItemImageAlt(item: OrderDetail['lineItems'][number]) {
  return item.name ? `${item.name} product image` : item.sku ? `${item.sku} product image` : 'Product image';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AllocationSplitRejectModal({
  order,
  vendorId,
  onClose,
  onSuccess,
  onFullAllocationReject,
}: AllocationSplitRejectModalProps) {
  const lineItems = useMemo(() => safeArray(order.lineItems).length ? safeArray(order.lineItems) : safeArray(order.items), [order.items, order.lineItems]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [reason, setReason] = useState<RejectOrderReason>('OUT_OF_STOCK');
  const [note, setNote] = useState('');
  const [plannerResult, setPlannerResult] = useState<AllocationSplitPlannerResponse | null>(null);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<AllocationSplitExecutionResponse | null>(null);

  const selectedCount = selectedLineIds.length;
  const remainingCount = Math.max(lineItems.length - selectedCount, 0);
  const noteLength = note.trim().length;
  const canPlan = selectedCount > 0 && !isPlanning && !isExecuting;
  const canExecuteSplit = plannerResult?.decision === 'can_split' && confirmationChecked && !isExecuting;
  const fullAllocationFallback = plannerResult?.decision === 'use_full_allocation_reject';

  function toggleLineItem(lineItemId: string) {
    setPlannerResult(null);
    setConfirmationChecked(false);
    setSuccessResult(null);
    setErrorMessage(null);
    setSelectedLineIds((current) =>
      current.includes(lineItemId)
        ? current.filter((id) => id !== lineItemId)
        : [...current, lineItemId],
    );
  }

  async function handlePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPlan) {
      setErrorMessage('Select at least one line item.');
      return;
    }

    setIsPlanning(true);
    setErrorMessage(null);
    setPlannerResult(null);
    setConfirmationChecked(false);
    try {
      const result = await planAllocationSplit(order.id, {
        selectedVendorAllocationLineItemIds: selectedLineIds,
        reason,
        note: note.trim() || undefined,
      }, {
        vendorId,
      });
      setPlannerResult(result);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Split preview could not be loaded.'));
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleExecuteSplit() {
    if (!canExecuteSplit) {
      return;
    }

    setIsExecuting(true);
    setErrorMessage(null);
    try {
      const result = await splitAllocation(order.id, {
        selectedVendorAllocationLineItemIds: selectedLineIds,
        reason,
        note: note.trim() || undefined,
        confirmSplit: true,
      }, {
        vendorId,
      });
      setSuccessResult(result);
      await onSuccess(result);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Selected items could not be rejected.'));
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleFullAllocationReject() {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setErrorMessage('Reject note is required for full allocation reject.');
      return;
    }

    setIsExecuting(true);
    setErrorMessage(null);
    try {
      await onFullAllocationReject({
        orderId: order.id,
        reason,
        note: trimmedNote,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Order could not be rejected.'));
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div className="support-modal-backdrop" role="presentation">
      <section className="support-modal allocation-split-modal" role="dialog" aria-modal="true" aria-labelledby="allocation-split-title">
        <div className="support-modal-header">
          <div>
            <h2 id="allocation-split-title">Reject selected items</h2>
            <p>{formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</p>
          </div>
          <button
            type="button"
            className="support-modal-close"
            onClick={onClose}
            aria-label="Close reject selected items form"
            disabled={isPlanning || isExecuting}
          >
            x
          </button>
        </div>

        <form className="support-ticket-form allocation-split-form" onSubmit={handlePlan}>
          <div className="allocation-split-two-column">
            <label>
              Reason
              <select
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value as RejectOrderReason);
                  setPlannerResult(null);
                  setConfirmationChecked(false);
                }}
                required
              >
                {REJECT_REASONS.map((candidate) => (
                  <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
                ))}
              </select>
            </label>
            <label>
              Note
              <textarea
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setPlannerResult(null);
                  setConfirmationChecked(false);
                }}
                maxLength={500}
                rows={3}
                placeholder="Explain which items cannot be fulfilled."
              />
            </label>
          </div>

          <section className="allocation-split-section" aria-label="Line item selection">
            <div className="allocation-split-section-heading">
              <strong>Line items</strong>
              <span>{selectedCount} selected · {remainingCount} remaining</span>
            </div>
            <div className="allocation-split-line-list">
              {lineItems.map((item) => (
                <label key={item.id} className="allocation-split-line-option">
                  <input
                    type="checkbox"
                    checked={selectedLineIds.includes(item.id)}
                    onChange={() => toggleLineItem(item.id)}
                  />
                  <ProductImagePreview
                    imageUrl={item.imageUrl}
                    fallbackLabel={getItemInitials(item.name || item.sku || 'Item')}
                    alt={getLineItemImageAlt(item)}
                    title={item.name || item.sku || 'Product image'}
                    subtitle={[item.sku, item.variantTitle].filter(Boolean).join(' · ')}
                    size="compact"
                  />
                  <span>
                    <strong>{item.name || 'Unknown item'}</strong>
                    <small>{[item.sku, item.variantTitle].filter(Boolean).join(' · ') || 'SKU pending'}</small>
                  </span>
                  <em>Qty {item.quantity}</em>
                  <b>{item.price}</b>
                </label>
              ))}
            </div>
          </section>

          {plannerResult ? (
            <section className="allocation-split-section" aria-label="Split preview">
              <div className="allocation-split-section-heading">
                <strong>Split preview</strong>
                <span>{plannerResult.decision.replace(/_/g, ' ')}</span>
              </div>

              {plannerResult.decision === 'blocked' ? (
                <div className="allocation-split-blockers">
                  {plannerResult.blockers.map((blocker) => (
                    <article key={blocker.code} className="allocation-split-blocker-card">
                      <strong>{blocker.code.replace(/_/g, ' ')}</strong>
                      <span>{blocker.message}</span>
                    </article>
                  ))}
                </div>
              ) : null}

              {fullAllocationFallback ? (
                <div className="allocation-split-warning">
                  <strong>All items selected.</strong>
                  <span>Use the standard reject allocation workflow instead of creating a split.</span>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => void handleFullAllocationReject()}
                    disabled={isExecuting}
                  >
                    {isExecuting ? 'Rejecting...' : 'Continue with full allocation reject'}
                  </button>
                </div>
              ) : null}

              {plannerResult.decision === 'can_split' ? (
                <>
                  <div className="allocation-split-preview-lines">
                    <div>
                      <strong>Selected items</strong>
                      {plannerResult.selectedLines.map((item) => (
                        <span key={item.id}>
                          {item.title || item.sku || item.shopifyLineItemId} · Qty {item.quantity} · {formatCurrency(item.lineAmount)}
                        </span>
                      ))}
                    </div>
                    <div>
                      <strong>Remaining items</strong>
                      {plannerResult.remainingLines.map((item) => (
                        <span key={item.id}>
                          {item.title || item.sku || item.shopifyLineItemId} · Qty {item.quantity} · {formatCurrency(item.lineAmount)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="allocation-split-preview-grid">
                    <div>
                      <span>Original amount</span>
                      <strong>{formatCurrency(plannerResult.amountPlan.originalAmount)}</strong>
                    </div>
                    <div>
                      <span>Selected amount</span>
                      <strong>{formatCurrency(plannerResult.amountPlan.selectedAmount)}</strong>
                    </div>
                    <div>
                      <span>Remaining amount</span>
                      <strong>{formatCurrency(plannerResult.amountPlan.remainingAmount)}</strong>
                    </div>
                  </div>
                  <div className="allocation-split-result-copy">
                    <strong>Proposed result</strong>
                    <span>Original allocation remains active.</span>
                    <span>Blocked allocation created for selected items.</span>
                    <span>Sporgym admin must transfer, refund, or return the blocked allocation.</span>
                  </div>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={confirmationChecked}
                      onChange={(event) => setConfirmationChecked(event.target.checked)}
                    />
                    <span>
                      I understand selected items will move to a new blocked allocation and remaining items stay fulfillable.
                    </span>
                  </label>
                </>
              ) : null}
            </section>
          ) : null}

          {successResult ? (
            <section className="allocation-split-success" aria-label="Split completed">
              <strong>Split completed.</strong>
              <span>Blocked allocation created: {successResult.childAllocationId}</span>
              <span>Source allocation remains active: {successResult.sourceAllocationId}</span>
              <span>Reason: {successResult.splitSummary.reason}</span>
            </section>
          ) : null}

          {errorMessage ? <p className="allocation-split-error">{errorMessage}</p> : null}

          <div className="support-modal-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
              disabled={isPlanning || isExecuting}
            >
              {successResult ? 'Close' : 'Cancel'}
            </button>
            {!successResult ? (
              <>
                <button type="submit" className="button button-secondary" disabled={!canPlan}>
                  {isPlanning ? 'Checking...' : plannerResult ? 'Refresh preview' : 'Continue'}
                </button>
                {plannerResult?.decision === 'can_split' ? (
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => void handleExecuteSplit()}
                    disabled={!canExecuteSplit}
                  >
                    {isExecuting ? 'Rejecting...' : 'Confirm split'}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {!plannerResult && !successResult && noteLength === 0 ? (
            <p className="support-context-note">Note is optional for split preview, but required if all items are rejected.</p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
