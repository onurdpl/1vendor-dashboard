# Try OTO Integration Discovery

Discovery source:
- `/Users/onur/Downloads/OTO API V2.postman_collection.json`
- `docs/SHOPIFY_DISCOVERIES.md`

This document is discovery-only. It does not define a runtime implementation and must not be treated as a complete provider contract. Every item marked **Unknown** requires Try OTO confirmation or a sandbox proof before production shipment execution.

## Safety Boundary

- Shopify remains the canonical commerce/order source.
- This platform should continue to act as the operational control center, not as a carrier or label generator.
- Vendors do not connect their own Shopify stores; this platform operates against the single Shopify store and vendor-scoped operational records.
- Try OTO runtime integration is not implemented by this document.
- Existing Kargo Entegrator behavior must remain unchanged until a separate implementation phase.
- Do not submit Shopify fulfillments automatically from Try OTO responses until a separate Shopify fulfillment phase is explicitly designed and tested.

## Support Clarifications Received After Initial Discovery

These notes are support clarifications layered on top of the Postman collection. The Postman collection remains the primary source of truth for endpoint names and example request/response shapes. Weak or ambiguous support answers are not treated as confirmed facts and remain marked as **Unknown** or **Needs confirmation** until sandbox proof.

Confirmed support notes:
- Initial label format requirement is PDF.
- For Turkey, `customer.city` accepts free text.
- For Turkey, `customer.district` accepts free text.
- `deliveryOptionId` is not mandatory for Turkey according to support.
- Carrier selection should be done by fetching delivery options through `checkOTODeliveryFee` or `checkDeliveryFee`, then using the selected `deliveryOptionId`.
- 20 stores can use separate `pickupLocationCode` and return address mappings.
- `createShipment=true` is supported, but separate `createOrder` plus `createShipment` gives more operational control.

Weak or needs-confirmation support notes:
- Support said the return label endpoint is `createShipment`, but the Postman collection contains `createReturnShipment`; return flow remains **Needs confirmation** and should prefer Postman evidence until Try OTO confirms the correct return-label path in writing or sandbox.
- Support said the print endpoint usually returns a PDF URL field named `printLabelURL`; the Postman collection shows `printAWBURL`. The exact label URL response field remains **Unknown** until sandbox confirms.
- Support said `trackingNumber` is usually authoritative; the authoritative tracking field remains **Unknown** until sandbox confirms responses for the selected Turkey carrier.
- Webhook payload examples were not provided; `shipmentError` and `orderStatus` payload shapes remain **Unknown**.
- Webhook signature verification exists according to support, but public key/secret retrieval and exact verification inputs remain **Unknown**.
- Sandbox Turkey carrier availability and usable `deliveryOptionId` values remain **Unknown**.

## 1. Auth

### Base URLs

Confirmed from collection variables:
- Sandbox/staging base URL: `https://staging-api.tryoto.com`
- Production base URL: `https://api.tryoto.com`

All inspected API paths are under:
- `/rest/v2/...`

The collection description also references:
- `https://api.tryoto.com/rest/v2/`

### Refresh Token Endpoint

Confirmed endpoint:
- `POST /rest/v2/refreshToken`

Example request:

```json
{
  "refresh_token": "refresh_token"
}
```

Example response fields:

```json
{
  "access_token": "<access token>",
  "refresh_token": "<refresh token>",
  "success": true,
  "token_type": "Bearer",
  "expires_in": "3600"
}
```

### Access Token Lifetime

Confirmed from collection description:
- Access token lifetime is one hour.
- `expires_in` example value is `"3600"`.

### Authorization Header

Confirmed header pattern in endpoint examples:

```http
Authorization: Bearer <access_token>
```

### Token Strategy Proposal

Recommended server-only strategy:
- Store the Try OTO refresh token only in backend configuration or encrypted provider-secret storage.
- Never expose refresh or access tokens to the browser.
- Cache access token server-side with its expiration time.
- Refresh proactively before one hour, for example around 50-55 minutes.
- Retry once on a clear expired-token response such as `Jwt is expired`, then fail safely.
- Record safe token state diagnostics only as booleans, for example `refreshTokenConfigured`, `accessTokenCached`, `accessTokenExpired`.

Unknowns:
- Exact production refresh token provisioning workflow.
- Whether refresh tokens rotate on every refresh or remain stable.
- Whether concurrent refresh requests invalidate older access tokens.
- Whether Try OTO supports multiple refresh tokens per account/environment.

## 2. Forward Shipment Flow

### `createOrder` Endpoint

Confirmed endpoint:
- `POST /rest/v2/createOrder`

The collection positions `createOrder` as the primary order registration endpoint. It can optionally create a shipment when `createShipment` is enabled.

### Required Fields

Confirmed required top-level request fields from the collection:
- `orderId`
- `payment_method`
- `amount`
- `amount_due`
- `currency`
- `customer`
- `items`

Confirmed required `customer` fields:
- `name`
- `mobile`
- `address`
- `city`
- `country`

Confirmed required `items` fields:
- `quantity`

