# Vendor Integration API Contract

## 1. Overview

Sporgym provides vendor-scoped API access for external vendor integration providers.

The provider can:

- Pull orders assigned to its vendor.
- Write back order import/processing status.
- Write back shipment/tracking references.
- Write back invoice references.

The API is allocation-scoped. Every order record returned to a provider represents a Sporgym `VendorAllocation`, not the full cross-vendor Shopify order.

Shipment and invoice write endpoints store operational snapshots only. They do not create Shopify fulfillments, shipment labels, accounting entries, settlements, payouts, or Shopify invoices.

## 2. Authentication

All requests require a bearer token:

```http
Authorization: Bearer spg_vi_...
```

Tokens are issued by Sporgym and scoped to a single vendor. Providers must store tokens in their own secret store and never expose them in client-side code, logs, URLs, or screenshots.

Supported token scopes:

- `orders:read` - read allocated orders for the authenticated vendor.
- `status:write` - report provider order status for the authenticated vendor's allocations.
- `shipment:write` - report provider shipment/tracking references for the authenticated vendor's allocations.
- `invoice:write` - report provider invoice references for the authenticated vendor's allocations.

Tokens can be revoked or rotated by Sporgym. After revocation, requests using the old token return an authentication or authorization error. Providers should be prepared to replace tokens through an agreed operational handoff.

## 3. Security Rules

- A provider can access only allocations assigned to the vendor linked to its token.
- Vendor identity is derived from the bearer token, never from request body or query parameters.
- Cross-vendor allocation access is rejected.
- Write endpoints require `Idempotency-Key`.
- Sporgym records audit logs for integration API requests.
- Audit logs do not store full request bodies, full response bodies, bearer tokens, passwords, or provider secrets.
- Raw Shopify webhook payloads are not exposed by this API.

## 4. Rate Limits

Endpoints under `/api/vendor-integration/*` are rate limited.

Default:

- `120` requests per minute per integration client.

The limit may be changed by Sporgym environment configuration:

```text
VENDOR_INTEGRATION_RATE_LIMIT_PER_MINUTE=120
```

Valid tokens are rate limited by integration client. Invalid or missing token attempts are rate limited by IP address.

When the limit is exceeded, Sporgym returns:

```http
HTTP/1.1 429 Too Many Requests
```

```json
{
  "message": "Rate limit exceeded."
}
```

Provider guidance:

- Cache the issued bearer token securely.
- Do not request a new token per API call.
- Avoid aggressive polling.
- Use `limit` and `cursor` pagination for order pulls.
- Back off and retry later after HTTP `429`.

## 5. Endpoints

Base path examples below use:

```text
https://backend.example.com
```

Implemented endpoints:

- `GET /api/vendor-integration/orders`
- `POST /api/vendor-integration/orders/:allocationId/status`
- `POST /api/vendor-integration/orders/:allocationId/shipment`
- `POST /api/vendor-integration/orders/:allocationId/invoice`

## 6. GET Orders

```http
GET /api/vendor-integration/orders
```

Required scope:

- `orders:read`

Query parameters:

- `status` - optional allocation status filter, for example `ACTIVE`.
- `limit` - optional page size. Default is `50`; maximum is `100`.
- `cursor` - optional cursor from the previous response.

Example request:

```bash
curl -sS \
  -H "Authorization: Bearer spg_vi_..." \
  "https://backend.example.com/api/vendor-integration/orders?limit=50"
```

Response schema:

