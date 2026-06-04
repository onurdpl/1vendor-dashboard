# Lidio Marketplace Discovery

## Scope
- This document is based only on the uploaded OpenAPI schema at `/Users/onur/Downloads/Lidio-API.json`.
- No runtime code, routes, database migrations, payment calls, refund calls, shipping/provider logic, Try OTO/Kargonomi work, or finance ledger persistence were added.
- The OpenAPI document title is `Mobilexpress API`, and the API is referred to here as Lidio because that is the provider context for this discovery.

## Confirmed Marketplace Endpoints
The schema includes these marketplace-related paths:
- `/CreateSubseller`
- `/UpdateSubseller`
- `/GetSubsellerList`
- `/Release`
- `/Unrelease`
- `/BalanceTransfer`
- `/DistributeSubsellerPayout`

## Authentication
- The inspected API endpoints require a `MerchantCode` header.
- `/CreateAPIKey` uses `LoginRequest` as its request model.
- `/CreateAPIKey` describes the returned token as usable in the `Authorization` header with the format `MxC2S TokenValue`.
- `/CreateAuthKey` uses `CreateAuthKeyRequest` as its request model.
- `/CreateAuthKey` describes the returned token as usable in the `Authorization` header with the format `MxM2S TokenValue`.
- `CreateAuthKeyResult` includes a `token` field.
- Lidio support confirmed Sporgym's `MerchantCode` is `SPORGYM`.
- Lidio support confirmed the server-to-server token type is `MxS2S`.
- Lidio support confirmed `MerchantKey`, `ApiPassword`, and an authorization credential exist.
- Lidio support confirmed `MerchantKey` validates ReturnURL hash.
- Lidio support confirmed `ApiPassword` validates payment notification `parameterhash`.
- Unknown: the exact sandbox base URL. The OpenAPI `servers` entry only contains `/api`.
- Unknown: the exact `MxS2S` token creation flow because the inspected OpenAPI descriptions mention `MxC2S` and `MxM2S`, while Lidio support confirmed `MxS2S` for server-to-server use.

## Subseller Model
`CreateSubsellerRequest` supports:
- company fields: `companyName`, `companyType`, `taxOffice`, `vkntckn`, `mersisNo`, `tradeRegistryNo`
- registered address fields: `registeredCountry`, `registeredCity`, `registeredDistrict`, `registeredAddress`
- payout/account fields: `ibanList`, `payOutNotAllowed`, `payOutBlockageAmount`, `payOutPreventionReason`, `payOutReportEmailRecipients`
- merchant mapping field: `subsellerIdGivenByMerchant`
- contact fields: `contactName`, `contactPhone`, `contactEmail`
- marketplace controls: `virtualProductPermission`, `merchantPanelUse`, `chargebacksOnSubseller`, `subsellerContractApproval`, `subsellerProfileId`

Lidio support confirmed Sporgym's `SubsellerProfileId` is `3`.

`UpdateSubsellerRequest` includes `subsellerId`, described as the Lidio-assigned subseller id, plus similar updateable company, address, contact, payout, contract, and merchant mapping fields.

Lidio response/list models confirm both identifiers:
- `FCCreateSubsellerResult.subsellerId`
- `FCCreateSubsellerResult.subsellerIdGivenByMerchant`
- `FCUpdateSubsellerResult.subsellerId`
- `FCUpdateSubsellerResult.subsellerIdGivenByMerchant`
- `FCGetSubsellerInfo.subsellerId`
- `FCGetSubsellerInfo.subsellerIdGivenByMerchant`

## Basket And Item-Level Marketplace Split
- `PaymentRequest` has `basketItems: BasketItem[]`.
- `StartHostedPaymentProcessRequest` has `basketItems: BasketItem[]`.
- `StartHostedPrePaymentRequest` has `basketItems: BasketItem[]`.
- `BasketItem` has `marketplace: BasketItemMPDetails`.
- `BasketItemMPDetails` requires:
  - `subsellerId`
  - `itemTotalPrice`