The collection lists these item fields as optional:
- `productId`
- `name`
- `price`
- `rowTotal`
- `taxAmount`
- `serialnumber`
- `sku`
- `image`
- `hsCode`, conditionally for international shipments
- `itemOrigin`

Useful optional top-level fields found in examples or parameter tables:
- `pickupLocationCode`
- `createShipment`
- `deliveryOptionId`
- `serviceType`
- `storeName`
- `pickingType`
- `shippingMethod`
- `shippingAmount`
- `subtotal`
- `shippingNotes`
- `packageSize`
- `packageCount`
- `packageWeight`
- `boxWidth`
- `boxLength`
- `boxHeight`
- `senderName`
- `senderInformation`
- `brandId`
- `sourceId`
- `whoPays`
- `boxes`
- ID card image URL fields for some countries/use cases

### Example `createOrder` Shape

The collection includes examples shaped like:

```json
{
  "orderId": "1234",
  "pickupLocationCode": "jdd_wh",
  "createShipment": true,
  "deliveryOptionId": 564,
  "payment_method": "paid",
  "amount": 100,
  "amount_due": 0,
  "currency": "SAR",
  "packageCount": 2,
  "packageWeight": 1,
  "boxWidth": 10,
  "boxLength": 10,
  "boxHeight": 10,
  "orderDate": "31/12/2022 15:45",
  "customer": {
    "name": "Customer Name",
    "email": "test@test.com",
    "mobile": "546607389",
    "address": "Customer address",
    "district": "Al Hamra",
    "city": "Jeddah",
    "country": "SA",
    "postcode": "12345"
  },
  "items": [
    {
      "productId": 112,
      "name": "test product",
      "price": 100,
      "rowTotal": 100,
      "taxAmount": 15,
      "quantity": 1,
      "sku": "test-product"
    }
  ]
}
```

Collection inconsistency to confirm:
- Some examples show `createShipment` as the string `"true"`.
- Parameter documentation says `createShipment` is boolean.
- Treat boolean `true`/`false` as the safer initial interpretation, but confirm with Try OTO.

### `createShipment` Endpoint

Confirmed endpoint:
- `POST /rest/v2/createShipment`

Example request:

```json
{
  "orderId": "1232464",
  "deliveryOptionId": "12345"
}
```

Confirmed required field:
- `orderId`

Optional fields listed:
- `deliveryOptionId`
- `pickingType`
- `whoPays`
- ID card URL fields for specific international/country requirements
- `consigneeId`

The collection states that if `deliveryOptionId` is not sent, OTO may assign a delivery company that satisfies a feasibility rule, or the first added delivery company if no rule exists.

Support clarification:
- `deliveryOptionId` is not mandatory for Turkey according to support.
- Carrier selection should still be explicit in the PoC: call `checkOTODeliveryFee` or `checkDeliveryFee`, let the operator/admin choose a returned delivery option, and pass the selected `deliveryOptionId` to `createShipment`.

Unknowns:
- Whether auto-assignment without `deliveryOptionId` is operationally safe for production Turkey shipments.
- Whether the selected `deliveryOptionId` remains stable across environments, stores, and carrier contract changes.
- Whether `createShipment` returns final shipment identifiers synchronously beyond the generic acceptance message.

### `createOrder` With `createShipment=true`

Confirmed behavior:
- `createOrder` can create an OTO order and ask OTO to create a shipment in the same call.
- The collection warns that if a delivery company returns an error while `createShipment=true`, a `shipmentError` webhook is needed to view the error details.

Recommended PoC approach:
1. First test `createOrder` with `createShipment=false` or omitted to validate order/customer/item mapping.
2. Fetch carrier delivery options with `checkOTODeliveryFee` or `checkDeliveryFee`.
3. Store/select the chosen `deliveryOptionId` for the test shipment.
4. Then test `createShipment` separately with the selected `deliveryOptionId`.
5. Only after separate order and shipment creation succeeds in sandbox, consider testing the `createShipment=true` shortcut.

Support clarification:
- `createShipment=true` is supported.
- Separate `createOrder` plus `createShipment` gives more control and should be used first for the PoC to isolate mapping, carrier selection, and shipment errors.

Unknowns:
- Whether Try OTO recommends one-step `createOrder(createShipment=true)` for production Turkey shipments after PoC success.
- Whether duplicate `orderId` calls are idempotent, rejected, or mutate existing orders.

### Payment Mapping

Confirmed `payment_method` values in parameter documentation:
- `cod`
- `paid`

Examples also contain values such as `COD` and `applePay`, but these are not listed in the formal parameter table.

Recommended initial mapping:
- Shopify paid/prepaid order: `payment_method = "paid"`, `amount_due = 0`
- Cash-on-delivery order, if supported by our business flow: `payment_method = "cod"`, `amount_due = amount`

Unknowns:
- Whether `COD` uppercase is accepted or only lowercase `cod`.
- Whether `applePay` or other payment labels are accepted enum values or sample artifacts.
- Exact mapping for partially paid, pending, manually paid, or externally captured Shopify orders.
- Whether `amount` should be gross order total, shipment-relevant allocation total, subtotal, or package/item value for multi-vendor split shipments.

