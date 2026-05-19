# Shopify Customer Return Workflow Plan

This document is planning-only. It defines how customer-initiated Shopify return requests should enter the marketplace return workflow. It does not authorize runtime implementation by itself.

Sources reviewed:
- `docs/SHOPIFY_DISCOVERIES.md`
- `docs/TRY_OTO_RETURN_PLAN.md`
- Shopify Admin GraphQL docs, reviewed 2026-05-19:
  - `reverseDeliveryCreateWithShipping`
  - `reverseDeliveryShippingUpdate`
  - `ReverseDelivery`
  - `ReverseFulfillmentOrder`
  - `ReverseDeliveryLineItemInput`
  - `ReverseDeliveryTrackingInput`
  - `ReverseDeliveryLabelInput`
  - `ReverseDeliveryShippingDeliverable`
  - `ReverseDeliveryLabelV2`
  - `ReverseDeliveryTrackingV2`
  - `stagedUploadsCreate`
  - `StagedUploadInput`
  - `StagedUploadTargetGenerateUploadResource.RETURN_LABEL`

Hard boundaries:
- Do not implement runtime code from this document alone.
- Do not automate refunds, payout deductions, or Shopify refund sync from customer return requests.
- Do not send customer emails until return label/barcode retrieval is reliable.
- Do not invent Shopify or Try OTO return behavior. Unknown behavior remains unknown until confirmed by live webhook/API evidence or provider support.

## Business Rules

- Customers can request returns from Shopify/customer-side surfaces.
- Customers never access the vendor/admin operational panel.
- Return eligibility window is based on Shopify order date, not delivery date.
- Return window is 21 days from Shopify order date.
- All products are return-eligible.
- Admin approval is not required before creating a return label for an eligible Shopify customer return request.
- Refund remains manual/operational after inspection. No automatic refund is created at return request or label creation time.
- Eligible customer return requests should eventually auto-create a Try OTO return shipment/barcode/label and email it to the customer.

## 1. Customer Return Entry Points

### Shopify Customer Account Return Request

Primary expected entry point:
- Customer opens a return request from Shopify/customer-side account or self-serve return flow.
- Confirmed Shopify lifecycle topic to support: `RETURNS_REQUEST`.
- Treat raw webhook payload as an event envelope only.
- Use the Shopify return id from the webhook to fetch canonical return details through Admin GraphQL before creating internal operational records.

Known from `SHOPIFY_DISCOVERIES.md`:
- `RETURNS_REQUEST` fires first when a customer starts a self-serve return request.
- Raw payload may include numeric `id`.
- `admin_graphql_api_id` may contain the Return GID.
- Safe canonical rule:
  - prefer `admin_graphql_api_id`
  - otherwise construct `gid://shopify/Return/{id}` from numeric id

### Shopify Admin / Support-Created Return

Possible entry point:
- Admin/support may create a return in Shopify Admin.

Status:
- Unknown whether the same `RETURNS_REQUEST` topic fires for every admin/support-created return flow in the same way as customer self-serve returns.
- Unknown whether support-created returns include the same raw payload fields and GraphQL return line item shape.
- Implementation must treat this as a Shopify-side return request only after the return lifecycle signal and canonical GraphQL fetch are confirmed.

## 2. Shopify Signals To Investigate

### Return Webhook Topics

Confirmed topics to support:
- `RETURNS_REQUEST`
- `RETURNS_APPROVE`
- `RETURNS_DECLINE`
- `RETURNS_CLOSE`

Additional lifecycle topics that may be useful later:
- `RETURNS_CANCEL`
- `RETURNS_REOPEN`
- `RETURNS_UPDATE`
- `RETURNS_PROCESS`

Implementation rule:
- Register return lifecycle topics through GraphQL `webhookSubscriptionCreate`.
- Required app scope: `read_returns`.
- Reinstall the Shopify custom app and refresh the Admin API token after adding `read_returns`.

### Refund Webhook Topics

Known:
- `refunds/create` fires when a money refund is created.
- `refunds/create` is not the customer return request signal.

