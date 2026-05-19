# Try OTO Return Shipment Implementation Plan

This document is planning-only. It must not be treated as a runtime provider contract until the sandbox PoC confirms the return flow end to end.

Sources reviewed:
- `docs/TRY_OTO_DISCOVERY.md`
- `docs/SHOPIFY_DISCOVERIES.md`

Hard boundaries:
- Do not implement Try OTO return shipment runtime code from this document alone.
- Do not change the existing forward Try OTO shipment flow.
- Do not change Kargo Entegrator behavior.
- Do not create Shopify refunds or modify Shopify return/refund lifecycle from Try OTO return shipment events.
- Unknown behavior remains unknown until confirmed by Try OTO support or sandbox evidence.

## Current Evidence Summary

Postman-backed candidate endpoint:
- `POST /rest/v2/createReturnShipment`

Postman-backed candidate print path:
- `GET /rest/v2/print/{orderId}` with optional `printReverseShipment`

Postman-backed status/tracking candidates:
- `POST /rest/v2/orderStatus`
- `POST /rest/v2/orderHistory`

Confirmed webhook observation from forward shipment sandbox:
- Try OTO can send status webhooks to `POST /webhooks/try-oto`.
- Observed payload key `reverseShipment` exists.
- Observed forward statuses include `searchingDriver` and `delivered`.

Important conflict:
- Try OTO support reportedly said the return label endpoint is `createShipment`.
- The Postman collection documents `createReturnShipment` and `returnOrderId`.
- Until sandbox confirms the exact sequence, prefer the Postman evidence for planning and do not implement runtime return creation.

## Endpoint Candidates

### Create Return Shipment

Candidate:
- `POST /rest/v2/createReturnShipment`

Example shape from documented discovery:

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

Documented fields:
- `orderId`, required.
- `pickupLocationCode`, optional.
- `deliveryOptionId`, optional.
- `items`, documented as optional at array level, but item rows list `quantity` and `sku` as required.
- optional `customer` object can update the customer address for return pickup.

Documented behavior:
- Creates a new return order for delivered forward orders.
- Generates a return order id with suffix such as `-R1` or `-R2`.
- Returns generated `returnOrderId`.
- Return-related actions, including tracking, print, and status checks, should use `returnOrderId`.
- Return shipment is item-based.

Unknowns:
- Whether `items` is truly optional or practically required.
- Whether return shipment can be created before Shopify return approval.
- Whether return shipment can be created before the forward shipment is delivered.
- Whether `createShipment` is also involved in return label purchase despite the Postman `createReturnShipment` endpoint.
- Whether `deliveryOptionId` should be selected through a return-specific delivery option lookup.
- Whether return shipments use the same carrier option IDs as forward shipments.

### Print Return Label

Candidate:
- `GET /rest/v2/print/{orderId}`

Candidate parameter:
- `printReverseShipment`

Documented behavior:
- Print endpoint has optional `printReverseShipment`.
- A Print Return AWB example exists in the collection.
- Example response shows a return AWB URL containing a `reverse=true` component.

Unknowns:
- Whether print should use original `orderId` plus `printReverseShipment=true`.
- Whether print should use generated `returnOrderId`.
- Whether either form works.
- Whether `printAWBURL`, `printLabelURL`, or both appear for return labels.
- Whether the return label URL is stable, expiring, public, or auth-protected.

### Return Tracking And Status

Candidates:
- `POST /rest/v2/orderStatus`
- `POST /rest/v2/orderHistory`

Expected identifier:
- `returnOrderId`, if `createReturnShipment` returns it as documented.

Unknowns:
- Whether return status enums differ from forward shipment statuses.
- Whether return tracking uses `trackingNumber`, `dcTrackingNumber`, or another authoritative field.
- Whether Try OTO webhook payload includes `reverseShipment=true` for return shipments consistently.
- Whether return webhook payloads always include `returnOrderId`, original `orderId`, `otoId`, tracking fields, or shipment id.

## Comparison With Confirmed Forward Flow

Confirmed forward flow:
1. Refresh token.
2. Create OTO order with `createOrder`.
3. Lookup delivery options through `checkOTODeliveryFee` / `checkDeliveryFee`.
4. Select a delivery option.
5. Call `createShipment`.
6. Capture tracking/label from `orderStatus`, print response, refresh, or webhook.
7. Keep auto-refresh as bridge while webhooks mature.

Planned return flow must not assume the same sequence. The documented return flow appears different:
1. Existing delivered forward OTO order must exist.
2. Call `createReturnShipment` against original forward `orderId`.
3. Store returned `returnOrderId`.
4. Print return label using the confirmed print path.
5. Track/status using `returnOrderId`.
6. Update local return shipment state only for confirmed return-specific statuses.

