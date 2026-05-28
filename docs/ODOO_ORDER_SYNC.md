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