Rule:
- Do not create finance/refund ledger entries for a return request until an actual refund event or explicit inspection-approved refund workflow occurs.
- Keep return request state and refund state separate.

### Order Updated / Fulfillment Updated Signals

Known:
- `orders/updated` is broad/noisy and should not be a primary operational signal.
- Fulfillment and fulfillment-order signals are for outbound fulfillment state, not return request truth.

Potential use:
- Order/fulfillment data may be useful for eligibility, order date, fulfillment status, and customer contact data.
- Canonical GraphQL/API fetches should be preferred before operational mutations.

### Shopify Admin API Return Objects

Known:
- Return detail should be fetched by GraphQL `return(id: $id)`.
- Return line items can expose:
  - `fulfillmentLineItem.lineItem.id`
  - `fulfillmentLineItem.lineItem.sku`
- `fulfillmentLineItem.lineItem.id` matches the same Shopify LineItem GID used by order line items.
- `reverseFulfillmentOrders` exists as a fallback path if direct return line items are insufficient.

Unknowns:
- Whether every customer return request in production exposes the direct `returnLineItems` inline-fragment path.
- Whether every Shopify return request includes SKU.
- Whether a single Shopify return request can span multiple vendors in normal production usage.

## 3. Eligibility Rules

An incoming Shopify-side return request is eligible for automated return-label creation only when all of these are true:

- The Shopify order exists in our system.
- The Shopify order date is within 21 days.
- The return request comes from Shopify-side return lifecycle events, not from our vendor/admin panel.
- The return line item can be attributed to a vendor allocation.
- The returned SKU maps through the order’s `custom.seller_info` snapshot.
- The requested line item quantity is positive and does not exceed known allocation quantity.
- No duplicate active return shipment exists for the same order, vendor, line item/SKU, and Shopify return id.
- The related forward shipment/provider context is sufficient for Try OTO return creation.
- Try OTO return shipment/barcode/label retrieval is configured and reliable enough for the current automation phase.

Business eligibility:
- All products are return-eligible.
- Admin approval is not required before label creation.

Not eligibility sources:
- Do not use deliveredAt for the return window.
- Do not infer eligibility from refund status.
- Do not infer vendor ownership from raw Shopify return webhook payload alone.

## 4. Proposed Workflow

### `shopify_return_requested`

Trigger:
- Shopify `RETURNS_REQUEST` webhook.

Actions:
- Verify Shopify webhook HMAC.
- Store idempotency/audit envelope.
- Resolve Return GID:
  - prefer `admin_graphql_api_id`
  - fallback to `gid://shopify/Return/{id}`
- Fetch canonical return detail through Shopify GraphQL.

### `eligibility_checked`

Actions:
- Fetch/resolve Shopify order.
- Confirm order exists locally.
- Compare Shopify order date to the 21-day window.
- Extract return line items and Shopify line item IDs/SKUs from canonical return detail.
- Attribute each return line to vendor allocation through `seller_info[sku]` and/or Shopify line item ID.
- Split into vendor-scoped operational return records when a Shopify return includes multiple vendors.
- Detect duplicate active return shipments for the same Shopify return/order/line item/vendor.

Outcomes:
- eligible
- ineligible: outside 21-day window
- blocked: unknown order
- blocked: unresolved vendor attribution
- blocked: duplicate active return shipment
- blocked: missing Try OTO forward shipment context

### `return_label_creation_queued`

Actions:
- Create an internal queued operation for eligible return lines.
- Keep idempotency key based on Shopify return id, Shopify line item id/SKU, vendor id, and quantity.
- Do not create refund, payout deduction, or finance ledger mutation.

### `try_oto_return_label_created`

Actions:
- Use confirmed Try OTO return flow only.
- Store return-specific provider metadata:
  - return order id/reference
  - return tracking/barcode
  - return label PDF URL when present
  - safe response diagnostics
- Do not overwrite forward shipment tracking or label fields.

Current Try OTO status:
- `createReturnShipment` exists in the Postman-backed plan.
- Return shipment creation is confirmed in the Try OTO sandbox panel.
- Return label printing is confirmed from the Try OTO return shipment list.
- Runtime label retrieval currently depends on confirmed response fields or `reverseShipment=true` webhook payloads with `printAWBURL`.
- Exact standalone return print endpoint remains unknown.