Key difference:
- Forward shipment starts from our allocation shipment execution.
- Return shipment should start from an existing Shopify `ReturnRecord` and the already-created Try OTO forward shipment/order identifiers.

## Internal Mapping Plan

### Original Order And Shipment

Required local references before return shipment creation:
- Shopify `ReturnRecord.id`.
- Shopify return GID/numeric id when available.
- Vendor allocation id.
- Forward shipment execution provider `try_oto`.
- Forward Try OTO order id used in `createOrder`.
- Forward Try OTO `otoId` / provider order id if available.
- Forward tracking number if available.

Candidate Try OTO return request mapping:
- original Try OTO forward `orderId` -> `createReturnShipment.orderId`.
- returned line item SKU -> `items[].sku`.
- returned quantity -> `items[].quantity`.
- vendor/store Try OTO pickup location or return location -> `pickupLocationCode`, only after sandbox confirms direction.
- selected return delivery option -> `deliveryOptionId`, only if sandbox confirms lookup is required or desired.

Do not use:
- Shopify order number alone as Try OTO `orderId` unless it exactly matches the original Try OTO order id stored during forward shipment creation.
- SKU-only matching when duplicate SKUs can occur in the same original order, unless Try OTO confirms SKU is sufficient.

### Return Address / Pickup Location Selection

Support clarification in discovery:
- 20 stores can use separate pickup location codes and return address mappings.

Plan:
- Treat return address mapping as provider/vendor configuration, not hardcoded code.
- Prefer explicit Try OTO return location config once confirmed.
- If Try OTO uses `pickupLocationCode` as the return pickup origin, it may represent the customer pickup or store location; this is **Unknown**.
- If Try OTO uses account-configured return addresses, the request may not need a return destination field; this is **Unknown**.

Unknowns for support/sandbox:
- Whether `pickupLocationCode` on `createReturnShipment` controls return pickup origin, return destination, or account/warehouse context.
- Whether customer return pickup address comes from original order, optional `customer`, Shopify return object, or Try OTO account state.
- Exact config field/API for per-store return addresses.

### PDF Return Label

Plan:
- Do not store or display a return label until sandbox confirms the print request and response field.
- Candidate label fields:
  - `printAWBURL`
  - `printLabelURL`
- Store label URL in a return-shipment-specific provider snapshot, not in the forward shipment label field.
- Expose authorized vendor/admin link as “Open return label PDF” only after sandbox proof.

Unknowns:
- Exact print endpoint identifier.
- Exact PDF field name.
- Whether return label URL requires auth.
- Whether reverse label can be generated for delivered and undelivered forward shipments.

### Return Tracking

Plan:
- Store return tracking separately from forward tracking.
- Candidate tracking fields:
  - `trackingNumber`
  - `dcTrackingNumber`
  - `trackingUrl`
  - `brandedTrackingURL`
- Do not overwrite forward shipment tracking.
- Do not update Shopify fulfillment or refund state from Try OTO return tracking.

Unknowns:
- Authoritative return tracking field for Turkey carriers.
- Whether return tracking appears immediately or asynchronously.
- Whether return tracking arrives through `orderStatus`, print response, webhook, or all three.

### Webhook `reverseShipment`

Observed forward webhook payload includes:
- `reverseShipment`

Plan:
- Treat `reverseShipment` as a hint only until a real return webhook payload is captured.
- If `reverseShipment === true` and the payload matches a stored return shipment by `returnOrderId` or return tracking number, update return shipment diagnostics/state.
- If `reverseShipment === true` but no return shipment matches, store safe unmatched diagnostics.
- If `reverseShipment` is absent or false, continue treating it as forward shipment status.
- Unknown statuses remain diagnostic-only.

Unknowns:
- Whether Try OTO always sets `reverseShipment` for return shipment webhooks.
- Whether return webhooks include original `orderId`, generated `returnOrderId`, `otoId`, `trackingNumber`, or `dcTrackingNumber`.
- Whether return webhook status enum differs from forward enum.

## Proposed Runtime Phases After PoC

### Phase 1: Documentation And Sandbox Proof

No runtime code.

Goals:
- Confirm exact return creation endpoint.
- Confirm required fields.
- Confirm return label print path.
- Confirm return tracking/status path.
- Capture safe webhook shape for return shipment.

### Phase 2: Admin-Only Dry-Run Preview

Runtime code, but no provider mutation.

