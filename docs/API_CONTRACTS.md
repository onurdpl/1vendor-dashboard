# API Contracts

This document describes the backend contract expected by the current frontend.
The frontend currently uses mock transport in local/demo mode, but the same route and data shapes are intended for a real backend later.

## Authentication and Session Assumptions

- The frontend sends an `Authorization: Bearer <token>` header when a session token exists.
- The backend is responsible for validating the token.
- The frontend also sends `X-Vendor-Id` as a contextual hint for the current selected vendor.
- The backend must not trust `X-Vendor-Id` blindly.
- The backend must derive the allowed vendor scope from the authenticated user/session.
- If the authenticated session is invalid or missing, the backend must return `401 Unauthorized`.

## Vendor Scoping Rules

- Vendor access is a backend enforcement concern.
- Vendor users must only read data for their own vendor.
- Admin users may access vendors they are allowed to access.
- Cross-vendor access must not leak data.
- If a resource belongs to another vendor, the backend should return `403 Forbidden` or `404 Not Found` consistently across the API.
- The frontend treats cross-vendor access as unavailable data, not as a different UI flow.
- Allocation records include:
  - `originalVendorId`: mapped from Shopify variant/product metafield.
  - `assignedVendorId`: operational owner responsible for fulfillment/shipping.
- Assigned vendor owns fulfillment responsibility and can report allocation blocking issues.
- Current compatibility field `vendorId` aliases `assignedVendorId`.

## Role and Permission Rules

- The frontend already models roles and permissions for:
  - `admin`
  - `vendor`
  - `support`
  - `finance`
- The backend should use its own authorization source of truth, but it must align with the frontend’s route and action expectations.
- Route-level access is currently expected for read-only pages.
- Action-level permissions are expected for write operations and operational actions.
- The backend must apply permission checks server-side even if the frontend hides or disables actions.

## Error Conventions

- `401 Unauthorized`
  - Session missing, expired, or invalid.
  - The frontend treats this as a logout/session reset case.

- `403 Forbidden`
  - Authenticated user does not have permission for the requested operation or vendor scope.

- `404 Not Found`
  - Resource does not exist, or the backend intentionally hides cross-vendor resources behind not-found semantics.

- `5xx` or network failures
  - Unexpected server failures or infrastructure issues.

## Implied Endpoints

The current frontend directly or indirectly expects the following read endpoints:

- `GET /orders`
- `GET /orders/:orderId`
- `GET /admin/orders/:shopifyOrderId` (admin operational view)
- `GET /returns`
- `GET /returns/:returnId`
- `GET /finance`
- `GET /automation`

No write endpoints are currently wired in the frontend, but future write actions are expected to follow the same auth, vendor, and permission rules.

Backend-only integration skeleton endpoints also exist for future Shopify ingestion:

- `POST /webhooks/shopify/orders-create`
- `POST /webhooks/shopify/orders-paid`
- `POST /webhooks/shopify/orders-cancelled`
- `POST /webhooks/shopify/refunds-create`
- `POST /webhooks/shopify/returns-request` (pending-return ingestion path)
- `POST /webhooks/shopify/returns-approve` (lifecycle status update)
- `POST /webhooks/shopify/returns-decline` (lifecycle status update)
- `POST /webhooks/shopify/returns-close` (lifecycle status update)
- `POST /webhooks/shopify/returns-cancel` (lifecycle status update)
- `POST /webhooks/shopify/fulfillments-create` (inbound fulfillment sync)
- `POST /webhooks/shopify/fulfillments-update` (inbound fulfillment sync)
- `POST /webhooks/shopify/fulfillment-events-create` (inbound delivery/event sync)
- `POST /webhooks/shopify/fulfillment-orders-cancelled` (inbound fulfillment cancellation sync)
- `POST /fulfillments/:allocationId/tracking`

Webhook processing lifecycle states:
- `RECEIVED`: webhook envelope persisted.
- `PROCESSING`: ingestion/recovery execution started.
- `PROCESSED`: ingestion completed successfully.
- `FAILED`: ingestion failed with explicit `errorMessage`.

## Endpoint Contracts

### GET /orders

- Purpose: return the current vendor’s order list.
- Required auth: yes.
- Vendor scoping rule: only orders for the authenticated user’s allowed vendor scope may be returned.
- Expected success response shape: `OrderSummary[]`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the session is authenticated but not permitted for the vendor scope or route.
- Expected `404` behavior: not typically used for collection requests, unless the backend intentionally obscures access.
- Order records are vendor-scoped views of Shopify source orders and must include a vendor-safe internal order id.
- Fulfillment and shipping fields are vendor-scoped too; vendor allocations may have different fulfillment states for the same Shopify order.
- Backend implementation note: route is protected by auth + vendor access middleware, and scoped by backend-resolved vendor context (`request.vendorContext.vendorId`).

### GET /orders/:orderId

- Purpose: return a single order detail record.
- Required auth: yes.
- Vendor scoping rule: only return the order if it belongs to an allowed vendor.
- Expected success response shape: `OrderDetail`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access the vendor scope.
- Expected `404` behavior: return `404 Not Found` when the order does not exist or when the backend hides cross-vendor resources.
- Backend implementation note: in current vendor-scoped query semantics, cross-vendor order ids resolve to `404` after vendor context is validated.
- Detail records should expose `sourceShopifyOrderId`, `sourceShopifyOrderNumber`, `vendorId`, and vendor-allocated `lineItems` so the frontend can show the current vendor slice only.
- Detail records should also expose vendor-scoped fulfillment/shipping metadata such as `fulfillmentStatus`, `shippingStatus`, `trackingNumber`, `carrier`, and `estimatedDelivery` when available.
- Fulfillment actions belong to the assigned vendor only. Suggested action state fields include `fulfillmentActionState`, `fulfillmentActionAvailable`, `shipmentCreatedAt`, `shipmentUpdatedAt`, `fulfilledAt`, and `fulfilledByVendorId`.
- In the assigned-vendor model, vendor-facing order endpoints should scope by `assignedVendorId`.
- Allocation workflow fields include `allocationStatus`, `cancellationReason`, `reassignmentRequired`, and optional `assignmentBlockedAt`.
- Allocation records should include `assignmentHistory` for auditability (`assigned`, `vendor_blocked`, `reassignment_requested`, `reassigned`).
- Vendor-reported blocking reasons may include `out_of_stock`, `vendor_cancelled`, `damaged_inventory`, or `fulfillment_issue`.
- Blocked allocations (`vendor_blocked`, `pending_reassignment`) must not allow fulfillment execution until reassignment or recovery.

