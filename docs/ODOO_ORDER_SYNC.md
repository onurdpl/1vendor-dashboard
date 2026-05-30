# Odoo Order Sync

## Purpose

This document describes the first real Shopify vendor allocation to Odoo `sale.order` sync.

The sync is intentionally narrow:

- It runs after a Sporgym `VendorAllocation` is persisted.
- It creates one Odoo draft `sale.order` per vendor allocation.
- It matches Odoo products by Shopify SKU / `product.product.default_code`.
- It can create a minimal Odoo product on demand when the SKU is missing in Odoo.
- It does not run full Shopify-Odoo catalog sync or overwrite existing Odoo products.
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

Required vendor portal mapping:

```text
ODOO_VENDOR_PARTNER_MAP=sporjinal:11,yalispor:12
```

This maps Sporgym vendor identifiers to existing Odoo partner ids for `sale.order.x_vendor_id`. If the allocation vendor is not mapped, sync fails closed before creating an Odoo order. The sync does not guess partner ids or create Odoo partners.

Odoo must already expose writable custom field `sale.order.x_vendor_id`. If `x_vendor_id` is missing, readonly, or not a Many2one field, sync stops before create.

Expected Odoo field definition:

- Model: `sale.order`
- Field label: `Vendor`
- Technical name: `x_vendor_id`
- Field type: `many2one`
- Relation: `res.partner`
- Required: no, unless every sale order in Odoo must be vendor-scoped
- Writable by: the Sporgym Odoo integration user
- Portal security rule: vendor portal users should only read sale orders whose `x_vendor_id` matches their allowed partner/commercial partner; this rule must be implemented and reviewed in Odoo, not inferred by Sporgym
- Admin/internal users: retain normal sales order access according to Odoo roles

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
- `x_vendor_id`: mapped Odoo vendor partner id from `ODOO_VENDOR_PARTNER_MAP`.
- `picking_policy`: `direct`, Odoo's standard delivery policy value for delivering each product as soon as it is available.
- `client_order_ref`: `sporgym-allocation:{allocationId}`.
- `origin`: Shopify order number.
- `note`: operational context.
- `order_line`: one product-backed line per allocation line item.

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
- `product_id`: existing or newly created `product.product` matched by SKU.
- `product_uom_qty`: allocation line item quantity.
- `price_unit`: Shopify unit price.

## On-Demand Product Creation

Shopify remains the source of truth for allocation line SKU, title, quantity, and price. The Odoo sync does not perform catalog reconciliation.

For each allocation line:

1. Read the Shopify SKU from the persisted Shopify order line item.
2. Fail closed if SKU is missing or blank.
3. Search Odoo `product.product` where `default_code = SKU`.
4. If found, reuse that product and do not update it.
5. If not found, create a minimal product for sale order representation only.

Minimal product fields sent:

- `name`: Shopify product/variant title, falling back to SKU.
- `default_code`: Shopify SKU.
- `list_price`: Shopify unit price.
- `sale_ok`: `true`.
- `type` or `detailed_type`: discovered consumable value when supported, otherwise discovered storable value.
- `uom_id`: first active Odoo `uom.uom` record discoverable by the integration user.
- `uom_po_id`: same unit when Odoo exposes the field as writable.
- `taxes_id`: first active sale tax only when discoverable; otherwise omitted.
- `description_sale`: operational reference with SKU, allocation id, and Shopify line item id.

The sync validates required Odoo fields from `fields_get` before product/order creation. Existing Odoo products are never overwritten.

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
- Odoo sale.order id/name/state and `x_vendor_id` when returned by Odoo.
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
- Reports `x_vendor_id` when returned by Odoo.
- Does not replay Shopify webhooks, create invoices, confirm orders, create accounting entries, create payouts, create settlements, create shipping labels, or change product mapping.

Call from a trusted shell only:

```bash
curl -sS -X POST "https://vendor-dashboard-backend-398h.onrender.com/admin/probes/odoo-real-allocation-sync-once" \
  -H "x-admin-probe-token: $ADMIN_PROBE_TOKEN" \
  -H "content-type: application/json"
```