### Amount And Currency Mapping

Confirmed fields:
- `amount`
- `amount_due`
- `currency`

Examples use `SAR`.

Recommended for Turkey PoC:
- Use `currency = "TRY"` only after Try OTO confirms Turkey account support for TRY in `createOrder`.
- For vendor allocation shipments, map `amount` from the shipment/allocation commercial total only if Try OTO confirms whether it expects full Shopify order total or shipment item total.

Unknowns:
- Whether Turkey shipments require `TRY`.
- Whether international/customs shipments require `customsValue` and `customsCurrency`.
- Whether OTO uses `amount` for COD insurance, carrier pricing, customs, or order display only.

### Package Weight And Dimensions

Confirmed fields:
- `packageWeight`, in kilograms according to pricing docs.
- `boxWidth`
- `boxLength`
- `boxHeight`
- `packageCount`
- `boxes[]` examples with per-box item and dimension structures.

Pricing docs state that rate calculation is based on the greater of actual and volumetric weight.

Mapping recommendation:
- Existing provider abstraction can map a default package weight to `packageWeight`.
- Existing desi/default desi cannot be assumed equivalent to kilograms; it needs a Try OTO-specific mapping decision.
- Box dimensions should be configured per vendor/store/package type if OTO rates or carrier selection require them.

Unknowns:
- Whether `packageWeight` is required for `createOrder` in Turkey when not using OTO rates.
- Whether dimensions are required for Turkish carriers.
- Whether per-item weights are accepted or only package-level weights matter.
- Whether `boxes[]` is required for multi-package Turkey shipments.

### Item Mapping

Confirmed item fields:
- `quantity` required.
- `name`, `sku`, `price`, `rowTotal`, `taxAmount`, `productId`, and `image` are optional in the documented table.

Recommended mapping:
- Shopify line item title -> `items[].name`
- Shopify SKU -> `items[].sku`
- Allocation quantity -> `items[].quantity`
- Allocation line price -> `price`
- Line total -> `rowTotal`
- Tax amount -> `taxAmount` only if we already have a reliable allocation-level tax value.

Unknowns:
- Whether Turkish domestic shipments require SKU/item names for carrier labels or only for OTO order records.
- Whether Try OTO expects item prices in gross or net amounts.
- Whether serial numbers, HS codes, or item origin are required for any Turkey flow.

### Customer Mapping

Confirmed customer fields:
- `name`, required.
- `mobile`, required.
- `address`, required.
- `city`, required.
- `country`, required ISO2 according to docs.
- Optional: `email`, `district`, `postcode`, `state`, `buildingNo`, `secondaryAddressNumber`, `shortAddressCode`, `street`, `lat`, `lon`, `refID`, `W3WAddress`, `consigneeId`.

Shopify mapping recommendation:
- Shopify shipping address name -> `customer.name`.
- Shopify shipping address phone, customer phone, or billing phone -> `customer.mobile`, in that preference order.
- Shopify address lines -> `customer.address`.
- Shopify city -> `customer.city`.
- Shopify country code -> `customer.country`.
- Shopify postal code -> `customer.postcode`.
- Shopify province/district-like field -> `customer.district` only if the source is actually district-level data.

Unknowns:
- Whether Turkey requires `district` even though the general docs mark it optional.
- Expected Turkish phone format, such as `5XXXXXXXXX`, `05XXXXXXXXX`, or `+905XXXXXXXXX`.
- Whether `country = "TR"` is accepted by `createOrder`; the collection confirms country-specific marketplace registration rules for TR but createOrder examples do not show TR.
- Whether Turkish carriers require national ID, tax number, or additional consignee fields for domestic shipments.

Support clarification:
- For Turkey, `customer.city` accepts free text.
- For Turkey, `customer.district` accepts free text.
- This confirms the field format is not limited to a known enum according to support, but sandbox should still verify carrier acceptance for the target delivery option.

### `pickupLocationCode` Behavior

Confirmed:
- `pickupLocationCode` references a predefined pickup address.
- It is required when `serviceType` is `pickupFromStore`.
- If omitted or not found, OTO may auto-assign a pickup location.
- Item-level `pickupLocation` examples can split an order across pickup locations and return multiple `otoIds`.

Recommendation:
- Do not rely on auto-assignment for production.
- Store an explicit Try OTO `pickupLocationCode` per vendor/store/warehouse.
- Avoid item-level split pickup logic in the first PoC because this platform already manages allocation/vendor scoping and split shipment logic internally.

Unknowns:
- Whether each Turkish store must map to a unique pickup location.
- Whether return shipments should use the same pickup location or a separate return location code.
- Whether `brandId`, `storeName`, or `senderName` is required in addition to pickup location for the desired label/sender display.

## 3. Label / AWB

### Print Endpoint

Confirmed endpoint:
- `GET /rest/v2/print/orderId`

The collection presents `orderId` in the path text, but the exact path style needs confirmation:
- Possible path segment style: `/rest/v2/print/{orderId}`
- Unknown whether query parameter style is also supported.

