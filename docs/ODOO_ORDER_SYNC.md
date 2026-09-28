# Odoo Order Sync

> Historical retired-integration notes. This provider is no longer connected or supported.
> Setup commands, credentials, probes and execution paths below are forensic history only,
> not current operational instructions. The executable integration has been removed.

## Status

Odoo order sync is inactive and deprecated.

Shopify order ingestion must not call Odoo allocation or sale order sync. Odoo production probes and one-off sync endpoints must remain unavailable.

Historical fields remain for compatibility until a later schema cleanup phase:

- `VendorAllocation.odooSaleOrderId`
- `VendorAllocation.odooSaleOrderName`
- `VendorAllocation.odooSaleOrderSyncedAt`
