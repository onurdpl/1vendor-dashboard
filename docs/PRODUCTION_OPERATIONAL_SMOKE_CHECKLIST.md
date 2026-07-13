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
- Live Shopify webhook API version: stable `2026-01`
- Live Shopify webhook format: JSON
- Production Shopify webhooks must not use `unstable`; exact live callback URLs are listed in `docs/SHOPIFY_LIVE_ROLLOUT.md`.

## Pre-Smoke Checks
- Confirm backend `GET /health` returns `{ "ok": true }`.
- Confirm backend `GET /version` returns `service: "vendor-dashboard-backend"` and `nodeEnv: "production"`.
- Confirm frontend loads from the Render frontend URL.
- Confirm Render backend envs are present before testing live Shopify-dependent paths.
- Confirm all configured Shopify webhooks use API version `2026-01`, JSON format, and the `https://vendor-dashboard-backend-398h.onrender.com` backend base URL.
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
- Confirm a positive full refund has unique `REFUND / SUCCESS` transaction totals matching each refund and `Order.totalRefundedSet`, then creates existing refund finance once.
- Confirm a positive partial refund uses the verified transaction amount as monetary proof while preserving existing line-item allocation behavior.
- Confirm a zero-value successful `VOID` with zero refund/order totals is reported as `ZERO_VALUE_VOID` and creates no refund, refund-derived return, ledger/events, adjustment, or vendor debt.
- Confirm a zero-value `VOID` plus a valid positive refund processes only the positive refund without double counting.
- Confirm non-final transactions, amount mismatch, currency mismatch, incomplete transaction/line-item pages, exactly 250 refunds, malformed evidence, and canonical verification failure create no finance mutation and remain retry/review candidates.
- Confirm refund ingestion uses original persisted order allocation snapshots.
- Confirm refund line items map by `refund_line_items[].line_item.sku`.
- Confirm vendor return/refund records and finance ledger rows are created only for affected vendor allocations.
- Confirm duplicate refund delivery is ignored through webhook idempotency.
- Confirm repeated canonical reconciliation, replay/recovery, and Current-State Repair do not duplicate valid positive-refund records or finance evidence.

## Full Order Cancellation
- Trigger or identify a Shopify `ORDERS_CANCELLED` delivery.
- Confirm `ORDERS_UPDATED` acts only as fallback when `cancelled_at` exists.
- Confirm `financial_status=voided` alone does not trigger full-order cancellation reconciliation.
- Confirm backend fetches canonical Shopify order state before invoking local cancellation reconciliation.
- Confirm `ShopifyOrder.cancelledAt` and `ShopifyOrder.cancelReason` are persisted after canonical full-order cancellation.
- Confirm Order Activity timestamps `Shopify order cancelled` from canonical `ShopifyOrder.cancelledAt`, with the existing legacy fallback used only when canonical cancellation time is unavailable.
- Confirm Order Activity labels real Shopify return requests as `Return requested` and refund-derived records with refund-specific status labels such as `Refund processed`; when both exist, confirm both rows remain distinct.
- Confirm `ShopifyOrder.cancelledAt` alone blocks the order when allocation `cancellationReason` is absent and raw allocation state remains `ACTIVE` / `Pending` / `Awaiting Shipment`.
- Confirm Vendor Orders shows `Cancelled`, `Fulfillment not required`, `Shipment not required`, and `Tracking not required`.
- Confirm full-cancelled orders are excluded from awaiting-shipment/tracking-missing/workload counts and admin Operations shipment queues.
- Confirm shipment preview/create/retry, tracking updates, vendor reject, allocation split, and Vendor Integration writes are blocked for full-cancelled orders.
- Confirm Vendor Integration order reads expose `isCancelled`, `cancelledAt`, `cancelReason`, and non-actionable operational projection without hiding preserved shipment history.
- Confirm automation reminders and stale fulfillment/SLA rules exclude full-cancelled orders.
- Confirm conflict-cancelled non-voided sale rows cannot enter settlement candidates, payout preparation, payout review, or Mark Paid.
- Confirm paid evidence and partially fulfilled/shipped evidence remain unchanged and are surfaced for review instead of being rewritten.
- Confirm fulfillment cancellation still follows the separate fulfillment-cancellation path.
- Confirm no missed-order repair is attempted by this lifecycle.

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
- As admin, open `/admin/diagnostics` and use the Production Recovery Center.
- Confirm processed, failed, stuck, and payload-availability states are visible without exposing full sensitive payloads.
- Confirm Safe Replay Candidates include only `FAILED` `refunds/create` events with retained raw payload and payload hash.
- Confirm processed `orders/create`, processed `orders/cancelled`, and stateful order/fulfillment topics cannot use Replay Stored Webhook.
- Confirm recover is available only for `RECEIVED` or `FAILED` events with retained payload.
- Confirm Replay Stored Webhook warns that the retained historical payload is replayed; for `refunds/create`, confirm canonical monetary evidence is fetched before finance mutation.
- Confirm Recover Failed Webhook warns that stored processing resumes; for `refunds/create`, confirm canonical monetary evidence is fetched before finance mutation.
- Confirm vendor users receive `403` for diagnostics routes.
- Confirm blocked replay/recover returns an explicit reason instead of silent success.