### `customer_return_label_email_sent`

Actions:
- Send a customer-facing email only after the return barcode/tracking and/or label link is reliably available.
- Use a transactional email provider or Shopify notification only after ownership of the customer communication channel is decided.
- Do not include vendor/admin panel links.

Status:
- Not implemented in this phase.

### `return_in_transit`

Trigger candidates:
- Try OTO return webhook with `reverseShipment=true`.
- Try OTO return status refresh if later confirmed.
- Shopify reverse delivery tracking if Shopify exposes it after customer/merchant shipping info is entered.

Rule:
- Unknown Try OTO return statuses remain diagnostic-only until mapped from observed values.

### `return_delivered_to_vendor`

Trigger candidates:
- Try OTO return webhook/status for delivered return shipment.
- Vendor/admin manual received action.

Rule:
- Mark only the relevant vendor-scoped return line/case.
- Do not mark other vendors in the same Shopify return as received.

### `return_inspection_pending`

Actions:
- Vendor/admin reviews returned item condition.
- Internal operational status changes only.
- No Shopify refund mutation yet.

### `refund_approved` / `refund_rejected`

Actions:
- Internal vendor/admin inspection decision.
- Rejection requires reason.
- Approval can queue/admin-enable refund operation later.

### `refund_synced_to_shopify`

Actions:
- Shopify refund mutation only after inspection approval and explicit refund workflow exists.
- Must remain idempotent and allocation/line-item scoped.

Status:
- Out of scope for this planning phase.

## 5. Automation Levels

### Phase 1: Ingest Shopify Return Request

Goal:
- Register/ingest `RETURNS_REQUEST`.
- Fetch canonical Shopify return details.
- Create vendor-scoped internal return records.
- Apply 21-day order-date eligibility.
- Record blocked reasons.

No Try OTO label creation yet.
No customer email yet.
No refund automation.

### Phase 2: Auto-Create Try OTO Return Label

Goal:
- For eligible return records, create Try OTO return shipment/barcode/label.
- Idempotently prevent duplicate return labels for the same Shopify return/order/line item/vendor.
- Store return shipment data separately from forward shipment data.

Required before implementation:
- Confirm Shopify return signal and canonical line item extraction in production.
- Confirm Try OTO return label retrieval is reliable enough for customer delivery.

### Phase 3: Auto-Email Customer

Goal:
- Email customer with carrier, barcode/tracking, and label PDF/link.
- Explain refund happens after returned item inspection.

Required before implementation:
- Confirm email provider/channel.
- Confirm customer email source and consent/notification policy.
- Confirm return label URL reliability and expiry behavior.

### Phase 4: Refund Workflow After Inspection

Goal:
- After vendor/admin inspection approval, queue or execute Shopify refund sync.
- Keep rejection path and reason audit.
- Preserve finance/payout correctness.

Required before implementation:
- Confirm refund API line-item mapping.
- Confirm accounting/finance impact rules.
- Confirm duplicate refund prevention.

## 6. Customer Communication

Return label email must include:
- Carrier name.
- Return barcode and/or tracking number.
- Return label PDF link when available.
- Plain instructions for sending the item back.
- A clear statement that refund happens after returned item inspection.

Return label email must not include:
- Vendor/admin panel links.
- Internal diagnostics.
- Internal provider payloads.
- Cross-vendor information.
- Refund approval promises before inspection.

Open channel decision:
- Unknown whether Shopify should send this message or our transactional email provider should send it.
- If Shopify email is used, confirm whether return label URL/tracking can be attached to the Shopify return/customer notification.
- If our email provider is used, confirm sender identity, templates, unsubscribe/legal requirements, and customer email source.

## 6.1 Shopify Return Tracking And Label Upload Plan

This section documents the Shopify-side return tracking and printable label attachment flow. It is planning-only and must not be treated as runtime authorization until tested against the live store/sandbox return object.

### Confirmed Local Observation

Observed behavior:
- Adding only return tracking number and tracking URL to Shopify return data makes the Shopify customer order page show carrier tracking number/link.
- Tracking-only data does not produce a printable return label button on the customer order page.