Documented request parameters:
- `orderId`, required.
- `internationalProforma`, optional boolean.
- `printReverseShipment`, optional boolean.

### PDF URL Response Fields

Confirmed response fields include:
- `dcTrackingNumber`
- `success`
- `printAWBURL`
- `deliveryCompany`
- `trackingNumber`
- `internationalProforma`, when requested, returned as base64 in examples.

Mapping recommendation:
- `printAWBURL` -> provider label URL.
- `trackingNumber` -> customer-facing tracking number if present.
- `dcTrackingNumber` -> carrier tracking number or secondary tracking reference; exact canonical choice must be proven per carrier.
- `deliveryCompany` -> carrier code/name.

Unknowns:
- Whether `printAWBURL` is stable, expiring, public, or requires authentication.
- Whether labels should be stored as URL only or fetched and archived.
- Whether `trackingNumber` or `dcTrackingNumber` is the canonical carrier tracking number for Turkish carriers.

Support clarification:
- Initial label format requirement is PDF.
- Support said the print endpoint usually returns a PDF URL field named `printLabelURL`.
- The Postman collection shows `printAWBURL`; therefore the exact label URL field remains **Unknown** until sandbox confirms whether the response uses `printAWBURL`, `printLabelURL`, both, or another field.

### ZPL Support

Confirmed:
- `orderStatus` supports `labelType = "ZPL"` and returns `zplDataArray`.

Unknown:
- Whether the `print` endpoint itself accepts a ZPL parameter.
- Whether Turkish carriers support ZPL through Try OTO for our account.

Recommendation:
- Start with PDF labels only.
- Treat ZPL as a later capability after sandbox confirmation.

### Tracking Number Fields

Fields seen across label/status/history endpoints:
- `trackingNumber`
- `dcTrackingNumber`
- `trackingUrl`
- `trackingURL`

Recommendation:
- Store all safe identifiers in the provider snapshot.
- Expose one canonical tracking number only after confirming which field Turkish carriers use.

Support clarification:
- Support said `trackingNumber` is usually authoritative.
- Keep the authoritative tracking field as **Unknown** until sandbox responses confirm the chosen Turkey carrier behavior.

### `printReverseShipment` Behavior

Confirmed:
- `printReverseShipment` is an optional parameter on the print endpoint.
- Example response shows a return AWB URL containing a `reverse=true` component.

Unknowns:
- Whether `printReverseShipment=true` requires an original order ID or the generated `returnOrderId`.
- Whether print reverse label works for both delivered and undelivered orders.
- Whether a return shipment must be created first with `createReturnShipment`.

## 4. Tracking / Status

### `orderStatus` Endpoint

Confirmed endpoint:
- `POST /rest/v2/orderStatus`

Request identifiers:
- `orderId`, required if no `otoId`.
- `otoId`, required if no `orderId`.

Optional:
- `labelType`, with ZPL support shown in examples.

Confirmed response fields include:
- `date`
- `customerAddress`
- `totalValue`
- `orderId`
- `trackingUrl`
- `dcTrackingNumber`
- `deliveryCompany`
- `printAWBURL`
- `customerName`
- `shipmentId`
- `success`
- `otoId`
- `status`
- `zplDataArray`, when ZPL is requested.

### `orderHistory` Endpoint

Confirmed endpoint:
- `POST /rest/v2/orderHistory`

Request can use one of:
- `orderIds`
- `otoIds`
- `shipmentIds`

Confirmed response fields include:
- `orderId`
- `trackingURL`
- `dcTrackingNumber`
- `history[]`
- `history[].date`
- `history[].description`
- `history[].status`
- `history[].shipmentId`
- `history[].deliveryCompany`
- `history[].currentLocation`
- `returnOrderIds`
- `amount_due`
- `currency`
- `packageCount`
- `items`
- `orderDate`
- `printAwbUrl`
- `payment_method`
- `status`

### `trackShipment` Endpoint

Confirmed endpoint:
- `POST /rest/v2/trackShipment`

Required fields:
- `trackingNumber`
- `deliveryCompanyName`

Optional:
- `statusHistory`
- `brandName`

The collection description says this endpoint requires no authorization, but the request example still includes an Authorization header.

Unknown:
- Whether `trackShipment` is truly public/no-auth for all accounts and environments.
- Whether we should use it from backend only despite no-auth support.

### Tracking Mapping

Recommended mapping:
- Try OTO order id from our request -> local shipment reference.
- `otoId` -> provider order id.
- `shipmentId` -> provider shipment id if present.
- `trackingNumber` -> candidate public tracking number.
- `dcTrackingNumber` -> candidate carrier tracking number.
- `trackingUrl` or `trackingURL` -> tracking URL.
- `deliveryCompany` or `deliveryCompanyName` -> carrier.
- `status` and `history[].status` -> provider status timeline, not Shopify fulfillment truth.

Unknowns:
- Canonical status enum list.
- Which statuses mean created, picked up, in transit, delivered, returned, failed, or canceled.
- Whether statuses vary by carrier/country.

## 5. Webhooks

