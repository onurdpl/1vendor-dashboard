# Paratika Payment Seller Mapping

## Purpose

This document records the backend-side mapping from Sporgym internal vendors to Paratika marketplace seller IDs.

This is a mapping and payload-preview foundation only. It does not call Paratika APIs, create live `SESSIONTOKEN` values, perform `SALE`, execute refunds/cancels, change checkout, execute payouts, change settlements, create invoices, or change Shopify fulfillment behavior.

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

No live payment construction is implemented yet.

## Confirmed Marketplace Contract

Paratika marketplace will use the **Satıcı Ödeme Tutarı Bazlı** model.

The prepared preview builder produces a form-style `ACTION=SESSIONTOKEN` payload preview for this model. It intentionally omits merchant credential fields from the response:

- `MERCHANTUSER`
- `MERCHANTPASSWORD`
- `MERCHANT`

Those values must be supplied only by secure runtime configuration in a future live API caller. They are not returned by the preview endpoint.

Required non-credential fields currently modeled:

- `ACTION=SESSIONTOKEN`
- `AMOUNT`
- `CURRENCY=TRY`
- `MERCHANTPAYMENTID`
- `RETURNURL`
- `CUSTOMER`
- `CUSTOMERNAME`
- `CUSTOMEREMAIL`
- `CUSTOMERIP`
- `CUSTOMERUSERAGENT`
- `CUSTOMERPHONE`
- `ORDERITEMS`
- `TOTALSELLERPAYMENTAMOUNT`
- `SESSIONTYPE=PAYMENTSESSION`

`ORDERITEMS` is emitted as a JSON array string. Each item uses:

- `productCode`: Shopify variant id when present, otherwise SKU.
- `name`: Shopify line title when present, otherwise SKU/product code.
- `description`: SKU when present, otherwise product code.
- `quantity`: Shopify line quantity.
- `amount`: gross VAT-included line amount.
- `sellerID`: backend-resolved Paratika seller id.
- `sellerPaymentAmount`: vendor payment amount from existing configured finance profile logic only.

`TOTALSELLERPAYMENTAMOUNT` is the sum of `ORDERITEMS[].sellerPaymentAmount`.

The preview fails closed instead of guessing when seller ID mapping, product code, customer context, return URL, amount, or seller payment amount cannot be proven from current backend data/configuration.

## Preview Endpoint

Admin-only diagnostic endpoint:

```text
GET /admin/probes/paratika/orders/:orderId/sessiontoken-payload-preview
```

Behavior:

- Requires authenticated admin access.
- Requires `ADMIN_PROBES_ENABLED=true`.
- Does not call Paratika.
- Returns `writesPerformed=false`.
- Returns `provider=PARATIKA`.
- Returns `model=seller_payment_amount_based`.
- Returns validation errors when required data is missing.
- Does not include card fields.
- Does not include merchant credential values.

Runtime configuration needed for a complete preview:

- `PARATIKA_RETURN_URL`

Customer IP/user-agent are read only from the stored Shopify order webhook payload if present. They are not invented from the admin probe request.

## Temporary Production Backfill Probe

Temporary admin-only endpoints:

```text
POST /admin/probes/paratika/payment-seller-mappings/backfill
GET /admin/probes/paratika/payment-seller-mappings/backfill
```

Purpose:

- Backfill the confirmed `VendorPaymentProviderSeller` rows in environments where the migration exists but seed/backfill data was not applied.
- Upsert only:
  - `sporjinal` / `PARATIKA` / `100003585`
  - `yalispor` / `PARATIKA` / `100003586`

Behavior:

- Requires authenticated admin access.
- Requires `ADMIN_PROBES_ENABLED=true`.
- Does not call Paratika.
- Does not return credentials or secrets.
- Returns `writesPerformed=true` only when the DB upsert path executes.
- Is idempotent because it uses provider/vendor upserts.
- The `GET` route is temporary and exists only for manual diagnostics where invoking the CSRF-protected `POST` route is impractical.

Remove or disable this temporary probe after production mapping presence is confirmed.

## Refund Note

Paratika `REFUND` supports optional `ORDERITEMS` for product-code-based partial refund according to the reviewed contract, but refund is not implemented in this step.

## Future Persistence Needs

Future live Paratika implementation must decide where to persist transaction evidence before any payment execution:

- `pgTranId`
- `merchantPaymentId`
- `pgOrderId`
- `sessionToken`, if required for reconciliation or redirect lifecycle

## Future Payment Construction Step

A future Paratika payment payload builder should resolve each payment line as:

```text
Shopify line / allocation line
-> internal Vendor.id
-> Paratika externalSellerId
-> Paratika marketplace item seller field
```

Before implementing payment requests, confirm Paratika's exact payload field names, item-level split semantics, webhook authenticity model, refund/cancel mapping, idempotency requirements, and which response identifiers are safe to persist.