Set `ADMIN_PROBES_ENABLED=false` immediately after the one-off diagnostic run.

## Guarded Read-Only Allocation Status Probe

A guarded read-only endpoint exists for checking whether a specific allocation is linked to Odoo without running sync:

```text
GET /admin/probes/odoo-allocation-sync-status?allocationId=<allocation-id>
```

Safety behavior:

- Disabled by default unless `ADMIN_PROBES_ENABLED=true`.
- Requires header `x-admin-probe-token`.
- Header value must match Render env `ADMIN_PROBE_TOKEN`.
- Reads one `VendorAllocation` by id.
- Reads local Odoo sync fields only:
  - `odooSaleOrderId`
  - `odooSaleOrderName`
  - `odooSaleOrderSyncedAt`
- If local `odooSaleOrderId` exists, reads Odoo `sale.order` by that id.
- If local `odooSaleOrderId` is missing, searches Odoo by deterministic `client_order_ref = sporgym-allocation:<allocation-id>`.
- Returns duplicate count for the deterministic Odoo reference.
- Does not run sync, replay Shopify webhooks, create Odoo records, create invoices, confirm orders, create accounting entries, create payouts, create settlements, or create shipping labels.

Call from a trusted shell only:

```bash
curl -sS "https://vendor-dashboard-backend-398h.onrender.com/admin/probes/odoo-allocation-sync-status?allocationId=alloc-sporjinal-7684032495953" \
  -H "x-admin-probe-token: $ADMIN_PROBE_TOKEN"
```

Expected response includes:

- Allocation id.
- Shopify order number/id.
- Vendor identifier.
- Line item count.
- Local Odoo sync metadata.
- Odoo sale.order id/name/state and `x_vendor_id` when found.
- Duplicate count.
- Sanitized warnings/unknowns/errors.

## Guarded Read-Only Allocation Diagnosis Probe

A guarded read-only endpoint exists for diagnosing why one allocation did not sync without creating anything:

```text
GET /admin/probes/odoo-allocation-sync-diagnosis?allocationId=<allocation-id>
```

Safety behavior:

- Disabled by default unless `ADMIN_PROBES_ENABLED=true`.
- Requires header `x-admin-probe-token`.
- Header value must match Render env `ADMIN_PROBE_TOKEN`.
- Reads one `VendorAllocation` by id.
- Reads runtime Odoo env gates as booleans only.
- Checks whether the allocation vendor is present in `ODOO_VENDOR_PARTNER_MAP`.
- Checks Odoo `sale.order.x_vendor_id` existence/type/writability.
- Checks Odoo required writable fields for `sale.order` and `sale.order.line`.
- Searches Odoo `product.product` by allocation SKU using `default_code`.
- Counts Odoo `sale.order` records by deterministic `client_order_ref`.
- Reports that order ingestion calls sync after allocation persistence, but failed sync results are logged and not persisted on the allocation.
- Does not run sync, replay Shopify webhooks, create Odoo records, create invoices, confirm orders, create accounting entries, create payouts, create settlements, or create shipping labels.

Call from a trusted shell only:

```bash
curl -sS "https://vendor-dashboard-backend-398h.onrender.com/admin/probes/odoo-allocation-sync-diagnosis?allocationId=alloc-sporjinal-7684032495953" \
  -H "x-admin-probe-token: $ADMIN_PROBE_TOKEN"
```

## Failure Behavior

Odoo sync runs after the Shopify allocation transaction commits. A sync failure does not roll back Shopify order ingestion or vendor allocation persistence.

Failures are logged with:

- allocation id
- sanitized Odoo error or validation message

Success is logged with:

- allocation id
- Odoo sale order id
- mapped Odoo `x_vendor_id`

## Current Unknowns

- Final customer/partner modeling in Odoo.
- Whether a dedicated Sporgym holding partner or customer partner mapping should be used long-term.
- Whether custom Odoo modules require additional fields beyond the discovered required fields.
- Whether a full catalog sync should be introduced later.
