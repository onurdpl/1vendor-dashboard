import { describe, expect, it, vi } from 'vitest';
import {
  resolveOrderSellerVendors,
  resolveOrderSellerVendorsFromEvidence,
  VendorIdentityRoutingError,
} from '../backend/src/modules/shopify/vendor-identity-routing.service.js';

const cutover = {
  externalSellerSlug: 'sporjinal',
  previousVendorId: 'sporjinal',
  replacementVendorId: 'demo-sporjinal',
  approvedCutoverAt: new Date('2026-11-01T12:00:00.000Z'),
  active: true,
  activatedAt: new Date('2026-10-31T12:00:00.000Z'),
};
const vendors = new Set(['sporjinal', 'demo-sporjinal', 'yalispor']);
const canonical = (createdAtUtc: string | null, orderGid = 'gid://shopify/Order/123') => ({
  orderGid, createdAtUtc, source: 'SHOPIFY_ADMIN_GRAPHQL' as const,
});

describe('shared Shopify vendor routing', () => {
  it('preserves direct slug routing when no cutover is active, including mixed vendors', () => {
    expect([...resolveOrderSellerVendorsFromEvidence({
      sellerSlugs: ['sporjinal', 'yalispor'], sourceShopifyOrderId: '123',
      canonicalOrder: null, cutovers: [], knownVendorIds: vendors,
    })]).toEqual([['sporjinal', 'sporjinal'], ['yalispor', 'yalispor']]);
  });

  it('routes a delayed historical order to the old vendor and a new order to the replacement', () => {
    for (const [time, expected] of [
      ['2026-10-31T23:59:59Z', 'sporjinal'],
      ['2026-11-01T12:00:00.000Z', 'demo-sporjinal'],
      ['2026-11-02T00:00:00Z', 'demo-sporjinal'],
    ]) {
      expect(resolveOrderSellerVendorsFromEvidence({
        sellerSlugs: ['sporjinal', 'yalispor'], sourceShopifyOrderId: '123',
        canonicalOrder: canonical(time), cutovers: [cutover], knownVendorIds: vendors,
      })).toEqual(new Map([['sporjinal', expected], ['yalispor', 'yalispor']]));
    }
  });

  it('rejects contradictory order identity and ambiguous timestamp at the cutoff', () => {
    for (const authority of [canonical('2026-11-01T12:00:00.000Z', 'gid://shopify/Order/999'), canonical('2026-11-01T12:00:00Z')]) {
      expect(() => resolveOrderSellerVendorsFromEvidence({
        sellerSlugs: ['sporjinal'], sourceShopifyOrderId: '123', canonicalOrder: authority,
        cutovers: [cutover], knownVendorIds: vendors,
      })).toThrow(VendorIdentityRoutingError);
    }
  });

  it('reads the persisted mapping and target vendor identity before resolving', async () => {
    const db = {
      vendor: { findMany: vi.fn(async () => [{ id: 'sporjinal' }, { id: 'demo-sporjinal' }]) },
      vendorIdentityCutover: { findMany: vi.fn(async () => [cutover]) },
    };
    const result = await resolveOrderSellerVendors({
      db: db as never, sellerSlugs: ['sporjinal'], sourceShopifyOrderId: '123',
      canonicalOrder: canonical('2026-11-01T12:00:00.000Z'),
    });
    expect(result.get('sporjinal')).toBe('demo-sporjinal');
    expect(db.vendorIdentityCutover.findMany).toHaveBeenCalledWith({
      where: { externalSellerSlug: { in: ['sporjinal'] } },
    });
  });
});