- `BasketItemMPDetails` optionally accepts:
  - `subsellerPayoutAmount`
- `BasketItemMPDetails.subsellerId` is described as `SubsellerId. If the value is zero, the basket item is processed as if it belongs to the marketplace itself`.

Conclusion from schema shape: sub-seller assignment is item-level, not only payment-level.

## Commission And Platform Amount
- The marketplace request-side models inspected do not expose a marketplace split field named `commissionAmount` or `platformCommission`.
- The available item-level payout control is `BasketItemMPDetails.subsellerPayoutAmount`.
- Likely implementation implication requiring Lidio confirmation: platform commission may be derived operationally as `itemTotalPrice - subsellerPayoutAmount`.
- Unknown: whether Lidio treats that difference exactly as platform commission in all marketplace settlement flows.

## Multiple Subseller Split
- Because payment requests accept `basketItems[]`, and each `BasketItem` can contain its own `marketplace.subsellerId`, the schema supports one payment request containing multiple item-level subseller assignments.
- Unknown: actual production enablement, maximum item/subseller limits, and settlement behavior. These must be confirmed with Lidio support before runtime implementation.

## Release And Unrelease
- `/Release` is described as releasing a marketplace sub-merchant payment by customer approval.
- `ReleasePaymentRequest` requires `orderId`.
- `ReleasePaymentRequest` optionally accepts `basketItems: PostPaymentBasketItem[]`.
- `PostPaymentBasketItem` requires `basketItemId`.
- This indicates release can target specific marketplace basket items.
- `/Unrelease` uses the same request shape through `UnreleasePaymentRequest`, with optional `basketItems: PostPaymentBasketItem[]`.
- Unknown: whether partial monetary release is supported. `PostPaymentBasketItem` does not expose an amount field in the inspected schema.

## Payout Distribution
- `/DistributeSubsellerPayout` uses `DistributeSubsellerPayoutRequest`.
- `DistributeSubsellerPayoutRequest` requires `orderId`.
- `DistributeSubsellerPayoutRequest` optionally accepts `basketItems: BasketItem[]`.
- `PaymentRequest`, `StartHostedPaymentProcessRequest`, and `StartHostedPrePaymentRequest` include `dontDistributeSubsellerPayout`.
- The `dontDistributeSubsellerPayout` description says it is only for Marketplace merchants and changes the standard marketplace flow where payout distribution is handled from payment transaction marketplace basket item details.
- Unknown: exact operational timing and settlement lifecycle.

## Refunds And Cancel
- `/Cancel` uses `CancelPaymentRequest`.
- `CancelPaymentRequest` requires `orderId`.
- `/Refund` uses `RefundPaymentRequest`.
- `RefundPaymentRequest` requires `orderId`, `totalAmount`, and `currency`.
- `RefundPaymentRequest` has `basketItems: RefundBasketItem[]`.
- `RefundBasketItem` requires:
  - `basketItemId`
  - `itemRefundAmount`
- `RefundBasketItem` descriptions state these fields are required only for, and applicable only to, Marketplace transactions.
- Therefore marketplace partial/item-level refund allocation is supported by schema.
- Unknown: whether refunds are auto-allocated when `basketItems` is omitted.
- `RefundPaymentRequest` has `refundTransId` for refund idempotency.
- The `refundTransId` description says repeated refund calls for the same `orderId` plus `refundTransId` can return `DuplicateRequest`, and merchants may process that equivalent to success if a previous attempt succeeded.

## Webhook, Callback, And Notification
- `PaymentRequest`, `StartHostedPaymentProcessRequest`, and `StartHostedPrePaymentRequest` include `notificationUrl` and `alternateNotificationUrl`.
- `FCPaymentNotification` exists.
- `FCPaymentNotification.action` allows these values: `Payment`, `Postauth`, `Cancel`, `Refund`, `PartialPayment`, `HostedPrePayment`.
- `FCPaymentNotification` includes:
  - `companyInfo`
  - `paymentResult`
  - `processInfo`
  - `customerInfo`
  - `basketItems`
  - `paymentList`
