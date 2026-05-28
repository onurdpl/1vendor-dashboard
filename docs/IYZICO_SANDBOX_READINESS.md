# iyzico Sandbox Readiness

## Purpose

Prepare the platform for controlled iyzico marketplace sandbox testing without creating payment calls, submerchant calls, checkout changes, database schema changes, or finance calculation changes.

This document is readiness planning only. It does not implement production payment logic and must not be treated as proof that iyzico, Shopify, or vendor settlement behavior is already integrated.

## Sources Reviewed

- `docs/SHOPIFY_DISCOVERIES.md`
- `docs/BACKEND_ARCHITECTURE.md`
- `docs/API_CONTRACTS.md`
- `docs/SHOPIFY_LIVE_ROLLOUT.md`
- `docs/FINANCE_LEDGER_MODEL.md`
- `docs/FINANCE_SETTLEMENT_MODEL.md`
- `docs/MARKETPLACE_FINANCE_WORKFLOW.md`
- `backend/prisma/schema.prisma`
- `backend/src/modules/shopify/order-ingestion.service.ts`
- `backend/src/modules/finance/sale-ledger.service.ts`
- `backend/src/config/env.ts`
- `.env.example`
- `backend/.env.example`

## Hard Boundaries

- Do not call iyzico payment APIs in readiness checks.
- Do not call iyzico submerchant APIs in readiness checks.
- Do not modify Shopify checkout from this project in this phase.
- Do not add payment, submerchant, or item transaction tables yet.
- Do not change finance calculations, payout statuses, settlement statuses, or payout batch behavior.
- Do not store real credentials in code, docs, fixtures, tests, screenshots, or committed env examples.
- Do not print API keys, secret keys, Admin API tokens, webhook secrets, card data, or raw customer/payment payloads in logs.

## Current Platform Truth

### Shopify Order And Webhook Handling

- Shopify is the canonical commerce/order source.
- Frontend must not call Shopify directly.
- Shopify Admin API access tokens and webhook secrets are backend-only.
- `orders/create` is treated as an event envelope.
- Order vendor mapping depends on a separate canonical fetch of order metafield `custom.seller_info`.
- `seller_info` maps SKU to vendor slug.
- `seller_info` may be written after `orders/create`, so ingestion has retry behavior.
- Empty SKU or missing seller mapping remains an unresolved operational state; do not invent a fallback.
- Webhook HMAC verification and idempotency must remain mandatory.

### Vendor Records And Allocation

- `Vendor` is the internal vendor record.
- `ShopifyOrderLineItem.sourceVariantId` stores the Shopify variant id when present.
- `ShopifyOrderLineItem.sku` is the current primary mapping key for `seller_info`.
- `ShopifyOrderLineItem.originalVendorId` stores the originally resolved vendor.
- `VendorAllocation` is allocation-scoped and carries `originalVendorId` and `assignedVendorId`.
- `VendorAllocationLineItem` links an allocation to its Shopify order line items.
- Multi-vendor orders are represented by separate vendor allocations; payment readiness must preserve allocation-level scoping.

### Finance And Settlement Records

- `VendorFinancialProfile` stores commission and shipping deduction configuration.
- `FinanceLedgerEntry` stores vendor-scoped sale/refund rows with commission and shipping snapshots.
- `ShipmentShippingCost` stores provider/manual/imported shipping cost evidence.
- `PayoutBatch` and `PayoutBatchLine` are draft/review artifacts, not payment execution.
- Current finance values are estimates or operational review amounts unless explicit future payout approval/payment evidence exists.
- Existing finance docs explicitly exclude payout execution, bank transfer integration, accounting authority, invoice authority, and mutable vendor balance updates.

### Env And Secret Handling

- Root `.env.example` and `backend/.env.example` exist and use empty placeholders for secrets.
- Backend environment is loaded through `backend/src/config/env.ts`.
- Shopify readiness scripts validate required variable presence without printing secret values.
- Existing code reads `SHOPIFY_ADMIN_ACCESS_TOKEN`, not `SHOPIFY_ADMIN_API_ACCESS_TOKEN`.
- Any future iyzico config loader should follow the same pattern: values from runtime env, placeholders in examples only, secrets never logged.

## Required Sandbox Credentials

Obtain these from the iyzico sandbox account before any API implementation:

- Sandbox API key.
- Sandbox secret key.
- Sandbox base URL.
- Merchant/account identifier, if iyzico requires it for marketplace flows.
- Sandbox test cards and failure-case cards from iyzico official sandbox materials.
- Marketplace/submerchant capability confirmation for the sandbox account.

