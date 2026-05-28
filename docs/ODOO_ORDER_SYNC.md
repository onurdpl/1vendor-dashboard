# Odoo Order Sync

## Purpose

This document describes the first real Shopify vendor allocation to Odoo `sale.order` sync.

The sync is intentionally narrow:

- It runs after a Sporgym `VendorAllocation` is persisted.
- It creates one Odoo draft `sale.order` per vendor allocation.
- It uses text-only `sale.order.line` rows.
- It does not require Odoo products.
- It does not create invoices, confirm orders, create stock moves, create accounting entries, touch shipping, touch payouts, or touch settlements.

## Runtime Gates

The sync only attempts live Odoo writes when:

```text
ODOO_ENABLED=true
ODOO_DRY_RUN=false
```

Required Odoo connection variables:

```text
ODOO_URL=
ODOO_DB=
ODOO_USERNAME=
ODOO_API_KEY=
```

Required sale order partner configuration:

```text
ODOO_SALE_ORDER_PARTNER_ID=
```

or:

```text
ODOO_SALE_ORDER_PARTNER_NAME=
```

The implementation does not create Odoo partners. If no configured partner is found, sync stops and logs a validation error.

The database migration must be applied before deploying this sync because `VendorAllocation` now stores Odoo sync metadata:

- `odooSaleOrderId`
- `odooSaleOrderName`
- `odooSaleOrderSyncedAt`

## Allocation To Odoo Mapping

One Sporgym vendor allocation becomes one Odoo draft `sale.order`.

Example:

```text
Shopify Order #1001
Vendor Allocation alloc-yalispor-1001

-> one Odoo sale.order
```

Odoo `sale.order` fields sent:

- `name`: generated Sporgym reference containing Shopify order number and allocation id.
- `company_id`: first accessible Odoo company.
- `date_order`: sync timestamp.
- `partner_id`: configured Odoo partner.
- `partner_invoice_id`: configured Odoo partner.
- `partner_shipping_id`: configured Odoo partner.
- `client_order_ref`: `sporgym-allocation:{allocationId}`.
- `origin`: Shopify order number.
- `note`: operational context.
- `order_line`: one text-only line per allocation line item.

The note stores:

- Shopify order number.
- Shopify order id.
- Vendor allocation id.
- Vendor identifier.
- Vendor name.
- Customer display name.

Odoo `sale.order.line` fields sent:

- `name`: product title, SKU, quantity, Shopify line item id, and allocation id.
- `customer_lead`: `0`.
- `product_uom_qty`: allocation line item quantity.
- `price_unit`: Shopify unit price.

No `product_id` is sent. Product mapping remains intentionally unmodeled.

## Idempotency

The local allocation stores:

- `odooSaleOrderId`
- `odooSaleOrderName`
- `odooSaleOrderSyncedAt`

Before creating an Odoo order, sync checks:

1. Local allocation already has `odooSaleOrderId`.
2. Odoo already has a `sale.order` with `client_order_ref = sporgym-allocation:{allocationId}`.

If either check finds an existing order, no duplicate Odoo order is created.

## Guarded Render Verification Endpoint

A temporary guarded endpoint exists for verifying the deployed Render database schema, synthetic allocation sync, and idempotency without replaying Shopify webhooks:

```text
POST /admin/probes/odoo-allocation-sync-verify
```

Safety behavior:

- Disabled by default unless `ADMIN_PROBES_ENABLED=true`.
- Requires header `x-admin-probe-token`.
- Header value must match Render env `ADMIN_PROBE_TOKEN`.
- Creates or reuses a fixed synthetic test fixture only:
  - reference: `SPORGYM-ODOO-SYNC-VERIFY`
  - allocation id: `alloc-odoo-sync-verify`
- Checks the `VendorAllocation` Odoo sync columns before running sync.
- Runs the existing allocation-to-Odoo sync twice.
- Reads back local Odoo sync fields.
- Reads Odoo `sale.order` state for the stored id.
- Confirms no duplicate by checking the fixed Odoo `client_order_ref`.
- Does not create invoices, confirm orders, create accounting entries, create payouts, create settlements, create shipping labels, or replay Shopify webhooks.

Keep `ADMIN_PROBES_ENABLED=false` in normal operation. Enable it only for controlled diagnostics, then disable it again after the probe is complete.

Call from a trusted shell only:

```bash
curl -sS -X POST "https://vendor-dashboard-backend-398h.onrender.com/admin/probes/odoo-allocation-sync-verify" \
  -H "x-admin-probe-token: $ADMIN_PROBE_TOKEN" \
  -H "content-type: application/json"
```

Expected response includes:

- Schema field presence.
- Masked Odoo env presence.
- Test allocation id.
- Odoo sale.order id/name/state.
- Local `odooSaleOrderSyncedAt`.
- Idempotency result.
- Sanitized warnings/errors.

## Render Verification Result

The guarded Render verification completed successfully after the allocation sync deploy:

- Schema fields present: yes.
- Test allocation id: `alloc-odoo-sync-verify`.
- Odoo sale.order id/name/state: `2` / `SPORGYM-SPORGYMODOOSYNCVERIFY-alloc-odoo-sync-verify` / `draft`.
- Local synced timestamp: `2026-05-28T22:32:00.085Z`.
- Duplicate count for the fixed Odoo `client_order_ref`: `1`.
- Idempotency result: passed; the second sync reused the existing local/Odoo order and did not create a duplicate.

Temporary admin probe endpoints should remain disabled by default after this successful verification.

## Guarded Real Allocation One-Off Probe

A guarded one-off endpoint exists for syncing exactly one real allocation from the deployed Render runtime without replaying Shopify webhooks:

```text
POST /admin/probes/odoo-real-allocation-sync-once
```

Safety behavior:

- Disabled by default unless `ADMIN_PROBES_ENABLED=true`.
- Requires header `x-admin-probe-token`.
- Header value must match Render env `ADMIN_PROBE_TOKEN`.
- Selects the newest non-test `VendorAllocation` with:
  - `odooSaleOrderId = null`
  - at least one line item
  - assigned vendor identifier present
  - no synthetic/test/probe/verify id or order-number marker
- Uses the existing allocation-to-Odoo sale.order sync service.
- Runs the sync twice for the same allocation to confirm idempotency.
- Counts Odoo `sale.order` records by the deterministic `client_order_ref`.
- Does not replay Shopify webhooks, create invoices, confirm orders, create accounting entries, create payouts, create settlements, create shipping labels, or change product mapping.

Call from a trusted shell only:

```bash
curl -sS -X POST "https://vendor-dashboard-backend-398h.onrender.com/admin/probes/odoo-real-allocation-sync-once" \
  -H "x-admin-probe-token: $ADMIN_PROBE_TOKEN" \
  -H "content-type: application/json"
```

Set `ADMIN_PROBES_ENABLED=false` immediately after the one-off diagnostic run.

## Failure Behavior

Odoo sync runs after the Shopify allocation transaction commits. A sync failure does not roll back Shopify order ingestion or vendor allocation persistence.

Failures are logged with:

- allocation id
- sanitized Odoo error or validation message

Success is logged with:

- allocation id
- Odoo sale order id

## Current Unknowns

- Final customer/partner modeling in Odoo.
- Whether a dedicated Sporgym holding partner or customer partner mapping should be used long-term.
- Whether custom Odoo modules require additional fields beyond the discovered required fields.
- Whether product mapping should be introduced later.
