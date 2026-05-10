# API Contracts

This document describes the backend contract expected by the current frontend.
The frontend currently uses mock transport in local/demo mode, but the same route and data shapes are intended for a real backend later.

## Authentication and Session Assumptions

- The frontend sends an `Authorization: Bearer <token>` header when a session token exists.
- The backend is responsible for validating the token.
- The frontend also sends `X-Vendor-Id` as a contextual hint for the current selected vendor.
- The backend must not trust `X-Vendor-Id` blindly.
- The backend must derive the allowed vendor scope from the authenticated user/session.
- If the authenticated session is invalid or missing, the backend must return `401 Unauthorized`.

## Vendor Scoping Rules

- Vendor access is a backend enforcement concern.
- Vendor users must only read data for their own vendor.
- Admin users may access vendors they are allowed to access.
- Cross-vendor access must not leak data.
- If a resource belongs to another vendor, the backend should return `403 Forbidden` or `404 Not Found` consistently across the API.
- The frontend treats cross-vendor access as unavailable data, not as a different UI flow.

## Role and Permission Rules

- The frontend already models roles and permissions for:
  - `admin`
  - `vendor`
  - `support`
  - `finance`
- The backend should use its own authorization source of truth, but it must align with the frontend’s route and action expectations.
- Route-level access is currently expected for read-only pages.
- Action-level permissions are expected for write operations and operational actions.
- The backend must apply permission checks server-side even if the frontend hides or disables actions.

## Error Conventions

- `401 Unauthorized`
  - Session missing, expired, or invalid.
  - The frontend treats this as a logout/session reset case.

- `403 Forbidden`
  - Authenticated user does not have permission for the requested operation or vendor scope.

- `404 Not Found`
  - Resource does not exist, or the backend intentionally hides cross-vendor resources behind not-found semantics.

- `5xx` or network failures
  - Unexpected server failures or infrastructure issues.

## Implied Endpoints

The current frontend directly or indirectly expects the following read endpoints:

- `GET /orders`
- `GET /orders/:orderId`
- `GET /admin/orders/:shopifyOrderId` (admin operational view)
- `GET /returns`
- `GET /returns/:returnId`
- `GET /finance`
- `GET /automation`

No write endpoints are currently wired in the frontend, but future write actions are expected to follow the same auth, vendor, and permission rules.

## Endpoint Contracts

### GET /orders

- Purpose: return the current vendor’s order list.
- Required auth: yes.
- Vendor scoping rule: only orders for the authenticated user’s allowed vendor scope may be returned.
- Expected success response shape: `OrderSummary[]`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the session is authenticated but not permitted for the vendor scope or route.
- Expected `404` behavior: not typically used for collection requests, unless the backend intentionally obscures access.
- Order records are vendor-scoped views of Shopify source orders and must include a vendor-safe internal order id.
- Fulfillment and shipping fields are vendor-scoped too; vendor allocations may have different fulfillment states for the same Shopify order.

### GET /orders/:orderId

- Purpose: return a single order detail record.
- Required auth: yes.
- Vendor scoping rule: only return the order if it belongs to an allowed vendor.
- Expected success response shape: `OrderDetail`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access the vendor scope.
- Expected `404` behavior: return `404 Not Found` when the order does not exist or when the backend hides cross-vendor resources.
- Detail records should expose `sourceShopifyOrderId`, `sourceShopifyOrderNumber`, `vendorId`, and vendor-allocated `lineItems` so the frontend can show the current vendor slice only.
- Detail records should also expose vendor-scoped fulfillment/shipping metadata such as `fulfillmentStatus`, `shippingStatus`, `trackingNumber`, `carrier`, and `estimatedDelivery` when available.

### GET /admin/orders/:shopifyOrderId

