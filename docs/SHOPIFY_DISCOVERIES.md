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

### Admin GraphQL 2026-01 Monetary Refund Evidence

- A Shopify `Refund` object or refund line-item subtotal does not by itself prove that money was refunded.
- Monetary refund ingestion requires canonical Admin GraphQL evidence from `Order.totalRefundedSet`, each `Refund.totalRefundedSet`, and unique `Refund.transactions` rows where `kind = REFUND`, `status = SUCCESS`, and `shopMoney.amount > 0`.
- Exact transaction totals must agree with each refund total and the order total in one shop currency. Refund line-item subtotals remain allocation and quantity evidence only.
- A successful zero-value `VOID` with zero refund and order aggregates is classified `ZERO_VALUE_VOID`; it creates no refund, refund-derived return, refund ledger/event, adjustment, or vendor debt.
- `PENDING`, `FAILURE`, `ERROR`, `AWAITING_RESPONSE`, or unknown refund transaction states are non-final and create no finance mutation.
- Canonical refund reads request at most 250 refunds, transactions, and refund line items. Exactly 250 refunds, `hasNextPage` on either connection, malformed money, duplicate transaction conflicts, currency mismatch, or aggregate mismatch fail closed for review.
- Live `refunds/create`, stored replay/recovery, canonical reconciliation, and Current-State Repair all use this shared canonical monetary-evidence gate before existing positive-refund ingestion.
- Successful refund money movement and full customer refund completion are separate classifications. A positive `REFUND / SUCCESS` transaction proves money moved, but does not prove the customer's complete order-level monetary position was refunded.
- Admin order reads derive customer refund completion from the same canonical refund transaction gate plus `Order.displayFinancialStatus`, `totalReceivedSet`, `totalRefundedSet`, `netPaymentSet`, and `totalOutstandingSet`. `totalRefundedShippingSet` is exposed as canonical diagnostic evidence; this read remains descriptive and does not itself initiate shipping refund execution.
- Full completion requires mutually consistent `REFUNDED` status, equal received/refunded shop money, zero net payment, and zero outstanding shop money. `PARTIALLY_REFUNDED` with positive canonical net payment remains partial. Missing or conflicting evidence fails closed to review and never falls back to local refund records or refunded line items.
- Fulfillment post-check completion remains independent from customer monetary completion. A selected allocation can require no further fulfillment while the order remains partially refunded.
- Refund completion does not recalculate historical checkout totals from current shipping fees or free-shipping thresholds.
- FIN-VOID-1 prevents future false refund evidence. It does not correct the existing `#1105` production refund/return/ledger records; those remain a separate controlled correction. `#1106` is not repaired by this phase.

### Order-Level Checkout Shipping Refund Ownership

