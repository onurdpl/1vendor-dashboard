# Production Finance Smoke Checklist

## Scope

Use this checklist after Phase 18 deployments to verify finance, settlement, payout preparation, vendor visibility, and shipment cost readiness in production.

Production services:
- Frontend: `https://onevendor-dashboard.onrender.com`
- Backend: `https://vendor-dashboard-backend-398h.onrender.com`
- Database: Render Postgres

Do not print secrets, raw webhook payloads, or production access tokens in smoke notes.

## Read-Only API Smoke

1. Backend health
   - Open `GET /health`.
   - Expected: HTTP 200 and `ok: true`.

2. Auth
   - Login with an authorized admin account.
   - Expected: token issued, no 500.

3. Vendor finance
   - Call `GET /finance` with `X-Vendor-Id: yalispor`.
   - Call `GET /finance` with `X-Vendor-Id: sporjinal`.
   - Expected:
     - HTTP 200
     - `summary` present
     - `profile` present
     - `records` array present
     - `payoutBatchSummary` present
     - settlement balance fields present

4. Admin profile
   - Call `GET /admin/vendors/:vendorId/financial-profile`.
   - Expected:
     - configured/default profile returned
     - commission/VAT/shipping settings visible

5. Payout batch listing
   - Call `GET /admin/payout-batches`.
   - Expected:
     - HTTP 200
     - list response

6. Shipping cost route guard
   - Call `POST /admin/shipping-costs` with an intentionally empty body.
   - Expected:
     - admin auth is accepted
     - route returns a validation error
     - no shipping cost is created

## Sale Ledger Smoke

1. Create a Shopify test order for a mapped vendor SKU.
2. Confirm `orders/create` webhook is received in Render logs.
3. Open Orders in the frontend.
4. Open Finance for the assigned vendor.
5. Expected:
   - vendor-scoped sale/invoice row appears once
   - row has Shopify order number/id context
   - row has payout calculation
   - row has `profileSource: snapshot`
   - duplicate webhook/replay does not create a second sale row

## Immutable Profile Smoke

1. Record an existing sale row's applied commission/VAT.
2. As admin, update the vendor financial profile.
3. Refresh Finance.
4. Expected:
   - current vendor profile panel shows the new values
   - historical sale row keeps its original applied commission/VAT
   - new sale rows created after the change use the new profile snapshot
   - summary handles mixed historical rates correctly

## Settlement Lifecycle Smoke

1. Inspect an unfulfilled sale row.
   - Expected: accruing/pending, not payout-ready.
2. Inspect a fulfilled/shipped sale row.
   - Expected: payable/payout-ready.
3. Inspect a refund row if present.
   - Expected: refund reduces accrued/payable balance.
4. Inspect timestamps.
   - Expected: accrued/payable timestamps match lifecycle readiness, when available.

## Return And Refund Smoke

1. Create a return request for a vendor-owned line item.
2. Open Returns as the vendor.
3. Expected:
   - pending return request appears in vendor Returns.
   - no finance refund ledger row is created yet.
4. Create/confirm the Shopify refund.
5. Open Finance.
6. Expected:
   - vendor-scoped refund ledger row appears.
   - refund fully reduces payout.
   - refund does not leak to unrelated vendors.

## Payout Batch Smoke

1. As admin, open Finance for a vendor with payable rows.
2. Confirm payout prep panel shows eligible row count and net amount.
3. Prepare a draft payout batch only in an approved test window.
4. Expected:
   - draft batch created
   - only payable rows included
   - unfulfilled/accruing rows excluded
   - refund rows reduce batch net
   - same row cannot be included in another active batch
5. Cancel the draft if it was created only for smoke.
6. Expected:
   - cancelled batch releases rows for future preparation

## Shipping Cost Smoke

1. Ensure the vendor profile uses `external_provider` mode.
2. Inspect a fulfilled sale row without a shipping cost snapshot.
   - Expected: shipping deduction remains `0.00`.
   - Expected: provider cost state shows pending provider cost.
3. As admin, attach a confirmed shipment cost only in an approved test window.
4. Expected:
   - route accepts vendor-scoped allocation/ledger reference
   - duplicate provider/reference attach upserts the same cost record
   - existing ledger snapshot is not rewritten
5. Create a future sale row after confirmed provider cost is available for that allocation flow.
   - Expected: new sale row can snapshot provider cost when the cost exists before ledger creation.

## Vendor Workspace Smoke

1. Login as a vendor user.
2. Open Finance.
3. Expected:
   - vendor sees only own rows and balances
   - upcoming payout summary is visible
   - settlement state is visible
   - shipping deduction state is visible
   - payout batch reference is read-only
   - no financial profile edit controls
   - no payout preparation controls
   - no shipping cost edit controls
   - no diagnostics/recovery controls

## Admin Workspace Smoke

1. Login as admin.
2. Open Finance for each vendor.
3. Expected:
   - vendor profile controls visible once
   - payout preparation controls visible
   - shipping cost attach controls visible for invoice/sale rows
   - immutable calculation profile details visible
   - settlement readiness visible
   - payout batch references visible

## Migration Smoke

Verify production migration logs include the Phase 18 migrations for:
- vendor financial profiles
- immutable finance snapshots
- settlement lifecycle
- payout batches
- shipment shipping costs

If direct DB access is unavailable locally, verify by route behavior:
- `/finance` returns settlement fields
- `/finance` returns payout batch summary
- `/finance` returns shipping cost status/source fields
- `/admin/payout-batches` is available
- `/admin/shipping-costs` is available

## Pass Criteria

Finance closure smoke passes when:
- sale, refund, settlement, payout batch, and shipping-cost-readiness paths behave deterministically
- historical calculation snapshots remain immutable
- vendor isolation holds in admin and vendor modes
- no production smoke requires unsupported payout execution, ERP export, or provider API calls
