# Try OTO Return Shipment Contract Research

Research sources:
- `/Users/onur/Downloads/OTO API V2.postman_collection.json`
- `docs/TRY_OTO_DISCOVERY.md`
- `docs/TRY_OTO_RETURN_PLAN.md`

This document is research-only. It does not implement runtime behavior. Unknown behavior remains unknown until confirmed by Try OTO support or sandbox diagnostics.

## Current Runtime Observation

Observed locally:
- `createReturnShipment` succeeds.
- `returnOrderId` exists.
- Try OTO shows the return as `Yeni Iade`.
- `getReturnDetails` works.
- `getReturnLink` works.
- Barcode, tracking, and label are not returned by those probes.
- The reverse `createShipment` path is disabled as unconfirmed/incorrect.

## High-Level Finding

Our current return integration is now aligned with the documented `createReturnShipment` payload shape, but it is not yet using all documented return follow-up actions.

The uploaded collection does not show `getReturnDetails` or `getReturnLink` as label/AWB retrieval endpoints. The collection points to:
- `POST /rest/v2/createReturnShipment` to create the return order.
- Generated `returnOrderId` for all return-related actions.
- `GET /rest/v2/print/{orderId}?printReverseShipment=true` for return AWB/label printing.
- `POST /rest/v2/orderStatus` and `POST /rest/v2/orderHistory` for return tracking/status when called with the relevant return identifier.
- `orderStatus` webhooks that may include return fields such as `returnOrderId`, `returnStatus`, `printAWBURL`, `trackingNumber`, and `dcTrackingNumber`.

Therefore, the most likely missing integration step, based strictly on the collection, is not reverse `createShipment`; it is calling the documented print/status paths with the generated `returnOrderId`.

## Confirmed Return Endpoints

### `POST /rest/v2/createReturnShipment`

Documented purpose:
- Creates a new return order for delivered forward orders.
- Generates a new return order ID by appending a suffix such as `-R1` or `-R2`.
- Return processing is item-based.

Documented example:

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

Documented success response:

```json
{
  "success": true,
  "returnOrderId": "2204749035-R1",
  "message": "A new return order is created for return shipment"
}
```

Documented duplicate/invalid example:

```json
{
  "otoErrorCode": "OTO1187",
  "success": false,
  "otoErrorMessage": "Item(s) have already been returned."
}
```

### `POST /rest/v2/getReturnLink`

Documented purpose:
- Generates a return request portal link for end customers.
- It is not documented as an AWB/PDF/label endpoint.

Documented request:

```json
{
  "orderId": "123"
}
```

Documented success response:

```json
{
  "success": true,
  "returnLink": "https://app.tryoto.com/sms/return-request?key=..."
}
```

Interpretation:
- A returned `returnLink` should not be treated as a shipping label unless Try OTO explicitly confirms it is a printable label URL.

### `POST /rest/v2/getReturnDetails`

Documented purpose:
- Retrieves detailed information about the reverse shipment associated with a specific order.
- Includes return reason, returned items, and status.

Documented request:

```json
{
  "orderId": "OID-9616-1008"
}
```

Documented response shape:

```json
{
  "returnLocationCode": "Riyadh",
  "orderId": "OID-9616-1008",
  "returnReason": "Damaged",
  "items": [
    {
      "sku": "123456",
      "quantityOrdered": 1
    }
  ],
  "status": "returned"
}
```

Interpretation:
- The documented response does not include barcode, tracking number, AWB URL, PDF URL, or label URL.
- Current diagnostics where `getReturnDetails` works but returns no label are consistent with the collection.

### `POST /rest/v2/triggerReturnSms`

Documented purpose:
- Triggers SMS for a successful return request if SMS settings are configured.
- This is customer communication, not label retrieval.

Documented request:

```json
{
  "orderId": "523939"
}
```

Documented success response:

```json
{
  "success": true,
  "otoId": 3077435
}
```

## Confirmed Required Fields For `createReturnShipment`

From the collection request parameter table:

Required:
- `orderId`: yes, string. The order number for which to create a reverse shipment.

Optional at top level:
- `pickupLocationCode`: no, string. Predefined pickup address from `Create Pickup Location`.
- `deliveryOptionId`: no, string. Activated delivery company option id.
- `pickingType`: enum, no explicit required flag.
- `frontSideIDCard`: no.
- `backSideIDCard`: no.
- `consigneeId`: no.
- `items`: no at array level in the table.

