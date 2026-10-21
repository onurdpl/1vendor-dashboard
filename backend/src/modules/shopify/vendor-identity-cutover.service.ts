/** Pure cutover decision: callers must obtain canonical order authority themselves. */
export type VendorIdentityCutoverSnapshot = {
  externalSellerSlug: string;
  previousVendorId: string;
  replacementVendorId: string;
  approvedCutoverAt: Date;
  active: boolean;
  activatedAt: Date | null;
};

export type VendorIdentityResolutionInput = {
  externalSellerSlug: string | null | undefined;
  canonicalOrder: {
    orderGid: string | null | undefined;
    createdAtUtc: string | null | undefined;
    source: 'SHOPIFY_ADMIN_GRAPHQL' | null;
  } | null;
  cutovers: readonly VendorIdentityCutoverSnapshot[];
  knownVendorIds: ReadonlySet<string>;
};

export type VendorIdentityResolution =
  | { ok: true; vendorId: string; authority: 'LEGACY_SLUG' | 'APPROVED_CUTOVER' }
  | { ok: false; reason:
      | 'SELLER_SLUG_MISSING'
      | 'CONFLICTING_CUTOVER_CONFIGURATION'
      | 'INVALID_CUTOVER_CONFIGURATION'
      | 'SHOPIFY_ORDER_IDENTITY_MISSING'
      | 'SHOPIFY_ORDER_TIME_MISSING_OR_INVALID'
      | 'SHOPIFY_ORDER_AUTHORITY_UNVERIFIED'
      | 'UNKNOWN_VENDOR' };

function validUtcInstant(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const parsedCanonical = timestamp.toISOString();
  const inputCanonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) =>
    `.${(fraction ?? '').padEnd(3, '0')}Z`);
  return parsedCanonical === inputCanonical ? timestamp : null;
}

function validCutover(mapping: VendorIdentityCutoverSnapshot, slug: string): boolean {
  return mapping.externalSellerSlug === slug &&
    /^[a-z0-9][a-z0-9_-]*$/.test(mapping.externalSellerSlug) &&
    Boolean(mapping.previousVendorId && mapping.replacementVendorId) &&
    mapping.previousVendorId === slug &&
    mapping.previousVendorId !== mapping.replacementVendorId &&
    mapping.approvedCutoverAt instanceof Date && Number.isFinite(mapping.approvedCutoverAt.getTime()) &&
    (mapping.active
      ? mapping.activatedAt instanceof Date && Number.isFinite(mapping.activatedAt.getTime())
      : mapping.activatedAt === null);
}

/** No database or Shopify read, and no ownership mutation. */
export function resolveVendorIdentity(input: VendorIdentityResolutionInput): VendorIdentityResolution {
  const slug = input.externalSellerSlug?.trim().toLowerCase();
  if (!slug) return { ok: false, reason: 'SELLER_SLUG_MISSING' };

  const matching = input.cutovers.filter((mapping) => mapping.externalSellerSlug === slug);
  if (matching.length > 1) return { ok: false, reason: 'CONFLICTING_CUTOVER_CONFIGURATION' };
  const mapping = matching[0];
  if (mapping && !validCutover(mapping, slug)) {
    return { ok: false, reason: 'INVALID_CUTOVER_CONFIGURATION' };
  }

  if (!mapping?.active) {
    return input.knownVendorIds.has(slug)
      ? { ok: true, vendorId: slug, authority: 'LEGACY_SLUG' }
      : { ok: false, reason: 'UNKNOWN_VENDOR' };
  }

  if (input.canonicalOrder?.source !== 'SHOPIFY_ADMIN_GRAPHQL') {
    return { ok: false, reason: 'SHOPIFY_ORDER_AUTHORITY_UNVERIFIED' };
  }
  if (!/^gid:\/\/shopify\/Order\/[0-9]+$/.test(input.canonicalOrder.orderGid ?? '')) {
    return { ok: false, reason: 'SHOPIFY_ORDER_IDENTITY_MISSING' };
  }
  const createdAt = validUtcInstant(input.canonicalOrder.createdAtUtc);
  if (!createdAt) return { ok: false, reason: 'SHOPIFY_ORDER_TIME_MISSING_OR_INVALID' };

  // Lower-than-millisecond Shopify precision cannot establish the boundary second.
  const fractionalDigits = input.canonicalOrder.createdAtUtc?.match(/\.(\d+)Z$/)?.[1]?.length ?? 0;
  if (fractionalDigits < 3 &&
      Math.floor(createdAt.getTime() / 1000) === Math.floor(mapping.approvedCutoverAt.getTime() / 1000)) {
    return { ok: false, reason: 'SHOPIFY_ORDER_TIME_MISSING_OR_INVALID' };
  }

  const vendorId = createdAt.getTime() < mapping.approvedCutoverAt.getTime()
    ? mapping.previousVendorId
    : mapping.replacementVendorId;
  return input.knownVendorIds.has(vendorId)
    ? { ok: true, vendorId, authority: 'APPROVED_CUTOVER' }
    : { ok: false, reason: 'UNKNOWN_VENDOR' };
}