- Purpose: return a full operational Shopify order breakdown across vendor allocations.
- Required auth: yes.
- Vendor scoping rule: admin-only access; vendor users must not receive cross-vendor allocation graphs.
- Expected success response shape: `ShopifyOrderBreakdown`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` for authenticated non-admin users.
- Expected `404` behavior: return `404 Not Found` when the Shopify order does not exist.
- Response should include:
  - source Shopify order metadata
  - all vendor allocations for that source order
  - per-allocation fulfillment/shipping status
  - per-allocation tracking metadata
  - per-allocation refunded items and totals when present

### GET /returns

- Purpose: return the current vendor’s return request list.
- Required auth: yes.
- Vendor scoping rule: only returns for the authenticated user’s allowed vendor scope may be returned.
- Expected success response shape: `ReturnSummary[]`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access the vendor scope.
- Expected `404` behavior: not typically used for collection requests, unless the backend intentionally obscures access.
- Return records are vendor-scoped allocations of Shopify refund activity and must include a vendor-safe internal return id.

### GET /returns/:returnId

- Purpose: return a single return request detail record.
- Required auth: yes.
- Vendor scoping rule: only return the record if it belongs to an allowed vendor.
- Expected success response shape: `ReturnDetail`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access the vendor scope.
- Expected `404` behavior: return `404 Not Found` when the return does not exist or when the backend hides cross-vendor resources.
- Detail records should expose `vendorId`, `sourceShopifyOrderId`, `sourceShopifyOrderNumber`, `sourceShopifyRefundId`, and vendor-allocated refunded line items so the frontend can show the current vendor slice only.

### GET /finance

- Purpose: return the current vendor’s finance summary and transaction list.
- Required auth: yes.
- Vendor scoping rule: finance data must be isolated to the authenticated vendor scope.
- Expected success response shape: `FinanceDashboard`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access finance data.
- Expected `404` behavior: not typically used for this collection-like response, unless the backend intentionally obscures access.
- Finance summary values should be computed from vendor-allocated Shopify order items and vendor-allocated Shopify refund items.
- Gross sales come from the vendor’s allocated order line items.
- Refunds come from the vendor’s allocated refunded line items.
- Net revenue is gross sales minus refunds.
- Platform fee or commission is an authoritative backend calculation; the current frontend demo uses a deterministic 10% rule.
- Payout estimate is net revenue minus platform fee.
- The frontend should receive already vendor-scoped finance data and should not perform financial allocation in production.

### GET /automation

- Purpose: return the current vendor’s automation alerts and suggestions.
- Required auth: yes.
- Vendor scoping rule: automation signals must be isolated to the authenticated vendor scope.
- Expected success response shape: `AutomationDashboard`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access automation data.
- Expected `404` behavior: not typically used for this collection-like response, unless the backend intentionally obscures access.

## Data Shapes

The frontend expects the following domain types from `src/lib/api/contracts.ts`:

- `OrderSummary`
- `OrderDetail`
- `ShopifyOrderBreakdown`
- `VendorAllocationSummary`
- `ReturnSummary`
- `ReturnDetail`
- `FinanceSummary`
- `FinanceTransaction`
- `FinanceDashboard`
- `AutomationAlert`
- `AutomationSuggestion`
- `AutomationDashboard`

### Shared Shape Expectations

- All date/time values are ISO strings.
- Currency values are currently represented as formatted strings by the frontend contract.
- IDs are opaque strings.
- Collections are returned as arrays.
- The backend should preserve the same field names unless the frontend contracts are updated first.
- `FinanceSummary` includes vendor-derived fields such as `grossSales`, `refunds`, `netRevenue`, `platformFee`, and `payoutEstimate` in addition to compatibility aliases used by the current frontend shell.

## Security Requirements

- Do not use `X-Vendor-Id` as the source of truth for authorization.
- Use the authenticated user/session to determine which vendor(s) are allowed.
- Ensure vendor-specific records are always filtered server-side.
- Do not rely on the frontend to hide data as a security boundary.
- Return `403` or `404` consistently for cross-vendor access, but do not leak data.

## Future Shopify Notes

- A Shopify store connection belongs to a vendor.
- Shopify orders must be stored with a `vendorId`.
- Shopify webhooks must resolve to a vendor/store connection before processing.
- Webhook processing must be idempotent.
- Any imported Shopify order or event must preserve vendor scoping from the source connection.
- Shopify refunds should be allocated by vendor-owned refunded line items, not by the full order total.
- Shopify fulfillment events should also be allocated by vendor-owned line items so vendors only see their own shipping/tracking metadata.

## Single Shopify Store Multi-Vendor Order Allocation

The expected production model is a single Shopify store that can contain products from multiple vendors.

- One Shopify order can contain line items from multiple vendors.
- Vendor identity comes from variant or product metafield data during ingestion.
- The backend must allocate Shopify order line items by vendor before exposing them to the frontend.
- Stored vendor-facing order records must always be scoped by `vendorId`.
- Vendors must only receive their own allocated line items.
- Admin users may inspect the full order and the per-vendor allocation breakdown.
- The frontend receives already-scoped vendor order data and must not perform Shopify allocation in production.
- Vendor users must only receive scoped allocations and must never receive cross-vendor shipping or tracking details.

### Allocation Rules

- Each Shopify line item should be matched to a vendor using metafield data.
- If a line item cannot be mapped to a vendor, the backend should keep it unmapped for review or exclude it from vendor-facing records according to ingestion policy.
- The original Shopify order ID and order number must be preserved across allocations.
- Multiple allocations can be produced for a single Shopify order when line items belong to different vendors.
- Vendor allocation logic must be deterministic and idempotent.

## Single Shopify Store Multi-Vendor Refund Allocation

Refunds follow the same single-store, multi-vendor model as orders.

- One Shopify refund can contain refunded line items from multiple vendors.
- Vendor identity comes from variant or product metafield data during ingestion.
- The backend must allocate Shopify refund line items by vendor before exposing them to the frontend.
- Stored vendor-facing return records must always be scoped by `vendorId`.
- Vendors must only receive their own refunded line items.
- Admin users may inspect the full refund and the per-vendor allocation breakdown.
- The frontend receives already-scoped vendor return/refund data and must not perform Shopify refund allocation in production.

### Refund Allocation Rules

- Each refunded Shopify line item should be matched to a vendor using metafield data.
- If a refunded line item cannot be mapped to a vendor, the backend should keep it unmapped for review or exclude it from vendor-facing records according to ingestion policy.
- The original Shopify order ID, order number, and refund ID must be preserved across allocations.
- Multiple return allocations can be produced for a single Shopify refund when refunded line items belong to different vendors.
- Vendor refund allocation logic must be deterministic and idempotent.

### Example

- Shopify Order `#1001`
  - `SKU123 / Medium` -> Demo Vendor A
  - `SKU123 / Large` -> Demo Vendor B

- If only `SKU123 / Medium` is refunded, Vendor A receives the refund allocation.
- Vendor B does not receive that refund allocation.

### Example

- Shopify Order `#1001`
  - `SKU123 / Medium` -> Demo Vendor A
  - `SKU123 / Large` -> Demo Vendor B
  - `Standard Product` -> Demo Vendor A

- Vendor A should receive only the Vendor A line items for order `#1001`.
- Vendor B should receive only the Vendor B line items for order `#1001`.

## Frontend Integration Notes

- The frontend currently uses mock transport in local/demo mode.
- Real backend mode is controlled by API environment configuration.
- The frontend expects the same route paths in mock and real modes.
- When the real backend is added, it should preserve these endpoint shapes or introduce a versioned compatibility layer.
