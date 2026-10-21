import type { Prisma, PrismaClient } from '@prisma/client';
import { resolveVendorIdentity, type VendorIdentityCutoverSnapshot } from './vendor-identity-cutover.service.js';

type Database = Prisma.TransactionClient | PrismaClient;

export class VendorIdentityRoutingError extends Error {
  constructor(public readonly reason: string) {
    super(`Shopify vendor identity cannot be resolved: ${reason}`);
    this.name = 'VendorIdentityRoutingError';
  }
}

export function resolveOrderSellerVendorsFromEvidence(input: {
  sellerSlugs: readonly (string | null | undefined)[];
  sourceShopifyOrderId: string;
  canonicalOrder: {
    orderGid: string | null | undefined;
    createdAtUtc: string | null | undefined;
    source: 'SHOPIFY_ADMIN_GRAPHQL' | null;
  } | null;
  cutovers: readonly VendorIdentityCutoverSnapshot[];
  knownVendorIds: ReadonlySet<string>;
}): Map<string, string> {
  const slugs = Array.from(new Set(input.sellerSlugs.map((value) => value?.trim().toLowerCase() ?? '')));
  if (slugs.includes('')) throw new VendorIdentityRoutingError('SELLER_SLUG_MISSING');
  if (input.cutovers.some((mapping) => mapping.active && slugs.includes(mapping.externalSellerSlug))) {
    const expectedGid = `gid://shopify/Order/${input.sourceShopifyOrderId}`;
    if (input.canonicalOrder?.orderGid !== expectedGid) {
      throw new VendorIdentityRoutingError('SHOPIFY_ORDER_IDENTITY_MISMATCH');
    }
  }
  const resolved = new Map<string, string>();
  for (const slug of slugs) {
    const result = resolveVendorIdentity({
      externalSellerSlug: slug,
      canonicalOrder: input.canonicalOrder,
      cutovers: input.cutovers,
      knownVendorIds: input.knownVendorIds,
    });
    if (!result.ok) throw new VendorIdentityRoutingError(result.reason);
    resolved.set(slug, result.vendorId);
  }
  return resolved;
}

/** The caller must supply the identity returned by the same canonical Shopify order read. */
export async function resolveOrderSellerVendors(input: {
  db: Database;
  sellerSlugs: readonly (string | null | undefined)[];
  sourceShopifyOrderId: string;
  canonicalOrder: {
    orderGid: string | null | undefined;
    createdAtUtc: string | null | undefined;
    source: 'SHOPIFY_ADMIN_GRAPHQL' | null;
  } | null;
}): Promise<Map<string, string>> {
  const slugs = Array.from(new Set(input.sellerSlugs.map((value) => value?.trim().toLowerCase() ?? '')));
  if (slugs.includes('')) throw new VendorIdentityRoutingError('SELLER_SLUG_MISSING');

  const [vendors, cutovers] = await Promise.all([
    input.db.vendor.findMany({ where: { id: { in: slugs } }, select: { id: true } }),
    input.db.vendorIdentityCutover.findMany({ where: { externalSellerSlug: { in: slugs } } }),
  ]);
  const knownVendorIds = new Set(vendors.map((vendor) => vendor.id));
  const targetIds = cutovers.flatMap((mapping) => [mapping.previousVendorId, mapping.replacementVendorId]);
  if (targetIds.length) {
    const targets = await input.db.vendor.findMany({ where: { id: { in: targetIds } }, select: { id: true } });
    targets.forEach((vendor) => knownVendorIds.add(vendor.id));
  }
  return resolveOrderSellerVendorsFromEvidence({ ...input, cutovers, knownVendorIds });
}