### GET /admin/orders/:shopifyOrderId

- Purpose: return a full operational Shopify order breakdown across vendor allocations.
- Required auth: yes.
- Vendor scoping rule: admin-only access; vendor users must not receive cross-vendor allocation graphs.
- Expected success response shape: `ShopifyOrderBreakdown`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` for authenticated non-admin users.
- Expected `404` behavior: return `404 Not Found` when the Shopify order does not exist.
- Response should include:
  - source Shopify order metadata
  - all vendor allocations for that source order
  - per-allocation fulfillment/shipping status
  - reassignment workflow fields (`reassignmentRequired`, candidate vendors, notes, and audit fields when present)
  - assignment history entries with actor, role, reason, and timestamps
  - per-allocation tracking metadata
  - per-allocation refunded items and totals when present
- Backend implementation note: route is auth-protected and admin-only; authenticated vendor users receive `403`.
- Missing Shopify orders return `404`.

### GET /admin/operations

- Purpose: return admin operations queue items aggregated from allocations, fulfillment, and return/refund state.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape: `{ summary, items }`.
- Pagination: supports `limit` and `offset`; consumers must not treat one returned page as the complete queue when summary/count values exceed the returned `items.length`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` for authenticated non-admin users.
- Expected `404` behavior: not used for this route.
- Queue item semantics:
  - `pending_reassignment`: allocation requires reassignment (`reassignmentRequired` or pending reassignment status)
  - `vendor_blocked`: allocation blocked by vendor state
  - `awaiting_shipment`: allocation in shipping wait state
  - `refund_attention`: return/refund records requiring review
- Count semantics: queue and summary counts are generated attention rows and are not guaranteed to be unique business incidents.
- Vendor Blocked full-list UI behavior: the Operations Control Center may page through this route and filter only the currently fetched page. No server-side `vendor_blocked` search/filter contract exists for this route.

### GET /admin/operations/attention

- Purpose: return the admin Operations Control Center attention projection.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape: `OperationsAttentionDashboard`.
- Dashboard section semantics:
  - `sections[].items` are capped preview rows; `sections[].count` is the generated active row count for the section.
  - Recommendations and vendor risk rows are preview summaries, not exhaustive inventories.
  - `recentActivity` is projected operational activity, not an immutable audit history.
- Count semantics: dashboard summary and section counts are generated attention rows and are not guaranteed to be unique business incidents.

### GET /admin/diagnostics/webhooks

- Purpose: return admin-only webhook receipt and ingestion visibility for operational debugging.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape: `{ summary, events }`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` for authenticated non-admin users.
- Response semantics:
  - `summary.total`: total persisted webhook envelopes
  - `summary.received`: events still in received state
  - `summary.processed`: events successfully processed
  - `summary.failed`: events that failed verification-side or ingestion-side processing
  - `summary.duplicates`: currently `0` in persisted diagnostics because duplicate deliveries are ignored before a second event row is created
  - `summary.needsAttention`: failed or operationally blocked events that need admin review
- Event fields include:
  - `id`
  - `topic`
  - `shopDomain`
  - `shopifyWebhookId`
  - `eventId` (same Shopify webhook delivery id when available)
  - `idempotencyKey`
  - `payloadHash`
  - `status`
  - `processingStatus`
  - `receivedAt`
  - `processedAt`
  - `errorMessage`
  - `lastErrorSummary`
  - `duplicate`
  - `payloadAvailable`
  - `replayEligible` / `replayBlockedReason`
  - `recoverEligible` / `recoverBlockedReason`
  - `recommendedAction`
  - `affectedEntities` with safe hints for Shopify order, return, refund, fulfillment, and vendor when inferable

### GET /admin/diagnostics/webhooks/:webhookEventId

- Purpose: return safe persisted diagnostics metadata for one webhook event.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape: webhook event metadata plus `payloadHash`, `status`, `errorMessage`, timestamps, replay/recover eligibility, recommended action, safe affected entity hints, and `relatedShopifyOrderId` when inferable.
- Expected `404` behavior: return `404 Not Found` when the webhook event does not exist.
- Raw payload note:
  - newer webhook events persist `rawPayload` for replay support
  - diagnostics detail does not return full raw payload by default
  - detail may return a truncated `payloadPreview` for operator context
  - response includes `payloadAvailable` so admin tooling can fail clearly before replay
  - secrets and webhook signing material are never returned

### GET /admin/diagnostics/orders/:orderNumber/state

- Purpose: power the permanent DIAG-ORDER-1 Admin Order State Inspector with one read-only, explicit-order lifecycle view.
- Product position: Tier-1 Operational Tool and the first-stop source for production order incident investigation.
- Required auth: yes; admin-only. Authenticated vendor, support, and finance roles receive `403 Forbidden`.
- Accepted identifier: repository-supported order number or identifier, including `1108` and `#1108`.
- Expected `404` behavior: `{ "message": "Order not found." }` when no local `ShopifyOrder` matches.
- Response sections:
  - safe order identity and persisted local Shopify state
  - vendor allocations and order-state shipping eligibility
  - source-specific Shopify return requests, refund-derived return evidence, and refund records
  - order/allocation-scoped finance ledgers, settlement/payout/paid evidence, and FinanceEvents
  - sanitized operational signals, chronological webhook history, and safe executed current-state repair history
  - deterministic frontend projection reasons, current-state summary, and read-only repair readiness
- Safety rules:
  - no live Shopify or shipping-provider call
  - no mutation, repair, replay, or reconciliation execution
  - no raw webhook payload, request/response snapshot, HMAC material, token, provider credential, bank/payment reference, customer PII, or full address
  - webhook history, repair history, operational signals, and finance events have fixed maximum result limits
- Inspection remains read-only. When this route returns `404 Order not found`, the admin Recovery Center may offer the separate current-state repair workflow for that same explicit identifier.

