import { getAvailableVendors, type VendorId } from '../auth/vendorContext';

export type ShopifyVariantId = string;
export type ShopifySku = string;
export type ShopifyLineItemId = string;
export type ShopifyVendorMetafieldValue = string | null | undefined;

export type ShopifyOrderLineItemInput = {
  id: ShopifyLineItemId;
  variantId: ShopifyVariantId;
  sku: ShopifySku;
  title: string;
  variantTitle: string;
  quantity: number;
  price: string;
  vendorMetafield?: ShopifyVendorMetafieldValue;
};

export type VendorAllocationLineItem<TLineItem extends ShopifyOrderLineItemInput = ShopifyOrderLineItemInput> = TLineItem & {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  vendorId: VendorId;
};

export type VendorOrderAllocation<TLineItem extends ShopifyOrderLineItemInput = ShopifyOrderLineItemInput> = {
  shopifyOrderId: string;
  shopifyOrderNumber: string | number;
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  vendorId: VendorId;
  vendorName: string;
  lineItems: VendorAllocationLineItem<TLineItem>[];
};

export type ShopifyOrderAllocationResult = {
  allocations: VendorOrderAllocation[];
  unmappedLineItems: ShopifyOrderLineItemInput[];
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function buildVendorLookup() {
  return new Map(
    getAvailableVendors().map((vendor) => [normalize(vendor.vendorName), vendor.vendorId] as const),
  );
}

export function resolveVendorFromVariantMetafield(value: ShopifyVendorMetafieldValue): VendorId | null {
  if (!value) {
    return null;
  }

  const lookup = buildVendorLookup();
  const normalized = normalize(value);

  return lookup.get(normalized) ?? null;
}

export type ShopifyOrderInput = {
  id: string;
  orderNumber: string | number;
  lineItems: ShopifyOrderLineItemInput[];
};

export function allocateShopifyOrderToVendors<TLineItem extends ShopifyOrderLineItemInput>(
  orderInput: { id: string; orderNumber: string | number; lineItems: TLineItem[] },
): {
  allocations: VendorOrderAllocation<TLineItem>[];
  unmappedLineItems: TLineItem[];
} {
  const allocations = new Map<VendorId, VendorOrderAllocation<TLineItem>>();
  const unmappedLineItems: ShopifyOrderLineItemInput[] = [];

  for (const lineItem of orderInput.lineItems) {
    const originalVendorId = resolveVendorFromVariantMetafield(lineItem.vendorMetafield);

    if (!originalVendorId) {
      unmappedLineItems.push(lineItem);
      continue;
    }
    const assignedVendorId = originalVendorId;

    const vendor = getAvailableVendors().find((candidate) => candidate.vendorId === assignedVendorId);

    if (!vendor) {
      unmappedLineItems.push(lineItem);
      continue;
    }

    const existingAllocation = allocations.get(assignedVendorId);
    const allocationLineItem: VendorAllocationLineItem<TLineItem> = {
      ...lineItem,
      originalVendorId,
      assignedVendorId,
      vendorId: assignedVendorId,
    };

    if (existingAllocation) {
      existingAllocation.lineItems.push(allocationLineItem);
      continue;
    }

    allocations.set(assignedVendorId, {
      shopifyOrderId: orderInput.id,
      shopifyOrderNumber: orderInput.orderNumber,
      originalVendorId,
      assignedVendorId,
      vendorId: assignedVendorId,
      vendorName: vendor.vendorName,
      lineItems: [allocationLineItem],
    });
  }

  return {
    allocations: Array.from(allocations.values()),
    unmappedLineItems: unmappedLineItems as TLineItem[],
  };
}
