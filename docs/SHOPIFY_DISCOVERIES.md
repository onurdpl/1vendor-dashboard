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

## Canonical Shopify Shop Domain
- Production webhook verification must use Shopify's canonical `shop.myshopifyDomain`, not a historical or accepted alias.
- Canonical identity must be verified with this backend-only Admin GraphQL query:

```graphql
query {
  shop {
    id
    name
    myshopifyDomain
    primaryDomain {
      host
    }
  }
}
```

- On July 11, 2026, both Admin GraphQL endpoints accepted the configured Admin API token:
  - `https://sporgym-3.myshopify.com/admin/api/2026-01/graphql.json`
  - `https://xgi47p-3k.myshopify.com/admin/api/2026-01/graphql.json`
- Both endpoints resolved to the same Shopify shop id and shop name, but Shopify returned canonical `shop.myshopifyDomain` as `xgi47p-3k.myshopify.com`.
- `SHOPIFY_SHOP_DOMAIN` must therefore contain `xgi47p-3k.myshopify.com` for production.
- Alias domains may continue to work for Admin API requests, but they are not acceptable for webhook verification after commit `925447f3` because webhook validation compares `X-Shopify-Shop-Domain` with `SHOPIFY_SHOP_DOMAIN`.

### July 11, 2026 Production Webhook Ingestion Failure
- Production root cause:
  - Render had `SHOPIFY_SHOP_DOMAIN=sporgym-3.myshopify.com`.
  - Shopify webhooks sent `X-Shopify-Shop-Domain=xgi47p-3k.myshopify.com`.
  - Commit `925447f3` added shop-domain enforcement.
  - Backend rejected otherwise valid Shopify webhooks with `403 shop_domain_mismatch`.
- Symptoms:
  - `orders/create` deliveries were rejected before ingestion.
  - `VendorAllocation` rows were never created.
  - Vendors did not see new Shopify orders in their workspace.
  - Cancellation reconciliation could not run for those orders because the original order ingestion never happened.
- Evidence:
  - Production Render logs showed `shop_domain_mismatch`.
  - Admin GraphQL verified both hostnames reached the same shop id.
  - Shopify returned canonical `shop.myshopifyDomain=xgi47p-3k.myshopify.com`.
- Verified fix:
  - Render `SHOPIFY_SHOP_DOMAIN` was updated to `xgi47p-3k.myshopify.com`.
  - No code change was required.
  - No webhook secret change was required.
  - No Admin API token change was required.
- Validation:
  - New Shopify order `#1108` produced an accepted `orders/create` delivery.
  - Local order ingestion created the expected `VendorAllocation`.
  - The order appeared immediately in the Yali Spor vendor workspace.
- Lesson learned:
  - Do not rely on historical `.myshopify.com` aliases when configuring webhook verification.
  - Always verify canonical Shopify identity through `shop.myshopifyDomain` before changing production Shopify environment variables.

## Turkey Address2 District Split
- Shopify Support confirmed that Turkey checkout neighborhood/district (`İlçe`) is not exposed as a separate Order API, webhook, or GraphQL field.
- Shopify merges the address line 2 value and neighborhood/district into `address2` using its reserved Unicode delimiter.
- Sporgym uses Shopify's official `@shopify/worldwide` `splitAddress2()` behavior only for Kargonomi outbound destination resolution.
- This split is not persisted back to `ShopifyOrder`, does not change Shopify ingestion storage, and does not change vendor-facing order APIs or UI display.
- If `splitAddress2()` cannot identify a neighborhood/district, Sporgym must not guess by parsing apartment or free-text address content.

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
- Customer return request is not the same lifecycle step as refund creation.
- `refunds/create` fires when money refund is created, not when a customer initially opens a return request.
- Vendor and admin operational flows should eventually show earlier pending return request visibility before refund creation.

### Return Lifecycle Webhook Topics
- Confirmed return lifecycle topics to support:
  - `RETURNS_REQUEST` (fires first when customer starts self-serve return request)
  - `RETURNS_APPROVE` (fires after merchant approval)
  - `RETURNS_DECLINE` (fires after decline)
  - `RETURNS_CLOSE` (fires when return is completed or closed)
- Additional lifecycle topics exist and may be useful in later phases:
  - `RETURNS_CANCEL`
  - `RETURNS_REOPEN`
  - `RETURNS_UPDATE`
  - `RETURNS_PROCESS`
- These topics should be registered through GraphQL `webhookSubscriptionCreate`, not assumed to be available only through the manual Shopify Admin webhook UI.
- Existing custom app can register these webhooks.
- Required app scope: `read_returns`.
- After adding `read_returns`, the custom app must be reinstalled and a fresh Admin API token must be copied into local `backend/.env`.
- Shopify does not require a specific callback path format; any HTTPS callback path is acceptable.