Required within each item if `items` is supplied:
- `items[].quantity`: yes, string.
- `items[].sku`: yes, string.

Customer object support:
- The collection documents `Request Parameters for Customer Data`.
- Required fields inside customer data are listed as:
  - `name`
  - `mobile`
  - `address`
  - `city`
  - `country`
- Optional customer fields include:
  - `email`
  - `district`
  - `state`
  - `buildingNo`
  - `secondaryAddressNumber`
  - `shortAddressCode`
  - `postcode`
  - `street`
  - `lat`
  - `lon`
  - `refID`
  - `W3WAddress`

Unknowns:
- Whether `items` is practically required even though the array is marked optional.
- Whether customer data is required for Turkey returns when the original order already has customer data.
- Whether `deliveryOptionId` is required for Turkey return shipment finalization in practice.
- Whether `pickupLocationCode` means return origin, return destination, or account warehouse context for Turkey returns.

## Does `createReturnShipment` Finalize The Shipment?

Confirmed by collection:
- It creates a new return order.
- It returns `returnOrderId`.
- It says all return-related actions use the generated return order ID.
- It does not show barcode/tracking/label fields in the documented `createReturnShipment` response.

Not confirmed by collection:
- That `createReturnShipment` directly returns barcode/tracking/label.
- That `createReturnShipment` synchronously finalizes carrier label purchase.
- That a separate reverse `createShipment` is required after `createReturnShipment`.

Current runtime contradiction:
- We expected corrected `createReturnShipment` to return barcode/tracking/label, but the collection's documented response only promises `returnOrderId` and a message.
- The runtime result of `returnOrderId` without barcode/tracking/label is not necessarily an API failure according to the collection.

Most likely collection-backed interpretation:
- `createReturnShipment` creates the return order.
- Label/tracking should be retrieved from follow-up documented return-related actions using `returnOrderId`, especially print/status/history and webhooks.

## Confirmed Uses Of `returnOrderId`

The Return Shipments section says:
- A new return order ID is generated by appending suffixes such as `-R1` or `-R2`.
- The generated ID is returned for return tracking and related operations.
- All return-related actions, specifically tracking, printing, and status checks, must be performed using the generated ID.

The Tracking `orderHistory` response includes:
- `returnOrderIds`: an array containing values such as `OID-23331-9743-R1`.
- A return history entry with status `returnShipmentProcessing`.
- `printAwbUrl` with a URL containing a reverse flag.
- `shipmentId` for the reverse shipment.

## Print/AWB Endpoint For Returns

Confirmed endpoint:
- `GET /rest/v2/print/{orderId}`

Documented optional query:
- `printReverseShipment=true`

The collection includes a `200-Print Return AWB` example response with:
- `dcTrackingNumber`
- `success`
- `printAWBURL`
- `deliveryCompany`
- `trackingNumber`

The example URL includes encoded data containing a `reverse=true` component.

Important unresolved point:
- The Print AWB section says `orderId` is required.
- The Return Shipments section says all return-related actions must use the generated `returnOrderId`.
- Therefore, the safest next sandbox probe is to call `print/{returnOrderId}?printReverseShipment=true`.
- If that fails, test `print/{originalOrderId}?printReverseShipment=true`, but this second form is not directly proven by the return section.

## Status And History Endpoints For Returns

### `POST /rest/v2/orderStatus`

Documented request identifiers:
- `orderId`, required if no `otoId`.
- `otoId`, required if no `orderId`.
- `labelType`, optional; `zpl` returns ZPL data.

The `200- PDF` response example includes return-shaped evidence:
- `trackingUrl`
- `dcTrackingNumber`
- `deliveryCompany`
- `printAWBURL`
- `shipmentId`
- `otoId`
- `status`: `returnShipmentProcessing`

This example strongly indicates `orderStatus` can return return label/tracking fields when called with the appropriate return order identifier.

### `POST /rest/v2/orderHistory`

Documented request identifiers:
- `orderIds`
- `otoIds`
- `shipmentIds`

The example response includes return evidence:
- history entry: `Return shipment created...`
- `shipmentId` for the return shipment.
- `deliveryCompany`.
- `status`: `returnShipmentProcessing`.
- `returnOrderIds`.
- `printAwbUrl` containing a reverse flag.
- `trackingURL`.

