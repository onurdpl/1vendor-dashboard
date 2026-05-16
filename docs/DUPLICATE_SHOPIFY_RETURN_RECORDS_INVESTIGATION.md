# Duplicate Shopify Return Records Investigation

## Scope

Investigated duplicate vendor Returns rows for Shopify order `#1029` after return lifecycle and refund webhook processing.

## Production Evidence

Production Returns list for vendor `sporjinal` showed two rows for the same Shopify order, line item, SKU, and vendor:

| Field | Return lifecycle row | Refund-created row |
| --- | --- | --- |
| ReturnRecord id | `return-request-23229399377-sporjinal-20346971095377` | `return-sporjinal-1074533826897` |
| Shopify order | `#1029` / `7621834670417` | `#1029` / `7621834670417` |
| Shopify return | `23229399377` / `gid://shopify/Return/23229399377` | not linked |
| Shopify refund | previously empty | `1074533826897` |
| Source path | `returns/request`, then `returns/approve`, then `returns/close` | `refunds/create` |
| Status shown | `closed` | `processed` |
| SKU | `DJ1196-002-42` | `DJ1196-002-42` |
| Item | `Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 42` | same |

Webhook diagnostics showed the sequence:

1. `returns/request` at `2026-05-16T14:33:19Z`
2. `returns/approve` at `2026-05-16T14:33:56Z`
3. `returns/close` at `2026-05-16T14:37:38Z`
4. `refunds/create` at `2026-05-16T14:37:38Z`

## Root Cause

This was a duplicate ingestion/upsert issue, not intentional separate business behavior.

The return lifecycle path created a deterministic return request record:

```text
return-request-{shopifyReturnId}-{vendorId}-{sourceLineItemId}
```

The refund webhook path then created a separate deterministic return record:

```text
return-{vendorId}-{shopifyRefundId}
```

The refund path did not check for an existing Shopify return request row for the same:

- vendor allocation
- Shopify order id
- Shopify line item id
- vendor

## Canonical Return Case Identity

For merchant-of-record operations, a single vendor return case should be keyed by the Shopify return request when available:

```text
sourceShopifyReturnId + vendorId + sourceShopifyLineItemId
```

When a refund arrives later for the same order/vendor/line item, it should attach refund metadata to the existing return request record instead of creating a second visible return case.

For refunds that have no prior return request, the existing refund-derived fallback remains:

```text
sourceShopifyRefundId + vendorId
```

## Implemented Prevention

The refund ingestion path now looks for an existing return request row with the same vendor allocation, Shopify order id, and Shopify line item id before upserting a refund-derived return record.

If found, it updates that existing row with:

- `sourceShopifyRefundId`
- processed refund status marker
- existing return reason preserved when the refund note is empty

Refund records, refund line items, finance ledger entries, and Shopify refund ingestion remain unchanged.

## Historical Cleanup Plan

Existing duplicate rows require a separate safe cleanup/backfill step. Recommended approach:

1. Dry-run query duplicate candidates grouped by:
   - `sourceShopifyOrderId`
   - `vendorAllocationId`
   - matching line item id/SKU
   - one `shopify_return_request` row plus one refund-derived row
2. Report candidate pairs with:
   - lifecycle row id
   - refund row id
   - Shopify return id
   - Shopify refund id
   - SKU/title
3. Execution mode should:
   - copy `sourceShopifyRefundId` from refund row to lifecycle row
   - preserve lifecycle fields and vendor review fields
   - keep `RefundRecord` and finance ledger rows untouched
   - remove or hide the duplicate refund-derived `ReturnRecord` only after verification

No historical delete/merge was run as part of this investigation.

## Admin Cleanup Endpoint

A safe admin-only cleanup endpoint is available:

```text
POST /admin/returns/duplicates/cleanup
```

Default behavior is dry-run:

```json
{
  "dryRun": true,
  "limit": 100
}
```

The report includes:

- duplicate pair candidates
- canonical Shopify return-request row
- duplicate refund-derived row
- fields proposed for copy
- `safeToExecute`
- `archiveAvailable`

Because `ReturnRecord` does not currently have an archive/suppression field, execution does not delete or hide the duplicate row. Execution only copies refund metadata to the canonical return-request row:

- `sourceShopifyRefundId`
- internal refund status marker

Finance ledger entries, refund records, refund line items, and Shopify state are not modified.