Operational conclusion:
- Return tracking sync is still required.
- Printable label visibility requires attaching/uploading the return label PDF through Shopify reverse delivery label fields, not only storing carrier tracking.

### Official Shopify API Findings

Official Admin GraphQL findings:
- `ReverseDelivery` represents a buyer sending a package back to a merchant.
- `ReverseDelivery.deliverable` can be a `ReverseDeliveryShippingDeliverable`.
- `ReverseDeliveryShippingDeliverable.tracking` exposes `carrierName`, `number`, and `url`.
- `ReverseDeliveryShippingDeliverable.label` exposes `publicFileUrl`.
- `reverseDeliveryCreateWithShipping` creates a reverse delivery with external shipping information.
- `reverseDeliveryShippingUpdate` updates an existing reverse delivery with external shipping information.
- Both mutations accept:
  - `trackingInput`
  - `labelInput`
  - `notifyCustomer`
- `ReverseDeliveryTrackingInput` supports:
  - `number`
  - `url`
- `ReverseDeliveryLabelInput` supports:
  - `fileUrl`
- `ReverseDeliveryLabelInput.fileUrl` is the URL of the label file. Shopify docs also state that if the label file was uploaded to be attached to the delivery, the temporary staged URL should be provided.
- `stagedUploadsCreate` can generate upload targets.
- `StagedUploadTargetGenerateUploadResource.RETURN_LABEL` represents a label associated with a return and can be used to create a `ReverseDelivery`.

Important constraint:
- `ReverseDeliveryTrackingInput` does not expose a carrier-name input field in the reviewed docs. Carrier name display may be derived by Shopify from tracking data, URL, or supported-carrier behavior. Exact Sürat Kargo carrier-name display behavior remains unknown until tested.

### Tracking-Only Sync Behavior

Required tracking mapping:
- Try OTO return barcode/tracking -> `trackingInput.number`
- Try OTO return tracking URL -> `trackingInput.url`
- Carrier target display -> `Sürat Kargo`, but Shopify reverse delivery tracking input has no explicit carrier-name field in the reviewed docs.

Tracking-only mutation candidates:

If no reverse delivery exists yet:

```graphql
mutation CreateReverseDeliveryWithTracking(
  $reverseFulfillmentOrderId: ID!
  $reverseDeliveryLineItems: [ReverseDeliveryLineItemInput!]!
  $trackingInput: ReverseDeliveryTrackingInput
  $notifyCustomer: Boolean
) {
  reverseDeliveryCreateWithShipping(
    reverseFulfillmentOrderId: $reverseFulfillmentOrderId
    reverseDeliveryLineItems: $reverseDeliveryLineItems
    trackingInput: $trackingInput
    notifyCustomer: $notifyCustomer
  ) {
    reverseDelivery {
      id
    }
    userErrors {
      field
      message
    }
  }
}
```

If a reverse delivery already exists:

```graphql
mutation UpdateReverseDeliveryTracking(
  $reverseDeliveryId: ID!
  $trackingInput: ReverseDeliveryTrackingInput
  $notifyCustomer: Boolean
) {
  reverseDeliveryShippingUpdate(
    reverseDeliveryId: $reverseDeliveryId
    trackingInput: $trackingInput
    notifyCustomer: $notifyCustomer
  ) {
    reverseDelivery {
      id
    }
    userErrors {
      field
      message
    }
  }
}
```

Recommended operational default:
- Use `notifyCustomer: true` only after the customer-facing notification copy and timing are approved.
- Use `notifyCustomer: false` during sandbox/internal validation to avoid accidental customer communication.

### PDF Label Attachment Behavior

Required label mapping:
- Try OTO return label PDF URL -> `labelInput.fileUrl`, if Shopify accepts the external Try OTO PDF URL.
- If Shopify requires uploaded label files or the Try OTO PDF URL is not stable/public enough, download the PDF server-side and use `stagedUploadsCreate` with resource `RETURN_LABEL`, then pass the staged label URL to `labelInput.fileUrl`.

PDF label mutation candidates:

