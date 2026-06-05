# Paratika Payment Seller Mapping

## Purpose

This document records the backend-side mapping from Sporgym internal vendors to Paratika marketplace seller numbers.

This is a mapping and payload-preview foundation only. It does not call Paratika APIs, create live `SESSIONTOKEN` values, perform `SALE`, execute refunds/cancels, change checkout, execute payouts, change settlements, create invoices, or change Shopify fulfillment behavior.

## Confirmed Seller Numbers

| Internal vendor id | Provider | External seller id |
| --- | --- | --- |
| `sporjinal` | `PARATIKA` | `Sporjinal` |
| `yalispor` | `PARATIKA` | `Yalispor` |

`externalSellerId` is stored as a string because Paratika expects the marketplace `ORDERITEMS[].sellerID` value to use the **Satıcı Numarası**, not the numeric Kurum/Firma ID.

## Source Of Truth

Shopify remains the source for order and line-item data. Vendor allocation still uses the existing backend path:

```text
Shopify line item
-> SKU
-> order metafield custom.seller_info[SKU]
-> internal Vendor.id
```

The Paratika seller number is resolved only after the internal vendor is known:

```text
internal Vendor.id
-> VendorPaymentProviderSeller(provider = PARATIKA)
-> externalSellerId
```

Do not store Paratika seller numbers in Shopify unless a later implementation explicitly changes the architecture and documents the reason.

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

The active probe model is now **Komisyon Oranı Bazlı** / Commission Rate Based.

The current Paratika merchant panel does not provide the Payment Amount Based option. The first live
`ACTION=SESSIONTOKEN` probe using Seller Payment Amount Based reached Paratika and returned:

```text
responseCode=99
errorCode=ERR10177
errorMsg=Invalid Marketplace Integration Mode
violatorParam=MERCHANT
```

That response indicates the request reached Paratika but the configured merchant does not match the seller-payment payload model. The active test model is therefore the documented `sellerCommission` commission-rate payload.

The selected probe model is controlled by:

```text
PARATIKA_MARKETPLACE_MODEL=SELLER_COMMISSION_RATE
```

Allowed values:

| Env value | ORDERITEMS field | Top-level total field |
| --- | --- | --- |
| `SELLER_COMMISSION_RATE` | `sellerCommission` | `TOTALSELLERCOMMISSION` |
| `SELLER_PAYMENT_AMOUNT` | `sellerPaymentAmount` | `TOTALSELLERPAYMENTAMOUNT` |

`SELLER_COMMISSION_RATE` is the default when `PARATIKA_MARKETPLACE_MODEL` is not configured. `SELLER_PAYMENT_AMOUNT` remains available only as a comparison probe mode.

The prepared preview builder produces a form-style `ACTION=SESSIONTOKEN` payload preview for the selected model. It intentionally omits merchant credential fields from the response:

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
- selected marketplace total field
- `SESSIONTYPE=PAYMENTSESSION`

`ORDERITEMS` is emitted as a JSON array string. Each item uses:

- `productCode`: Shopify variant id when present, otherwise SKU.
- `name`: Shopify line title when present, otherwise SKU/product code.
- `description`: SKU when present, otherwise product code.
- `quantity`: Shopify line quantity.
- `amount`: gross VAT-included line amount.
- `sellerID`: backend-resolved Paratika Satıcı Numarası.
- selected marketplace split field:
  - `sellerCommission`: commission rate from the current vendor financial profile.
  - `sellerPaymentAmount`: line gross amount minus commission and commission VAT for preview/test purposes.

The selected top-level marketplace field is paired with the selected `ORDERITEMS` split field. The probe does not mix marketplace model fields in one payload.

For `SELLER_COMMISSION_RATE`, every `ORDERITEMS` entry includes its own `sellerCommission` from the vendor financial profile. If every item has the same commission rate, the preview also includes top-level `TOTALSELLERCOMMISSION` and reports:

```json
{
  "totalSellerCommissionPolicy": "single_rate_included"
}
```

If vendors/items use different commission rates, the preview omits top-level `TOTALSELLERCOMMISSION`, keeps each item-level `sellerCommission`, and reports:

```json
{
  "totalSellerCommissionPolicy": "mixed_rates_omitted"
}
```

This avoids sending a misleading single top-level rate for multi-vendor orders such as Sporjinal `10` and Yalispor `15`.

For preview/test payloads, shipping deduction is intentionally deferred and not applied. The preview response reports:

```json
{
  "shippingDeductionPolicy": "deferred_not_applied"
}
```

This is because the current finance model stores shipping deductions at allocation level, not exact line-item level. Production payment execution must not guess a line-level shipping split, must not use proportional shipping deduction unless explicitly approved, and must continue to fail closed until the shipping deduction policy is confirmed.

The preview fails closed instead of guessing when seller ID mapping, product code, customer context, return URL, amount, seller payment amount, or seller commission rate cannot be proven from current backend data/configuration.

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
- Returns the selected `marketplaceModel`.
- Returns `model` as the selected documented marketplace model name.
- Returns validation errors when required data is missing.
- Does not include card fields.
- Does not include merchant credential values.

Runtime configuration needed for a complete preview:

- `PARATIKA_RETURN_URL`
- `PARATIKA_MARKETPLACE_MODEL` optional, defaults to `SELLER_COMMISSION_RATE`