- Customer checkout shipping is order-level money; allocation-level refund-attempt protection alone cannot serialize it across vendors.
- `OrderShippingRefundClaim` provides database-enforced ownership for one active logical checkout-shipping refund attempt per Shopify order.
- The active-order key is nullable and unique: one active owner is allowed, while released claim rows remain retained audit history.
- The same `OutboundShopifyRefundAttempt` may resume its existing ownership and retains its stable Shopify refund idempotency identity.
- A different attempt cannot take ownership while the original owner is nonterminal, pending, failed with ambiguous submission evidence, or otherwise unreconciled.
- There is no timeout, TTL, age-based release, or automatic takeover. Canonical `RESOLVED` attempt state releases ownership; ambiguous money movement remains blocked for reconciliation.
- The Vendor Reject / Admin Refund flow now uses this ownership primitive before including pre-shipment customer checkout shipping in `refundCreate`.
- Checkout-shipping eligibility is order-level: every customer-facing allocation must be vendor-blocked before shipment, and concrete shipment/fulfillment evidence prevents inclusion. Unknown fulfillment evidence fails closed for the shipping component.
- Shopify `SuggestedRefund.shipping.maximumRefundableSet` is the current refundable shipping authority. The final `suggestedRefund` call receives that explicit `shippingAmount`, and its `suggestedTransactions` remain the refund transaction authority.
- No checkout shipping fee, free-shipping threshold, VAT, tax, gross/net, or historical tariff is reconstructed locally.
- `RefundInput.shipping.amount` is sent only from the fresh Shopify maximum. The client cannot force shipping inclusion.
- A canonically verified partial product refund can use the same flow for shipping-only remediation without repeating product line items.
- Mutation acceptance remains pending evidence: fresh shipping maximum and canonical customer monetary state are checked afterward, while the existing canonical ingestion path alone resolves the attempt and releases its ownership.
- Customer checkout shipping is Sporgym-funded and does not alter vendor commission, payable, debt, settlement, payout, or carrier-cost accounting.
- Delivered-return checkout-shipping refunds remain not implemented.

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
- The admin Recovery Center is the operator entry point: inspect the explicit order first, use Repair Missing Shopify Order only for missing local commerce state, review the dry-run plan, then confirm execution separately.
- Replay Stored Webhook is limited to failed `refunds/create` events with retained payload because refund ingestion is identity-based and idempotent. Before finance mutation, the refund path fetches current canonical monetary evidence; stateful order and fulfillment payloads remain unsafe replay candidates.
- Recover Failed Webhook is limited to retained `FAILED` or stuck `RECEIVED` events. It resumes stored-payload processing; for `refunds/create`, current canonical monetary evidence is fetched before the retained payload may reach refund ingestion.
- Missing orders rejected before `WebhookEvent` persistence or never delivered must use current-state repair; replay and recover cannot reconstruct them.
- Executed repair creates missing order/allocation/finance evidence and applies refund, return, and full-order cancellation lifecycles inside one transaction. Failure rolls back repair data and records a safe failed reconciliation job/signal.
- Current-state repair must be used instead of Fresh Order Backfill when a missed order is now cancelled, refunded, or returned.
- Repair history contains only safe source, timestamp, actor, mode, status, and error-summary metadata. Raw Shopify payloads are not retained by the repair path.
- SHOP-REPAIR-1B aligns canonical recovery reads with Admin GraphQL API `2026-01`: `Order.refunds` is read as a direct refund list, each refund keeps its `refundLineItems` connection, and `Order.returns` remains a connection whose stable return identity comes from the Shopify GraphQL ID rather than unsupported `Return.legacyResourceId`.
- Canonical repair fetch failures are classified safely as order, refund, return, or response-parse failures without returning GraphQL headers, tokens, or raw payloads.
- FIN-VOID-1 does not rewrite existing `#1105` false monetary-refund evidence; that production correction remains separately controlled. `#1106` remains outside this phase.
- Fulfillment cancellation remains on the existing fulfillment cancellation path and must not be treated as full order cancellation.

## Customer Notifications
- `tracking_info.number` stores tracking number.
- `tracking_info.company` stores carrier.
- `tracking_info.url` is optional but useful.
- `notify_customer: true` lets Shopify send the tracking email to the customer.
- Customer notification policy is still an operational choice and remains an open question for production behavior.

## Customer Cancellation Request Foundation

- Customer Cancellation Request is a separate operational authority from Vendor Reject. It does not use `VENDOR_BLOCKED`, `cancelRefundReviewStatus`, `reassignmentRequired`, or allocation cancellation metadata.
- The local persistence foundation retains request-level and item-level state, requested quantities, customer/shop identity, admin review metadata, and database-enforced idempotency.
- Creating a `PENDING` request is non-monetary. It does not cancel the Shopify Order, change allocation ownership/status, create refunds or finance entries, or alter shipment/tracking state.
- A persisted `PENDING` request item is now an authoritative shipment hold for its allocation. Provider/Kargonomi creation and retries, manual tracking that creates Shopify fulfillment, and Vendor Integration shipment ingestion all re-check the hold under the canonical Shopify-order transaction lock before claiming or persisting new shipment authority; blocked HTTP paths return `409` with `CUSTOMER_CANCELLATION_PENDING`.
- Shipment authority remains allocation-scoped for multi-vendor orders. Existing carrier/provider/Shopify evidence is preserved and reconciled rather than cancelled or discarded; if durable shipment intent or real shipment evidence wins the same order lock first, the later customer request is recorded as `CONFLICTED` or `TOO_LATE` instead of becoming a shipment hold.
- This phase does not block inbound canonical Shopify fulfillment webhooks and does not add automatic carrier cancellation, refunds, finance mutations, or admin approval/decline actions.
- The authenticated Customer Account backend boundary now exposes read-only eligibility and request-creation endpoints. It verifies the Shopify Customer Account HS256 session token, audience, canonical shop destination, expiry/not-before/issued-at claims, and signed-in customer subject; it then re-fetches the canonical Shopify Order and requires its customer GID to match before local mapping.
- Customer cancellation creation is still non-monetary and uses only server-derived order, line, allocation, and quantity authority. A successful `PENDING` request immediately activates the existing allocation-scoped shipment hold.
- The Customer Account UI extension is not live. Production use requires the app's Customer Account client ID configuration; session-token verification reuses the same actual app Client Secret already configured as `SHOPIFY_WEBHOOK_SECRET` and never the Admin API access token. Shopify protected-customer-data access must be sufficient for the signed-in customer `sub`; there is no insecure fallback when `sub` is absent.
- Admin approval/decline, Shopify mutation, refund execution, finance changes, notification, and native Shopify cancellation-setting changes remain unimplemented.
- Historical Shopify RequestedEdit evidence, including order `#1124`, is not imported into the local request model.

