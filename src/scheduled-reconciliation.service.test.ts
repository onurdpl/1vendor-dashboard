import { describe, expect, it } from 'vitest';
import {
  buildScheduledReconciliationCandidate,
  buildScheduledReconciliationPayload,
  isReconciliationJobActive,
  isWithinReconciliationCooldown,
} from '../backend/src/modules/reconciliation/scheduled-reconciliation.service.js';

describe('scheduled reconciliation foundation', () => {
  it('builds stable reconciliation candidates for stale allocation scheduling', () => {
    const detectedAt = new Date('2026-05-13T10:00:00.000Z');
    const candidate = buildScheduledReconciliationCandidate({
      type: 'stale_allocation',
      reason: 'Allocation should be refreshed from canonical Shopify state.',
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      vendorAllocationId: 'alloc-1',
      priority: 7,
      detectedAt,
    });

    expect(candidate.key).toBe('stale_allocation:allocation:alloc-1:order:gid://shopify/Order/1001');
    expect(candidate.source).toBe('scheduled_reconciliation');
    expect(candidate.detectedAt).toBe(detectedAt);
  });

  it('serializes the reconciliation reason into operational job payload metadata', () => {
    const detectedAt = new Date('2026-05-13T10:00:00.000Z');
    const candidate = buildScheduledReconciliationCandidate({
      type: 'missing_refund_ledger',
      reason: 'Refund is missing a matching operational finance ledger entry.',
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      vendorAllocationId: 'alloc-1',
      refundRecordId: 'refund-record-1',
      priority: 8,
      detectedAt,
    });

    expect(buildScheduledReconciliationPayload(candidate)).toEqual({
      source: 'scheduled_reconciliation',
      candidateKey: 'missing_refund_ledger:allocation:alloc-1:refund:refund-record-1:order:gid://shopify/Order/1001',
      candidateType: 'missing_refund_ledger',
      reason: 'Refund is missing a matching operational finance ledger entry.',
      detectedAt: '2026-05-13T10:00:00.000Z',
    });
  });

  it('treats pending and retrying reconciliation jobs as active duplicate protection', () => {
    expect(isReconciliationJobActive('PENDING')).toBe(true);
    expect(isReconciliationJobActive('RETRYING')).toBe(true);
    expect(isReconciliationJobActive('COMPLETED')).toBe(false);
  });

  it('enforces reconciliation cooldown windows for terminal jobs', () => {
    const now = new Date('2026-05-13T10:30:00.000Z');

    expect(isWithinReconciliationCooldown({
      latestJobAt: new Date('2026-05-13T10:05:00.000Z'),
      now,
      cooldownMs: 30 * 60 * 1000,
    })).toBe(true);
    expect(isWithinReconciliationCooldown({
      latestJobAt: new Date('2026-05-13T09:30:00.000Z'),
      now,
      cooldownMs: 30 * 60 * 1000,
    })).toBe(false);
  });
});
