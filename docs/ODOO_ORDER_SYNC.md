# Odoo Order Sync

## Status

Odoo order sync is inactive and deprecated.

Shopify order ingestion must not call Odoo allocation or sale order sync. Odoo production probes and one-off sync endpoints must remain unavailable.

Historical fields remain for compatibility until a later schema cleanup phase:

- `VendorAllocation.odooSaleOrderId`
- `VendorAllocation.odooSaleOrderName`
- `VendorAllocation.odooSaleOrderSyncedAt`