- No webhook signature field was confirmed in the `FCPaymentNotification` schema.
- Return URL hash verification exists in the `ProcessPayment` and hosted flow descriptions.
- Unknown: notification signing. Lidio support must confirm whether notifications are signed, which header or field carries the signature, and which algorithm is used.

## Idempotency
- Refund idempotency is explicitly documented through `RefundPaymentRequest.refundTransId`.
- Payment `orderId` uniqueness behavior is documented in payment request models.
- `BalanceTransferRequest.transactionId` is described as a unique balance transfer transaction id given by the merchant.
- No general `Idempotency-Key` header was found in the inspected schema.
- Unknown: general idempotency support outside `refundTransId`, `orderId`, and `transactionId`.

## Required Environment Variables For Sandbox Discovery
Expected variables for a future sandbox probe:
- `LIDIO_BASE_URL`
- `LIDIO_MERCHANT_CODE`
- `LIDIO_MERCHANT_KEY`
- `LIDIO_API_PASSWORD`
- `LIDIO_AUTHORIZATION_CREDENTIAL`
- `LIDIO_S2S_TOKEN` or token creation inputs, depending on the confirmed `MxS2S` flow
- `LIDIO_NOTIFICATION_URL`
- `LIDIO_RETURN_URL`
- `LIDIO_SANDBOX_MODE`
- `LIDIO_SUBSELLER_PROFILE_ID`

Known values confirmed by Lidio support:
- `LIDIO_MERCHANT_CODE=SPORGYM`
- `LIDIO_SUBSELLER_PROFILE_ID=3`

Unknown: exact sandbox base URL and exact `MxS2S` token creation inputs until Lidio provides the sandbox credential contract.

## Shopify Implications For Sporgym
- Shopify variant/product mapping can map to Sporgym vendor/subseller records.
- A future runtime payment request would need backend-resolved `basketItems[].marketplace.subsellerId`.
- Do not store Lidio subseller payout, commission, IBAN, or tax data in Shopify metafields unless explicitly approved later.
- The backend should remain the source of truth for vendor to Lidio subseller mapping.
- Existing vendor allocation can likely feed item-level marketplace split, but no runtime implementation was added in this discovery.
- Shopify compatibility remains a risk because Shopify checkout/payment provider constraints are not proven by this OpenAPI schema.

## Comparison With Previous Iyzico Assumptions
- The iyzico marketplace assumption required basket item `subMerchantKey` and `subMerchantPrice`.
- The Lidio equivalent schema appears to be `BasketItem.marketplace.subsellerId` and `BasketItem.marketplace.subsellerPayoutAmount`.
- Lidio has explicit `/Release`, `/Unrelease`, and `/DistributeSubsellerPayout` APIs.
- Unlike the previous iyzico path, Shopify compatibility is still unknown and must not be assumed.

## Open Questions Summary
The original OpenAPI-only unknowns are refined in the `Lidio Support Validation Matrix` and the final `Questions To Send To Lidio` section below. Lidio support has since confirmed `MerchantCode=SPORGYM`, server-to-server token type `MxS2S`, credential existence, `SubsellerProfileId=3`, ReturnURL hash validation by `MerchantKey`, and payment notification `parameterhash` validation by `ApiPassword`.

## Recommended Smallest Safe PoC
The initial OpenAPI-only PoC recommendation has been replaced by the more specific `Minimum Safe Sandbox PoC` below.

No production payment execution should happen until Lidio confirms the sandbox contract and webhook security behavior.