### POST /admin/diagnostics/shopify/order-repair

- Purpose: reconstruct exactly one missed Shopify order from current canonical Shopify state without replaying a historical webhook payload.
- Required auth: yes; admin-only. Authenticated vendor, support, and finance roles receive `403 Forbidden`.
- Request body:
  - `orderIdentifier`: required single numeric Shopify order ID or `#` order number
  - `execute`: optional boolean; omission or `false` is dry-run, and only `true` permits mutation
- The Recovery Center `Order number` field accepts `1105` or `#1105` and sends the canonical order-name form `#1105`. Numeric Shopify legacy IDs remain available through the backend/API contract and are not mixed into this operator field.
- Bulk/range/date input is unsupported.
- Dry-run response includes `repairSource`, `repairTimestamp`, `dryRun: true`, `executed: false`, and a safe planned summary. Dry-run performs no database or audit write.
- Recovery Center operator flow: inspect one order, run dry-run, review canonical identity/local state/planned mutations/warnings, then use a separate explicit confirmation before sending `execute: true`.
- Execute behavior:
  - fetch canonical order, refund, and return snapshots before mutation
  - validate seller/SKU/vendor/finance-profile mapping and snapshot completeness
  - create missing local order, line items, allocations, and sale ledgers directly from canonical current state
  - apply existing refund, return, and canonical full-order cancellation lifecycles in one transaction
  - write a safe reconciliation job and operational signal; no raw Shopify payload is retained
  - roll back commerce and finance repair records if any step fails
- The response summary reports `ShopifyOrder`, allocation, and finance as `Created` or `Existing`, plus cancellation/refund/return application, warnings, and skipped state.
- Expected errors:
  - `400 invalid_order_identifier` for missing, malformed, range, or bulk-like input
  - `404 shopify_order_not_found` when Shopify has no exact order
  - `409 repair_preflight_failed` for unsafe/incomplete mapping or unsupported current state
  - `409 repair_transaction_failed` when execution rolls back
  - `502`/`503` for unavailable or incomplete Shopify Admin current-state evidence

### GET /admin/diagnostics/sync-events

- Purpose: return a consolidated admin-only diagnostics feed across webhook ingestion and fulfillment sync state.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape: `{ items }`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` for authenticated non-admin users.
- Item shape includes:
  - `id`
  - `type`
  - `severity`
  - `title`
  - `description`
  - `relatedWebhookEventId`
  - `relatedShopifyOrderId`
  - `relatedAllocationId`
  - `status`
  - `createdAt`
- Current item sources:
  - failed webhook ingestion events
  - seller-info / SKU / vendor resolution failures surfaced through webhook errors
  - fulfillment sync failures
- Duplicate delivery note:
  - duplicate deliveries are accepted with `202 duplicate_ignored`
  - duplicates are not currently stored as separate webhook-event rows
  - duplicate visibility in this phase is response-level and idempotency-key-level, not a separate diagnostics item

### GET /admin/diagnostics/reconciliation

- Purpose: return an admin-only reconciliation view for stuck or failed operational sync state.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape: `{ summary, items }`.
- Summary includes:
  - `stuckReceived`
  - `failedWebhooks`
  - `fulfillmentSyncFailures`
  - `missingPayload`
  - `staleAllocations`
  - `total`
- Item shape includes:
  - `id`
  - `type`
  - `severity`
  - `title`
  - `description`
  - `relatedWebhookEventId`
  - `relatedShopifyOrderId`
  - `relatedAllocationId`
  - `status`
  - `createdAt`
  - `suggestedAction`
  - `payloadAvailable`
- Current stale allocation signals are visibility-only heuristics. They may point operators to the admin reconciliation endpoints, but they do not perform background repair.

### POST /admin/reconciliation/orders/:allocationId

- Purpose: re-fetch canonical Shopify fulfillment state for the allocation's Shopify order and reconcile one allocation.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape:
  - `reconciliationStatus`: `in_sync`, `repaired`, or `needs_attention`
  - `staleFields`
  - `repairedFields`
  - `skippedFields`
  - `canonicalShopifySummary`
  - `localStateSummary`
  - `affectedAllocations`
  - `affectedVendorIds`
  - `warnings`
  - `requiresManualReview`
- Expected `403` behavior: vendor users are forbidden.
- Expected `404` behavior: allocation is missing or lacks Shopify order linkage.
- Repair-safe fields:
  - allocation `fulfillmentStatus`
  - allocation `shippingStatus`
  - allocation tracking number/carrier
  - fulfillment tracking URL
  - fulfillment timestamps
  - fulfillment sync status
  - local refund/return operational status when an existing processed record is stale
  - missing finance ledger entry for an already persisted processed refund
- Guardrails:
  - does not mutate Shopify
  - does not delete historical financial records
  - does not overwrite manual notes
  - does not alter raw webhook history
  - only updates the requested allocation and its existing operational records

### POST /admin/reconciliation/shopify-order/:shopifyOrderId

- Purpose: re-fetch canonical Shopify fulfillment state and reconcile all local allocations for one ingested Shopify order.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Expected success response shape: same as allocation reconciliation.
- Expected `404` behavior: local Shopify order is not found.
- Multi-vendor rule:
  - repairs are line-item scoped by Shopify line item id
  - unrelated vendor allocations must not inherit tracking, fulfillment, or cancellation state

### POST /admin/diagnostics/webhooks/:webhookEventId/replay

- Purpose: explicitly replay one failed, retained immutable webhook event from its stored payload.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Safe replay topic/state:
  - topic `refunds/create`
  - source state `FAILED`
  - retained raw payload and payload hash
- Expected `202` behavior:
  - returns an explicit result with `action`, `topic`, `webhookEventId`, `beforeStatus`, `afterStatus`, `replayStatus`, `processingStatus`, optional affected counts, and safe `errorSummary`
  - does not silently succeed
- Expected `404` behavior:
  - webhook event not found
- Expected `409` behavior:
  - returns `{ ok: false, replayStatus: "not_replayable", skippedReason, ... }`
  - payload unavailable
  - payload hash unavailable
  - unsupported topic
  - any state other than `FAILED`
- Replay note:
  - replay uses stored payload content only
  - replay does not replace the historical payload with current Shopify state
  - for `refunds/create`, replay fetches canonical Admin GraphQL monetary evidence and runs the shared classifier before the retained payload may reach refund ingestion
  - zero-value void evidence is processed as a non-financial skip; blocked/unavailable evidence remains needs-attention
  - processed `orders/create`, processed `orders/cancelled`, and stateful order/fulfillment payloads are not safe replay candidates
  - older persisted webhook events may not have replayable payloads because raw payload retention was added later

### POST /admin/diagnostics/webhooks/:webhookEventId/recover

- Purpose: recover stuck (`RECEIVED`) or failed (`FAILED`) webhook events using stored payloads without introducing queue workers.
- Required auth: yes.
- Vendor scoping rule: admin-only route; vendor users must not access this endpoint.
- Allowed source states:
  - `RECEIVED`
  - `FAILED`
- Protected states:
  - `PROCESSED` returns `409` (not recoverable)
- Expected `202` behavior:
  - returns `{ ok: true, recoveryStatus, action, topic, webhookEventId, beforeStatus, afterStatus, processingStatus, ... }`
  - `recoveryStatus` is one of:
    - `recovered`
    - `failed`
    - `not_recoverable`
- Expected `409` behavior:
  - returns `{ ok: false, recoveryStatus: "not_recoverable", skippedReason, ... }`
  - payload missing
  - payload hash missing
  - unsupported topic
  - already processed event
- Recovery note:
  - recover marks the event `PROCESSING` before executing ingestion path
  - recover reuses idempotent ingestion/upsert behavior
  - recover resumes processing from the retained webhook payload
  - for `refunds/create`, recover fetches canonical Admin GraphQL monetary evidence before the retained payload may create refund finance
  - recover does not add background workers in this phase

### POST /webhooks/shopify/orders-create

- Purpose: receive verified Shopify `orders/create` webhook payloads and ingest vendor allocations when seller info can be resolved.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", shopifyOrderId, allocationCount }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored" }`
  - needs attention: `{ ok: true, duplicate: false, action: "received_needs_attention", processingStatus: "needs_attention", message }`
