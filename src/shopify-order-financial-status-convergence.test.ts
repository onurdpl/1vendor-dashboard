import { describe, expect, it, vi } from 'vitest';
import {
  normalizeCanonicalShopifyOrderFinancialStatus,
  synchronizeCanonicalShopifyOrderFinancialStatus,
} from '../backend/src/modules/shopify/shopify-order-financial-status.service.js';

function buildStore() {
  return {
    shopifyOrder: {
      update: vi.fn().mockResolvedValue({ id: 'order-db-1' }),
    },
  };
}

describe('canonical Shopify order financial-status convergence', () => {
  it('normalizes canonical Shopify status using the persisted repository convention', () => {
    expect(normalizeCanonicalShopifyOrderFinancialStatus(' PARTIALLY_REFUNDED ')).toBe('partially_refunded');
    expect(normalizeCanonicalShopifyOrderFinancialStatus('REFUNDED')).toBe('refunded');
  });

  it('converges paid to the canonical partial-refund status', async () => {
    const db = buildStore();

    await expect(synchronizeCanonicalShopifyOrderFinancialStatus({
      db,
      shopifyOrder: { id: 'order-db-1', financialStatus: 'paid' },
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    })).resolves.toEqual({ updated: true, financialStatus: 'partially_refunded' });

    expect(db.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-db-1' },
      data: { financialStatus: 'partially_refunded' },
    });
  });

  it('converges paid or partial status to the canonical full-refund status', async () => {
    const db = buildStore();

    await synchronizeCanonicalShopifyOrderFinancialStatus({
      db,
      shopifyOrder: { id: 'order-db-1', financialStatus: 'partially_refunded' },
      canonicalFinancialStatus: 'REFUNDED',
    });

    expect(db.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-db-1' },
      data: { financialStatus: 'refunded' },
    });
  });

  it('does not write when the persisted status is already canonical', async () => {
    const db = buildStore();

    await expect(synchronizeCanonicalShopifyOrderFinancialStatus({
      db,
      shopifyOrder: { id: 'order-db-1', financialStatus: 'refunded' },
      canonicalFinancialStatus: 'REFUNDED',
    })).resolves.toEqual({ updated: false, financialStatus: 'refunded' });

    expect(db.shopifyOrder.update).not.toHaveBeenCalled();
  });

  it('fails closed without canonical Shopify financial status', async () => {
    const db = buildStore();

    await expect(synchronizeCanonicalShopifyOrderFinancialStatus({
      db,
      shopifyOrder: { id: 'order-db-1', financialStatus: 'paid' },
      canonicalFinancialStatus: null,
    })).resolves.toEqual({ updated: false, financialStatus: null });

    expect(db.shopifyOrder.update).not.toHaveBeenCalled();
  });
});
