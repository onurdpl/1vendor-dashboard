# Try OTO Sandbox PoC Checklist And Payload Pack

This document is for manual sandbox validation only. It does not implement a provider adapter, register provider runtime configuration, or change existing shipping providers.

Primary evidence:
- `/Users/onur/Downloads/OTO API V2.postman_collection.json`
- `docs/TRY_OTO_DISCOVERY.md`
- Try OTO support clarifications recorded in `docs/TRY_OTO_DISCOVERY.md`

Rules for this PoC:
- Use the Postman collection as the primary source of truth.
- Use support answers only as clarifications.
- Treat weak or conflicting support answers as **Unknown** or **Needs confirmation**.
- Do not submit Shopify fulfillments from this PoC.
- Do not mutate Shopify order data.
- Do not use production credentials or production shipments.

## 1. Sandbox Setup Steps

### Create Sandbox Account

1. Create or request a Try OTO sandbox/staging account.
2. Confirm the account can access the staging API base URL:

```text
https://staging-api.tryoto.com
```

3. Confirm the sandbox account is enabled for Turkey testing.
4. Confirm at least one Turkey carrier or OTO delivery option is available in sandbox.

Unknowns to verify:
- Whether the sandbox account has Turkey carriers enabled by default.
- Whether sandbox needs wallet/balance before shipment creation.
- Whether sandbox simulates real carrier labels/tracking or returns mock labels/tracking.

### Activate Refresh Token

The Postman collection states that the refresh token can be obtained from the UI and is permanent for access-token refresh.

1. Obtain the sandbox refresh token from Try OTO UI or support.
2. Store it only in a local secure operator secret store for manual testing.
3. Do not store the token in this repository.
4. Do not paste the token into screenshots, logs, or tickets.

### Get Access Token

Endpoint:

```http
POST /rest/v2/refreshToken
```

Headers:

```http
Content-Type: application/json
```

Payload:

```json
{
  "refresh_token": "<TRY_OTO_SANDBOX_REFRESH_TOKEN>"
}
```

Expected HTTP status:
- `200 OK`

Expected success fields:
- `success: true`
- `access_token`
- `refresh_token`
- `token_type: "Bearer"`
- `expires_in: "3600"`

Use the returned access token for subsequent calls:

```http
Authorization: Bearer <TRY_OTO_SANDBOX_ACCESS_TOKEN>
```

### Verify Account Requirements

Manual checks before shipment tests:
- Sandbox/staging base URL works.
- Refresh token returns an access token.
- Access token works for an authenticated endpoint.
- Account country/carrier coverage supports Turkey.
- At least one pickup location can be created or already exists.
- At least one delivery option can be returned by `checkOTODeliveryFee` or `checkDeliveryFee`.

### Verify Wallet / Balance Requirements

The Postman collection includes a `createShipment` error example for insufficient credit:
- HTTP status: `400 Bad Request`
- Error meaning: credit is not enough.

PoC checks:
- Confirm with Try OTO whether sandbox requires wallet balance for shipment creation.
- Confirm how sandbox wallet/balance is funded or simulated.
- If `createShipment` returns an insufficient credit error, stop and resolve sandbox balance before changing payloads.

Unknown:
- Exact sandbox wallet/balance rules for Turkey.

## 2. Pickup Location Setup

Endpoint:

```http
POST /rest/v2/createPickupLocation
```

Required fields confirmed by the Postman collection:
- `name`
- `code`
- `mobile`
- `city`
- `country`
- `address`
- `contactName`
- `contactEmail`

Optional fields useful for Turkey PoC:
- `district`
- `postcode`
- `lat`
- `lon`
- `street`
- `buildingNo`
- `brandName`
- `status`

Avoid `type: "branch"` unless the sandbox account package supports branch locations. The Postman collection says `branch` can only be used by enterprise and marketplace packages.

### Suggested Turkey Pickup Location Test Payload

This payload uses only fields confirmed by the Postman collection. City and district are free text according to support.

```json
{
  "code": "tr-test-store-001",
  "name": "TR Test Store 001",
  "mobile": "905551112233",
  "address": "Test Mahallesi, Test Sokak No: 1",
  "contactName": "Test Operator",
  "contactEmail": "test-operator@example.com",
  "city": "Istanbul",
  "country": "TR",
  "district": "Kadikoy",
  "postcode": "34710",
  "status": "active"
}
```