Create reverse delivery with tracking and label together:

```graphql
mutation CreateReverseDeliveryWithTrackingAndLabel(
  $reverseFulfillmentOrderId: ID!
  $reverseDeliveryLineItems: [ReverseDeliveryLineItemInput!]!
  $trackingInput: ReverseDeliveryTrackingInput
  $labelInput: ReverseDeliveryLabelInput
  $notifyCustomer: Boolean
) {
  reverseDeliveryCreateWithShipping(
    reverseFulfillmentOrderId: $reverseFulfillmentOrderId
    reverseDeliveryLineItems: $reverseDeliveryLineItems
    trackingInput: $trackingInput
    labelInput: $labelInput
    notifyCustomer: $notifyCustomer
  ) {
    reverseDelivery {
      id
      deliverable {
        ... on ReverseDeliveryShippingDeliverable {
          label {
            publicFileUrl
          }
          tracking {
            carrierName
            number
            url
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

Update existing reverse delivery with label:

```graphql
mutation UpdateReverseDeliveryLabel(
  $reverseDeliveryId: ID!
  $trackingInput: ReverseDeliveryTrackingInput
  $labelInput: ReverseDeliveryLabelInput
  $notifyCustomer: Boolean
) {
  reverseDeliveryShippingUpdate(
    reverseDeliveryId: $reverseDeliveryId
    trackingInput: $trackingInput
    labelInput: $labelInput
    notifyCustomer: $notifyCustomer
  ) {
    reverseDelivery {
      id
      deliverable {
        ... on ReverseDeliveryShippingDeliverable {
          label {
            publicFileUrl
          }
          tracking {
            carrierName
            number
            url
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

Staged upload fallback plan:
1. Fetch Try OTO return label PDF server-side.
2. Call `stagedUploadsCreate` with:
   - `filename`: a safe generated PDF filename.
   - `mimeType`: `application/pdf`.
   - `resource`: `RETURN_LABEL`.
   - `httpMethod`: use Shopify-provided/default method.
3. Upload the PDF binary to the returned staged target using Shopify-provided URL/parameters.
4. Pass the resulting staged URL/resource URL as `ReverseDeliveryLabelInput.fileUrl`.
5. Create or update the reverse delivery.

Unknowns:
- Whether Shopify accepts the Try OTO external PDF URL directly as `labelInput.fileUrl` for our store.
- Whether staged upload is mandatory for customer-page printable label behavior.
- Exact staged target URL/resource URL field that should be passed into `labelInput.fileUrl` must be verified in sandbox before implementation.
- Whether the customer page shows the printable label immediately after `reverseDeliveryShippingUpdate`, or only after notification/customer-account refresh.

### Required Shopify IDs

Required IDs for create/update:
- Shopify Return GID.
- Reverse fulfillment order ID from `Return.reverseFulfillmentOrders`.
- Reverse fulfillment order line item IDs from `ReverseFulfillmentOrder.lineItems`.
- Quantities to attach to each reverse delivery line item.
- Existing reverse delivery ID, if updating an already-created reverse delivery.

Line-item input:
- `reverseFulfillmentOrderLineItemId`
- `quantity`

When `reverseDeliveryLineItems` is an empty array, official docs say Shopify creates a reverse delivery line item for each reverse fulfillment order line item using total quantity. For vendor-scoped and partial return safety, this platform should prefer explicit line-item IDs and quantities once verified.

### Shopify Query Needed Before Mutation

Candidate canonical query:

```graphql
query GetReturnReverseDeliveryInputs($id: ID!) {
  return(id: $id) {
    id
    reverseFulfillmentOrders(first: 20) {
      nodes {
        id
        status
        lineItems(first: 50) {
          nodes {
            id
            totalQuantity
            fulfillmentLineItem {
              id
              lineItem {
                id
                sku
              }
            }
          }
        }
        reverseDeliveries(first: 20) {
          nodes {
            id
            deliverable {
              ... on ReverseDeliveryShippingDeliverable {
                label {
                  publicFileUrl
                }
                tracking {
                  carrierName
                  number
                  url
                }
              }
            }
          }
        }
      }
    }
  }
}
```

Use this query to decide:
- Create new reverse delivery if no matching reverse delivery exists.
- Update existing reverse delivery if the return already has one.
- Avoid duplicate reverse deliveries for the same return line items.

### Planned Mutation Sequence

Preferred sequence for first implementation:
1. Receive and canonical-fetch Shopify return.
2. Resolve vendor-scoped return line items using Shopify line item IDs/SKUs and local allocation mapping.
3. Create Try OTO return shipment and obtain:
   - return tracking/barcode
   - return tracking URL
   - return label PDF URL
4. Fetch Shopify return reverse fulfillment order data.
5. Determine whether a matching reverse delivery already exists.
6. If no reverse delivery exists:
   - call `reverseDeliveryCreateWithShipping` with explicit reverse fulfillment order line item IDs/quantities, `trackingInput`, and `labelInput`.
7. If a matching reverse delivery exists:
   - call `reverseDeliveryShippingUpdate` with `trackingInput` and `labelInput`.
8. Query the return again and confirm:
   - reverse delivery ID exists.
   - tracking number/url are visible.
   - label `publicFileUrl` is visible.
9. Store Shopify reverse delivery sync diagnostics locally.

Idempotency rules:
- Never create another reverse delivery if the existing reverse delivery already has the same tracking number or matching return line items.
- If tracking exists but label is missing, update the existing reverse delivery rather than creating a new one.
- If label exists but tracking is missing, update tracking on the existing reverse delivery.

### Stop Conditions

Stop before runtime implementation if:
- The Shopify Return GID cannot be resolved.
- Reverse fulfillment order ID cannot be fetched.
- Reverse fulfillment order line item IDs cannot be mapped to local vendor-scoped return lines.
- Try OTO return label PDF URL is missing or unavailable.
- Sandbox cannot confirm whether direct external PDF URL works as `labelInput.fileUrl`.
- Sandbox cannot confirm the staged upload URL/resource URL to pass to `labelInput.fileUrl`.
- Shopify userErrors indicate the mutation cannot attach a label for the tested return state.
- The tested store lacks required `write_returns` scope.

Implementation must not:
- Create refunds.
- Close/process returns.
- Deduct payouts.
- Modify outbound fulfillment state.
- Create duplicate reverse deliveries.
- Notify customers before the notification behavior is approved.

## 7. Risks

### Duplicate Return Labels

Risk:
- Webhook retries or repeated Shopify return updates can create duplicate Try OTO return shipments.

Mitigation:
- Idempotency key per Shopify return id + Shopify line item id/SKU + vendor id + quantity.
- Check active return shipment before creating a new label.

### Label Cost Immediately After Return Request

Risk:
- Auto-creating labels immediately may incur provider/carrier costs for every eligible request.

Mitigation:
- Phase 1 should be ingest-only.
- Phase 2 should include metrics/diagnostics for created label count and provider cost exposure.

### Customer Abuse / Fraud

Risk:
- All products are eligible and no admin approval is required before label creation.

Mitigation:
- Enforce 21-day order-date window.
- Prevent duplicate active return labels.
- Keep refund manual after inspection.
- Add operational attention for repeated returns later if needed.

### Partial Returns

Risk:
- Shopify return requests may include partial quantities and multiple SKUs.

Mitigation:
- Store return records at line-item/vendor scope.
- Do not treat an order-level return as a single-vendor return unless canonical line item mapping proves it.

### Shopify Return Object Uncertainty

Risk:
- Raw webhook payload may not include enough line-item data.
- GraphQL path may vary by return workflow.

Mitigation:
- Always canonical-fetch the Shopify Return.
- Keep diagnostics for which GraphQL extraction path worked.
- Stop automation if line items or vendor attribution cannot be resolved.

### Try OTO Label Async Timing

Risk:
- Try OTO may create return shipment/barcode before label PDF is immediately available.

Mitigation:
- Do not email until barcode/label retrieval is reliable.
- Accept label fields from `createReturnShipment` response when present.
- Accept `reverseShipment=true` webhook `printAWBURL` when present.
- Do not guess standalone print endpoint until confirmed.

### Shopify Label Attachment Uncertainty

Risk:
- Tracking can be visible while printable label remains unavailable unless `labelInput.fileUrl` is attached through Shopify reverse delivery APIs.

Mitigation:
- Treat tracking sync and label attachment as separate confirmation points.
- Verify direct Try OTO PDF URL attachment first in sandbox.
- If direct URL fails or does not produce customer printable label behavior, use `stagedUploadsCreate` with `RETURN_LABEL`.
- Query `ReverseDeliveryShippingDeliverable.label.publicFileUrl` after mutation before marking Shopify label upload confirmed.

## 8. Questions For Shopify / Implementation

1. Which webhook fires when a customer requests a return in the active Shopify customer-account flow?
2. Does admin/support-created return creation fire the same lifecycle topic as customer self-serve return requests?
3. What is the canonical Shopify return object/id in every return lifecycle webhook payload?
4. Are `id` and `admin_graphql_api_id` always present in return lifecycle webhook payloads?
5. How are returned line items represented for every return workflow in this store/API version?
6. Is `returnLineItems[].fulfillmentLineItem.lineItem.sku` always populated?
7. When should `reverseFulfillmentOrders` be used as fallback for line item extraction?
8. Can one Shopify return request include items from multiple vendors?
9. Can a return label URL, barcode, or tracking number be attached to the Shopify return/customer notification?
10. Should return-label email be sent by Shopify or by our transactional email provider?
11. How should return shipment tracking be represented in Shopify before refund?
12. Does Shopify expose customer-entered reverse delivery tracking for every return flow?
13. Which return lifecycle event represents customer cancellation of a return request?
14. Are `RETURNS_APPROVE`, `RETURNS_DECLINE`, and `RETURNS_CLOSE` useful when admin approval is not required before label creation?
15. What Shopify state should be written, if any, when a Try OTO return label is created externally?
16. Does `reverseDeliveryCreateWithShipping` with `labelInput.fileUrl` make the customer order page show a printable return label button for this store?
17. Can `labelInput.fileUrl` point directly to a Try OTO PDF URL, or must the PDF be uploaded with `stagedUploadsCreate` using `RETURN_LABEL`?
18. If staged upload is required, should `ReverseDeliveryLabelInput.fileUrl` receive the staged target `resourceUrl`, upload URL, or another returned URL field?
19. Does `reverseDeliveryShippingUpdate` notify the customer with printable label instructions when `notifyCustomer: true`?
20. How does Shopify derive/display `carrierName` for reverse delivery tracking when `ReverseDeliveryTrackingInput` only accepts `number` and `url`?
21. Should we create a reverse delivery when Shopify already created one during the customer return request, or only update the existing reverse delivery?

## 9. Stop Conditions

Stop before auto-creating labels if:
- `RETURNS_REQUEST` or equivalent Shopify return request signal is not confirmed in the live store.
- Canonical Shopify Return GraphQL fetch is not confirmed for the incoming return id.
- Returned line item SKU/line item id cannot be resolved.
- Vendor attribution cannot be resolved from Shopify order mapping.
- Duplicate active return shipment detection is not in place.
- Try OTO return flow cannot reliably create a return shipment/barcode.

Stop before auto-emailing customers if:
- Return label URL/barcode retrieval is not reliable.
- Try OTO return label URL expiry/access behavior is unknown.
- Email channel ownership is not decided.
- Customer email template/legal requirements are not approved.

Stop before auto-refunding if:
- Inspection workflow is not complete.
- Refund approval/rejection state is not finalized.
- Shopify refund mutation payload and idempotency are not confirmed.
- Finance/payout impact rules are not approved.

## Implementation Guardrails

- Preserve vendor isolation and allocation-level scoping.
- Treat Shopify webhooks as triggers/envelopes.
- Prefer canonical Shopify GraphQL return details before local mutations.
- Do not rely on raw webhook payload for vendor attribution.
- Do not create refunds from return requests.
- Do not deduct payouts from return requests.
- Do not expose provider diagnostics or vendor/admin panel links to customers.
- Unknown statuses and payload fields must go to diagnostics, not business logic.
