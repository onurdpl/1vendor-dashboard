# Shopify Order Backfill

This manual tool backfills exactly one missed Shopify order by fetching it from Shopify Admin GraphQL and posting a signed `orders/create` payload to the existing webhook ingestion endpoint.

## Safety Rules

- Manual-only; it never runs from runtime shipment flows.
- Requires `SHOPIFY_ORDER_BACKFILL_CONFIRM=YES`.
- Requires an explicit `SHOPIFY_ORDER_BACKFILL_NAME`, for example `#1048`.
- Uses the existing `/webhooks/shopify/orders-create` ingestion path.
- Uses a deterministic webhook id (`manual-backfill-orders-create-<shopifyOrderId>`) so repeat runs are idempotent.
- Does not call Kargonomi, Try OTO, shipment creation, fulfillment creation, label generation, refund, or return automation.
- Does not print Shopify tokens or webhook secrets.

## Required Env

```bash
SHOPIFY_ORDER_BACKFILL_CONFIRM=YES
SHOPIFY_ORDER_BACKFILL_NAME=#1048
SHOPIFY_ORDER_BACKFILL_BACKEND_URL=https://vendor-dashboard-backend-398h.onrender.com
SHOPIFY_SHOP_DOMAIN=<shop>.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=<secret>
SHOPIFY_WEBHOOK_SECRET=<secret>
SHOPIFY_API_VERSION=2024-01
```

`SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, and `SHOPIFY_API_VERSION` can be read from `backend/.env` for local operator use. Never commit real secret values.

## Command

From the repository root:

```bash
SHOPIFY_ORDER_BACKFILL_CONFIRM=YES \
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