## Conclusion
Lidio OpenAPI schema confirms item-level marketplace primitives. The key schema evidence is `BasketItem.marketplace -> BasketItemMPDetails` with `subsellerId`, `itemTotalPrice`, and optional `subsellerPayoutAmount`. `RefundBasketItem` confirms item-level marketplace refund allocation. However, Shopify compatibility, webhook signature rules, production enablement, settlement timing, and some payout lifecycle behavior remain unknown.

# Lidio Support Validation Matrix

| Topic | Current Evidence | Risk | Blocking? | Required From Lidio |
|---------|---------|---------|---------|---------|
| Sandbox Base URL | OpenAPI `servers` only shows `/api`. Support confirmed Sporgym credentials exist, but not the base URL. | Cannot run deterministic sandbox probes. | Blocking | Exact sandbox base URL, production base URL, and whether `/api` is included in the base. |
| MxS2S token creation flow | Support confirmed server-to-server token type is `MxS2S`. OpenAPI descriptions mention `MxC2S` for `/CreateAPIKey` and `MxM2S` for `/CreateAuthKey`. | Wrong auth flow could block all server-side calls. | Blocking | Exact token endpoint, request body, headers, credential inputs, token lifetime, and final `Authorization` header format. |
| `parameterhash` formula | Support confirmed `ApiPassword` validates payment notification `parameterhash`. OpenAPI confirms ReturnURL hash but not notification hash formula. | Notifications cannot be safely trusted without verification. | Blocking | Exact canonical string, included fields, ordering, separators, hash algorithm, encoding, and sample payload/hash. |
| Notification signature model | `FCPaymentNotification` exists, but no signature field was confirmed in that schema. Support confirmed `parameterhash` exists for payment notifications. | Callback ingestion could accept forged or replayed events if verification is wrong. | Blocking | Whether `parameterhash` is the only notification signature, where it appears, replay protection guidance, and failure handling expectations. |
| Release lifecycle | `/Release` exists and accepts `orderId` plus optional basket item ids. | Incorrect release timing could pay vendors before operational approval. | Important | State machine from payment success to release eligibility, required trigger, and expected result statuses. |
| Unrelease lifecycle | `/Unrelease` exists with the same item-targeting request shape as release. | Incorrect rollback behavior could leave held or released funds inconsistent. | Important | When unrelease is allowed, whether it reverses release before settlement only, and result/status semantics. |
| Settlement lifecycle | OpenAPI has subseller payout fields and marketplace endpoints, but timing is not specified. | Finance and operations cannot safely promise payout timing. | Important | End-to-end settlement timeline, payout status fields, merchant panel states, and failure/retry handling. |
| `DistributeSubsellerPayout` lifecycle | Endpoint exists. Payment requests have `dontDistributeSubsellerPayout`, described as a later secondary payout-detail flow. | Wrong two-step use could misallocate vendor payouts. | Important | When to use it, whether it is mandatory with `dontDistributeSubsellerPayout`, allowed timing, idempotency, and failure behavior. |
| Multi-subseller payment limits | Schema supports `basketItems[]`, each with its own `marketplace.subsellerId`. | Production limits could reject valid multi-vendor Shopify orders. | Blocking | Confirmation that one payment may include multiple subsellers in production, plus maximum items/subsellers and amount limits. |
| Partial release behavior | Release can target basket item ids, but `PostPaymentBasketItem` has no amount field. | Cannot model partial monetary release safely if only item-level release is supported. | Important | Whether release is item-only or can be monetary partial, and how quantity/partial item cases work. |
| Marketplace refund allocation behavior | `RefundBasketItem` requires `basketItemId` and `itemRefundAmount` for marketplace transactions. | Refunds could be rejected or misallocated if item allocation is omitted. | Blocking | Whether marketplace refunds require `basketItems`, whether omission is rejected or auto-allocated, and how duplicate `refundTransId` should be handled operationally. |
| Platform commission defaulting | Request-side marketplace models expose `subsellerPayoutAmount`, but no marketplace `commissionAmount` or `platformCommission` field was confirmed. | Commission math could be wrong when payout amount is omitted. | Important | How commission is configured when `subsellerPayoutAmount` is null, and whether `itemTotalPrice - subsellerPayoutAmount` is the correct merchant-side interpretation. |
| Hosted flow payout fields | Hosted payment requests include `basketItems[]` and `dontDistributeSubsellerPayout`, but production behavior is not verified. | Hosted checkout may accept basket items but ignore or restrict payout fields. | Blocking | Confirmation that `subsellerPayoutAmount` can be supplied per item in the hosted payment flow used by Sporgym. |
| Shopify hosted checkout compatibility | OpenAPI proves Lidio marketplace primitives, not Shopify checkout integration compatibility. | Sporgym may be unable to use these primitives inside Shopify checkout. | Blocking | Supported Shopify integration mode and whether hosted payment can receive item-level marketplace data from Shopify checkout. |
| Shopify payment provider compatibility | No OpenAPI evidence confirms Lidio is usable as a Shopify payment provider with marketplace basket split. | Checkout/payment architecture could be incompatible even if Lidio API supports marketplace. | Blocking | Whether Lidio is available/approved as a Shopify payment provider for this merchant/region and how provider callbacks map to Lidio marketplace APIs. |
| Production activation requirements | OpenAPI includes marketplace APIs, but enablement requirements are not specified. | Sandbox success may not translate to production readiness. | Blocking | Required contracts, marketplace flags, IP allowlists, KYB/vendor data requirements, webhook allowlist, rate limits, and go-live checklist. |
| BalanceTransfer sandbox availability | `/BalanceTransfer` exists and requires `transactionId`, source/destination subsellers, amount, and currency. | Later payout-adjustment probes may be delayed if sandbox does not support it. | Nice To Have | Whether `/BalanceTransfer` is enabled in sandbox and whether it is relevant to Sporgym's intended marketplace flow. |
| Sandbox test cards and 3DS flows | Payment and hosted descriptions reference card and hosted/3DS flows, but test instruments are not in the inspected schema. | Sandbox PoC may take longer without known test instruments. | Nice To Have | Sandbox test cards, 3DS scenarios, and expected success/failure test cases. |