- Expected `202` behavior: valid HMAC signature accepted whether processing succeeds immediately, is ignored as duplicate, or is parked in needs-attention state.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Duplicate webhook response semantics:
  - first verified delivery -> `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed" }`
  - repeated verified delivery -> `{ ok: true, duplicate: true, action: "duplicate_ignored" }`
- Processing note:
  - this phase verifies, de-duplicates, fetches `custom.seller_info`, and creates order allocations
  - seller info fetch uses the documented Shopify Admin metafield query
  - unresolved SKU or vendor mapping should return needs-attention semantics instead of silent fallback
  - future webhook events persist raw payloads for explicit admin replay and reconciliation
- refund ingestion, fulfillment mutation, and queue-based async processing are deferred to later phases

### POST /webhooks/shopify/orders-paid

- Purpose: receive verified Shopify `orders/paid` webhook payloads and sync narrow payment snapshot fields on an existing Shopify order.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - processed: `{ ok: true, duplicate: false, action: "paid_snapshot_synced", processingStatus: "processed", shopifyOrderId, orderMatched, snapshotUpdated, changedFields }`
  - ignored unknown order: `{ ok: true, duplicate: false, action: "paid_snapshot_ignored", processingStatus: "processed", orderMatched: false }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored" }`
- Expected `202` behavior: valid HMAC signature accepted whether processing updates an existing order, safely ignores an unknown order, or is ignored as duplicate.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Processing note:
  - updates only `financialStatus` and safe `paymentGatewayName` snapshot data when present
  - does not create orders, allocations, line items, refunds, returns, fulfillment state, finance ledgers, settlement state, or payout state
  - `orders/updated` remains limited to contact/address snapshot updates unless `cancelled_at` is present as the full-order cancellation fallback

### POST /webhooks/shopify/orders-cancelled

- Purpose: receive verified Shopify `orders/cancelled` webhook envelopes and bridge full-order cancellation into canonical cancellation reconciliation.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - processed: `{ ok: true, duplicate: false, action: "canonical_cancellation_reconciled", processingStatus: "processed", shopifyOrderId, cancellationProcessed, cancellationState }`
  - ignored when canonical cancellation is absent: `{ ok: true, duplicate: false, action: "canonical_cancellation_ignored", processingStatus: "processed", cancellationProcessed: false, reason: "canonical_cancelled_at_missing" }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored" }`
  - needs attention: `{ ok: true, duplicate: false, action: "received_needs_attention", processingStatus: "needs_attention", message }`
- Expected `202` behavior: valid HMAC signature accepted whether reconciliation runs, canonical cancellation is absent, processing needs attention, or the delivery is duplicate.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Processing note:
  - `orders/cancelled` is the primary full-order cancellation webhook
  - webhook payload is treated as trigger/envelope
  - backend fetches canonical Shopify order state before local reconciliation
  - `cancelled_at` / canonical `cancelledAt` is required before full-order cancellation reconciliation runs
  - `financial_status=voided` alone is not sufficient
  - canonical full-order cancellation metadata is persisted on `ShopifyOrder.cancelledAt` and `ShopifyOrder.cancelReason`
  - `ShopifyOrder.cancelledAt` is authoritative for backend operational and finance eligibility; allocation cancellation metadata is not required
  - persisted allocation, fulfillment, and shipping values may preserve ownership/history while the API derives terminal cancellation behavior
  - vendor/admin order projections expose terminal cancellation fields such as `isCancelled`, `cancelledAt`, and `cancelReason`
  - Vendor Integration order reads expose cancellation metadata, `operationalWritesAllowed`, terminal not-required values for simple cancellations, and preserved operational history for conflict cancellations
  - full-cancelled orders remain historically visible, but are terminal for fulfillment, shipment, tracking, reject/split, and Vendor Integration writes
  - full-cancelled orders are excluded from shipment/tracking/workload queues and dashboard counts
  - settlement selection, payout preparation/review, and Mark Paid revalidation block new progression for cancelled conflict rows even when a sale ledger was not voided
  - no `AllocationStatus.CANCELLED` is introduced and persisted shipping/fulfillment history is not overwritten
  - SHOP-CANCEL-2A does not add missed-order repair, vendor debt, payment reversal, or fulfillment-cancellation redesign

