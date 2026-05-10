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

export type VendorAllocationLineItem = ShopifyOrderLineItemInput & {
  vendorId: VendorId;
};

export type VendorOrderAllocation = {
  shopifyOrderId: string;
  shopifyOrderNumber: string | number;
  vendorId: VendorId;
  vendorName: string;
  lineItems: VendorAllocationLineItem[];
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

export function allocateShopifyOrderToVendors(orderInput: ShopifyOrderInput): ShopifyOrderAllocationResult {
  const allocations = new Map<VendorId, VendorOrderAllocation>();
  const unmappedLineItems: ShopifyOrderLineItemInput[] = [];

  for (const lineItem of orderInput.lineItems) {
    const vendorId = resolveVendorFromVariantMetafield(lineItem.vendorMetafield);

    if (!vendorId) {
      unmappedLineItems.push(lineItem);
      continue;
    }

    const vendor = getAvailableVendors().find((candidate) => candidate.vendorId === vendorId);

    if (!vendor) {
      unmappedLineItems.push(lineItem);
      continue;
    }

    const existingAllocation = allocations.get(vendorId);
    const allocationLineItem: VendorAllocationLineItem = {
      ...lineItem,
      vendorId,
    };

    if (existingAllocation) {
      existingAllocation.lineItems.push(allocationLineItem);
      continue;
    }

    allocations.set(vendorId, {
      shopifyOrderId: orderInput.id,
      shopifyOrderNumber: orderInput.orderNumber,
      vendorId,
      vendorName: vendor.vendorName,
      lineItems: [allocationLineItem],
    });
  }

  return {
    allocations: Array.from(allocations.values()),
    unmappedLineItems,
  };
}