Credential storage rules:

- Store real values only in local `backend/.env`, Render environment variables, or an approved secret manager.
- Commit only blank placeholders.
- Never paste credentials into support tickets, docs, test output, GitHub Actions logs, browser screenshots, or diagnostics.

## Required Shopify Dev Store Setup

Prepare a Shopify dev store that can produce realistic post-order events without changing production checkout:

- One Shopify store for the platform, matching the existing single-store model.
- Shopify custom app with Admin API access for the current operational scripts.
- Admin API token stored backend-only.
- Webhook secret stored backend-only.
- Product variants with SKUs that match `custom.seller_info` keys.
- Order metafield namespace/key:
  - namespace: `custom`
  - key: `seller_info`
  - type: JSON
- `seller_info` values must be internal vendor slugs, not display names.
- Public HTTPS tunnel or deployed backend only when webhook delivery is intentionally tested.

Unknown:

- Whether Shopify standard checkout can be configured to route through iyzico sandbox in the target dev store without custom checkout changes from this project.
- Whether a pending Shopify order created by an external payment gateway can be resolved through Admin API in the exact target flow.
- Whether the selected Shopify app scopes are sufficient for any future pending-order resolution step.

## Required Vendor/Submerchant Setup

Before marketplace payment testing, define a controlled mapping between internal vendors and iyzico sandbox submerchants:

- Internal `Vendor.id`.
- Vendor display name.
- iyzico sandbox `subMerchantKey`.
- Submerchant type and required sandbox identity fields.
- Whether the submerchant is active/approved in iyzico sandbox.
- Whether the submerchant can receive marketplace basket item allocations.

Current blocker:

- The project has no persisted submerchant model and no vendor payment account model.
- Do not add schema until the exact iyzico submerchant fields, lifecycle, and operational ownership are confirmed.

## Required Product/Variant `seller_id` Mapping

The current platform uses `custom.seller_info` SKU-to-vendor-slug mapping for allocation. iyzico marketplace basket item testing needs a deterministic path from Shopify line item to iyzico submerchant.

Minimum dry-run mapping chain:

```text
Shopify line item
  -> SKU
  -> custom.seller_info[SKU]
  -> internal Vendor.id
  -> sandbox subMerchantKey
  -> iyzico basketItems[].subMerchantKey
```

If a `seller_id` product/variant metafield is introduced later, it must not replace current allocation truth without a confirmed migration plan.

No-guessing rules:

- Do not infer seller identity from product title, vendor display name, product vendor, tags, collection, or UI text.
- Do not use Shopify display fields for business logic.
- Do not invent a variant-id fallback unless the mapping format is explicitly changed and documented.
- Do not map a basket item to a submerchant unless the vendor slug and subMerchantKey are both known.

## Required Environment Variables

Placeholders added to `backend/.env.example`:

```dotenv
IYZICO_ENV=sandbox
IYZICO_API_KEY=
IYZICO_SECRET_KEY=
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
SHOPIFY_ADMIN_API_ACCESS_TOKEN=
SHOPIFY_SHOP_DOMAIN=
```

Existing project note:

- Current Shopify code and scripts read `SHOPIFY_ADMIN_ACCESS_TOKEN`.
- The requested `SHOPIFY_ADMIN_API_ACCESS_TOKEN` placeholder is not wired to runtime behavior yet.
- Before implementing Shopify Admin API behavior for iyzico readiness, choose one canonical name and update code/docs deliberately.

Future iyzico env loader should validate:

- `IYZICO_ENV` is `sandbox` before any sandbox-only helper can run.
- `IYZICO_BASE_URL` points to the sandbox host for sandbox helpers.
- API key and secret key presence is checked by name only.
- No readiness command prints key values.

## Sandbox Test Plan

### Phase 1: Shopify Checkout To iyzico Sandbox Standard Payment Confirmation

Goal:

- Prove a Shopify dev-store checkout can complete through iyzico sandbox standard payment outside this project.

Allowed actions:

- Configure Shopify/iyzico sandbox through provider/admin UI where appropriate.
- Place a controlled test order with sandbox card data.
- Record only safe order identifiers, timestamps, and observed status labels.

Do not:

- Modify this app checkout.
- Call iyzico APIs from this backend.
- Store card data or raw payment payloads.

### Phase 2: Payment Session Payload/Log Inspection

Goal:

- Identify what safe metadata is visible after sandbox payment confirmation.

Allowed actions:

- Inspect provider/admin UI logs manually.
- Capture field names and high-level shape in a private operator note.
- Redact customer data, card data, tokens, secrets, auth headers, and raw payload bodies.