Expected HTTP status:
- `200 OK`

Expected response fields from Postman examples:
- `success: true`
- `pickupLocationCode`
- `warhouseId`
- `message`

Note:
- `warhouseId` is spelled this way in the collection response example.

### Store `pickupLocationCode`

Store the returned `pickupLocationCode` in the PoC notes table:

| Internal store/vendor | Try OTO pickupLocationCode | Return address mapping | Notes |
| --- | --- | --- | --- |
| `<vendor/store>` | `<pickupLocationCode>` | `<support-confirmed return address mapping>` | `<notes>` |

Do not add this to runtime config until adapter design begins.

## 3. Minimal Turkey `createOrder` Payloads

Endpoint:

```http
POST /rest/v2/createOrder
```

Confirmed required fields:
- `orderId`
- `payment_method`
- `amount`
- `amount_due`
- `currency`
- `customer`
- `items`

Confirmed required customer fields:
- `name`
- `mobile`
- `address`
- `city`
- `country`

Confirmed required item fields:
- `quantity`

Support-confirmed Turkey notes:
- `customer.city` accepts free text.
- `customer.district` accepts free text.
- `deliveryOptionId` is not mandatory for Turkey.
- `createShipment=true` is supported, but the PoC should start with separate `createOrder` plus `createShipment`.

Important:
- `currency: "TRY"` is the expected Turkey value to test, but the Postman examples use `SAR`. Treat `TRY` acceptance as a sandbox verification item.
- `pickupLocationCode` is not marked required for `createOrder`, but should be included in this PoC to avoid ambiguous pickup auto-assignment.
- Do not include `createShipment: true` in initial PoC order payloads.

### Paid Order Example, Single Item

```json
{
  "orderId": "POC-TR-PAID-1001",
  "pickupLocationCode": "tr-test-store-001",
  "payment_method": "paid",
  "amount": 1299.90,
  "amount_due": 0,
  "currency": "TRY",
  "packageCount": 1,
  "packageWeight": 1,
  "customer": {
    "name": "Sandbox Customer",
    "email": "sandbox-customer@example.com",
    "mobile": "905551234567",
    "address": "Test Mahallesi, Alici Sokak No: 10",
    "district": "Besiktas",
    "city": "Istanbul",
    "country": "TR",
    "postcode": "34353"
  },
  "items": [
    {
      "name": "Sandbox T-Shirt",
      "price": 1299.90,
      "rowTotal": 1299.90,
      "quantity": 1,
      "sku": "POC-TSHIRT-001"
    }
  ]
}
```

### COD Order Example, Single Item

```json
{
  "orderId": "POC-TR-COD-1001",
  "pickupLocationCode": "tr-test-store-001",
  "payment_method": "cod",
  "amount": 899.50,
  "amount_due": 899.50,
  "currency": "TRY",
  "packageCount": 1,
  "packageWeight": 1,
  "customer": {
    "name": "Sandbox COD Customer",
    "email": "sandbox-cod@example.com",
    "mobile": "905559998877",
    "address": "Deneme Mahallesi, Kargo Caddesi No: 20",
    "district": "Cankaya",
    "city": "Ankara",
    "country": "TR",
    "postcode": "06680"
  },
  "items": [
    {
      "name": "Sandbox Shoes",
      "price": 899.50,
      "rowTotal": 899.50,
      "quantity": 1,
      "sku": "POC-SHOES-001"
    }
  ]
}
```

### Paid Order Example, Multi-Item

```json
{
  "orderId": "POC-TR-PAID-1002",
  "pickupLocationCode": "tr-test-store-001",
  "payment_method": "paid",
  "amount": 1749.40,
  "amount_due": 0,
  "currency": "TRY",
  "packageCount": 1,
  "packageWeight": 2,
  "customer": {
    "name": "Sandbox Multi Item Customer",
    "email": "sandbox-multi@example.com",
    "mobile": "905554445566",
    "address": "Ornek Mahallesi, Test Caddesi No: 30",
    "district": "Nilüfer",
    "city": "Bursa",
    "country": "TR",
    "postcode": "16110"
  },
  "items": [
    {
      "name": "Sandbox Hoodie",
      "price": 1199.90,
      "rowTotal": 1199.90,
      "quantity": 1,
      "sku": "POC-HOODIE-001"
    },
    {
      "name": "Sandbox Cap",
      "price": 549.50,
      "rowTotal": 549.50,
      "quantity": 1,
      "sku": "POC-CAP-001"
    }
  ]
}
```