## Order State Inspector
- As admin, open `/admin/diagnostics` and inspect one explicit order number such as `1108` or `#1108`.
- Confirm identity, persisted cancellation state, allocations, shipping evidence, source-specific returns/refunds, finance, operational signals, webhook history, executed repair history, projection reasons, and repair readiness are visible.
- Confirm the inspector identifies `ShopifyOrder.cancelledAt` as canonical, explains raw allocation fields as preserved ownership/history, and reports cancellation-policy queue/action/finance blocking from persisted evidence.
- Confirm vendor, support, and finance roles receive `403` from `GET /admin/diagnostics/orders/:orderNumber/state`.
- Confirm no raw payload, customer PII, full address, access token, HMAC/API secret, provider credential, bank information, or payment reference is returned.
- Confirm existing local orders expose no repair or replay action.
- For an order that returns `404 Order not found`, confirm Repair Missing Shopify Order appears for only that explicit identifier.

## Current-State Order Repair
- Use only one explicitly approved Shopify order ID or number. Do not use a range, date window, or bulk input.
- In the Recovery Center `Order number` field, enter the Shopify order number as `1105` or `#1105`; the UI sends `#1105` to the repair API. Use a numeric Shopify legacy ID only through the explicit backend/API contract.
- Confirm production uses stable Shopify Admin GraphQL API `2026-01`; canonical refunds must parse totals, transactions, and pagination completeness from the direct `Order.refunds` list, and canonical returns must use Shopify GraphQL IDs without requesting `Return.legacyResourceId`.
- From the missing-order inspector result, choose Repair Missing Shopify Order and confirm the first request omits execution (`execute: false`) and returns `dryRun: true`, `executed: false`.
- Confirm dry-run creates no local order, allocation, ledger, refund, return, job, or operational signal.
- Review canonical identity, expected vendors, `Created`/`Existing` summary, cancellation/refund/return flags, monetary classification/counts/completeness, warnings, execution blocking, and skipped state.
- Confirm missing `seller_info`, missing/unknown SKU mapping, unknown vendor, missing active finance profile, or incomplete canonical evidence fails before mutation.
- Confirm Execute Repair is unavailable until dry-run results are visible.
- Only after review, open the separate confirmation and repeat the same explicit order with `execute: true`.
- Confirm the UI exposes no bulk, range, or date-based repair action and shows executed repair history after refresh.
- Confirm missing order, line item, allocation, and sale ledger evidence is created exactly once.
- For a currently cancelled order, confirm terminal cancellation metadata and finance hold/void or conflict-review evidence appear at the same commit; no active operational state should be externally observable between creation and cancellation.
- Confirm canonical refunds and returns use existing lifecycle records and do not create duplicate records, ledgers, adjustments, debt, or FinanceEvents on repeat execution.
- Confirm a forced lifecycle failure rolls back all repair commerce/finance records while retaining only the safe failed job/signal evidence.
- Confirm the Order State Inspector shows repair source, timestamp, executed mode, actor, and status without raw Shopify payload or secrets.
- Treat `canonical_order_fetch_failed`, `canonical_refund_fetch_failed`, `canonical_return_fetch_failed`, and `canonical_snapshot_parse_failed` as blockers; do not proceed to execute until dry-run succeeds.
- FIN-VOID-1 does not correct existing `#1105` production refund/return/ledger evidence and does not repair `#1106`; keep any production correction as a separate controlled action.

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