### Proposed Callback Endpoints
- Planned backend callback endpoints for return lifecycle ingestion:
  - `/webhooks/shopify/returns-request`
  - `/webhooks/shopify/returns-approve`
  - `/webhooks/shopify/returns-decline`
  - `/webhooks/shopify/returns-close`

### Return Webhook Payload Strategy
- Do not rely on raw return webhook payload for detailed line-item vendor mapping.
- Treat return lifecycle webhook payload as trigger or envelope metadata.
- Use `payload.id` (Return GID) as the primary key to fetch canonical return details through Shopify GraphQL.
- Live verification update (May 12, 2026):
  - `RETURNS_REQUEST` raw payload used numeric `id` (for example `23117529425`), not GID string.
  - Return GID was present as `admin_graphql_api_id` (for example `gid://shopify/Return/23117529425`).
  - Safe canonical rule for GraphQL fetch:
    - prefer `admin_graphql_api_id` when present
    - otherwise construct `gid://shopify/Return/{id}` from numeric id

### Confirmed GraphQL Return Fetch Strategy
- Candidate query shape:

```graphql
query GetReturn($id: ID!) {
  return(id: $id) {
    id
    order {
      id
    }
    returnLineItems(first: 20) {
      edges {
        node {
          id
          ... on ReturnLineItem {
            fulfillmentLineItem {
              id
              lineItem {
                id
                sku
              }
            }
          }
        }
      }
    }
    reverseFulfillmentOrders(first: 20) {
      edges {
        node {
          lineItems(first: 20) {
            edges {
              node {
                fulfillmentLineItem {
                  id
                  lineItem {
                    id
                    sku
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- `returnLineItems[].fulfillmentLineItem` may require inline fragment usage on `ReturnLineItem`.
- `reverseFulfillmentOrders` can be used as a fallback path when the direct return line-item path is insufficient.
- GraphQL return query can provide `fulfillmentLineItem.lineItem.sku`.
- GraphQL return query can provide `fulfillmentLineItem.lineItem.id`.
- `fulfillmentLineItem.lineItem.id` matches the same Shopify LineItem GID used by order line items.
- There is no standalone root query for `fulfillmentLineItem`; access it through the parent return query.
- Live verification update (May 12, 2026):
  - Inline-fragment `returnLineItems` path worked and returned:
    - `fulfillmentLineItem.id`
    - `fulfillmentLineItem.lineItem.id`
    - `fulfillmentLineItem.lineItem.sku`
  - `reverseFulfillmentOrders` fallback was not needed for the verified return sample.

### Order Line Item Image Snapshots
- REST `orders/create` webhook line items do not include a product image URL directly. Do not infer a line-item image from webhook-only fields.
- Admin GraphQL can resolve order line item images with this priority:
  1. `lineItem.image.url`
  2. `lineItem.variant.image.url`
  3. `lineItem.product.featuredMedia.image.url`
  4. no URL, UI placeholder
- Confirmed query shape:

```graphql
query OrderLineItemImages($orderId: ID!) {
  order(id: $orderId) {
    lineItems(first: 50) {
      edges {
        node {
          id
          sku
          image {
            url
            altText
          }
          variant {
            id
            image {
              url
              altText
            }
          }
          product {
            id
            featuredMedia {
              ... on MediaImage {
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- Snapshot decision:
  - Persist nullable `ShopifyOrderLineItem.imageUrl` at order ingestion when the Admin GraphQL lookup succeeds.
  - If the lookup fails, order ingestion must continue and log only safe diagnostics.
  - Existing orders are lazily backfilled on Order Detail load when `imageUrl` is missing and the Shopify order id is available.
  - Lazy backfill failure must not block Order Detail rendering.
- Fallback behavior:
  - Order Detail renders the stored image URL when present.
  - If no URL exists, or the image fails to load, the UI keeps the stable initials/placeholder thumbnail.

### Return Shipping / Tracking Visibility
- Confirmed from Shopify Admin GraphQL docs:
  - `Return.reverseFulfillmentOrders` exposes reverse fulfillment orders for a return.
  - `ReverseFulfillmentOrder.reverseDeliveries` exposes reverse deliveries.
  - `ReverseDelivery.deliverable` can be a `ReverseDeliveryShippingDeliverable`.
  - `ReverseDeliveryShippingDeliverable.tracking` exposes:
    - `carrierName`
    - `number`
    - `url`
- Use this GraphQL path for customer-entered return shipment visibility:

```graphql
return(id: $id) {
  reverseFulfillmentOrders(first: 20) {
    edges {
      node {
        reverseDeliveries(first: 20) {
          edges {
            node {
              deliverable {
                ... on ReverseDeliveryShippingDeliverable {
                  tracking {
                    carrierName
                    number
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- These fields are for return shipment visibility only.
- Do not use them to mutate refund, payout, outbound fulfillment, or lifecycle status logic.
- If Shopify does not provide return tracking, keep local return shipment fields empty and do not invent carrier, tracking number, or tracking URL.

### Vendor Attribution for Return Requests
- Preferred mapping path:
  - `RETURNS_REQUEST` webhook
  - `payload.id` (Return GID)
  - `GetReturn(returnId)` GraphQL query
  - `return.order.id`
  - `returnLineItems[].fulfillmentLineItem.lineItem.sku`
  - fetch or read order metafield `custom.seller_info`
  - `sellerInfo[sku]`
  - internal `vendorId`
  - create or update vendor-scoped pending return request state
- `seller_info[sku]` remains the vendor attribution mechanism.
- SKU is reached indirectly through GraphQL return detail.
- If SKU is missing or `sellerInfo[sku]` is missing, do not silently assign vendor; mark needs attention.
- A single return request can contain multiple SKUs across multiple vendors.
- Implementation must attribute each return line item separately using `SKU -> sellerInfo[sku]`.
- Backend and UI should support vendor-split pending return records.

### Live Verification Requirement (Before Production Return Lifecycle Ingestion)
- Verify `RETURNS_REQUEST` fires when a customer opens a return request.
- Verify `payload.id` contains Return GID.
- Verify GraphQL `GetReturn` works with that Return GID.
- Verify whether the inline-fragment `returnLineItems` path or `reverseFulfillmentOrders` fallback path is needed for this store/API version.
- Verify `returnLineItems[].fulfillmentLineItem.lineItem.sku` is populated (or confirm fallback source path).
- Verify `sellerInfo[sku]` maps to expected vendor.
- Verify `RETURNS_APPROVE`, `RETURNS_DECLINE`, and `RETURNS_CLOSE` arrive in expected sequence.
- Log and store enough diagnostics to explain which GraphQL extraction path worked.
- Do not implement production vendor attribution based only on unverified raw payload shapes.

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
- Inbound fulfillment status synchronization should use webhook topics as trigger/envelope data and fetch canonical state before mutating allocation status.
- Confirmed relevant inbound topics for fulfillment status work:
  - `FULFILLMENTS_CREATE`
  - `FULFILLMENTS_UPDATE`
  - `FULFILLMENT_EVENTS_CREATE`
  - `FULFILLMENT_ORDERS_CANCELLED`
- Fulfillment cancellation behavior confirmed by Shopify AI:
  - cancelling a fulfillment emits `FULFILLMENTS_UPDATE`
  - cancellation can also emit `FULFILLMENT_ORDERS_CANCELLED`
  - `ORDERS_UPDATED` may also fire, but it is broad/noisy and should not be the primary cancellation path
  - `FULFILLMENT_EVENTS_CREATE` is not reliable for cancellations
  - there is no dedicated `FULFILLMENTS_CANCEL` topic
  - preferred cancellation topic is `FULFILLMENT_ORDERS_CANCELLED`
- Canonical cancellation signals:
  - `fulfillmentOrder.status === CANCELLED`
  - `fulfillment.status === CANCELLED`
  - `order.displayFulfillmentStatus` is display-only aggregate state, not the source of truth for allocation mutation
  - cancellation can restore `remainingQuantity` / line-item fulfillment state
- Required app scope for fulfillment webhook topics: `read_fulfillments` (or the documented marketplace/order alternatives where applicable).
- Canonical order fulfillment refresh should read:
  - Shopify order id
  - `displayFulfillmentStatus`
  - fulfillments
  - fulfillment status
  - fulfillment `createdAt` / `updatedAt`
  - fulfillment line items
  - linked Shopify line item ids
  - tracking info when present
  - fulfillment events when available
- Vendor allocation updates must be scoped by exact Shopify line item ids. Do not mark a vendor allocation fulfilled because another vendor line item in the same Shopify order was fulfilled.
- Fulfillment cancellation updates must also be scoped by exact Shopify line item ids. Do not clear another vendor allocation's tracking/fulfilled state because a different fulfillment order was cancelled.
- If Shopify tracking info is absent, do not invent carrier, tracking number, or tracking URL.
- Shopify can report a fulfillment as complete while `trackingInfo` is empty; the app should still persist fulfillment/shipment timestamps from canonical fulfillment data but keep carrier/tracking fields unassigned.
- `FULFILLMENT_EVENTS_CREATE` may indicate delivery progression, but unknown event status values should go to diagnostics instead of false delivery state.
- Delivery/in-transit/failure event status must be scoped to the matching Shopify fulfillment id before updating vendor allocation shipping status.

## Full Order Cancellation
- Full order cancellation is separate from fulfillment cancellation.
- Primary webhook topic for full order cancellation:
  - `ORDERS_CANCELLED`
- Fallback webhook topic:
  - `ORDERS_UPDATED`, only when the payload contains `cancelled_at`
- Canonical cancellation signal:
  - `cancelled_at != null`
- `financial_status=voided` alone is not sufficient to process a full order cancellation.
- Recommended marketplace pattern:
  - webhook envelope
  - fetch canonical Shopify order through Admin GraphQL
  - reconcile locally from canonical state
- SHOP-CANCEL-1 bridges full order cancellation webhooks into existing canonical cancellation reconciliation.
- SHOP-CANCEL-2 persists canonical full-order cancellation metadata on `ShopifyOrder.cancelledAt` and `ShopifyOrder.cancelReason`.
- `ShopifyOrder.cancelledAt` is the shared backend source of truth for full-order cancellation eligibility. `VendorAllocation.cancellationReason` is legacy/secondary metadata and is not sufficient for canonical detection.
- Raw `VendorAllocation` ownership, fulfillment, and shipping fields may retain their previous values so historical evidence is not rewritten. These values do not make a full-cancelled order operationally eligible.
- Full-cancelled orders remain historically visible, but are operationally terminal:
  - Vendor Orders shows `Cancelled`, `Fulfillment not required`, `Shipment not required`, and `Tracking not required`.
  - Shipment/tracking workload queues and dashboard counts exclude full-cancelled orders.
  - Shipment creation, tracking updates, vendor reject, allocation split, and Vendor Integration status/shipment/invoice writes are blocked.
  - Automation, SLA, settlement candidate, payout preparation, payout review, and Mark Paid eligibility use the shared cancellation policy.
- Conflict cancellations preserve fulfillment, shipping, refund, settlement, and paid evidence, but block new operational and finance progression and require review.
- No `AllocationStatus.CANCELLED` was introduced; full-order cancellation remains an order lifecycle fact.
- SHOP-CANCEL-2A does not implement missed-order repair, vendor debt, payment reversal, or fulfillment-cancellation redesign.
- SHOP-REPAIR-1 provides the separate admin-only missed-order recovery path. It fetches the current canonical Shopify order, refund, and return state and does not replay historical webhook payloads.
- Current-state repair is dry-run by default, accepts one explicit Shopify order ID or number, and requires `execute: true` before mutation.
- Executed repair creates missing order/allocation/finance evidence and applies refund, return, and full-order cancellation lifecycles inside one transaction. Failure rolls back repair data and records a safe failed reconciliation job/signal.
- Current-state repair must be used instead of Fresh Order Backfill when a missed order is now cancelled, refunded, or returned.
- Repair history contains only safe source, timestamp, actor, mode, status, and error-summary metadata. Raw Shopify payloads are not retained by the repair path.
- Fulfillment cancellation remains on the existing fulfillment cancellation path and must not be treated as full order cancellation.

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
- Webhook registration tooling must be mixed-state-safe: already-registered topics must not block registration of missing topics.

## Open Questions
- Exact Shopify Admin API version to use.
- Whether fulfillment orders are already split in a way that maps cleanly to vendor-owned line items.
- How cancelled or closed fulfillment orders should be handled.
- Whether customer notification should always be `true` or configurable.
- Whether return authorization details beyond `refund_line_items` are needed.
- Whether `seller_info` should include `variant_id` fallback in the future.
- Whether all four return lifecycle topics are available for this store after `read_returns` scope is added.
- Whether `RETURNS_APPROVE`, `RETURNS_DECLINE`, and `RETURNS_CLOSE` payloads all include `return.id`.
- Whether `returnLineItems` can span multiple vendors in a single return request and how UI should present that.
- Whether return request cancellation exists as a separate event or topic.
- Whether every return workflow in this store creates reverse deliveries with tracking immediately, or only after customer/merchant shipping information is entered.
- Whether all stores emit `RETURNS_CANCEL`, `RETURNS_REOPEN`, `RETURNS_UPDATE`, and `RETURNS_PROCESS` consistently.
- Whether `RETURNS_CANCEL` payload clearly differentiates customer cancellation vs. merchant cancellation.
- Whether this store emits `FULFILLMENT_EVENTS_CREATE` for every manual Shopify Admin delivered-state change.
- Whether `FULFILLMENTS_UPDATE` is sufficient for tracking edits after fulfillment creation or whether an order-level fallback should be tested later.

## Implementation Guardrails
- Before coding Shopify-dependent behavior, read this document.
- If Shopify behavior is unknown, ask Shopify AI before implementation.
- Do not invent payload shape, metafield timing, fulfillment behavior, or refund behavior.
- Prefer diagnostics or failed state over silent fallback when mapping is unresolved.
- Keep mock and frontend behavior separate from production Shopify assumptions.
- Do not infer vendor ownership from raw return webhook payload alone.
- Do not map return requests directly from refund data.
- Do not create refund ledger entries for return requests until `refunds/create` occurs.
- Keep return request state and refund state as separate lifecycle states.