### POST /webhooks/shopify/refunds-create

- Purpose: receive verified Shopify `refunds/create` webhook payloads and create vendor-scoped refund allocations from the original order mapping snapshot.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", shopifyOrderId, refundAllocationCount }`
  - zero-value void skipped: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", shopifyOrderId, refundAllocationCount: 0, refundClassification: "ZERO_VALUE_VOID", reasonCode: "zero_value_void_not_monetary_refund" }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored" }`
  - needs attention: `{ ok: true, duplicate: false, action: "received_needs_attention", processingStatus: "needs_attention", message }`
- Expected `202` behavior: valid HMAC signature accepted whether refund processing succeeds immediately, is ignored as duplicate, or is parked in needs-attention state.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Processing note:
  - the raw webhook is an envelope for refund identity and line-item mapping; it is not sufficient monetary evidence
  - backend fetches canonical Admin GraphQL order/refund totals and transactions before monetary refund ingestion
  - only verified unique positive `REFUND / SUCCESS` shop-money transactions may reach existing refund ingestion
  - `ZERO_VALUE_VOID` creates no refund-derived commerce or finance evidence
  - non-final, ambiguous, incomplete, amount-mismatched, or currency-mismatched evidence remains needs-attention with deterministic safe reason codes
  - refund mapping uses the original persisted order allocation snapshot
  - primary vendor lookup path is `refund_line_items[].line_item.sku`
  - no silent fallback allocation is allowed for missing SKU or unresolved vendor mapping
- duplicate refund delivery is ignored through the existing webhook idempotency layer
- future webhook events persist raw payloads for explicit admin replay and reconciliation

Sanitized repair/reconciliation diagnostics may expose `classification`, exact decimal `monetaryRefundAmount`, `currency`, transaction counts, aggregate amounts/mismatch flags, pagination completeness, `reasonCode`, and sanitized warnings. They never expose transaction IDs, gateways, authorization/payment identifiers, raw Shopify payment payloads, or customer data.

### POST /webhooks/shopify/returns-request

- Purpose: receive verified Shopify `RETURNS_REQUEST` lifecycle webhook envelopes.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - first delivery processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", topic: "returns/request", shopifyReturnGid, affectedRecordCount }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored", topic: "returns/request" }`
- Expected `202` behavior: verified payload is accepted, idempotency-checked, and ingested into vendor-scoped pending return records when mapping succeeds.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Expected needs-attention response:
  - `{ ok: true, duplicate: false, action: "received_needs_attention", processingStatus: "needs_attention", message }`
- Operational note:
  - verification uses raw request bytes
  - route can use `SHOPIFY_RETURN_WEBHOOK_SECRET` when return lifecycle webhooks are signed by a different Shopify app secret

### POST /webhooks/shopify/returns-approve

- Purpose: receive verified Shopify `RETURNS_APPROVE` lifecycle webhook envelopes.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - first delivery processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", topic: "returns/approve", shopifyReturnGid, affectedRecordCount }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored", topic: "returns/approve" }`
- Expected `202` behavior: verified payload updates existing vendor-scoped pending return records to lifecycle status `approved`.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Operational note:
  - verification uses raw request bytes
  - route can use `SHOPIFY_RETURN_WEBHOOK_SECRET` when return lifecycle webhooks are signed by a different Shopify app secret

### POST /webhooks/shopify/returns-decline

- Purpose: receive verified Shopify `RETURNS_DECLINE` lifecycle webhook envelopes.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - first delivery processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", topic: "returns/decline", shopifyReturnGid, affectedRecordCount }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored", topic: "returns/decline" }`
- Expected `202` behavior: verified payload updates existing vendor-scoped pending return records to lifecycle status `declined`.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Operational note:
  - verification uses raw request bytes
  - route can use `SHOPIFY_RETURN_WEBHOOK_SECRET` when return lifecycle webhooks are signed by a different Shopify app secret

### POST /webhooks/shopify/returns-close

- Purpose: receive verified Shopify `RETURNS_CLOSE` lifecycle webhook envelopes.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - first delivery processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", topic: "returns/close", shopifyReturnGid, affectedRecordCount }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored", topic: "returns/close" }`
- Expected `202` behavior: verified payload updates existing vendor-scoped pending return records to lifecycle status `closed`.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Operational note:
  - verification uses raw request bytes
  - route can use `SHOPIFY_RETURN_WEBHOOK_SECRET` when return lifecycle webhooks are signed by a different Shopify app secret

### POST /webhooks/shopify/returns-cancel

- Purpose: receive verified Shopify `RETURNS_CANCEL` lifecycle webhook envelopes and mark existing pending return records as cancelled.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - first delivery processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", topic: "returns/cancel", shopifyReturnGid, affectedRecordCount }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored", topic: "returns/cancel" }`
- Expected `202` behavior: verified payload updates existing vendor-scoped pending return records to lifecycle status `cancelled`.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.

### POST /webhooks/shopify/fulfillments-create

- Purpose: receive verified Shopify `FULFILLMENTS_CREATE` webhook envelopes and sync canonical Shopify fulfillment state into vendor allocations.
- Required auth: none; verification is via Shopify HMAC signature.
- Expected success response shape:
  - processed: `{ ok: true, duplicate: false, action: "accepted", processingStatus: "processed", topic: "fulfillments/create", shopifyOrderId, affectedAllocationCount }`
  - duplicate: `{ ok: true, duplicate: true, action: "duplicate_ignored", topic: "fulfillments/create" }`
  - needs attention: `{ ok: true, duplicate: false, action: "received_needs_attention", processingStatus: "needs_attention", message }`