### COD Order Example, Multi-Item

```json
{
  "orderId": "POC-TR-COD-1002",
  "pickupLocationCode": "tr-test-store-001",
  "payment_method": "cod",
  "amount": 2049.80,
  "amount_due": 2049.80,
  "currency": "TRY",
  "packageCount": 1,
  "packageWeight": 2,
  "customer": {
    "name": "Sandbox COD Multi Customer",
    "email": "sandbox-cod-multi@example.com",
    "mobile": "905552223344",
    "address": "Kargo Test Mahallesi, Iade Sokak No: 40",
    "district": "Konak",
    "city": "Izmir",
    "country": "TR",
    "postcode": "35220"
  },
  "items": [
    {
      "name": "Sandbox Jacket",
      "price": 1499.90,
      "rowTotal": 1499.90,
      "quantity": 1,
      "sku": "POC-JACKET-001"
    },
    {
      "name": "Sandbox Socks",
      "price": 274.95,
      "rowTotal": 549.90,
      "quantity": 2,
      "sku": "POC-SOCKS-001"
    }
  ]
}
```

## 4. Manual API Test Sequence

Use this order:

1. `refreshToken`
2. `createPickupLocation`
3. `checkOTODeliveryFee`
4. `createOrder`
5. `createShipment`, separate flow
6. `print AWB`
7. `orderStatus`
8. `orderHistory`
9. `createReturnShipment`
10. `print reverse shipment label`

### Step 1: Refresh Token

```http
POST https://staging-api.tryoto.com/rest/v2/refreshToken
Content-Type: application/json
```

```json
{
  "refresh_token": "<TRY_OTO_SANDBOX_REFRESH_TOKEN>"
}
```

Capture:
- `access_token`
- `expires_in`

### Step 2: Create Pickup Location

```http
POST https://staging-api.tryoto.com/rest/v2/createPickupLocation
Authorization: Bearer <TRY_OTO_SANDBOX_ACCESS_TOKEN>
Content-Type: application/json
```

Use the suggested Turkey pickup location payload above.

Capture:
- `pickupLocationCode`
- `warhouseId`

### Step 3: Check OTO Delivery Fee

Endpoint:

```http
POST /rest/v2/checkOTODeliveryFee
```

Minimal confirmed fields:
- `originCity`
- `destinationCity`
- `weight`

Payload:

```json
{
  "originCity": "Istanbul",
  "destinationCity": "Ankara",
  "weight": 1,
  "currency": "TRY"
}
```

Notes:
- `currency` is optional in the Postman docs, but useful to test for Turkey.
- If `TRY` is rejected, record the error and ask Try OTO which currency value sandbox expects.

Capture from a selected `deliveryCompany[]` item:
- `deliveryOptionId`
- `deliveryCompanyName`
- `deliveryOptionName`
- `price`
- `currency`
- `pickupDropoff`
- `trackingType`

Alternative endpoint:
- Use `checkDeliveryFee` instead of `checkOTODeliveryFee` when testing own carrier contracts rather than OTO rates.

### Step 4: Create Order

```http
POST /rest/v2/createOrder
Authorization: Bearer <TRY_OTO_SANDBOX_ACCESS_TOKEN>
Content-Type: application/json
```

Use one of the `createOrder` payloads above.

Capture:
- `success`
- `otoId`
- Any validation or duplicate-order error.

Do not send `createShipment: true` in the first PoC.

### Step 5: Create Shipment, Separate Flow

Endpoint:

```http
POST /rest/v2/createShipment
```

Payload:

```json
{
  "orderId": "POC-TR-PAID-1001",
  "deliveryOptionId": "<SELECTED_DELIVERY_OPTION_ID>"
}
```

Notes:
- `deliveryOptionId` is not mandatory for Turkey according to support.
- For this PoC, pass the selected `deliveryOptionId` to make carrier selection explicit.

Capture:
- `success`
- `message`
- Any provider/carrier validation error.
- Any insufficient credit/wallet error.

### Step 6: Print AWB

Endpoint from Postman:

```http
GET /rest/v2/print/orderId
```

Path format to verify:
- Try `/rest/v2/print/<ORDER_ID>` if the literal Postman path does not work.