### Webhook Registration Endpoint

Confirmed endpoints:
- `POST /rest/v2/webhook`
- `GET /rest/v2/webhook`
- `PUT /rest/v2/webhook`
- `DELETE /rest/v2/webhook`

Confirmed create/update fields:
- `method`
- `url`
- `orderPrefix`
- `timestampFormat`
- `secretKey`
- `authorizationKey`
- `webhookType`

Confirmed `webhookType` values in docs:
- `shipmentError`
- `orderStatus`
- `newOrders`
- `walletTransactions`

Description notes:
- `secretKey` is used to sign the message so the receiver can validate it.
- `authorizationKey` is a secure token to authenticate/validate incoming webhook requests.

### Order Status Webhook

Confirmed:
- `orderStatus` is a webhook type.

Unknown:
- Exact payload shape.
- Exact headers.
- Signature algorithm.
- Whether status webhook includes `orderId`, `otoId`, `shipmentId`, `trackingNumber`, `dcTrackingNumber`, and `deliveryCompany`.

Support clarification:
- No `orderStatus` webhook payload example was provided.
- Keep the payload shape **Unknown** until Try OTO provides an example or sandbox emits a real payload.

### Shipment Error Webhook

Confirmed:
- `shipmentError` is a webhook type.
- Collection specifically recommends registering it to see delivery-company errors when using `createShipment=true`.

Unknown:
- Exact error payload shape.
- Whether errors are keyed by `orderId`, `otoId`, or `shipmentId`.
- Whether error payloads contain customer data that must be redacted.

Support clarification:
- No `shipmentError` webhook payload example was provided.
- Keep the payload shape **Unknown** until Try OTO provides an example or sandbox emits a real payload.

### Signature Verification Requirements

Known:
- `secretKey` is used for signing according to collection text.
- `authorizationKey` can authenticate/validate incoming webhook requests.
- Support confirmed webhook signature verification exists.

Unknown:
- Signature header name.
- Signature algorithm.
- Canonical string/body used for signing.
- Public key behavior; no public key flow is shown in the collection and support did not provide public key or secret retrieval details.
- Replay protection requirements.

Recommendation:
- Do not enable webhook state mutations until signature/header rules are confirmed.
- First implement a disabled/safe webhook receiver that records only sanitized diagnostics in sandbox.

## 6. Return / Reverse Shipment

### `createReturnShipment` Endpoint

Confirmed endpoint:
- `POST /rest/v2/createReturnShipment`

Example request:

```json
{
  "orderId": "202111080914",
  "deliveryOptionId": "156",
  "pickupLocationCode": "wh1",
  "items": [
    {
      "quantity": "1",
      "sku": "SKU045857"
    }
  ]
}
```

Confirmed behavior from collection:
- Creates a new return order for delivered forward orders.
- Generates a return order ID by appending a suffix such as `-R1` or `-R2`.
- Returns this generated ID as `returnOrderId`.
- All return-related actions, including tracking, print, and status checks, should use the returned return order ID.
- Return shipment is item-based.

Support clarification:
- Support said the return label endpoint is `createShipment`.
- This conflicts with or at least does not fully explain the Postman collection evidence, which contains `createReturnShipment` and documents generated `returnOrderId` behavior.
- Treat the return flow as **Needs confirmation** and prefer the Postman `createReturnShipment` evidence until Try OTO confirms the exact return shipment and return label sequence.

Documented fields:
- `orderId`, required.
- `pickupLocationCode`, optional.
- `deliveryOptionId`, optional.
- `items`, documented as optional at array level, but item rows list `quantity` and `sku` as required.
- Optional customer object can update the customer address for return pickup.

Unknowns:
- Whether `items` is truly optional or required for item-based return shipments.
- Whether return shipment can be created before Shopify return approval or only after delivery.
- Whether a return can be created for undelivered forward shipments.
- Whether Try OTO return shipment should be tied to our Shopify ReturnRecord, refund, or shipment execution object.
- Whether the correct return-label flow is `createReturnShipment` then print by `returnOrderId`, original order print with `printReverseShipment=true`, `createShipment`, or another sequence.

### Return Item Behavior

Confirmed item identifiers:
- `sku`
- `quantity`

Recommendation:
- Use Shopify return line item SKU and quantity only when the SKU is stable and unique within the order allocation.
- If duplicate SKUs can exist in the same order, ask Try OTO whether item line ids or original OTO item references are supported.

Unknown:
- Whether Try OTO can return by original item row id or only SKU.

### Returned `returnOrderId`

Confirmed:
- Response includes `returnOrderId`.
- This ID must be used for return tracking, printing, and status.

Mapping recommendation:
- Store `returnOrderId` separately from forward provider order id.
- Do not overwrite the forward shipment provider id.

### Printing Return Label

Confirmed:
- Print endpoint has `printReverseShipment` optional boolean.
- Collection shows a Print Return AWB example.

Unknown:
- Whether printing return AWB uses original order id plus `printReverseShipment=true`, generated `returnOrderId`, or either.

### Tracking Return Order

Confirmed:
- Collection says all return-related actions should use `returnOrderId`.

