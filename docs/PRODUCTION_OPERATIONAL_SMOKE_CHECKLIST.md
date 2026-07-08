# Production Operational Smoke Checklist

## Purpose
- Provide a repeatable production smoke checklist for the Shopify multi-vendor operational platform.
- Verify the production-ready foundation before Phase 16A/16B/16C/16D UX architecture work.
- Keep smoke checks operator-driven and non-destructive unless the step explicitly names a recovery action.

## Production Targets
- Frontend: `https://onevendor-dashboard.onrender.com`
- Backend: `https://vendor-dashboard-backend-398h.onrender.com`
- Database: Render Postgres through backend `DATABASE_URL`
- Canonical webhook target: Render backend routes under `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/*`

## Pre-Smoke Checks
- Confirm backend `GET /health` returns `{ "ok": true }`.
- Confirm backend `GET /version` returns `service: "vendor-dashboard-backend"` and `nodeEnv: "production"`.
- Confirm frontend loads from the Render frontend URL.
- Confirm Render backend envs are present before testing live Shopify-dependent paths.
- Confirm no smoke step uses another vendor's credentials, allocation id, return id, refund id, or fulfillment state.

## Login
- Admin can log in and see admin navigation.
- Vendor user can log in and does not see admin-only navigation.
- Invalid or expired session returns the user to authentication instead of exposing data.

## Order Ingest
- Trigger or identify a Shopify `ORDERS_CREATE` delivery.
- Confirm the webhook receipt is accepted with valid HMAC.
- Confirm duplicate delivery is accepted as duplicate and ignored operationally.
- Confirm the ingested Shopify order is visible in admin order breakdown.
- Confirm vendor order lists show only each vendor's allocated line items.
- Confirm unresolved `seller_info`, missing SKU, or unknown vendor mapping appears in diagnostics instead of creating unsafe allocations.

## Return Request
- Trigger or identify a Shopify `RETURNS_REQUEST` delivery.
- Confirm return webhook HMAC uses `SHOPIFY_RETURN_WEBHOOK_SECRET` when configured, otherwise `SHOPIFY_WEBHOOK_SECRET`.
- Confirm backend resolves the Return GID from `admin_graphql_api_id` or numeric `id`.
- Confirm canonical Shopify return fetch maps return line items by SKU and original `seller_info`.
- Confirm vendor-scoped pending return records are created only for affected vendor line items.

## Return Approval / Decline
- Trigger or identify `RETURNS_APPROVE` and `RETURNS_DECLINE` deliveries.
- Confirm existing vendor-scoped return records move to approved or declined lifecycle status.
- Confirm unrelated vendor return records are unchanged.
- Confirm missing local return records are surfaced for operator attention.

## Return Close
- Trigger or identify `RETURNS_CLOSE`.
- Confirm existing vendor-scoped return records move to closed lifecycle status.
- Confirm closing a return does not create refund ledger entries by itself.

## Refund Ingest
- Trigger or identify a Shopify `REFUNDS_CREATE` delivery.
- Confirm refund ingestion uses original persisted order allocation snapshots.
- Confirm refund line items map by `refund_line_items[].line_item.sku`.
- Confirm vendor return/refund records and finance ledger rows are created only for affected vendor allocations.
- Confirm duplicate refund delivery is ignored through webhook idempotency.

## Full Order Cancellation
- Trigger or identify a Shopify `ORDERS_CANCELLED` delivery.
- Confirm `ORDERS_UPDATED` acts only as fallback when `cancelled_at` exists.
- Confirm `financial_status=voided` alone does not trigger full-order cancellation reconciliation.
- Confirm backend fetches canonical Shopify order state before invoking local cancellation reconciliation.
- Confirm SHOP-CANCEL-1 does not change vendor order UI projection, shipping queue projection, or new finance payout blocker behavior.

## Fulfillment Update
- Trigger or identify `FULFILLMENTS_CREATE` or `FULFILLMENTS_UPDATE`.
- Confirm webhook payload is treated as an envelope and canonical Shopify fulfillment state is fetched.
- Confirm allocation updates are scoped by exact Shopify line item id.
- Confirm absent Shopify tracking info remains unassigned instead of being invented.

## Tracking Sync
- Submit tracking through `POST /fulfillments/:allocationId/tracking` from an assigned vendor or admin context.
- Confirm cross-vendor tracking mutation is rejected.
- Confirm backend persists tracking number, carrier, optional URL, fulfillment status, and shipment timestamps after Shopify sync succeeds.
- Confirm Shopify sync failure is persisted and surfaced instead of returning false success.
- Confirm inbound fulfillment webhooks can refresh tracking from canonical Shopify state.

## Fulfillment Cancellation Rollback
- Trigger or identify `FULFILLMENT_ORDERS_CANCELLED` or a cancellation reflected through `FULFILLMENTS_UPDATE`.
- Confirm cancellation is derived from canonical `fulfillmentOrder.status` or `fulfillment.status`, not display-only order fields.
- Confirm only affected line-item allocations revert to pending or awaiting shipment.
- Confirm active tracking is cleared only for affected cancelled allocations.
- Confirm unrelated vendor allocations and unrelated active fulfillments remain unchanged.

## Diagnostics Replay / Recover
- As admin, open webhook diagnostics.
- Confirm processed, failed, stuck, and payload-availability states are visible without exposing full sensitive payloads.
- Confirm replay is available only for supported topics with retained payload.
- Confirm recover is available only for `RECEIVED` or `FAILED` events with retained payload.
- Confirm vendor users receive `403` for diagnostics routes.
- Confirm blocked replay/recover returns an explicit reason instead of silent success.

## Reconciliation Action
- As admin, open reconciliation diagnostics.
- Confirm stale allocation, failed webhook, missing payload, and fulfillment sync failure items are visible when present.
- Run allocation-level reconciliation only for a known affected allocation.
- Run order-level reconciliation only for a known affected Shopify order.
- Confirm reconciliation fetches canonical Shopify state, repairs only safe operational fields, and reports repaired/skipped/warning details.
- Confirm reconciliation does not mutate Shopify, raw webhook history, manual notes, or historical finance records.

## Vendor Isolation Verification
- Verify vendor order list contains only assigned vendor allocations.
- Verify vendor order detail hides other vendor line items from the same Shopify order.
- Verify vendor returns and refunds contain only vendor-owned return/refund line items.
- Verify vendor finance reflects only vendor-owned sales/refunds.
- Verify vendor cannot access admin operations, diagnostics, reconciliation, or cross-vendor tracking mutations.

## Pass Criteria
- All lifecycle smoke paths either pass or produce explicit diagnostics with operator-visible next action.
- No smoke result leaks another vendor's operational data.
- No failed webhook, recovery, or reconciliation path silently reports success.
- Any unknown Shopify behavior is recorded as unknown and not treated as verified.
