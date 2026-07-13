# Shopify Order Backfill

This document covers two distinct single-order recovery tools. Fresh Order Backfill posts a signed `orders/create` payload only for a still-fresh, open order. Current-State Repair reconstructs the order from today's canonical Shopify state and must be used when cancellation, refund, or return state already exists.

## Choose the Correct Tool

- Use Fresh Order Backfill only for a missing, recent, open, unfulfilled, non-cancelled, non-refunded, and non-returned order.
- Use Current-State Repair for a missing order whose canonical Shopify state may now be cancelled, refunded, or returned.
- Never use Fresh Order Backfill to replay a historical active state over a terminal Shopify order.
- Both tools accept exactly one explicit order. Neither supports ranges, dates, bulk repair, or `repair all` behavior.

## Fresh Order Backfill

## Safety Rules

- Manual-only; it never runs from runtime shipment flows.
- Requires `SHOPIFY_ORDER_BACKFILL_CONFIRM=BACKFILL_FRESH_MISSING_ORDER`.
- Requires an explicit `SHOPIFY_ORDER_BACKFILL_NAME`, for example `#1048`.
- Uses the existing `/webhooks/shopify/orders-create` ingestion path.
- Uses a deterministic webhook id (`manual-backfill-orders-create-<shopifyOrderId>`) so repeat runs are idempotent.
- Does not call Kargonomi, Try OTO, shipment creation, fulfillment creation, label generation, refund, or return automation.
- Does not print Shopify tokens or webhook secrets.

## Required Env

```bash
SHOPIFY_ORDER_BACKFILL_CONFIRM=BACKFILL_FRESH_MISSING_ORDER
SHOPIFY_ORDER_BACKFILL_NAME=#1048
SHOPIFY_ORDER_BACKFILL_BACKEND_URL=https://vendor-dashboard-backend-398h.onrender.com
SHOPIFY_SHOP_DOMAIN=<shop>.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=<secret>
SHOPIFY_WEBHOOK_SECRET=<secret>
SHOPIFY_API_VERSION=2026-01
```

`SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, and `SHOPIFY_API_VERSION` can be read from `backend/.env` for local operator use. Never commit real secret values.

## Command

From the repository root:

```bash
SHOPIFY_ORDER_BACKFILL_CONFIRM=BACKFILL_FRESH_MISSING_ORDER \
SHOPIFY_ORDER_BACKFILL_NAME=#1048 \
SHOPIFY_ORDER_BACKFILL_BACKEND_URL=https://vendor-dashboard-backend-398h.onrender.com \
npm run shopify:order-backfill
```

The script builds the backend CLI first, fetches only the named order from Shopify, signs the webhook body, and sends it to the configured backend URL.

## Expected Output

The command prints only a safe summary:

- order name
- Shopify order id
- deterministic webhook id
- backend HTTP status
- backend action
- duplicate yes/no
- allocation count when returned
- safe message if the existing ingestion path reports a recoverable issue

If the order was already processed with the same deterministic webhook id, the backend should report `duplicate_ignored`.

## Current-State Repair

Admin-only endpoint:

```text
POST /admin/diagnostics/shopify/order-repair
```

Dry-run is the default:

```json
{
  "orderIdentifier": "#1105"
}
```

Mutation requires explicit execution:

```json
{
  "orderIdentifier": "7856043819345",
  "execute": true
}
```

Current-State Repair:

- fetches the canonical order, refunds, and returns through Shopify Admin GraphQL before mutation
- validates `seller_info`, exact SKU mapping, vendor existence, active finance profile, and snapshot completeness
- creates missing `ShopifyOrder`, line item, `VendorAllocation`, and sale ledger records without creating a synthetic `orders/create` webhook
- applies the existing refund and return lifecycles, then applies canonical full-order cancellation in one database transaction
- persists no temporary active state for a cancelled order because the transaction commits only after terminal state is applied
- rolls back all commerce and finance repair records if any lifecycle step fails
- remains idempotent through deterministic allocations, ledger identifiers, refund identifiers, finance-event keys, and return identifiers
- records executed success/failure attempts as safe reconciliation jobs and an operational signal
- never stores a raw Shopify payload in repair history

Dry-run performs no database write and therefore does not create repair history. Its response still includes `dryRun: true`, `executed: false`, and the planned repair summary.

The safe summary reports whether the Shopify order, allocation, and finance evidence are `Created` or `Existing`, whether cancellation/refund/return work applies, warnings, and whether the execution was skipped as already current.

Missing orders with existing fulfillment progress fail closed for manual review; this phase does not reconstruct historical fulfillment or tracking evidence.