Unknown:
- Whether `orderHistory` should be called with original order ID or generated return order ID for best return detail coverage.
- Whether Turkey/Sürat responses use the exact same field casing, for example `printAwbUrl` versus `printAWBURL`.

## Search Findings

Searched terms:
- `printAWBURL`
- `trackingNumber`
- `dcTrackingNumber`
- `returnStatus`
- `reverseShipmentProcessing`
- `reverseReturned`
- `AWB`
- `label`
- `PDF`
- `returnOrderId`
- `reverseShipment`
- `printReverseShipment`

Confirmed occurrences:
- `printAWBURL` appears in Print AWB, Order Status, and webhook examples.
- `trackingNumber` and `dcTrackingNumber` appear in Print AWB, Order Status, Track Shipment, and webhook examples.
- `returnStatus` appears in the webhook example.
- `returnStatus` examples include `reverseShipment`; the field description mentions examples such as `reverseShipmentProcessing` and `reverseReturned`.
- Status list includes reverse lifecycle statuses:
  - `returnShipmentProcessing`
  - `newReturn`
  - `reverseShipmentCreated`
  - `reverseShipmentCanceled`
  - `reverseGoingToPickup`
  - `reversePickupAttempted`
  - `reversePickedUp`
  - `reverseOutForDelivery`
  - `reverseArrivedTerminal`
  - `reverseDepartedTerminal`
  - `reverseArrivedDestinationTerminal`
  - `reverseUndeliveredAttempt`
  - `reverseHeldForPickup`
  - `reverseShipmentOnHold`
  - `reverseReturned`
  - `reverseConfirmReturn`
  - `returnReverseComment`
- `printReverseShipment` appears in the Print AWB endpoint documentation and example URL.

No confirmed occurrence found:
- A separate documented reverse shipment finalization endpoint in the Return Shipments section.
- A `reverseShipment` boolean in the collection examples. The collection uses `returnStatus` for return-order state; our runtime has observed a `reverseShipment` boolean in sandbox, but that is runtime evidence, not collection evidence.

## Webhook Fields

The collection's webhook section documents `orderStatus` payload fields including:
- `orderId`
- `parentOrderId`
- `returnOrderId`
- `otoId`
- `entityId`
- `brandedTrackingURL`
- `brandId`
- `status`
- `dcStatus`
- `returnStatus`
- `note`
- `pickupLocationCode`
- `printAWBURL`
- `trackingNumber`
- `dcTrackingNumber`
- `trackingUrl`
- `deliveryCompany`
- `shipmentWeight`
- `attemptFailureReason`
- `timestamp`
- `signature`

The collection states:
- `returnOrderId` is the unique identifier of the return order.
- `returnStatus` is the current status of the return order in OTO.
- Example `returnStatus` values include `reverseShipmentProcessing` and `reverseReturned`.
- `printAWBURL` is the URL to download or print the AWB.
- `trackingNumber` is generated by OTO.
- `dcTrackingNumber` is generated by the delivery company.

Signature:
- The collection states the signature uses `orderId:status:timestamp` signed with `HmacSHA256` and Base64 encoding.
- The public key is shared privately.
- This is still incomplete for production verification because our configured secret/public-key handling and exact header/body verification inputs must be confirmed.

## Comparison With Current Integration

Aligned:
- Uses `POST /rest/v2/createReturnShipment`.
- Sends `orderId`.
- Sends `pickupLocationCode` when configured.
- Sends `deliveryOptionId` when already stored.
- Sends item rows with `sku` and `quantity`.
- Keeps reverse `createShipment` disabled.
- Uses `getReturnDetails` and `getReturnLink` as diagnostics/probes rather than assuming they are confirmed label endpoints.

Potentially misaligned or incomplete:
- Current diagnostics have focused on `getReturnDetails` and `getReturnLink` for label discovery, but the collection does not document either as the label retrieval path.
- Current integration does not yet appear to call `GET /rest/v2/print/{returnOrderId}?printReverseShipment=true`.
- Current integration does not yet appear to call `orderStatus` with the generated `returnOrderId` for return tracking/AWB discovery.
- Current integration does not yet appear to call `orderHistory` with a return-related identifier for return tracking/AWB discovery.

