# Shopify Discoveries

## Purpose
- Capture confirmed Shopify integration discoveries before live Shopify-dependent implementation begins.
- Give future phases a single reference point for verified Shopify behavior, known limits, and open questions.
- Reduce accidental invention of Shopify behavior during backend ingestion, fulfillment, and refund work.

## Confirmed Shopify Behaviors
- There is one Shopify store.
- Vendors do not connect their own Shopify stores.
- Products and SKUs are listed once in Shopify.
- Active vendor, stock, and price are managed by an external inventory/orchestration system.
- This application starts from post-order operations, not catalog or inventory ownership.
- Frontend must not call Shopify directly.
- Shopify Admin API access token must remain backend-only.
- Shopify webhook secret must remain backend-only.
- Vendor isolation must be enforced by backend logic and database access rules.

## Current Integration Boundary
- Shopify is the source of truth for commerce and order creation.
- This app owns post-order operational state:
  - allocations
  - assigned vendor ownership
  - fulfillment workflow
  - reassignment
  - audit trail
  - finance reporting
  - diagnostics and attention states
- Before implementing Shopify-dependent behavior, review this document.
- If operational uncertainty remains, ask Shopify AI before implementation.
- Do not invent Shopify behavior.

## Order Vendor Mapping
- `orders/create` webhook payload does not include metafields.
- Order metafield `custom.seller_info` must be fetched separately through Shopify Admin API.
- Recommended GraphQL query:

```graphql
query GetOrderSellerInfo($id: ID!) {
  order(id: $id) {
    metafield(namespace: "custom", key: "seller_info") {
      value
    }
  }
}
```

- REST fallback:

```text
GET /admin/api/2024-01/orders/{order_id}/metafields.json?namespace=custom&key=seller_info
```

## Seller Info Metafield
- Namespace: `custom`
- Key: `seller_info`
- Type: JSON
- Value maps SKU to vendor slug.
- Example:

```json
{
  "DH2987-100-41": "yalispor",
  "DH2987-100-40,5": "sporjinal"
}
```

- `seller_info` JSON key equals `line_items[].sku`.
- Key is the variant SKU.
- Line item SKU comes from the variant SKU.
- Values are vendor slugs, not display names.
- Turkish display-name normalization should not be needed when slugs are used.
- Comma sizes like `"40,5"` are preserved exactly as string keys.
- `sellerInfo[lineItem.sku]` is the primary mapping rule.

### Quantity
- `quantity > 1` still maps to one vendor by SKU.
- The same SKU appearing as two separate line items is currently not expected.
- If the same SKU appears twice, `seller_info` JSON can only contain one value for that SKU.

### Empty SKU
- If SKU is empty, current `seller_info` mapping cannot resolve vendor.
- Short-term rule: treat empty SKU as unresolved and fail ingestion into diagnostics or attention state.
- Do not invent a `variant_id` fallback unless `seller_info` format is explicitly changed.

### seller_info Timing
- `seller_info` is written by Shopify Flow after order creation.
- `orders/create` webhook delivery and Flow execution may race.
- The webhook may arrive before `seller_info` exists.
- Backend must retry fetching `seller_info` after webhook receipt.
- Suggested retry behavior:
  - wait 2 to 3 seconds
  - retry up to 3 times
- If `seller_info` is still missing, mark webhook or order ingestion as failed or needs attention.

## Refund / Return Mapping
- `refunds/create` webhook contains `refund_line_items[].line_item.sku`.
- Refund mapping can use the original order `seller_info` mapping:
  - `sellerInfo[refundLineItem.line_item.sku]`
- `seller_info` remains the order creation snapshot and should not change during refunds.
- This preserves historical vendor assignment.
- Prefer preserving the original mapped vendor snapshot over recalculating against later catalog state.

## Fulfillment / Tracking
- Use Shopify Fulfillment Orders API.
- Do not use the old deprecated Fulfillment API.
- Vendor submits carrier and tracking information in our panel.
- Backend validates assigned vendor ownership before fulfillment actions.
- Backend fetches fulfillment orders for Shopify order:

```text
GET /fulfillment_orders.json?order_id={id}
```

- Backend creates fulfillment:

```text
POST /fulfillments.json
```

- Use `line_items_by_fulfillment_order` to fulfill only the vendor-owned line items.
- A multi-vendor order can have separate fulfillments and separate tracking data per vendor.

## Customer Notifications
- `tracking_info.number` stores tracking number.
- `tracking_info.company` stores carrier.
- `tracking_info.url` is optional but useful.
- `notify_customer: true` lets Shopify send the tracking email to the customer.
- Customer notification policy is still an operational choice and remains an open question for production behavior.

## Known Race Conditions
- `orders/create` webhook can arrive before Shopify Flow writes `custom.seller_info`.
- Future fulfillment operations may depend on fulfillment orders being available after order creation.
- Retry logic is required instead of assuming order metadata is immediately consistent.
- When mapping data is unresolved, prefer diagnostics or failed state over silent fallback.

## Required Retry Behavior
- After receiving `orders/create`, fetch `custom.seller_info`.
- If missing, wait 2 to 3 seconds and retry.
- Retry up to 3 times before failing into diagnostics or attention state.
- Future ingestion should record enough audit data to explain whether failure was caused by missing mapping, bad payload, or repeated webhook delivery.

## Operational Rules
- Shopify is the commerce and order source of truth.
- This application owns post-order operational state:
  - allocations
  - assignedVendorId
  - fulfillment workflow
  - reassignment
  - audit trail
  - finance reporting
  - diagnostics
- Use vendor slug mapping from `seller_info`, not display-name heuristics, for production ingestion.
- Backend must validate vendor ownership before creating fulfillments or updating tracking.
- Backend must preserve historical vendor assignment for refunds by using the original order mapping snapshot.

## Open Questions
- Exact Shopify Admin API version to use.
- Whether fulfillment orders are already split in a way that maps cleanly to vendor-owned line items.
- How cancelled or closed fulfillment orders should be handled.
- Whether customer notification should always be `true` or configurable.
- Whether return authorization details beyond `refund_line_items` are needed.
- Whether `seller_info` should include `variant_id` fallback in the future.

## Implementation Guardrails
- Before coding Shopify-dependent behavior, read this document.
- If Shopify behavior is unknown, ask Shopify AI before implementation.
- Do not invent payload shape, metafield timing, fulfillment behavior, or refund behavior.
- Prefer diagnostics or failed state over silent fallback when mapping is unresolved.
- Keep mock and frontend behavior separate from production Shopify assumptions.