Capture:
- PDF label URL field.
- Whether the field name is `printAWBURL`, `printLabelURL`, both, or another field.
- `trackingNumber`
- `dcTrackingNumber`
- `deliveryCompany`

Initial label format:
- PDF only.

### Step 7: Order Status

Endpoint:

```http
POST /rest/v2/orderStatus
```

Payload by order id:

```json
{
  "orderId": "POC-TR-PAID-1001"
}
```

Optional ZPL test later:

```json
{
  "orderId": "POC-TR-PAID-1001",
  "labelType": "ZPL"
}
```

Do not run the ZPL test until PDF label flow succeeds.

Capture:
- `success`
- `status`
- `otoId`
- `shipmentId`
- `trackingUrl`
- `trackingNumber`, if present.
- `dcTrackingNumber`, if present.
- `printAWBURL`, if present.
- `zplDataArray`, only if testing ZPL.

### Step 8: Order History

Endpoint:

```http
POST /rest/v2/orderHistory
```

Payload:

```json
{
  "orderIds": ["POC-TR-PAID-1001"]
}
```

Capture:
- `success`
- `items[]`
- `items[].status`
- `items[].trackingURL`
- `items[].dcTrackingNumber`
- `items[].history[]`
- `history[].status`
- `history[].description`
- `history[].shipmentId`
- `history[].deliveryCompany`

### Step 9: Create Return Shipment

Endpoint from Postman:

```http
POST /rest/v2/createReturnShipment
```

Return flow warning:
- Support said the return label endpoint is `createShipment`, but the Postman collection contains `createReturnShipment`.
- Prefer Postman evidence during this PoC and record the result.
- If Try OTO sandbox rejects this flow, ask support for the exact return shipment sequence.

Payload:

```json
{
  "orderId": "POC-TR-PAID-1001",
  "deliveryOptionId": "<SELECTED_RETURN_DELIVERY_OPTION_ID>",
  "pickupLocationCode": "tr-test-store-001",
  "items": [
    {
      "quantity": "1",
      "sku": "POC-TSHIRT-001"
    }
  ]
}
```

Notes:
- The collection says return shipments are for delivered forward orders.
- If the sandbox order is not in a delivered state, this may fail. Record the exact error.

Capture:
- `success`
- `returnOrderId`
- `message`

### Step 10: Print Reverse Shipment Label

Endpoint from Postman:

```http
GET /rest/v2/print/orderId
```

Parameters from Postman:
- `orderId`
- `printReverseShipment`, optional boolean.

Test and record which path works:
- Print with original order id plus `printReverseShipment=true`.
- Print with generated `returnOrderId`.

Do not assume either behavior until sandbox confirms.

Capture:
- PDF label URL field.
- `trackingNumber`
- `dcTrackingNumber`
- `deliveryCompany`
- Whether reverse label URL includes return/reverse markers.

## 5. Validation Checklist

| Step | Expected HTTP status | Expected success fields | Expected tracking fields | Expected label fields | Expected error handling |
| --- | --- | --- | --- | --- | --- |
| `refreshToken` | `200 OK` | `success`, `access_token`, `token_type`, `expires_in` | None | None | `401` or validation error means token/config problem. |
| `createPickupLocation` | `200 OK` | `success`, `pickupLocationCode`, `warhouseId`, `message` | None | None | Duplicate code may return success or error; record exact sandbox behavior. |
| `checkOTODeliveryFee` | `200 OK` | `success`, `deliveryCompany[]` | None | None | No delivery options means carrier/account/coverage setup is not ready. |
| `createOrder` | `200 OK` | `success`, `otoId` | None expected | None expected | Validation errors should identify missing/invalid customer/order fields. |
| `createShipment` | `200 OK` | `success`, `message` | Unknown at this step | Unknown at this step | `400` insufficient credit means wallet/balance setup issue; `404` order not found means order id mismatch. |
| `print AWB` | `200 OK` in examples, exact status for print examples partly absent | `success` | `trackingNumber`, `dcTrackingNumber` if assigned | `printAWBURL` in Postman; `printLabelURL` mentioned by support; exact field unknown | Missing label means shipment not ready or print path/field differs. |
| `orderStatus` | `200 OK` | `success`, `status`, `otoId`, `shipmentId` | `trackingUrl`, `trackingNumber`, `dcTrackingNumber` candidates | `printAWBURL`, `zplDataArray` only when requested | `401` means token expired; refresh and retry once. |
| `orderHistory` | `200 OK` | `success`, `items[]`, `history[]` | `trackingURL`, `dcTrackingNumber`, `history[].shipmentId` | `printAwbUrl` may appear in expanded response | Missing history means order/shipment not advanced or wrong identifier. |
| `createReturnShipment` | `200 OK` | `success`, `returnOrderId`, `message` | None expected | None expected | Already-returned items may return an error; undelivered order may fail. |
| `print reverse shipment label` | `200 OK` in successful print examples, exact reverse path unknown | `success` | `trackingNumber`, `dcTrackingNumber` if assigned | PDF label URL field unknown until sandbox | If both original id and return id fail, return-label flow needs Try OTO confirmation. |