# Sporgym Marketplace Readiness

| Capability | Status | Evidence | Remaining Gap |
|---------|---------|---------|---------|
| Vendor onboarding | PARTIALLY CONFIRMED | `/CreateSubseller`, `/UpdateSubseller`, `/GetSubsellerList`, Lidio-assigned `subsellerId`, merchant-provided `subsellerIdGivenByMerchant`, and support-confirmed `SubsellerProfileId=3`. | Sandbox base URL, `MxS2S` auth flow, required production KYB fields, and activation rules. |
| Vendor mapping | PARTIALLY CONFIRMED | Lidio returns both `subsellerId` and `subsellerIdGivenByMerchant`; Sporgym backend can remain source of truth for vendor-to-subseller mapping. | No runtime mapping has been implemented; Shopify compatibility remains unknown. |
| Basket item allocation | CONFIRMED | `PaymentRequest`, `StartHostedPaymentProcessRequest`, and `StartHostedPrePaymentRequest` accept `basketItems[]`; each `BasketItem` can include `marketplace`. | Production multi-subseller limits still need support confirmation. |
| Split payment modeling | PARTIALLY CONFIRMED | `BasketItemMPDetails` requires `subsellerId` and `itemTotalPrice`, with optional `subsellerPayoutAmount`. | Platform commission behavior when `subsellerPayoutAmount` is null remains unknown. |
| Refund modeling | PARTIALLY CONFIRMED | `RefundPaymentRequest` accepts `basketItems: RefundBasketItem[]`; `RefundBasketItem` requires `basketItemId` and `itemRefundAmount`; `refundTransId` supports refund idempotency. | Omitted `basketItems` behavior and production refund allocation rules remain unknown. |
| Payout modeling | PARTIALLY CONFIRMED | `subsellerPayoutAmount`, `dontDistributeSubsellerPayout`, `/DistributeSubsellerPayout`, and `/BalanceTransfer` exist. | Settlement timing, payout status visibility, and two-step payout lifecycle remain unknown. |
| Release modeling | PARTIALLY CONFIRMED | `/Release` and `/Unrelease` exist and can target `PostPaymentBasketItem.basketItemId`. | Partial monetary release, unrelease constraints, and release-to-settlement lifecycle remain unknown. |
| Shopify compatibility | UNKNOWN | OpenAPI confirms Lidio marketplace API primitives only. | Shopify hosted checkout and Shopify payment provider compatibility must be confirmed by Lidio and/or Shopify before runtime implementation. |