Current runtime behavior that is not a confirmed bug:
- `createReturnShipment` returning only `returnOrderId` and creating `Yeni Iade` may match the documented response shape.
- `getReturnDetails` returning no label may match the documented response shape.
- `getReturnLink` returning no label may match the documented purpose as a customer return portal link.

## Exact Contradictions And Tensions

1. The plan previously described `createReturnShipment` as creating/finalizing a return shipment when confirmed fields are present.
   - Collection evidence: `createReturnShipment` creates a new return order and returns `returnOrderId`; the example does not include label/tracking.
   - Runtime: it creates `Yeni Iade` with no barcode/tracking/label.
   - Conclusion: finalization is not proven by `createReturnShipment` alone.

2. Manual panel flow produced a barcode after carrier selection.
   - Collection evidence: no return-specific delivery-option lookup or finalization endpoint appears in the Return Shipments folder.
   - Collection evidence elsewhere: print/status/history can return return AWB/tracking when using return identifiers.
   - Conclusion: the panel step may correspond to internal workflow or documented print/status behavior, but the exact API equivalent remains unknown.

3. Reverse `createShipment` path came from panel traces.
   - Collection evidence: `createShipment` is documented for forward shipment creation; Return Shipments does not document reverse `createShipment`.
   - Current stance: keep disabled.

4. Webhook field shape differs between collection and observed runtime.
   - Collection: documents `returnStatus`, `returnOrderId`, and label/tracking fields.
   - Runtime: observed `reverseShipment` boolean in sandbox payloads.
   - Conclusion: support both as diagnostics, but do not assume undocumented fields are always present.

## Most Likely Missing Integration Step

Without guessing provider behavior, the collection-backed missing step is:

1. After `createReturnShipment` returns `returnOrderId`, call the documented print path:
   - `GET /rest/v2/print/{returnOrderId}?printReverseShipment=true`

2. Also call documented tracking/status paths with the generated return identifier:
   - `POST /rest/v2/orderStatus` with `orderId = returnOrderId`
   - `POST /rest/v2/orderHistory` with `orderIds = [returnOrderId]` or, if sandbox proves necessary, the original order id.

3. Capture:
   - `printAWBURL` or `printAwbUrl`
   - `trackingNumber`
   - `dcTrackingNumber`
   - `trackingUrl` or `trackingURL`
   - `deliveryCompany`
   - return status values such as `returnShipmentProcessing` or reverse statuses.

This is the strongest next PoC path because it is explicitly supported by the collection's Return Shipments, Print AWB, Tracking, and Webhook documentation.

## Unresolved Unknowns

- Whether `print/{returnOrderId}?printReverseShipment=true` works for Turkey/Sürat sandbox returns immediately after `createReturnShipment`.
- Whether `print/{originalOrderId}?printReverseShipment=true` is required instead of the generated `returnOrderId`.
- Whether `orderStatus` should use `returnOrderId`, `otoId`, or another return-specific identifier in Turkey sandbox.
- Whether `orderHistory` should use original order id or return order id for complete reverse shipment history.
- Whether `deliveryOptionId` is required for Turkey returns in practice.
- Whether `deliveryOptionId` must be selected from a return-capable option lookup using `forReverseShipment=true`.
- Whether `pickupLocationCode` means return origin, return destination, or account context for Turkey.
- Whether `getReturnDetails` changes after print/status processing to include label/tracking fields. The collection does not show that, but sandbox could.
- Whether `getReturnLink` is ever a label URL. The collection says it is a customer return request portal.
- Exact webhook signature verification setup for production.

## Recommended Next Research/PoC Actions

No runtime code should be changed until these are checked against sandbox:

1. Call `GET /rest/v2/print/{returnOrderId}?printReverseShipment=true` for an existing generated `returnOrderId`.
2. Call `POST /rest/v2/orderStatus` with `orderId = returnOrderId`.
3. Call `POST /rest/v2/orderHistory` with `orderIds = [returnOrderId]`.
4. If those fail, repeat print/status/history with the original forward `orderId` and document the exact response.
5. Capture safe response keys and status/error codes.
6. Update this document and `docs/TRY_OTO_RETURN_PLAN.md` with sandbox-confirmed behavior before implementing runtime label retrieval.