- Expected `202` behavior: valid HMAC signature accepted whether processing succeeds, is ignored as duplicate, or is parked in needs-attention state.
- Expected `401` behavior: invalid or missing Shopify HMAC signature.
- Sync semantics:
  - webhook payload is treated as a trigger/envelope
  - backend fetches canonical order fulfillment state through Shopify Admin GraphQL
  - allocations are updated only when their exact Shopify line item ids appear in fulfilled line items
  - tracking fields are persisted only when Shopify provides `trackingInfo`
  - fulfillment timestamps are persisted from canonical Shopify fulfillment data:
    - `fulfilledAt` from fulfillment `createdAt`
    - `shipmentCreatedAt` from fulfillment `createdAt`
    - `shipmentUpdatedAt` from the latest available canonical fulfillment timestamp, comparing fulfillment `updatedAt` and latest fulfillment event `happenedAt`
  - missing tracking remains null/Not assigned; backend does not invent carrier, tracking number, or tracking URL
- Secret behavior:
  - fulfillment webhook routes use `SHOPIFY_FULFILLMENT_WEBHOOK_SECRET` when set
  - otherwise they fall back to `SHOPIFY_WEBHOOK_SECRET`
  - orders/refunds continue to use `SHOPIFY_WEBHOOK_SECRET`; return lifecycle routes keep their `SHOPIFY_RETURN_WEBHOOK_SECRET` fallback behavior

### POST /webhooks/shopify/fulfillments-update

- Purpose: receive verified Shopify `FULFILLMENTS_UPDATE` webhook envelopes and refresh canonical fulfillment/tracking state.
- Required auth: none; verification is via Shopify HMAC signature.
- Response semantics match `POST /webhooks/shopify/fulfillments-create`, with topic `fulfillments/update`.
- Operational note: updates remain line-item scoped so a fulfillment change for one vendor allocation cannot mark another vendor allocation as fulfilled.
- Cancellation note: Shopify fulfillment cancellation can arrive through this topic; backend confirms cancellation from canonical `fulfillment.status === CANCELLED` / fulfillment-order state before reverting allocation fulfillment or clearing tracking.

### POST /webhooks/shopify/fulfillment-events-create

- Purpose: receive verified Shopify `FULFILLMENT_EVENTS_CREATE` webhook envelopes and map known delivery event states into allocation shipping status.
- Required auth: none; verification is via Shopify HMAC signature.
- Response semantics match `POST /webhooks/shopify/fulfillments-create`, with topic `fulfillment_events/create`.
- Event mapping:
  - `delivered` -> `shippingStatus: "delivered"`
  - `in_transit`, `out_for_delivery`, or `confirmed` -> `shippingStatus: "in_transit"`
  - `failure`, `failed`, or `attempted_delivery` -> `shippingStatus: "fulfillment_event_attention"`
  - unknown event statuses do not invent delivery state; canonical fulfillment still syncs as shipped/partially shipped when fulfillment line items match
  - raw fulfillment event status is applied only to the matching Shopify fulfillment id to prevent cross-vendor status leakage

### POST /webhooks/shopify/fulfillment-orders-cancelled

- Purpose: receive verified Shopify `FULFILLMENT_ORDERS_CANCELLED` webhook envelopes and sync canonical cancellation state back into vendor allocations.
- Required auth: none; verification is via Shopify HMAC signature.
- Response semantics match `POST /webhooks/shopify/fulfillments-create`, with topic `fulfillment_orders/cancelled`.
- Cancellation semantics:
  - webhook payload is treated as trigger/envelope
  - backend fetches canonical Shopify fulfillment/order state before changing allocations
  - cancellation is recognized from canonical `fulfillmentOrder.status === CANCELLED` or `fulfillment.status === CANCELLED`
  - affected allocations are matched by exact Shopify line item id
  - fully cancelled allocations are reverted to `fulfillmentStatus: "pending"` and `shippingStatus: "awaiting_shipment"`
  - active tracking/fulfillment fields are cleared only for the affected cancelled allocation
  - unrelated vendor allocations and unrelated active fulfillments remain unchanged
  - ambiguous canonical state is treated as needs-attention/failed sync rather than inventing cancellation behavior

### POST /fulfillments/:allocationId/tracking

- Purpose: submit vendor-owned shipment tracking and sync fulfillment to Shopify Fulfillment Orders API.
- Required auth: yes.
- Vendor scoping rule: route requires backend vendor context validation; vendor users may update only their own assigned allocation and admin may update within the selected vendor context.
- Expected request body:

```json
{
  "trackingNumber": "TRACK123",
  "carrier": "Yurtiçi Kargo",
  "trackingUrl": "https://tracking.example/TRACK123",
  "notifyCustomer": true
}
```

- Expected success response shape:

```json
{
  "ok": true,
  "allocationId": "alloc-yalispor-9001",
  "trackingNumber": "TRACK123",
  "carrier": "Yurtiçi Kargo",
  "trackingUrl": "https://tracking.example/TRACK123",
  "notifyCustomer": true,
  "fulfillmentStatus": "fulfillment_submitted",
  "shippingStatus": "shipped",
  "shopifySyncSource": "mock",
  "shopifyFulfillmentId": "mock-fulfillment-alloc-yalispor-9001",
  "shopifyFulfillmentCreated": true,
  "shopifyFulfillmentSkippedReason": null,
  "shopifyFulfillmentOrderIdPresent": true,
  "shopifyFulfillmentIdPresent": true,
  "shopifyFulfillmentOrderLookupAttempted": true,
  "shopifyFulfillmentOrderLookupSuccess": true,
  "shopifyFulfillmentOrderCount": 1,
  "shopifySelectedFulfillmentOrderIdPresent": true,
  "fulfilledAt": "2026-05-12T13:22:52.000Z",
  "shipmentCreatedAt": "2026-05-12T13:22:52.000Z",
  "shipmentUpdatedAt": "2026-05-12T13:22:59.000Z"
}
```

- Expected `400` behavior:
  - missing `trackingNumber`
  - missing `carrier`
  - missing Shopify order linkage
- Expected `403` behavior:
  - authenticated user attempts mutation outside allowed vendor context
- Expected `404` behavior:
  - allocation does not exist
- Expected `409` behavior:
  - allocation is blocked/cancelled or otherwise not eligible for fulfillment updates
- Expected `502` behavior:
  - Shopify fulfillment-order resolution fails for the allocation
  - Shopify fulfillment sync fails after validation