Recommendation:
- Use `orderStatus` or `orderHistory` with `returnOrderId` after sandbox confirmation.

Unknown:
- Whether return status enums differ from forward shipment statuses.

## 7. Marketplace / Multi-Store Model

### OTO Account Models Found

The collection contains both:
- Regular merchant account APIs, including pickup locations, brands, delivery options, and shipments.
- Marketplace APIs, including `register` and `clientInfo`, intended for marketplaces with multiple vendors.

Marketplace registration notes:
- A special marketplace token from OTO is required.
- Regular refresh tokens are not accepted for marketplace registration.
- The register endpoint returns an activation link and refresh token.

### Recommended Model For 20 Stores In Turkey

Safest initial recommendation:
- Use a single main Try OTO account for the platform.
- Configure one pickup location per physical vendor/store/warehouse.
- Map internal `store_id` or vendor warehouse id to Try OTO `pickupLocationCode`.
- Optionally use OTO Brands only if label/sender branding or default warehouse behavior requires it.

Reasoning:
- Shopify discovery confirms vendors do not connect their own Shopify stores.
- The platform is merchant-of-record/operational control center, not a general marketplace shipping account broker.
- Pickup locations are directly supported and can map cleanly to stores.
- Marketplace registration introduces additional onboarding, country-specific seller identity fields, activation links, and account lifecycle complexity.

Unknowns requiring Try OTO confirmation:
- Whether carrier contracts are per account, per pickup location, per brand, or per marketplace seller.
- Whether each store needs its own Brand, Pickup Location, Branch, Warehouse, or sub-account.
- Whether sender name on label comes from account, brand, pickup location, or request field.

Support clarification:
- 20 stores can use separate `pickupLocationCode` and return address mappings according to support.
- Carrier-contract behavior still needs confirmation because the collection separates pickup locations, brands, carrier integrations, and marketplace sub-accounts.

### `store_id` To `pickupLocationCode` Mapping

Recommended internal mapping:
- `vendorId` + optional `warehouseId/storeId` -> `pickupLocationCode`
- Optional `brandId` or `clientStoreId` if OTO confirms brand-level sender behavior.
- Optional `deliveryOptionId` per carrier preference.

Required admin UI/config for PoC:
- Try OTO pickup location code.
- Default package weight.
- Optional box dimensions.
- Optional default delivery option id.
- Optional brand id/store id if needed.

### Return Address Mapping

Confirmed from pickup location docs:
- Pickup locations include address, city, country, contact name/email/mobile, and optional district/postcode/street/building fields.

Unknowns:
- Whether `pickupLocationCode` on `createReturnShipment` controls return pickup origin or return destination.
- Whether returns are always routed to pickup location, support-confirmed return address mapping, a separate warehouse, or a carrier-specific return location.
- Exact API/config field for the support-confirmed return address mapping.

## 8. Turkey-Specific Risks

### Country Code

Known:
- Customer `country` is documented as ISO2.
- Marketplace registration includes Turkey-specific fields under country `TR`.

Unknown:
- Whether `createOrder.customer.country = "TR"` is accepted for Turkish domestic shipments in our account.
- Whether carrier-specific validation prefers Turkish, English, or OTO canonical city names despite support saying free text is accepted.

Support clarification:
- For Turkey, `customer.city` accepts free text.

### City / District Expectations

Known:
- `customer.city` is required.
- `customer.district` is optional in the general `createOrder` docs.
- Pickup location creation requires `city` and optional `district`.
- `getCities` can return cities for a country.
- `availableCities` returns account/carrier coverage cities.

Unknown:
- Whether Try OTO exposes a district list endpoint; none was found in the inspected collection.
- Whether province, district, and neighborhood must be split into separate fields for Turkey.

Support clarification:
- For Turkey, `customer.district` accepts free text.
- Whether specific carriers reject some district spellings remains **Unknown** until sandbox.

### Phone Format

Known:
- Customer field is `mobile`.
- Pickup location field is `mobile`.

Unknown:
- Expected Turkey mobile format.
- Whether `+90`, `90`, leading `0`, or local `5XXXXXXXXX` is required.
- Whether fixed-line phone numbers are accepted.

### Currency

Known:
- `currency` is required.
- Examples use `SAR`.

Unknown:
- Whether `TRY` is accepted for all Turkey shipments.
- Whether currency must match account country or carrier contract.

### Supported Carriers For Turkey

Carrier names/codes found in the DC List response include:
- `AJEX Türkiye` / `ajex-tr`
- `Aras Kargo` / `araskargo`
- `Bolt Kargo` / `boltkargo`
- `DHL Türkiye` / `dhlTr`
- `HepsiJet` / `hepsijet`
- `HepsiJet Marketplace` / `hepsijetmarketplace`
- `KargoIst` / `kargoist`
- `Kargoist` / `kargoistmarketplace`
- `Kolay Gelsin` / `kolaygelsin`
- `Kolay Gelsin (OTO)` / `kolaygelsin-marketplace`
- `MNG Kargo` / `mngkargo`
- `MNG Kargo (OTO)` / `mngkargo-marketplace`
- `PTT Kargo` / `pttKargo`
- `Sürat Kargo (OTO)` / `surat-kargo-marketplace`
- `Yurtiçi Kargo` / `yurticiKargo`
- `Yurtiçi Kargo` / `yurtici-kargo-marketplace`