```json
{
  "data": [
    {
      "id": "alloc-vendor-demo-1001",
      "shopifyOrderId": "gid://shopify/Order/1001",
      "shopifyOrderNumber": "#1001",
      "allocationStatus": "ACTIVE",
      "fulfillmentStatus": "Pending",
      "shippingStatus": "Awaiting Shipment",
      "vendorIdentifier": "vendor-demo",
      "originalVendorIdentifier": "vendor-demo",
      "vendorIntegrationStatus": "acknowledged",
      "vendorIntegrationStatusMessage": "Order imported into Provider",
      "vendorIntegrationStatusUpdatedAt": "2026-06-02T12:30:00.000Z",
      "vendorIntegrationProvider": "provider-test",
      "shopifyCreatedAt": "2026-06-02T10:00:00.000Z",
      "createdAt": "2026-06-02T10:05:00.000Z",
      "updatedAt": "2026-06-02T12:30:00.000Z",
      "financial": {
        "currency": "TRY",
        "financialStatus": "paid",
        "paymentGatewayName": "Marketplace Payment",
        "taxesIncluded": true,
        "orderTaxAmount": "118.17",
        "shippingAmount": "29.90",
        "discountAmount": "15.50"
      },
      "orderNote": "Optional customer/order note",
      "orderTags": ["tag-1", "tag-2"],
      "customer": {
        "name": "Customer Name",
        "email": "customer@example.com",
        "phone": "+900000000000"
      },
      "billingAddress": {
        "fullName": "Billing Customer",
        "company": "Billing Company",
        "phone": "+900000000001",
        "city": "Istanbul",
        "district": "Besiktas",
        "address1": "Billing address 1",
        "address2": "Floor 2",
        "postcode": "34330"
      },
      "shippingAddress": {
        "country": "TR",
        "postcode": "34000",
        "city": "Istanbul",
        "district": "Kadikoy",
        "address": "Shipping address"
      },
      "shipment": {
        "carrier": "Demo Carrier",
        "trackingNumber": "ABC123456",
        "trackingUrl": "https://tracking.example/ABC123456",
        "fulfilledAt": null,
        "shipmentCreatedAt": "2026-06-02T12:00:00.000Z",
        "shipmentUpdatedAt": null,
        "externalShippedAt": "2026-06-02T12:00:00.000Z"
      },
      "vendorInvoice": {
        "invoiceNumber": "ABC202600001",
        "invoiceDate": "2026-06-02",
        "invoiceUrl": "https://provider.example/invoices/ABC202600001.pdf",
        "invoiceAmount": "1299.90",
        "receivedAt": "2026-06-02T12:30:00.000Z"
      },
      "totals": {
        "orderTotal": "1299.90",
        "allocationLineTotal": "1299.90"
      },
      "lineItems": [
        {
          "id": "allocation-line-1",
          "shopifyLineItemId": "gid://shopify/LineItem/1",
          "shopifyProductId": "gid://shopify/Product/1",
          "shopifyVariantId": "gid://shopify/ProductVariant/1",
          "sku": "SKU-1",
          "title": "Product title",
          "imageUrl": null,
          "quantity": 1,
          "unitPrice": "1299.90",
          "unitPriceVatIncluded": "1299.90",
          "lineTotalVatIncluded": "1299.90",
          "lineTaxAmount": "118.17",
          "vatRate": "10",
          "lineAmount": "1299.90"
        }
      ]
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null
  }
}
```

Snapshot notes:

- Optional fields may be `null`.
- Amounts are decimal strings.
- Timestamps are ISO 8601 strings unless otherwise specified.
- `invoiceDate` is a date-only `YYYY-MM-DD` value.
- `orderTags` is an array and may be empty.
- No raw Shopify payload is returned.

## 7. POST Status

```http
POST /api/vendor-integration/orders/:allocationId/status
```

Required scope:

- `status:write`

Required headers:

```http
Authorization: Bearer spg_vi_...
Idempotency-Key: provider-unique-operation-key
Content-Type: application/json
```

Allowed statuses:

- `acknowledged`
- `processing`
- `ready_to_ship`
- `failed`
- `cancelled`

Example request:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer spg_vi_..." \
  -H "Idempotency-Key: provider-status-alloc-vendor-demo-1001-1" \
  -H "Content-Type: application/json" \
  "https://backend.example.com/api/vendor-integration/orders/alloc-vendor-demo-1001/status" \
  -d '{
    "status": "acknowledged",
    "message": "Order imported into Provider"
  }'
```

Example response:

```json
{
  "idempotent": false,
  "allocation": {
    "id": "alloc-vendor-demo-1001",
    "vendorIdentifier": "vendor-demo",
    "vendorIntegrationStatus": "acknowledged",
    "vendorIntegrationStatusMessage": "Order imported into Provider",
    "vendorIntegrationStatusUpdatedAt": "2026-06-02T14:30:00.000Z",
    "vendorIntegrationProvider": "provider-test",
    "lastVendorIntegrationRequestId": "request-id"
  }
}
```

This endpoint updates only the provider status snapshot on the allocation.

## 8. POST Shipment

```http
POST /api/vendor-integration/orders/:allocationId/shipment
```

Required scope:

- `shipment:write`

Required headers:

```http
Authorization: Bearer spg_vi_...
Idempotency-Key: provider-unique-operation-key
Content-Type: application/json
```

Required body fields:

- `carrier`
- `trackingNumber`

Optional body fields:

- `trackingUrl`
- `shippedAt`

Example request:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer spg_vi_..." \
  -H "Idempotency-Key: provider-shipment-alloc-vendor-demo-1001-1" \
  -H "Content-Type: application/json" \
  "https://backend.example.com/api/vendor-integration/orders/alloc-vendor-demo-1001/shipment" \
  -d '{
    "carrier": "Demo Carrier",
    "trackingNumber": "ABC123456",
    "trackingUrl": "https://tracking.example/ABC123456",
    "shippedAt": "2026-06-02T12:00:00Z"
  }'
```