## Shopify-First Missed Order Discovery
- The backend can opt into a Shopify-first recent-order discovery scan with `SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED=true`.
- Discovery uses Admin GraphQL `2026-01` and reads only `Order.id`, `legacyResourceId`, `name`, `createdAt`, and cursor page information.
- `Order.legacyResourceId` is compared with unique local `ShopifyOrder.sourceShopifyOrderId`; order name is display and repair-input metadata only.
- Operational defaults are a 15-minute interval, 15-minute grace period, seven-day overlapping lookback, 100-order page size, and 1,000-order run cap.
- Missing orders create one deterministic `shopify_order_missing_local` `OperationalSignal`. Repeated observations update the same signal without replacing its original detection timestamp.
- A completed scan resolves a missing-order signal only after positive confirmation that the local `ShopifyOrder` exists. Failed or truncated scans do not resolve existing missing-order signals.
- Discovery is read-only toward commerce state. It never creates or modifies orders, allocations, finance entries/events, fulfillment, refunds, returns, settlements, or payouts.
- Recovery remains admin-supervised: inspect the signal in Recovery Center, run existing Current-State Repair dry-run, review it, and explicitly confirm execution when safe. Discovery never invokes Current-State Repair or Fresh Order Backfill.

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

### Orders/Create State-Aware Retry Contract
- Same-ID `orders/create` handling is state-aware:
  - `PROCESSED` is a successful duplicate no-op.
  - `PROCESSING` is non-reprocessable because active versus stale ownership is not yet authoritative.
  - `RECEIVED` and strictly eligible `FAILED` events must win one atomic conditional transition to `PROCESSING` before ingestion.
- A same-ID delivery with a different payload hash is acknowledged as an evidence conflict and never replaces or processes the retained payload.
- Automatic retry uses the original retained raw payload. Retry/recovery ingestion is missing-order-only: it may create an absent local order but must not update an existing local order from a stale snapshot.
- An existing local order requires admin Current-State Repair instead of retained-payload ingestion.
- Only explicitly classified and durably recorded transient failures return non-2xx so Shopify can retry. Validation, configuration, and unknown failures fail closed with `202` needs-attention semantics.
- Admin failed-webhook recovery for `orders/create` uses the same generation/attempt/lease claim, heartbeat, fenced processing service, order transaction fence, and retained missing-order-only behavior as the executor. An active `PROCESSING` lease cannot be directly recovered, and exhausted attempts are not reset; operators use Current-State Repair instead.
- Operational jobs record bounded retry state but are not execution locks. No automatic OperationalJob worker exists.
- Missed-order discovery uses `WebhookEvent` status, availability, lease, and remaining attempt budget as execution authority. `OperationalJob` status alone never suppresses a signal. Actionable enrolled work suppresses only while the executor is enabled; with the executor disabled it remains visible with safe execution evidence. Terminal, exhausted, dead-letter, and legacy unenrolled work never suppresses missing-order detection.
- Admin reconciliation diagnostics evaluate `orders/create` events that remain `PROCESSING` for 15 minutes from `receivedAt` and surface a deterministic supervised-review `OperationalSignal`. An unexpired lease is authoritative and is not marked stale solely because of age. Expired and legacy no-lease work remains reviewable after the threshold, while exhausted `PROCESSING` is always HIGH severity. Review remains diagnostic-only and exposes only safe generation, attempt, lease, job, and local-commerce evidence.
- The review reuses Order State Inspector and the canonical Current-State Repair boundary. Repair remains dry-run first and explicitly confirmed; skipped or execution-blocked plans do not expose execute. Detection never calls Shopify and never mutates webhook/job or commerce state.
- A completed exact-order Current-State Repair can resolve only the separate review signal while preserving the historically `PROCESSING` event/job evidence. Request-driven evaluation adds no scheduler, worker, schema change, or migration.
- Shopify five-second acknowledgement is addressed in production by the durable fast-ack path described below. The code default remains disabled, while the verified production environment enables both Fast ACK and its required executor.