Unknown:
- Which of these carriers are available for the actual Try OTO account.
- Which carrier codes map to own contracts versus OTO marketplace contracts.
- Sandbox Turkey carrier availability and usable `deliveryOptionId` values.

Support clarification:
- `deliveryOptionId` is not mandatory for Turkey according to support.
- Carrier selection should still be driven by calling `checkOTODeliveryFee` or `checkDeliveryFee`, then using the selected `deliveryOptionId`.

### National ID / Tax Fields

Known:
- Marketplace `register` includes Turkey-specific requirements:
  - `nationalID`, 11 digits.
  - `dateOfBirth`.
  - If VAT registered, `taxOffice`, `companyName`, `vatNumber`, `district`, and `invoiceCompanyName`.

Unknown:
- Whether these fields are only for marketplace seller registration or also required for shipment creation in Turkey.
- Whether recipient national ID is required for any Turkish domestic carrier.
- Whether sender tax identity is inherited from the Try OTO account, brand, pickup location, or request.

## 9. Proposed Internal Provider Contract

### Existing Fields That Map Cleanly

Current shipping abstraction fields that likely map:
- Internal order/allocation reference -> `orderId`
- Provider base URL -> Try OTO base URL.
- Provider auth token state -> access token/refresh token strategy.
- Customer name -> `customer.name`.
- Customer phone -> `customer.mobile`.
- Customer email -> `customer.email`, optional.
- Shipping address -> `customer.address`.
- Shipping city -> `customer.city`.
- Shipping country code -> `customer.country`.
- Postal code -> `customer.postcode`, optional unless carrier/account requires it.
- Order lines -> `items[]`.
- SKU -> `items[].sku`.
- Quantity -> `items[].quantity`.
- Package weight -> `packageWeight`, after unit validation.
- Tracking URL -> `trackingUrl`/`trackingURL`.
- Label URL -> `printAWBURL`.

### Fields Requiring New Provider Config

Likely new config fields:
- `tryOtoBaseUrl`
- `tryOtoRefreshToken`
- Access token cache settings.
- `pickupLocationCode`, per vendor/store/warehouse.
- Optional `brandId` or client store id.
- Optional default `deliveryOptionId`.
- Default package weight in kilograms.
- Optional box dimensions.
- Default `createShipment` strategy: order-only, order plus shipment, or shipment after order.
- Webhook `secretKey`.
- Webhook `authorizationKey`.
- Preferred label format: PDF or ZPL, if supported.
- Carrier preference or delivery option strategy.

### Fields Requiring Vendor/Admin UI Input

Admin-only:
- Try OTO provider enabled.
- Sandbox/production environment.
- Refresh token presence.
- Pickup location code per vendor/store.
- Default delivery option id, if used.
- Default package weight/dimensions.
- Label format preference.
- Webhook configured/readiness state.

Vendor/operator shipment completion:
- Missing phone.
- Missing city.
- Missing country.
- Missing postal code if required.
- Missing district if Try OTO/Turkey requires it.
- Package weight/dimensions if not configured.

Do not mutate Shopify order/customer data when operators complete shipment-only fields.

### Provider Identifier Mapping

Recommended storage:
- Provider order id: `otoId`
- Provider shipment id: `shipmentId`, when present.
- Carrier tracking number candidates: `trackingNumber`, `dcTrackingNumber`.
- Label URL: `printAWBURL`.
- Carrier: `deliveryCompany`.

Unknown:
- Which identifier should become `providerShipmentId` in the current local `ShipmentExecution` model.
- Whether `otoId` alone is enough for retry/status/print operations.

### Migration Risks

Risks to plan for:
- Existing Kargo-specific config names do not map directly to Try OTO.
- `desi` and Try OTO `packageWeight` are not the same concept.
- One Try OTO order may contain multiple pickup locations and return multiple `otoIds`, which conflicts with a simple one allocation to one provider id assumption.
- One Shopify order may split across vendors; Try OTO `orderId` must be unique per allocation/shipment, not only Shopify order number.
- Reusing Shopify order number directly as OTO `orderId` can collide across vendors or retries.
- `createShipment=true` may hide carrier errors behind webhooks.
- Status webhooks cannot be trusted until signature verification is confirmed.

## 10. PoC Checklist

1. Sandbox account setup
   - Obtain sandbox base URL confirmation.
   - Obtain refresh token.
   - Verify `POST /rest/v2/refreshToken`.
   - Verify `GET /rest/v2/healthCheck`.

2. Create pickup location
   - Create one Turkish pickup location.
   - Record `pickupLocationCode`.
   - Confirm sender name/address behavior on labels.