# Minimum Safe Sandbox PoC

Document only. No implementation is included in this discovery.

## PoC-1: MxS2S Authentication
- Confirm sandbox base URL.
- Create or obtain an `MxS2S` token using the support-confirmed Sporgym credentials.
- Verify the final `Authorization` header format without calling payment execution endpoints.

## PoC-2: CreateSubseller
- Create one sandbox subseller using `CreateSubsellerRequest`.
- Use support-confirmed `SubsellerProfileId=3`.
- Record the Lidio-assigned `subsellerId` and merchant-provided `subsellerIdGivenByMerchant`.

## PoC-3: GetSubsellerList
- Query `/GetSubsellerList`.
- Confirm the created sandbox subseller is returned with both Lidio and merchant identifiers.

## PoC-4: PaymentRequest With `BasketItem.marketplace`
- In sandbox only, prepare a payment request containing multiple `basketItems[]`, each with `marketplace.subsellerId`, `marketplace.itemTotalPrice`, and optional `marketplace.subsellerPayoutAmount`.
- Validate whether Lidio accepts item-level marketplace split in the intended hosted or server flow.
- Do not execute production payment collection.

## PoC-5: Notification Validation
- Capture a sandbox payment notification.
- Validate ReturnURL hash with `MerchantKey`.
- Validate payment notification `parameterhash` with `ApiPassword`.
- Confirm replay and invalid-hash handling expectations.

## PoC-6: RefundBasketItem Validation
- In sandbox only, refund a marketplace test transaction using `RefundPaymentRequest.basketItems[]`.
- Confirm `RefundBasketItem.basketItemId`, `itemRefundAmount`, and `refundTransId` behavior.
- Confirm whether omitted `basketItems` is rejected or auto-allocated.

# Questions To Send To Lidio

1. What are the exact sandbox and production base URLs, and should requests append `/api`?
2. What is the exact `MxS2S` token creation flow, including endpoint, request body, required headers, credential inputs, token lifetime, and `Authorization` header format?
3. What is the exact payment notification `parameterhash` formula, including fields, ordering, separators, algorithm, encoding, and one sample payload/hash?
4. Is `parameterhash` the complete notification signature model, and what replay protection or timestamp/idempotency checks should merchants apply?
5. Can a production payment contain multiple `basketItems[].marketplace.subsellerId` values, and what are the item, subseller, and amount limits?
6. For marketplace refunds, are `RefundPaymentRequest.basketItems[]` required, rejected when omitted, or auto-allocated?
7. Are `/Release` and `/Unrelease` item-only or monetary-partial, and what is the release/unrelease-to-settlement lifecycle?
8. When should `dontDistributeSubsellerPayout` and `/DistributeSubsellerPayout` be used, and what are the timing, idempotency, and failure rules?
9. Is Lidio compatible with Shopify hosted checkout/payment provider flows for item-level marketplace split, and what integration mode is supported for Sporgym?
10. What production activation steps are required, including marketplace flags, KYB/vendor data, IP allowlist, rate limits, webhook setup, and go-live approval?