### Orders/Create Fenced Processing Preparation

- The existing `orders/create` business processing has been extracted behind a reusable service while the HTTP route still awaits it synchronously before responding.
- A request-independent `orders/create` executor runtime now exists and is disabled by default through `SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED=false`.
- The executor processes only explicitly enrolled `WebhookEvent` rows whose `executionAvailableAt` is non-null and due, or whose non-null processing lease has expired. Legacy rows with null availability or lease remain excluded and are not backfilled.
- Due RECEIVED work, due FAILED retries, and expired PROCESSING takeover use database-backed atomic claims. `WebhookEvent` generation, attempt, lease, availability, and status fields remain the execution and retry authority; `OperationalJob` is best-effort metadata only.
- Heartbeats extend current ownership, and generation fencing plus the commerce transaction fence prevent an expired or replaced owner from finalizing failure or committing commerce.
- Exhausted expired PROCESSING ownership is fenced and terminalized without running commerce or Current-State Repair.
- Executor-owned seller_info, image, and tax Admin requests use a deadline derived from half the configured lease. The synchronous webhook path has no new request deadline.
- Fenced ingestion uses an order-scoped PostgreSQL transaction advisory lock and verifies the current event generation and unexpired lease before commerce mutation and final success.
- Current-State Repair uses the same deterministic order-scoped advisory transaction lock. Dry-run reports `active_shopify_order_intake`; execute reacquires the lock, rechecks authoritative actionable intake and local plan assumptions, and requires a fresh dry-run if either changed. Legacy no-lease `PROCESSING` does not claim active-intake authority.
- Explicit admin recovery can fence a legacy `RECEIVED`/`FAILED` attempt, but a retryable legacy failure keeps `executionAvailableAt` null so the action does not enroll that historical row for automatic execution.
- The current synchronous route does not supply a fenced execution context and does not require lease fields.
- When explicitly enabled with a database configuration, the executor polls immediately and periodically, consumes durable retries, heartbeats active work, and drains active ownership for at most one lease during graceful shutdown.
- Durable fast acknowledgement has a code default of `SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED=false`. With the flag disabled, the existing synchronous route remains unchanged and does not enroll incoming events. The verified production environment overrides this default with Fast ACK enabled.
- Enabling fast acknowledgement requires `SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED=true`; invalid startup configuration fails closed.
- With both flags enabled, the verified route atomically persists the retained event envelope and enrolls it with `sourceShopifyOrderId` plus database-current `executionAvailableAt`, then returns `202` without seller-info lookup, operational-job creation, commerce processing, or direct executor invocation.
- A persistence failure returns retryable `503`, so Shopify is not told that an event was durably accepted when no inbox row exists. Duplicate responses are derived from retained event status and scheduling fields without mutating legacy unenrolled rows.
- Request timing logs include the safe route name, response status, elapsed time, and response size; intake logs correlate only by internal webhook event id and outcome, never by raw payload or secret material.
- Production fast acknowledgement was not activated as part of this implementation phase.
- The first production fast-ack canary durably enrolled its event and returned `202`, but executor commerce processing exposed Prisma's inability to deserialize the `void` result selected from PostgreSQL `pg_advisory_xact_lock`.
- The shared order advisory-lock query now casts that result to a Prisma-supported `text` scalar. Its order key, `hashtextextended(..., 0)`, blocking transaction-scoped lock behavior, fencing boundary, and shared executor/recovery/Current-State Repair usage remain unchanged.

### Production Fast ACK Rollout Closure

- A subsequent successful production canary used Shopify order `#1124` (`8131796599121`) and `WebhookEvent` `cmtbnqjx90001n92curc7387l`.
- HMAC verification passed and the webhook returned HTTP `202` in approximately 10 ms after durable intake, before executor completion.
- The executor claimed generation `1`, attempt `1`, processed in approximately 1,111 ms, and finalized the event as `PROCESSED`.
- The canary created exactly one local order, the correct vendor allocation and finance state, no duplicate commerce writes, and the order was visible in the panel.
- No additional `orders/create` or `orders/updated` HTTP `401` delivery was observed for the canary, and `/ready` returned HTTP `200`.
- Permanent production activation was subsequently verified with `SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED=true` and `SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED=true`.

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