Example:

```text
PARATIKA_RETURN_URL=https://onevendor-dashboard.onrender.com/payments/paratika/return
PARATIKA_MARKETPLACE_MODEL=SELLER_COMMISSION_RATE
```

`RETURNURL` is required for `ACTION=SESSIONTOKEN` preview generation. The preview remains fail-closed when `PARATIKA_RETURN_URL` is missing.

Customer IP/user-agent are read only from the stored Shopify order webhook payload if present. They are not invented from the admin probe request.

## Temporary SESSIONTOKEN Live Probe

Temporary admin-only diagnostic endpoint:

```text
POST /admin/probes/paratika/orders/:orderId/sessiontoken-live-probe
```

Purpose:

- Send only `ACTION=SESSIONTOKEN` to Paratika test mode after the preview payload validates.
- Verify whether Paratika returns a `sessionToken`.
- Keep checkout, card payment, `SALE`, `PREAUTH`, `REFUND`, and `VOID` out of scope.

Required gates:

- Authenticated admin session.
- `ADMIN_PROBES_ENABLED=true`.
- `PARATIKA_TEST_MODE=true`.
- `PARATIKA_PROBE_DRY_RUN=true` by default for no external API call.
- `PARATIKA_PROBE_CONFIRM=CREATE_SESSIONTOKEN_TEST` only when `PARATIKA_PROBE_DRY_RUN=false`.

Required runtime configuration:

- `PARATIKA_API_URL`
- `PARATIKA_MERCHANT`
- `PARATIKA_MERCHANTUSER`
- `PARATIKA_MERCHANTPASSWORD`
- `PARATIKA_RETURN_URL`
- `PARATIKA_HOSTED_PAYMENT_BASE_URL`, for example `https://entegrasyon.paratika.com.tr/merchant/post/sale`
- `PARATIKA_TEST_MODE`
- `PARATIKA_PROBE_DRY_RUN`
- `PARATIKA_PROBE_CONFIRM`
- `PARATIKA_MARKETPLACE_MODEL`

Dry-run behavior:

- Builds the existing preview payload.
- Does not call Paratika.
- Returns `writesPerformed=false`.
- Returns sanitized payload keys and `ORDERITEMS` preview.
- Returns selected `marketplaceModel` and `model`.
- Does not return `MERCHANTUSER`, `MERCHANTPASSWORD`, merchant credential values, card fields, a session token, or a hosted payment URL.

Live probe behavior:

- Requires `PARATIKA_PROBE_DRY_RUN=false`.
- Requires `PARATIKA_PROBE_CONFIRM=CREATE_SESSIONTOKEN_TEST`.
- Posts a form-encoded `ACTION=SESSIONTOKEN` payload to `PARATIKA_API_URL`.
- Returns `writesPerformed=true` because an external SESSIONTOKEN request was made.
- Returns `responseCode`, `responseMsg`, whether a session token was received, session token length only, and raw response body keys only.
- When `responseCode=00` and a session token is returned, derives `hostedPaymentUrl` as `PARATIKA_HOSTED_PAYMENT_BASE_URL/sessionToken` for manual redirect testing.
- Also returns `hostedPaymentUrlCandidates` for manual testing of known Paratika hosted paths:
  - `https://entegrasyon.paratika.com.tr/merchant/post/sale/{sessionToken}`
  - `https://entegrasyon.paratika.com.tr/merchant/post/sale3d/{sessionToken}`
  - `https://entegrasyon.paratika.com.tr/paratika/api/v2/post/sale3d/{sessionToken}`
- Uses the selected `PARATIKA_MARKETPLACE_MODEL`.
- Never returns the session token value separately and never returns merchant credentials.
- Does not perform `SALE`; the hosted URL is only for manual redirect testing.
- Does not fetch or open hosted URL candidates server-side.

Remove or keep disabled after test-mode SESSIONTOKEN behavior is confirmed.

## Payment Return Placeholder

Externally shareable Paratika return URL:

```text
https://onevendor-dashboard.onrender.com/payments/paratika/return
```

Current behavior:

- The frontend route displays: `Payment return received. Verification pending.`
- No payment is completed.
- No Shopify order is marked paid.
- No Shopify payment API is called.
- No Paratika API is called.
- Query parameters are not trusted and are not displayed.

Backend placeholder routes also exist for provider-side return/callback testing if Paratika requires the backend host instead of the frontend host:

```text
GET /payments/paratika/return
POST /payments/paratika/return
```

Backend behavior:

- Accepts the request and returns `202`.
- Logs only sanitized metadata such as method, request id, parameter counts, and sensitive-key counts.
- Does not log raw query/body values, card data, tokens, merchant credentials, or secrets.
- Does not mutate order, payment, Shopify, settlement, payout, or accounting state.

## Temporary Production Backfill Probe

Temporary admin-only endpoints:

```text
POST /admin/probes/paratika/payment-seller-mappings/backfill
GET /admin/probes/paratika/payment-seller-mappings/backfill
```

Purpose:

- Backfill the confirmed `VendorPaymentProviderSeller` rows in environments where the migration exists but seed/backfill data was not applied.
- Upsert only:
  - `sporjinal` / `PARATIKA` / `Sporjinal`
  - `yalispor` / `PARATIKA` / `Yalispor`

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
