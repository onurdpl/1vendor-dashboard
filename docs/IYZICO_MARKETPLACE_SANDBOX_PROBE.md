# iyzico Marketplace Sandbox Probe

## Scope

This probe adds backend-only iyzico marketplace sandbox calls for controlled admin diagnostics.

It does not:

- connect iyzico to Shopify checkout
- change production payment flow
- store card data
- add database schema
- add automatic payout, item approval, refund, or cancellation logic
- write iyzico results into finance, settlement, payout, allocation, refund, or return records

## Required Env Vars

Set these on the backend runtime before using the probe:

```dotenv
IYZICO_SANDBOX_API_KEY=
IYZICO_SANDBOX_SECRET_KEY=
IYZICO_SANDBOX_BASE_URL=https://sandbox-api.iyzipay.com
```

The route rejects any base URL other than `https://sandbox-api.iyzipay.com`.

## Authorization

Requests are signed with:

```text
IYZWSv2 base64("apiKey:{apiKey}&randomKey:{randomKey}&signature:{hmacSha256(randomKey + uriPath + rawBody, secretKey)}")
```

The signed `rawBody` is the exact JSON request body sent to iyzico.

The backend does not log or return:

- API key
- secret key
- Authorization header value
- card number
- CVC/CVV
- buyer identity number
- checkout form HTML content

## Admin Endpoints Added

All endpoints are `POST`, backend-only, and protected by the existing authenticated admin route guard.

### `/admin/diagnostics/iyzico-marketplace/submerchant`

Create submerchant:

```json
{
  "action": "create",
  "payload": {
    "locale": "en",
    "conversationId": "submerchant-create-001",
    "subMerchantExternalId": "vendor-sandbox-001",
    "subMerchantType": "PRIVATE_COMPANY",
    "address": "Sandbox address",
    "contactName": "Sandbox Vendor",
    "email": "vendor@example.invalid",
    "gsmNumber": "+905350000000",
    "name": "Sandbox Vendor",
    "iban": "TR180006200119000006672315",
    "currency": "TRY",
    "taxOffice": "Sandbox Tax Office",
    "legalCompanyTitle": "Sandbox Vendor Ltd"
  }
}
```

Retrieve submerchant:

```json
{
  "action": "retrieve",
  "subMerchantExternalId": "vendor-sandbox-001"
}
```

### `/admin/diagnostics/iyzico-marketplace/checkout-form`

Initialize marketplace checkout form:

```json
{
  "action": "initialize",
  "payload": {
    "locale": "en",
    "conversationId": "checkout-sandbox-001",
    "price": "100",
    "paidPrice": "100",
    "currency": "TRY",
    "basketId": "basket-sandbox-001",
    "paymentGroup": "PRODUCT",
    "callbackUrl": "https://example.invalid/iyzico-callback",
    "buyer": {
      "id": "buyer-sandbox-001",
      "name": "Sandbox",
      "surname": "Buyer",
      "identityNumber": "11111111111",
      "email": "buyer@example.invalid",
      "gsmNumber": "+905350000000",
      "registrationAddress": "Sandbox registration address",
      "city": "Istanbul",
      "country": "Turkey",
      "ip": "127.0.0.1"
    },
    "shippingAddress": {
      "address": "Sandbox shipping address",
      "contactName": "Sandbox Buyer",
      "city": "Istanbul",
      "country": "Turkey"
    },
    "billingAddress": {
      "address": "Sandbox billing address",
      "contactName": "Sandbox Buyer",
      "city": "Istanbul",
      "country": "Turkey"
    },
    "basketItems": [
      {
        "id": "line-001",
        "price": "100",
        "name": "Sandbox product",
        "category1": "Shoes",
        "category2": "Sneakers",
        "itemType": "PHYSICAL",
        "subMerchantKey": "sandbox-submerchant-key",
        "subMerchantPrice": "80"
      }
    ]
  }
}
```

Required marketplace basket item fields:

- `id`
- `price`
- `name`
- `category1`
- `category2` optional
- `itemType`
- `subMerchantKey`
- `subMerchantPrice`

Retrieve checkout form result:

```json
{
  "action": "retrieve-result",
  "token": "checkout-form-token",
  "conversationId": "checkout-sandbox-001"
}
```

### `/admin/diagnostics/iyzico-marketplace/payment-detail`

Retrieve payment detail:

```json
{
  "action": "retrieve",
  "paymentId": "25152948",
  "paymentConversationId": "checkout-sandbox-001"
}
```

Approve payment item:

```json
{
  "action": "approve-item",
  "paymentTransactionId": "27142369"
}
```

Disapprove payment item:

```json
{
  "action": "disapprove-item",
  "paymentTransactionId": "27142369"
}
```

Update payment item submerchant payout fields:

```json
{
  "action": "update-item",
  "paymentTransactionId": "27142369",
  "subMerchantKey": "sandbox-submerchant-key",
  "subMerchantPrice": "80"
}
```

### `/admin/diagnostics/iyzico-marketplace/refund`

Refund a payment transaction item:

```json
{
  "paymentTransactionId": "27142369",
  "price": "10",
  "currency": "TRY"
}
```

### `/admin/diagnostics/iyzico-marketplace/cancel`

Cancel a payment:

```json
{
  "paymentId": "25152948"
}
```

## Response Shape

The diagnostic response contains safe operational metadata:

```json
{
  "ok": true,
  "provider": "iyzico",
  "sandbox": true,
  "productionPaymentFlowChanged": false,
  "shopifyCheckoutIntegration": false,
  "method": "POST",
  "endpointPath": "/payment/detail",
  "httpStatus": 200,
  "contentType": "application/json",
  "requestBodyKeys": ["locale", "paymentId"],
  "authorizationHeaderPresent": true,
  "providerStatus": "success",
  "body": {
    "status": "success",
    "paymentId": "25152948"
  }
}
```

Provider response fields are sanitized before being returned by diagnostics.

## Exact Unknowns Remaining

- Unknown: Shopify native iyzico app marketplace payload support is still not proven.
- Unknown: Whether a Shopify standard checkout flow can carry item-level `subMerchantKey` and `subMerchantPrice` through the native iyzico app.
- Unknown: Whether iyzico marketplace checkout form behavior maps cleanly to Shopify order creation without custom checkout integration.
- Unknown: Which iyzico identifiers should be persisted for future reconciliation, idempotency, and audit evidence.
- Unknown: How iyzico item transaction states should map to existing finance settlement language.
- Unknown: Whether item approve/disapprove/update should be operator-only, scheduled, or driven by another audited workflow after production design.

## Next Step After Sandbox Success

After submerchant creation, checkout form initialization/result retrieval, payment detail, refund, and cancel are proven in sandbox, document the observed safe response fields and design a non-mutating mapping plan from:

```text
Shopify line item -> seller_info SKU vendor slug -> internal Vendor -> sandbox subMerchantKey -> iyzico basketItems[].subMerchantKey
```

Only after that should a separate design decide whether Shopify native iyzico checkout can support marketplace payloads or whether a different checkout/payment architecture is required.
