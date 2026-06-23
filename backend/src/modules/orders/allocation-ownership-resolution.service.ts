import type { Prisma } from '@prisma/client';

type AllocationOwnershipResolutionDb = Pick<
  Prisma.TransactionClient,
  'shopifyOrderLineItem' | 'vendorAllocationLineItem'
>;

export class AllocationOwnershipResolutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AllocationOwnershipResolutionError';
  }
}

export async function resolveAllocationForShopifyOrderLineItem(
  input: {
    shopifyOrderId: string;
    shopifyOrderLineItemId?: string | null;
    sourceLineItemId?: string | null;
  },
  db: AllocationOwnershipResolutionDb,
) {
  const shopifyOrderId = input.shopifyOrderId.trim();
  const shopifyOrderLineItemId = input.shopifyOrderLineItemId?.trim() ?? '';
  const sourceLineItemId = input.sourceLineItemId?.trim() ?? '';

  if (!shopifyOrderId) {
    throw new AllocationOwnershipResolutionError(
      'shopify_order_missing',
      'Shopify order id is required to resolve allocation ownership.',
    );
  }

  if (!shopifyOrderLineItemId && !sourceLineItemId) {
    throw new AllocationOwnershipResolutionError(
      'shopify_order_line_item_missing',
      'Shopify order line item id or source line item id is required to resolve allocation ownership.',
    );
  }

  const lineItemOr: Prisma.ShopifyOrderLineItemWhereInput[] = [];
  if (shopifyOrderLineItemId) {
    lineItemOr.push({ id: shopifyOrderLineItemId });
    lineItemOr.push({ sourceLineItemId: shopifyOrderLineItemId });
  }
  if (sourceLineItemId) {
    lineItemOr.push({ sourceLineItemId });
  }

  const lineItems = await db.shopifyOrderLineItem.findMany({
    where: {
      shopifyOrderId,
      OR: lineItemOr,
    },
    take: 2,
  });

  if (lineItems.length === 0) {
    throw new AllocationOwnershipResolutionError(
      'shopify_order_line_item_not_found',
      `No Shopify order line item found for ownership resolution (${sourceLineItemId || shopifyOrderLineItemId}).`,
    );
  }

  if (lineItems.length > 1) {
    throw new AllocationOwnershipResolutionError(
      'multiple_shopify_order_line_items',
      `Multiple Shopify order line items matched ownership resolution input (${sourceLineItemId || shopifyOrderLineItemId}).`,
    );
  }

  const shopifyOrderLineItem = lineItems[0];
  const owners = await db.vendorAllocationLineItem.findMany({
    where: {
      shopifyLineItemId: shopifyOrderLineItem.id,
    },
    include: {
      vendorAllocation: true,
      shopifyOrderLineItem: true,
    },
    take: 2,
  });

  if (owners.length === 0) {
    throw new AllocationOwnershipResolutionError(
      'allocation_line_owner_not_found',
      `No vendor allocation owner found for Shopify line item ${shopifyOrderLineItem.sourceLineItemId}.`,
    );
  }

  if (owners.length > 1) {
    throw new AllocationOwnershipResolutionError(
      'multiple_allocation_line_owners',
      `Multiple vendor allocation owners found for Shopify line item ${shopifyOrderLineItem.sourceLineItemId}.`,
    );
  }

  const allocationLineItem = owners[0];

  return {
    allocation: allocationLineItem.vendorAllocation,
    allocationLineItem,
    shopifyOrderLineItem,
  };
}