## 6. Unknowns To Verify During Sandbox PoC

- Authoritative tracking field:
  - `trackingNumber`
  - `dcTrackingNumber`
  - another carrier-specific field
- Exact PDF label field name:
  - `printAWBURL`
  - `printLabelURL`
  - both
  - another field
- `shipmentError` webhook payload shape.
- `orderStatus` webhook payload shape.
- Webhook signature header names and verification algorithm.
- Webhook public key, shared secret, or secret retrieval process.
- Turkey-specific carrier behavior.
- Sandbox Turkey carrier availability.
- Usable sandbox `deliveryOptionId` values.
- Whether `TRY` is accepted in sandbox `createOrder` and delivery fee requests.
- Whether Turkish city/district free text passes selected carrier validation.
- Turkey phone format accepted by selected carrier.
- Whether return shipment can be tested before a real delivered status exists.
- Return shipment tracking behavior and canonical return identifier.
- Whether reverse label printing uses original order id, `returnOrderId`, or another sequence.

## 7. Mapping Checklist For Our System

### Shopify Order ID To OTO `orderId`

Recommendation for PoC:
- Use an allocation-safe synthetic order id, not only Shopify order number.
- Example format:

```text
shopify-<shopifyOrderId>-allocation-<allocationId>-poc-<sequence>
```

Reason:
- One Shopify order can contain multiple vendors/allocations.
- OTO `orderId` must remain unique per shipment attempt.

Unknown:
- Try OTO duplicate `orderId` idempotency behavior.

### Store / Vendor To `pickupLocationCode`

Map:

```text
vendorId/storeId -> pickupLocationCode
```

PoC field to capture:

```text
pickupLocationCode = <returned from createPickupLocation>
```

### Vendor Return Address Mapping

Support says 20 stores can use separate pickup location and return address mappings.

PoC must verify:
- Where return address mapping is configured.
- Whether it is API-driven, UI-driven, pickup-location-driven, or carrier-contract-driven.
- Whether return shipment payload needs a return-specific location field.

### Payment Mapping

Initial mapping:

| Shopify/payment state | Try OTO field | PoC value |
| --- | --- | --- |
| Paid/prepaid | `payment_method` | `paid` |
| Paid/prepaid | `amount_due` | `0` |
| COD, if supported | `payment_method` | `cod` |
| COD, if supported | `amount_due` | same as `amount` |

Unknown:
- Partially paid or pending payment mapping.
- Whether uppercase `COD` is accepted.

### Package Weight Mapping

Try OTO field:
- `packageWeight`, kilograms.

PoC mapping:
- Use a controlled test value such as `1` or `2`.
- Do not map desi to kilograms without a provider-specific decision.

Unknown:
- Whether Turkish carriers require dimensions.
- Whether volumetric weight must be precomputed and sent as weight.

### Customer Phone Normalization

Try OTO field:
- `customer.mobile`

PoC values:
- Use numeric Turkish mobile-shaped values such as `905551234567`.

Unknown:
- Whether Try OTO/Turkey accepts `+90`, `90`, `0`, or local mobile formats.

### Item / SKU Mapping

Try OTO fields:
- `items[].sku`
- `items[].name`
- `items[].quantity`
- `items[].price`
- `items[].rowTotal`

PoC mapping:
- Shopify line item title -> `items[].name`
- Shopify SKU -> `items[].sku`
- Allocation quantity -> `items[].quantity`
- Allocation line price -> `items[].price`
- Allocation line total -> `items[].rowTotal`

Unknown:
- Whether returns can identify items reliably by SKU when an order contains duplicate SKUs.