Unknowns:

- Which iyzico fields are available for Shopify standard payment confirmation.
- Whether item-level marketplace metadata is available before direct marketplace API testing.

### Phase 3: Pending Order Admin API Resolve

Goal:

- Determine whether a pending Shopify order can be resolved after sandbox payment state changes.

Allowed actions:

- Use existing Shopify Admin API patterns only after a deliberate implementation step.
- Prefer canonical GraphQL state.
- Keep any live check opt-in and off by default.

Do not:

- Mutate orders from readiness scripts.
- Treat `orders/updated` as the primary operational signal.
- Infer payment truth from UI display fields.

### Phase 4: `seller_id` To `subMerchantKey` Resolution Dry-Run

Goal:

- Prove the mapping from Shopify line item to iyzico sandbox submerchant without making payment calls.

Dry-run input:

- Shopify order id or fixture payload.
- Canonical `seller_info` mapping.
- Internal vendor records.
- Manually provided sandbox subMerchantKey mapping.

Dry-run output:

- Allocation id.
- Vendor id.
- Shopify line item id.
- SKU.
- SubMerchantKey presence boolean only.
- Missing mapping diagnostics without exposing secrets.

Do not:

- Persist subMerchantKey in current schema.
- Call iyzico submerchant APIs.
- Generate basket item payment requests.

### Phase 5: Marketplace `basketItems` Sandbox Payment

Goal:

- Later, after phases 1-4 are understood, test iyzico marketplace basket item payment in sandbox.

Prerequisites:

- Confirmed iyzico marketplace API request/response contract.
- Confirmed subMerchantKey mapping.
- Confirmed idempotency key strategy.
- Confirmed safe logging/redaction strategy.
- Explicit operator opt-in.

Do not start this phase from the current codebase yet.

### Phase 6: `itemTransactions` Persistence Planning

Goal:

- Design how iyzico item-level payment results should attach to existing allocation and finance records.

Planning questions:

- Does each iyzico item transaction map to `VendorAllocationLineItem`, `FinanceLedgerEntry`, or a new payment evidence table?
- Which iyzico ids are stable and safe to persist?
- Which fields are secrets, personal data, or sensitive payment payloads?
- How should payment failure, partial failure, refund, cancellation, and chargeback events map to current settlement states?
- Is a new append-only payment evidence model required before finance can consume iyzico data?

No schema change is approved by this readiness document.

## Unknowns And Blockers

- Exact iyzico marketplace sandbox contract for standard Shopify checkout vs direct marketplace API flow.
- Whether Shopify standard checkout can provide item-level submerchant settlement data.
- Whether Shopify pending-payment resolution requires additional Admin API scopes or webhook topics.
- Which iyzico identifiers are stable enough for idempotency.
- Whether iyzico `itemTransactions` are available synchronously on payment response or asynchronously later.
- How iyzico refund/cancel/chargeback states should map to existing refund, settlement, and finance preview language.
- Whether vendor submerchant onboarding belongs in this platform or an external operations process.
- Whether `seller_id` should be a Shopify metafield, external inventory-system attribute, or derived from existing `seller_info`.
- Whether current env naming should adopt `SHOPIFY_ADMIN_API_ACCESS_TOKEN` or keep `SHOPIFY_ADMIN_ACCESS_TOKEN`.

## No-Guessing Checklist

Before any implementation beyond this readiness doc:

- Confirm iyzico sandbox credentials are available outside git.
- Confirm iyzico marketplace/submerchant sandbox capability is enabled.
- Confirm official iyzico sandbox docs for payment, submerchant, basket item, and item transaction fields.
- Confirm Shopify dev-store checkout/payment configuration path.
- Confirm whether this app needs any Shopify checkout changes. Default answer is no until proven otherwise.
- Confirm canonical Shopify Admin API state needed for pending order resolution.
- Confirm seller mapping source of truth:
  - current `custom.seller_info`
  - future `seller_id`
  - or another explicitly documented source
- Confirm vendor-to-subMerchantKey mapping ownership and storage plan.
- Confirm redaction rules before logging any provider response.
- Confirm idempotency and retry rules before making any payment/submerchant API call.
- Confirm finance semantics before writing any iyzico-derived data into settlement records.

## Explicit Non-Goals For This Phase

- No iyzico payment API calls.
- No iyzico submerchant API calls.
- No Shopify checkout modification.
- No Shopify live mutation.
- No database migration.
- No finance calculation change.
- No payout/accounting flow.
- No production payment logic.
