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
- Unknown: the exact sandbox base URL. The OpenAPI `servers` entry only contains `/api`.

## Subseller Model
`CreateSubsellerRequest` supports:
- company fields: `companyName`, `companyType`, `taxOffice`, `vkntckn`, `mersisNo`, `tradeRegistryNo`
- registered address fields: `registeredCountry`, `registeredCity`, `registeredDistrict`, `registeredAddress`
- payout/account fields: `ibanList`, `payOutNotAllowed`, `payOutBlockageAmount`, `payOutPreventionReason`, `payOutReportEmailRecipients`
- merchant mapping field: `subsellerIdGivenByMerchant`
- contact fields: `contactName`, `contactPhone`, `contactEmail`
- marketplace controls: `virtualProductPermission`, `merchantPanelUse`, `chargebacksOnSubseller`, `subsellerContractApproval`, `subsellerProfileId`

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
- `LIDIO_API_TOKEN` or `LIDIO_API_USERNAME` / `LIDIO_API_PASSWORD`, depending on the actual credential contract
- `LIDIO_AUTH_TOKEN` if `MxM2S` is required
- `LIDIO_NOTIFICATION_URL`
- `LIDIO_RETURN_URL`
- `LIDIO_SANDBOX_MODE`

Unknown: exact credential names and token creation inputs until Lidio provides the sandbox credential contract.

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

## Open Questions For Lidio Support
- What is the exact sandbox base URL?
- Which token type should Sporgym use for server-to-server payment APIs: `MxC2S` or `MxM2S`?
- What exact credentials are required for `CreateAPIKey` / `LoginRequest`?
- Are notifications signed? If yes, what header or field and algorithm are used?
- Is Return URL hash verification also used for `NotificationURL`?
- Can one payment include multiple `subsellerId` values in `basketItems` in production?
- Are partial releases monetary or only item-level?
- What happens if `RefundPaymentRequest` omits `basketItems` for a marketplace payment?
- Are marketplace refunds auto-allocated or rejected unless `itemRefundAmount` is supplied?
- How is platform commission configured when `subsellerPayoutAmount` is null?
- Can `subsellerPayoutAmount` be supplied per item in hosted payment flow?
- What is the lifecycle from payment success to release to payout?
- Does `dontDistributeSubsellerPayout` defer payout distribution until `DistributeSubsellerPayout`?
- Are `BalanceTransfer` and `DistributeSubsellerPayout` available in sandbox?
- Are there sandbox test cards and 3DS test flows?
- Are there API rate limits and IP allowlist requirements?

## Recommended Smallest Safe PoC
1. Phase 1: sandbox auth probe only.
2. Phase 2: hosted test payment creation probe with no real card storage.
3. Phase 3: item-level subseller split probe using `basketItems[].marketplace`.
4. Phase 4: refund allocation probe using `RefundBasketItem`.
5. Phase 5: notification/return URL signature/hash probe.

No production payment execution should happen until Lidio confirms the sandbox contract and webhook security behavior.

## Conclusion
Lidio OpenAPI schema confirms item-level marketplace primitives. The key schema evidence is `BasketItem.marketplace -> BasketItemMPDetails` with `subsellerId`, `itemTotalPrice`, and optional `subsellerPayoutAmount`. `RefundBasketItem` confirms item-level marketplace refund allocation. However, Shopify compatibility, webhook signature rules, production enablement, settlement timing, and some payout lifecycle behavior remain unknown.
