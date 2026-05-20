# Missing Shopify Order #1048 Investigation

## Scope

Investigation only. No Kargonomi provider logic, shipment creation flow, Shopify return logic, or ingestion runtime behavior was changed.

## Summary

Shopify order `#1048` exists in Shopify, but the app has no evidence of receiving it through the configured local database. The clearest root cause found is that the Shopify shop currently has no active `ORDERS_CREATE` webhook subscription pointing at the backend.

Without an active `ORDERS_CREATE` subscription, Shopify will not deliver new-order webhooks to `/webhooks/shopify/orders-create`, so the normal ingestion path cannot create the local `ShopifyOrder`, `ShopifyOrderLineItem`, `VendorAllocation`, or finance sale ledger records.

## Evidence

### Shopify Source Order

Shopify Admin GraphQL lookup for `name:#1048` returned one order:

- Name: `#1048`
- Shopify order id tail: `7632165011793`
- Created at: `2026-05-20T13:07:18Z`
- Financial status: `PAID`
- Fulfillment status: `UNFULFILLED`
- Line item count: `1`
- SKU: `IF1208-010-L`
- `custom.seller_info`: present
- `seller_info` contains a mapping key for `IF1208-010-L`
- `seller_info` JSON parsed successfully

This rules out the order not existing in Shopify and makes a missing `seller_info` race unlikely for this order at investigation time.

### Active Shopify Webhook Subscriptions

Shopify Admin GraphQL `webhookSubscriptions(first: 100)` returned these active topics:

- `FULFILLMENTS_CREATE`
- `FULFILLMENTS_UPDATE`
- `FULFILLMENT_EVENTS_CREATE`
- `FULFILLMENT_ORDERS_CANCELLED`
- `RETURNS_REQUEST`
- `RETURNS_APPROVE`
- `RETURNS_DECLINE`
- `RETURNS_CLOSE`

No `ORDERS_CREATE` subscription was present.

Expected target route exists in code:

- `POST /webhooks/shopify/orders-create`

But with no active `ORDERS_CREATE` subscription, Shopify will not call it for new orders.

### Local Database Check

The reachable local database from `backend/.env` contains orders only through `#1015`, so it is stale relative to the live shop. In that local DB, order `#1048` was not found in:

- `ShopifyOrder`
- `VendorAllocation`
- `WebhookEvent`
- `OperationalJob`

The Render production database URL in `backend/.env` uses an internal Render hostname and was not resolvable from this machine:

```text
could not translate host name "dpg-d81holv7f7vs73dkrjsg-a"
```

Therefore I could not directly query production `WebhookEvent` rows from this workspace.

### Production Backend

Production backend is reachable and running the latest pushed commit at investigation time:

- `GET https://vendor-dashboard-backend-398h.onrender.com/version`
- Service: `vendor-dashboard-backend`
- Environment: `production`
- Git commit: `a06e4d15e18d`

## Ingestion Path Reviewed

The `orders/create` route does the following:

1. Verifies Shopify HMAC.
2. Creates or reuses a webhook idempotency record.
3. Creates an operational job.
4. Fetches `custom.seller_info` from Shopify Admin GraphQL with retry.
5. Calls `ingestShopifyOrderWebhook`.
6. Upserts local `ShopifyOrder`.
7. Upserts `ShopifyOrderLineItem` records.
8. Resolves every SKU to a known vendor from `seller_info`.
9. Upserts vendor allocations.
10. Upserts sale ledger rows.
11. Marks the webhook processed.

Important failure gates:

- Missing Shopify order id in payload marks webhook failed.
- Missing or unresolved `seller_info` marks webhook failed before local order persistence.
- Missing SKU or unknown vendor mapping marks webhook failed before local order persistence.
- Duplicate deliveries are protected by webhook idempotency.

For order `#1048`, Shopify currently has seller info for the SKU, so the strongest identified blocker is delivery not happening because the order creation webhook subscription is absent.

## Root Cause

Confirmed root cause: active Shopify webhook subscriptions do not include `ORDERS_CREATE`.

Production database confirmation of whether any historical `orders/create` webhook row exists for `#1048` remains unknown because the production database host is not reachable from this local environment.

## Recommended Recovery

1. Register an `ORDERS_CREATE` webhook subscription pointing to:

```text
https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-create
```

2. Confirm `webhookSubscriptions` includes `ORDERS_CREATE` after registration.
3. Backfill or replay order `#1048` explicitly from Shopify Admin canonical data if needed, because creating a webhook subscription now will not retroactively deliver the already-created order.
4. Query production `WebhookEvent`/`ShopifyOrder` from within Render or another network path that can reach the Render Postgres internal hostname to confirm there is no historical failed event.

## Unknowns

- Whether Shopify attempted any `ORDERS_CREATE` delivery before the subscription disappeared is unknown.
- Whether production has a failed `WebhookEvent` row for order `#1048` is unknown until the production database is queried from a reachable environment.
- Why the `ORDERS_CREATE` subscription is absent is unknown. Existing scripts currently register return and fulfillment webhooks, but I did not find an equivalent order-create registration script.