- Fulfillment sync semantics:
  - route fetches fulfillment orders for the Shopify order
  - route maps allocation-owned Shopify line items into `line_items_by_fulfillment_order`
  - route submits tracking with `tracking_info.number`, `tracking_info.company`, and optional `tracking_info.url`
  - route may set `notify_customer: true`
  - route only reports success after Shopify returns a fulfillment id
  - route resolves Shopify fulfillment orders before creation, using the normalized Shopify order id when local storage contains a GID
  - route selects matching open fulfillment orders only; closed/cancelled/fulfilled order data is not used to create duplicate fulfillments
  - route returns safe fulfillment diagnostics: whether a fulfillment was created, whether a fulfillment order id was available, whether a fulfillment id was returned, lookup attempted/success status, lookup order count, selected fulfillment order id presence, and any idempotent skip reason
- Current frontend real-mode safety note:
  - the vendor order-detail UI defaults `notifyCustomer` to `false` unless the user explicitly opts in during tracking submission
- Suggested status transitions:
  - `awaiting_shipment`
  - `fulfillment_submitted`
  - `shipped`
  - `fulfillment_sync_failed`
- Failure semantics:
  - backend must not silently report success if Shopify sync fails
  - sync failure should be persisted and surfaced to caller

### GET /returns

- Purpose: return the current vendor’s return request list.
- Required auth: yes.
- Vendor scoping rule: only returns for the authenticated user’s allowed vendor scope may be returned.
- Expected success response shape: `ReturnSummary[]`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access the vendor scope.
- Expected `404` behavior: not typically used for collection requests, unless the backend intentionally obscures access.
- Return records are vendor-scoped allocations of both:
  - Shopify refund activity (`refunds/create`)
  - Shopify pending return lifecycle events (`returns/*`)
- Return records should expose lifecycle/source metadata so pending return requests and processed refunds stay distinguishable.
- Backend implementation note: route is protected by auth + vendor access middleware, and scoped by backend-resolved vendor context (`request.vendorContext.vendorId`).

### GET /returns/:returnId

- Purpose: return a single return request detail record.
- Required auth: yes.
- Vendor scoping rule: only return the record if it belongs to an allowed vendor.
- Expected success response shape: `ReturnDetail`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access the vendor scope.
- Expected `404` behavior: return `404 Not Found` when the return does not exist or when the backend hides cross-vendor resources.
- Detail records should expose `vendorId`, `sourceShopifyOrderId`, `sourceShopifyOrderNumber`, and source identifiers (`sourceShopifyRefundId`, `sourceShopifyReturnId`, `sourceShopifyReturnGid`) plus lifecycle/source fields (`returnLifecycleStatus`, `returnRequestSource`).
- Return-request and refund lifecycles are intentionally separate:
  - pending return requests do not create refund-ledger entries
  - refund records continue to be created only from `refunds/create`
- Backend implementation note: in current vendor-scoped query semantics, cross-vendor return ids resolve to `404` after vendor context is validated.

### GET /finance

- Purpose: return the current vendor’s finance summary and transaction list.
- Required auth: yes.
- Vendor scoping rule: finance data must be isolated to the authenticated vendor scope.
- Expected success response shape: `FinanceDashboard`.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access finance data.
- Expected `404` behavior: not typically used for this collection-like response, unless the backend intentionally obscures access.
- Finance summary values should be computed from vendor-allocated Shopify order items and vendor-allocated Shopify refund items.
- Gross sales come from the vendor’s allocated order line items.
- Refunds come from the vendor’s allocated refunded line items.
- Net revenue is gross sales minus refunds.
- Platform fee or commission is an authoritative backend calculation; the current frontend demo uses a deterministic 10% rule.
- Payout estimate is net revenue minus platform fee.
- The frontend should receive already vendor-scoped finance data and should not perform financial allocation in production.
- Backend implementation note: route is protected by auth + vendor access middleware, and scoped by backend-resolved vendor context (`request.vendorContext.vendorId`).
- Finance record status mapping:
  - `failed`/`error` should display `Failed`
  - non-failure lifecycle states used for persisted refund/sale ledger rows (such as `hold`) should display non-failure wording (`Recorded`, `Completed`, or `Reconciled` depending on state mapping)
  - successful `refunds/create` ingestion that produces ledger rows must not be labeled as `Failed` in vendor-facing finance UI
- Finance in this phase is reporting-only:
  - no payout execution
  - no payout provider integration
  - deterministic fee model is currently acceptable for seeded/demo data (`platformFee = 10% of netRevenue`, `payoutEstimate = netRevenue - platformFee`)

### GET /automation

- Purpose: return the current vendor’s automation alerts and suggestions.
- Required auth: yes.
- Vendor scoping rule: automation signals must be isolated to the authenticated vendor scope.
- Expected success response shape: `AutomationDashboard`.
- Current implementation note: this route is read-only and intended to power real-mode operational visibility. It does not execute automation actions, and current frontend action buttons remain non-mutating until a future write contract exists.
- Expected `401` behavior: return `401 Unauthorized`.
- Expected `403` behavior: return `403 Forbidden` if the user is authenticated but not allowed to access automation data.
- Expected `404` behavior: not typically used for this collection-like response, unless the backend intentionally obscures access.

## Data Shapes

## Shopify Registration Scripts

- `npm run shopify:return-webhooks:register` and `npm run shopify:fulfillment-webhooks:register` are opt-in operational scripts.
- Mixed-state behavior is required:
  - existing topic+callback subscriptions should be reported as existing
  - missing topics should still be created even when other topics already exist
  - duplicate/address-taken responses should trigger a subscription re-check and continue
  - unexpected per-topic failures should be reported without stopping processing of remaining topics
  - script exits non-zero only after all topics are attempted and one or more unexpected failures remain
- Scripts must print only safe summaries (`created`, `existing`, `failed`, callback URLs, subscription ids) and must never print secrets.

The frontend expects the following domain types from `src/lib/api/contracts.ts`:

- `OrderSummary`
- `OrderDetail`
- `ShopifyOrderBreakdown`
- `VendorAllocationSummary`
- `ReturnSummary`
- `ReturnDetail`
- `FinanceSummary`
- `FinanceTransaction`
- `FinanceDashboard`
- `AutomationAlert`
- `AutomationSuggestion`
- `AutomationDashboard`

### Shared Shape Expectations

