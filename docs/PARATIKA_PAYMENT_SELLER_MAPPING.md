# Paratika Payment Seller Mapping

## Purpose

This document records the backend-side mapping from Sporgym internal vendors to Paratika marketplace seller IDs.

This is a mapping foundation only. It does not implement Paratika payment requests, checkout changes, payout execution, refund execution, settlement changes, invoice creation, or Shopify fulfillment behavior.

## Confirmed Seller IDs

| Internal vendor id | Provider | External seller id |
| --- | --- | --- |
| `sporjinal` | `PARATIKA` | `100003585` |
| `yalispor` | `PARATIKA` | `100003586` |

`externalSellerId` is stored as a string because provider identifiers are external references, not local numeric values.

## Source Of Truth

Shopify remains the source for order and line-item data. Vendor allocation still uses the existing backend path:

```text
Shopify line item
-> SKU
-> order metafield custom.seller_info[SKU]
-> internal Vendor.id
```

The Paratika seller ID is resolved only after the internal vendor is known:

```text
internal Vendor.id
-> VendorPaymentProviderSeller(provider = PARATIKA)
-> externalSellerId
```

Do not store Paratika seller IDs in Shopify unless a later implementation explicitly changes the architecture and documents the reason.

## Runtime Behavior

`resolveVendorPaymentSellerId(provider, vendorId)` returns the enabled external seller ID for the vendor and provider.

The resolver fails closed when:

- the provider is unsupported;
- the vendor id is empty;
- the vendor does not exist;
- the provider mapping is missing;
- the provider mapping is disabled.

No payment construction is implemented yet.

## Future Payment Construction Step

A future Paratika payment payload builder should resolve each payment line as:

```text
Shopify line / allocation line
-> internal Vendor.id
-> Paratika externalSellerId
-> Paratika marketplace item seller field
```

Before implementing payment requests, confirm Paratika's exact payload field names, item-level split semantics, webhook authenticity model, refund/cancel mapping, idempotency requirements, and which response identifiers are safe to persist.