Goals:
- Build return shipment payload preview for one ReturnRecord.
- Validate required local data.
- Show missing SKU/quantity/provider order id/return config.
- No Try OTO calls.
- No Shopify changes.

### Phase 3: Sandbox Return Shipment Creation

Runtime code behind sandbox/admin gate.

Goals:
- Call confirmed return endpoint.
- Store `returnOrderId`.
- Store safe response diagnostics.
- Do not auto-update Shopify return/refund lifecycle.

### Phase 4: Return Label Print And Status Refresh

Runtime code behind sandbox/admin gate.

Goals:
- Print return label with confirmed path.
- Refresh return status by confirmed identifier.
- Store return label/tracking separately from forward shipment.

### Phase 5: Webhook Return Status Sync

Runtime code behind explicit webhook gate.

Goals:
- Handle confirmed `reverseShipment` payload shape.
- Idempotent return shipment updates.
- Unknown statuses diagnostic-only.
- No Shopify refund mutation.

## Sandbox Manual PoC Checklist

1. Choose delivered test order
   - Use a Try OTO sandbox order with successful forward shipment.
   - Confirm forward status is delivered.
   - Record original Try OTO `orderId`, `otoId`, tracking number, and label URL.

2. Verify local Shopify return context
   - Pick or create a Shopify return request for the same order/item.
   - Confirm ReturnRecord line item SKU and quantity.
   - Confirm vendor/allocation scope.
   - Do not create refunds as part of this test.

3. Create return shipment
   - Call candidate `POST /rest/v2/createReturnShipment`.
   - Use original Try OTO forward `orderId`.
   - Include one returned item with SKU and quantity.
   - Include `pickupLocationCode` only if sandbox/support confirms its meaning.
   - Include `deliveryOptionId` only if sandbox/support confirms required or selected value.
   - Capture response status and keys.
   - Expected success field: `returnOrderId`.

4. Print return label
   - Test print with generated `returnOrderId`.
   - If that fails, test original order id plus `printReverseShipment=true`.
   - Capture label field name (`printAWBURL`, `printLabelURL`, or other).
   - Confirm PDF opens.

5. Verify tracking
   - Call `orderStatus` with `returnOrderId`.
   - Call `orderHistory` with `returnOrderId`.
   - Capture tracking/status fields.
   - Confirm whether tracking differs from forward tracking fields.

6. Verify webhook
   - Trigger or wait for return shipment status webhook.
   - Confirm whether payload contains `reverseShipment`.
   - Confirm matching identifier fields.
   - Confirm status field/value.
   - Confirm no PII is needed for matching.

7. Record results
   - Update `docs/TRY_OTO_DISCOVERY.md`.
   - Update this plan before implementation.
   - Keep unknowns marked unknown if not proven.

## Questions For Try OTO Support

1. For returns, should API clients use `createReturnShipment`, `createShipment`, or both?
2. If `createReturnShipment` is correct, is `orderId` the original forward Try OTO order id or original platform order id?
3. Is `items[]` required for every return shipment?
4. Are `items[].sku` and `items[].quantity` sufficient when the original order has duplicate SKUs?
5. Is `deliveryOptionId` required for Turkey return shipments?
6. If carrier selection is needed for returns, should we use `checkOTODeliveryFee`, `checkDeliveryFee`, or a return-specific rate endpoint?
7. What does `pickupLocationCode` mean on `createReturnShipment`: customer pickup origin, warehouse destination, account context, or something else?
8. How are per-store return addresses configured for 20 Turkey stores?
9. Does return label printing use generated `returnOrderId`, original `orderId` with `printReverseShipment=true`, or another path?
10. What is the exact return label URL response field?
11. Which return tracking field is authoritative for Turkey carriers: `trackingNumber`, `dcTrackingNumber`, or another field?
12. What webhook payload is sent for return shipment updates?
13. Is `reverseShipment` always present for return shipment webhooks?
14. What are the return shipment status enum values?
15. Can return shipments be created before the original forward shipment is delivered?
16. Can return labels be generated for undelivered orders?
17. Are return shipment webhook retries and idempotency keys provided?
18. What webhook signature header, algorithm, and secret/public-key process should be used before production ingest?

## Implementation Stop Conditions

Stop before runtime implementation if any of these remain unresolved:
- Exact return creation endpoint is not confirmed by sandbox.
- Exact return label print path is not confirmed by sandbox.
- `returnOrderId` behavior is not confirmed.
- Return address / pickup location meaning is not confirmed.
- Required item identification fields are not confirmed for duplicate-SKU cases.
- Webhook signature verification remains unknown for production rollout.