3. Carrier readiness
   - Get active delivery options.
   - Confirm available Turkey carrier codes.
   - Call `checkOTODeliveryFee` or `checkDeliveryFee`.
   - Store the selected `deliveryOptionId` for the shipment attempt.
   - Confirm sandbox Turkey carrier availability and usable delivery options.

4. Create paid forward order
   - Use `payment_method = "paid"`.
   - Use `amount_due = 0`.
   - Use `currency = "TRY"` only after confirmation.
   - Include one allocation-scoped line item.
   - Use a Try OTO-safe unique `orderId`.

5. Create shipment
   - Test separate `createShipment`.
   - Use the selected `deliveryOptionId` from the delivery fee/options response.
   - Confirm response body and provider identifiers.
   - Keep `createShipment=true` disabled for the first PoC so order creation and shipment creation errors can be isolated.

6. Print AWB
   - Call print endpoint.
   - Capture the PDF label URL.
   - Confirm whether the field is `printAWBURL`, `printLabelURL`, or another field.
   - Confirm whether URL is public, authenticated, or expiring.
   - Keep initial label handling PDF-only.
   - Test ZPL through `orderStatus(labelType=ZPL)` only after PDF works and thermal output is needed.

7. Read order status
   - Call `orderStatus` by `orderId`.
   - Call `orderHistory` by `orderIds`.
   - Map `trackingNumber`, `dcTrackingNumber`, `trackingUrl`, `shipmentId`, `otoId`, and `status`.
   - Confirm whether `trackingNumber` or `dcTrackingNumber` is authoritative for the selected Turkey carrier.

8. Create return shipment
   - Confirm original order must be delivered first.
   - Confirm whether the correct return flow is `createReturnShipment`, `createShipment`, or another sequence.
   - Create return shipment with `items[].sku` and `items[].quantity`.
   - Store returned `returnOrderId`.

9. Print return AWB
   - Confirm whether to print with original order id plus `printReverseShipment`, or with `returnOrderId`.
   - Capture return label URL.

10. Verify webhook payload
   - Register `orderStatus` webhook.
   - Register `shipmentError` webhook.
   - Confirm signature headers and algorithm.
   - Confirm payload shape and PII content.

11. Verify failure response quality
   - Submit a controlled invalid payload.
   - Record error code, error field format, and trace/request id behavior.
   - Confirm whether shipment creation failures are synchronous, webhook-only, or both.

## 11. Questions For Try OTO Support

1. What is the exact minimal `createOrder` payload for a Turkish domestic shipment?
2. After sandbox success with separate calls, is `createOrder(createShipment=true)` recommended for production Turkey shipments, or should we keep separate `createOrder` plus `createShipment`?
3. If `deliveryOptionId` is omitted for Turkey, what exact auto-assignment rules apply?
4. When using `checkOTODeliveryFee` or `checkDeliveryFee`, which returned field is the stable `deliveryOptionId` to store for the immediate shipment attempt?
5. Which Turkish carrier codes are enabled for our account in sandbox and production?
6. Does `customer.country = "TR"` and `currency = "TRY"` work for Turkey shipments?
7. What exact phone format is required for Turkish recipients?
8. Even though support says city/district are free text, are there carrier-specific spelling, casing, Turkish character, province, or district requirements?
9. Is there a district lookup endpoint for Turkey, or should operators enter free text?
10. Are recipient national ID, sender tax office, sender tax number, or company tax fields required for Turkey shipment creation?
11. What should `amount` represent for a split multi-vendor Shopify order: full Shopify order total, allocation total, shipment item total, or declared item value?
12. For prepaid Shopify orders, should we always send `payment_method = "paid"` and `amount_due = 0`?
13. Are `COD`, `cod`, `paid`, and `applePay` all valid `payment_method` values, or only `cod` and `paid`?
14. Are package dimensions required for Turkey, or is `packageWeight` enough?
15. What is the recommended mapping for volumetric/desi weight to OTO `packageWeight` and dimensions?
16. Is `pickupLocationCode` enough to choose sender/warehouse, or must `brandId`, `senderName`, or `senderInformation` also be sent?
17. Can one main account with 20 pickup locations support 20 Turkish stores, or is the marketplace sub-account model required?
18. How are return addresses configured for each store?
19. What is the exact print endpoint path format: `/print/{orderId}` or another form?
20. Are PDF labels and ZPL labels both supported for Turkish carriers?
21. Which field is canonical for carrier tracking in real Turkey sandbox responses: `trackingNumber` or `dcTrackingNumber`?
22. Are `trackingUrl` and `trackingURL` stable/public URLs?
23. For return labels, should we use `createReturnShipment` followed by print on `returnOrderId`, original-order print with `printReverseShipment=true`, `createShipment`, or another sequence?
24. Can return shipments be created before the forward order is delivered?
25. What webhook headers carry signature and authorization information?
26. What is the signature algorithm for `secretKey` validation?
27. Is there a public key flow or only shared-secret verification? If public key verification exists, where is the public key obtained?
28. What are the exact payloads for `orderStatus` and `shipmentError` webhooks?
29. Are webhook retries/idempotency keys provided?
30. What are production onboarding steps, go-live checks, and sandbox-to-production differences?