Example response:

```json
{
  "idempotent": false,
  "allocation": {
    "id": "alloc-vendor-demo-1001",
    "vendorIdentifier": "vendor-demo",
    "carrier": "Demo Carrier",
    "trackingNumber": "ABC123456",
    "trackingUrl": "https://tracking.example/ABC123456",
    "shippedAt": "2026-06-02T12:00:00.000Z",
    "shippingStatus": "In Transit",
    "lastVendorIntegrationShipmentRequestId": "request-id"
  }
}
```

Operational boundary:

- This endpoint stores shipment/tracking snapshot fields only.
- It does not create Shopify fulfillment yet.
- It does not create a shipment label or carrier record.
- It does not mutate invoices, accounting entries, settlements, or payouts.

## 9. POST Invoice

```http
POST /api/vendor-integration/orders/:allocationId/invoice
```

Required scope:

- `invoice:write`

Required headers:

```http
Authorization: Bearer spg_vi_...
Idempotency-Key: provider-unique-operation-key
Content-Type: application/json
```

Required body fields:

- `invoiceNumber`
- `invoiceDate` as `YYYY-MM-DD`
- `invoiceAmount` as a decimal string

Optional body fields:

- `invoiceUrl`

Example request:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer spg_vi_..." \
  -H "Idempotency-Key: provider-invoice-alloc-vendor-demo-1001-1" \
  -H "Content-Type: application/json" \
  "https://backend.example.com/api/vendor-integration/orders/alloc-vendor-demo-1001/invoice" \
  -d '{
    "invoiceNumber": "ABC202600001",
    "invoiceDate": "2026-06-02",
    "invoiceUrl": "https://provider.example/invoices/ABC202600001.pdf",
    "invoiceAmount": "1299.90"
  }'
```

Example response:

```json
{
  "idempotent": false,
  "allocation": {
    "id": "alloc-vendor-demo-1001",
    "vendorIdentifier": "vendor-demo",
    "vendorInvoiceNumber": "ABC202600001",
    "vendorInvoiceDate": "2026-06-02",
    "vendorInvoiceUrl": "https://provider.example/invoices/ABC202600001.pdf",
    "vendorInvoiceAmount": "1299.90",
    "vendorInvoiceReceivedAt": "2026-06-02T12:30:00.000Z",
    "lastVendorIntegrationInvoiceRequestId": "request-id"
  }
}
```

Operational boundary:

- This endpoint stores an informational vendor invoice reference snapshot only.
- It does not create Shopify invoices.
- It does not create accounting entries or financial postings.
- It does not create settlements or payouts.
- It does not mutate shipment or status behavior.

## 10. Idempotency

All write endpoints require `Idempotency-Key`.

Rules:

- The provider should use one unique key per operation.
- Repeating the same key for the same client and allocation returns the previous result.
- A repeated key does not create a duplicate event.
- A repeated key does not overwrite the previously stored snapshot for that operation.

Recommended key format:

```text
provider-name:{operation}:{allocationId}:{provider-event-id-or-attempt-id}
```

Examples:

- `provider-status-alloc-vendor-demo-1001-import-1`
- `provider-shipment-alloc-vendor-demo-1001-tracking-ABC123456`
- `provider-invoice-alloc-vendor-demo-1001-ABC202600001`

## 11. Error Responses

Common responses:

```json
{
  "message": "Human-readable error message."
}
```

Status codes:

- `400` - validation error, invalid status, invalid amount/date, or missing `Idempotency-Key`.
- `401` - missing or invalid bearer token.
- `403` - missing scope, disabled/revoked token, or forbidden access.
- `404` - allocation not found for the authenticated vendor.
- `429` - rate limit exceeded.

Examples:

```json
{
  "message": "Idempotency-Key header is required."
}
```

```json
{
  "message": "Missing required scope: invoice:write"
}
```

```json
{
  "message": "Vendor allocation not found."
}
```

## 12. Operational Notes

- Timestamps are ISO 8601 strings.
- Amounts are decimal strings, not floating point numbers.
- Shopify prices are VAT-inclusive when Shopify provides VAT-inclusive data.
- `lineTaxAmount` and `vatRate` come from Shopify tax data when available.
- If Shopify line-level tax data is missing, Sporgym may return a fallback VAT rate for current sports clothing/shoes/bags products.
- The fallback VAT rate does not make Sporgym a tax engine and does not change finance, settlement, payout, or accounting calculations.
- Providers should treat Sporgym allocation ids as the stable identifiers for write-back operations.
- Providers should not infer cross-vendor order contents from allocation records.