- All date/time values are ISO strings.
- Currency values are currently represented as formatted strings by the frontend contract.
- IDs are opaque strings.
- Collections are returned as arrays.
- The backend should preserve the same field names unless the frontend contracts are updated first.
- `FinanceSummary` includes vendor-derived fields such as `grossSales`, `refunds`, `netRevenue`, `platformFee`, and `payoutEstimate` in addition to compatibility aliases used by the current frontend shell.
- Allocation-related shapes include both `originalVendorId` and `assignedVendorId`.
- `vendorId` remains for compatibility and currently aliases `assignedVendorId`.

## Security Requirements

- Do not use `X-Vendor-Id` as the source of truth for authorization.
- Use the authenticated user/session to determine which vendor(s) are allowed.
- Ensure vendor-specific records are always filtered server-side.
- Do not rely on the frontend to hide data as a security boundary.
- Return `403` or `404` consistently for cross-vendor access, but do not leak data.

## Future Shopify Notes

- A Shopify store connection belongs to a vendor.
- Shopify orders must be stored with a `vendorId`.
- Shopify metafield mapping determines `originalVendorId`.
- Backend must resolve Shopify variant/vendor metafield values into internal vendor IDs before allocation.
- Vendor metafield matching should be trim-safe, case-insensitive, and resilient to Turkish character variants where practical.
- Operational assignment determines `assignedVendorId`.
- Reassignment from original to assigned vendor is future work; this contract prepares for it.
- Vendor cancellation/out-of-stock reporting can mark allocations as blocked and pending reassignment.
- Reassignment is admin-controlled and must be persisted by backend workflow APIs in the future.
- `originalVendorId` must remain immutable across reassignment changes.
- `assignedVendorId` changes only when reassignment is committed by backend.
- Reassignment actions should be stored with audit history (`reassignedBy`, `reassignedAt`, and note/reason trail).
- Assignment history is required for auditability and should be persisted by backend as an append-only timeline.
- Audit history entries should include actor identity, actor role, reason, and timestamps.
- Fulfillment actions (`create_label`, `mark_shipped`, `update_tracking`) should be audit logged by backend with actor and timestamp.
- Carrier/shipping API integrations are future work and should plug into this assigned-vendor fulfillment model.
- Shopify webhooks must resolve to a vendor/store connection before processing.
- Webhook processing must be idempotent.
- Any imported Shopify order or event must preserve vendor scoping from the source connection.
- Shopify refunds should be allocated by vendor-owned refunded line items, not by the full order total.
- Shopify fulfillment events should also be allocated by vendor-owned line items so vendors only see their own shipping/tracking metadata.

## Single Shopify Store Multi-Vendor Order Allocation

The expected production model is a single Shopify store that can contain products from multiple vendors.

- One Shopify order can contain line items from multiple vendors.
- Vendor identity comes from variant or product metafield data during ingestion.
- Inventory, active vendor, and price selection are managed outside this application and synced into Shopify.
- This application begins from post-order operations, not storefront/catalog management.
- The backend must allocate Shopify order line items by vendor before exposing them to the frontend.
- Stored vendor-facing order records must always be scoped by `vendorId`.
- Vendors must only receive their own allocated line items.
- Admin users may inspect the full order and the per-vendor allocation breakdown.
- The frontend receives already-scoped vendor order data and must not perform Shopify allocation in production.
- Vendor users must only receive scoped allocations and must never receive cross-vendor shipping or tracking details.

### Allocation Rules

- Each Shopify line item should be matched to a vendor using metafield data.
- If a line item cannot be mapped to a vendor, the backend should keep it unmapped for review or exclude it from vendor-facing records according to ingestion policy.
- The original Shopify order ID and order number must be preserved across allocations.
- Multiple allocations can be produced for a single Shopify order when line items belong to different vendors.
- Vendor allocation logic must be deterministic and idempotent.

## Single Shopify Store Multi-Vendor Refund Allocation

Refunds follow the same single-store, multi-vendor model as orders.

- One Shopify refund can contain refunded line items from multiple vendors.
- Vendor identity comes from variant or product metafield data during ingestion.
- The backend must allocate Shopify refund line items by vendor before exposing them to the frontend.
- Stored vendor-facing return records must always be scoped by `vendorId`.
- Vendors must only receive their own refunded line items.
- Admin users may inspect the full refund and the per-vendor allocation breakdown.
- The frontend receives already-scoped vendor return/refund data and must not perform Shopify refund allocation in production.

### Refund Allocation Rules

- Each refunded Shopify line item should be matched to a vendor using metafield data.
- If a refunded line item cannot be mapped to a vendor, the backend should keep it unmapped for review or exclude it from vendor-facing records according to ingestion policy.
- The original Shopify order ID, order number, and refund ID must be preserved across allocations.
- Multiple return allocations can be produced for a single Shopify refund when refunded line items belong to different vendors.
- Vendor refund allocation logic must be deterministic and idempotent.

### Example

- Shopify Order `#1001`
  - `SKU123 / Medium` -> Demo Vendor A
  - `SKU123 / Large` -> Demo Vendor B

- If only `SKU123 / Medium` is refunded, Vendor A receives the refund allocation.
- Vendor B does not receive that refund allocation.

### Example

- Shopify Order `#1001`
  - `SKU123 / Medium` -> Demo Vendor A
  - `SKU123 / Large` -> Demo Vendor B
  - `Standard Product` -> Demo Vendor A

- Vendor A should receive only the Vendor A line items for order `#1001`.
- Vendor B should receive only the Vendor B line items for order `#1001`.

## Frontend Integration Notes

- The frontend currently uses mock transport in local/demo mode.
- Real backend mode is controlled by API environment configuration.
- The frontend expects the same route paths in mock and real modes.
- When the real backend is added, it should preserve these endpoint shapes or introduce a versioned compatibility layer.

## Admin Operations Queue

- The admin operations queue is admin-only.
- It aggregates operational issues across allocations, fulfillment state, and refund attention.
- Current frontend mock derives queue items from existing mock allocations and returns.
- Planned queue categories include:
  - `pending_reassignment`
  - `vendor_blocked`
  - `awaiting_shipment`
  - `refund_attention`
- Backend should eventually provide an authoritative queue endpoint with consistent severity/status semantics and auditability.
