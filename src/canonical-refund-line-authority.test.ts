import { describe, expect, it } from 'vitest';
import {
  evaluateCanonicalRefundLineAuthority,
} from '../backend/src/modules/finance/canonical-refund-line-authority.service.js';
import type { CanonicalRefundLineEvidence } from '../backend/src/modules/shopify/shopify-refund-monetary-evidence.js';

function line(overrides: Partial<CanonicalRefundLineEvidence> = {}): CanonicalRefundLineEvidence {
  return {
    sourceRefundLineItemId: 'refund-line-1',
    sourceLineItemId: 'order-line-1',
    sku: 'SKU-1',
    quantity: 1,
    quantityProvenance: 'OBSERVED_VALID',
    subtotalAmount: '0.00',
    subtotalAmountProvenance: 'OBSERVED',
    subtotalCurrency: null,
    ...overrides,
  };
}

describe('canonical refund line authority', () => {
  it('accepts observed quantity one, observed zero subtotal, and nullable line currency', () => {
    expect(evaluateCanonicalRefundLineAuthority({
      sourceRefundLineItemIds: ['refund-line-1'],
      canonicalLines: [line()],
    })).toEqual({ authoritative: true, failures: [] });
  });

  it.each([
    {
      name: 'missing original line id even with SKU',
      overrides: { sourceLineItemId: null },
      reasonCode: 'missing_original_line_item_id',
    },
    {
      name: 'missing observed quantity despite compatibility-shaped one',
      overrides: { quantity: null, quantityProvenance: 'ABSENT' },
      reasonCode: 'missing_observed_quantity',
    },
    {
      name: 'invalid observed quantity',
      overrides: { quantity: 0, quantityProvenance: 'OBSERVED_INVALID' },
      reasonCode: 'invalid_observed_quantity',
    },
    {
      name: 'missing observed subtotal despite compatibility-shaped zero',
      overrides: { subtotalAmount: null, subtotalAmountProvenance: 'ABSENT' },
      reasonCode: 'missing_observed_subtotal',
    },
    {
      name: 'invalid observed subtotal',
      overrides: { subtotalAmount: 'not-money' },
      reasonCode: 'invalid_observed_subtotal',
    },
  ] as const)('rejects $name', ({ overrides, reasonCode }) => {
    expect(evaluateCanonicalRefundLineAuthority({
      sourceRefundLineItemIds: ['refund-line-1'],
      canonicalLines: [line(overrides as Partial<CanonicalRefundLineEvidence>)],
    })).toEqual({
      authoritative: false,
      failures: [{ sourceRefundLineItemId: 'refund-line-1', reasonCode }],
    });
  });

  it('reports multiple defects in deterministic line and reason order', () => {
    expect(evaluateCanonicalRefundLineAuthority({
      sourceRefundLineItemIds: ['refund-line-b', 'refund-line-a'],
      canonicalLines: [
        line({
          sourceRefundLineItemId: 'refund-line-b',
          sourceLineItemId: '',
          quantity: null,
          quantityProvenance: 'ABSENT',
          subtotalAmount: null,
          subtotalAmountProvenance: 'ABSENT',
        }),
      ],
    })).toEqual({
      authoritative: false,
      failures: [
        { sourceRefundLineItemId: 'refund-line-a', reasonCode: 'missing_canonical_refund_line' },
        { sourceRefundLineItemId: 'refund-line-b', reasonCode: 'missing_original_line_item_id' },
        { sourceRefundLineItemId: 'refund-line-b', reasonCode: 'missing_observed_quantity' },
        { sourceRefundLineItemId: 'refund-line-b', reasonCode: 'missing_observed_subtotal' },
      ],
    });
  });

  it('rejects duplicate canonical evidence for the same refund line', () => {
    expect(evaluateCanonicalRefundLineAuthority({
      sourceRefundLineItemIds: ['refund-line-1'],
      canonicalLines: [line(), line()],
    })).toEqual({
      authoritative: false,
      failures: [{
        sourceRefundLineItemId: 'refund-line-1',
        reasonCode: 'ambiguous_canonical_refund_line',
      }],
    });
  });
});
