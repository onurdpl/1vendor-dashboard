import { describe, expect, it } from 'vitest';
import {
  resolveVendorIdentity,
  type VendorIdentityCutoverSnapshot,
  type VendorIdentityResolutionInput,
} from '../backend/src/modules/shopify/vendor-identity-cutover.service.js';

const cutoverAt = new Date('2026-11-01T12:00:00.000Z');
const knownVendorIds = new Set(['sporjinal', 'demo-sporjinal', 'yalispor']);

function mapping(overrides: Partial<VendorIdentityCutoverSnapshot> = {}): VendorIdentityCutoverSnapshot {
  return {
    externalSellerSlug: 'sporjinal',
    previousVendorId: 'sporjinal',
    replacementVendorId: 'demo-sporjinal',
    approvedCutoverAt: cutoverAt,
    active: true,
    activatedAt: new Date('2026-10-31T12:00:00.000Z'),
    ...overrides,
  };
}

function request(overrides: Partial<VendorIdentityResolutionInput> = {}): VendorIdentityResolutionInput {
  return {
    externalSellerSlug: 'sporjinal',
    canonicalOrder: {
      orderGid: 'gid://shopify/Order/123',
      createdAtUtc: '2026-11-01T11:59:59.999Z',
      source: 'SHOPIFY_ADMIN_GRAPHQL',
    },
    cutovers: [mapping()],
    knownVendorIds,
    ...overrides,
  };
}

describe('dormant vendor identity cutover resolver', () => {
  it('preserves existing slug routing with no active mapping', () => {
    expect(resolveVendorIdentity(request({ cutovers: [], canonicalOrder: null }))).toEqual({
      ok: true, vendorId: 'sporjinal', authority: 'LEGACY_SLUG',
    });
    expect(resolveVendorIdentity(request({ cutovers: [mapping({ active: false, activatedAt: null })], canonicalOrder: null }))).toEqual({
      ok: true, vendorId: 'sporjinal', authority: 'LEGACY_SLUG',
    });
  });

  it('routes before, exactly at, and after the approved UTC cutover', () => {
    expect(resolveVendorIdentity(request())).toEqual({ ok: true, vendorId: 'sporjinal', authority: 'APPROVED_CUTOVER' });
    for (const createdAtUtc of ['2026-11-01T12:00:00.000Z', '2026-11-01T12:00:00.001Z']) {
      expect(resolveVendorIdentity(request({ canonicalOrder: {
        orderGid: 'gid://shopify/Order/123', createdAtUtc, source: 'SHOPIFY_ADMIN_GRAPHQL',
      } }))).toEqual({ ok: true, vendorId: 'demo-sporjinal', authority: 'APPROVED_CUTOVER' });
    }
  });

  it('fails closed for second-precision evidence in the cutover second', () => {
    for (const createdAtUtc of ['2026-11-01T12:00:00Z', '2026-11-01T12:00:00.0Z', '2026-11-01T12:00:00.00Z']) {
      expect(resolveVendorIdentity(request({ canonicalOrder: {
        orderGid: 'gid://shopify/Order/123', createdAtUtc, source: 'SHOPIFY_ADMIN_GRAPHQL',
      } }))).toEqual({ ok: false, reason: 'SHOPIFY_ORDER_TIME_MISSING_OR_INVALID' });
    }
  });

  it('leaves unrelated slugs on existing direct-ID routing', () => {
    expect(resolveVendorIdentity(request({ externalSellerSlug: ' YALISPOR ', canonicalOrder: null }))).toEqual({
      ok: true, vendorId: 'yalispor', authority: 'LEGACY_SLUG',
    });
  });

  it('fails closed without canonical Shopify order identity, time, or authority', () => {
    expect(resolveVendorIdentity(request({ canonicalOrder: null }))).toEqual({ ok: false, reason: 'SHOPIFY_ORDER_AUTHORITY_UNVERIFIED' });
    expect(resolveVendorIdentity(request({ canonicalOrder: {
      orderGid: '', createdAtUtc: '2026-11-01T12:00:00Z', source: 'SHOPIFY_ADMIN_GRAPHQL',
    } }))).toEqual({ ok: false, reason: 'SHOPIFY_ORDER_IDENTITY_MISSING' });
    expect(resolveVendorIdentity(request({ canonicalOrder: {
      orderGid: 'gid://shopify/Order/123', createdAtUtc: null, source: 'SHOPIFY_ADMIN_GRAPHQL',
    } }))).toEqual({ ok: false, reason: 'SHOPIFY_ORDER_TIME_MISSING_OR_INVALID' });
    expect(resolveVendorIdentity(request({ canonicalOrder: {
      orderGid: 'gid://shopify/Order/123', createdAtUtc: '2026-11-01T12:00:00Z', source: null,
    } }))).toEqual({ ok: false, reason: 'SHOPIFY_ORDER_AUTHORITY_UNVERIFIED' });
  });

  it('rejects non-UTC, invalid-calendar, and unsupported higher-precision timestamps', () => {
    for (const createdAtUtc of ['2026-11-01T13:00:00+01:00', '2026-02-30T12:00:00Z', '2026-11-01T12:00:00.000001Z']) {
      expect(resolveVendorIdentity(request({ canonicalOrder: {
        orderGid: 'gid://shopify/Order/123', createdAtUtc, source: 'SHOPIFY_ADMIN_GRAPHQL',
      } }))).toEqual({ ok: false, reason: 'SHOPIFY_ORDER_TIME_MISSING_OR_INVALID' });
    }
  });

  it('rejects an unknown resolved vendor', () => {
    expect(resolveVendorIdentity(request({ knownVendorIds: new Set(['sporjinal']) , canonicalOrder: {
      orderGid: 'gid://shopify/Order/123', createdAtUtc: '2026-11-01T12:00:00.000Z', source: 'SHOPIFY_ADMIN_GRAPHQL',
    } }))).toEqual({ ok: false, reason: 'UNKNOWN_VENDOR' });
  });

  it('rejects missing seller slug and duplicate or inconsistent cutover configuration', () => {
    expect(resolveVendorIdentity(request({ externalSellerSlug: '' }))).toEqual({ ok: false, reason: 'SELLER_SLUG_MISSING' });
    expect(resolveVendorIdentity(request({ cutovers: [mapping(), mapping()] }))).toEqual({
      ok: false, reason: 'CONFLICTING_CUTOVER_CONFIGURATION',
    });
    for (const invalid of [
      mapping({ replacementVendorId: 'sporjinal' }),
      mapping({ previousVendorId: 'yalispor' }),
      mapping({ active: true, activatedAt: null }),
      mapping({ active: false, activatedAt: new Date() }),
      mapping({ approvedCutoverAt: new Date('invalid') }),
    ]) {
      expect(resolveVendorIdentity(request({ cutovers: [invalid] }))).toEqual({
        ok: false, reason: 'INVALID_CUTOVER_CONFIGURATION',
      });
    }
  });
});
