# Allocation Full-Refund Terminal Fact

## Status and Authority

This document is the authoritative persisted domain and schema contract for allocation-scoped full-refund operational closure.

It defines the Phase 1 schema foundation only. It does not implement a writer, action guard, queue projection, historical backfill, Shopify mutation, or production migration execution.

## Domain Meaning

The existence of an `AllocationFullRefundTerminalFact` means that the referenced `VendorAllocation` was canonically verified against Shopify with all of the following conditions satisfied:

1. Every allocation-owned line quantity is fully covered by successful canonical refund evidence.
2. Every supporting transaction has `kind = REFUND` and `status = SUCCESS`.
3. The sum of matching active `OPEN` fulfillment-order line `remainingQuantity` values is zero.
4. All required canonical order, refund, transaction, refund-line, fulfillment-order, and fulfillment-order-line pagination and completeness checks passed.

The fact is allocation-scoped and monotonic. At most one fact may exist for a `VendorAllocation`.

The fact does not mean that:

- Shopify `Order.cancelledAt` is set.
- `VendorAllocation.allocationStatus` is rewritten.
- `VendorAllocation.fulfillmentStatus` is rewritten.
- `VendorAllocation.shippingStatus` is rewritten.

A partial refund does not create the fact. In a multi-vendor order, one allocation may have the fact while another remains operationally active. An already-shipped allocation may receive the fact after canonical proof, but existing shipment and tracking history remains unchanged.

The fact does not alter refund or finance history and does not become a monetary authority. Inventory remains under the external Vendor Inventory System authority; this fact does not authorize Shopify restocking.

## Operational Consequence

Future runtime phases must treat the fact as an allocation-level terminal guard. Once present, it must prevent new forward operational actions for that allocation, including:

- shipment and provider-shipment creation;
- tracking mutation;
- fulfillment;
- vendor rejection;
- reassignment or reactivation;
- other forward operational actions.

Active operational projections must exclude allocations with this fact from action-required queues such as Ready to ship, Awaiting shipment, Tracking missing, and Shipment review. Historical records remain visible.

Those runtime behaviors are outside the Phase 1 schema foundation.

## Prisma Contract

```prisma
model AllocationFullRefundTerminalFact {
  id                   String           @id @default(cuid())
  vendorAllocationId   String           @unique
  shopifyOrderGid      String
  verificationSource   String
  shopifyApiVersion    String
  verifiedAt           DateTime         @default(now())
  evidenceJson         Json
  vendorAllocation     VendorAllocation @relation(fields: [vendorAllocationId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([shopifyOrderGid])
}
```

The required reverse relation on `VendorAllocation` is:

```prisma
fullRefundTerminalFact AllocationFullRefundTerminalFact?
```

### Field Semantics

- `id`: Repository-standard cuid primary key.
- `vendorAllocationId`: Required unique identity of the operationally closed allocation.
- `shopifyOrderGid`: Canonical Shopify order GID used during verification.
- `verificationSource`: Controlled application-level provenance for how the fact was established.
- `shopifyApiVersion`: Shopify Admin API version used to retrieve the canonical evidence.
- `verifiedAt`: Time the canonical terminality decision was verified and persisted.
- `evidenceJson`: Immutable, sanitized, versioned evidence supporting the terminal decision.

There is intentionally no `updatedAt`. The fact is not a mutable lifecycle record.

## Verification Source Contract

The persisted `verificationSource` is a `String`. Writers must accept only these application-level constants:

```ts
const FULL_REFUND_TERMINAL_FACT_SOURCES = {
  REFUND_WEBHOOK: 'refund_webhook',
  CANONICAL_RECONCILIATION: 'canonical_reconciliation',
  CURRENT_STATE_REPAIR: 'current_state_repair',
  HISTORICAL_BACKFILL: 'historical_backfill',
} as const;
```

This source vocabulary is enforced by the application, not a Prisma enum, so adding a future verification entrypoint does not require a database enum migration.

## Evidence JSON Contract

Version 1 has this exact shape:

```json
{
  "schemaVersion": 1,
  "orderLineItemsComplete": true,
  "refundsListComplete": true,
  "fulfillmentCollectionsComplete": true,
  "refundEvidenceClassification": "MONETARY_REFUND",
  "refundEvidenceReasonCode": "monetary_refund_verified",
  "lines": [
    {
      "vendorAllocationLineItemId": "local-allocation-line-id",
      "shopifyLineItemGid": "gid://shopify/LineItem/123",
      "ownedQuantity": 2,
      "successfullyRefundedQuantity": 2,
      "remainingFulfillableQuantity": 0,
      "refunds": [
        {
          "shopifyRefundGid": "gid://shopify/Refund/456",
          "classification": "MONETARY_REFUND",
          "reasonCode": "monetary_refund_verified",
          "refundLineItemsComplete": true,
          "transactionsComplete": true,
          "refundLineItems": [
            {
              "shopifyRefundLineItemGid": "gid://shopify/RefundLineItem/457",
              "refundedQuantity": 2
            }
          ],
          "transactions": [
            {
              "shopifyTransactionGid": "gid://shopify/OrderTransaction/789",
              "kind": "REFUND",
              "status": "SUCCESS"
            }
          ]
        }
      ],
      "fulfillmentOrderLines": [
        {
          "shopifyFulfillmentOrderGid": "gid://shopify/FulfillmentOrder/101",
          "shopifyFulfillmentOrderStatus": "OPEN",
          "shopifyFulfillmentOrderLineItemGid": "gid://shopify/FulfillmentOrderLineItem/102",
          "remainingQuantity": 0
        }
      ]
    }
  ]
}
```

### Evidence Invariants

- `schemaVersion` must equal `1`.
- `orderLineItemsComplete`, `refundsListComplete`, and `fulfillmentCollectionsComplete` must all be `true`.
- `fulfillmentCollectionsComplete` means that both fulfillment-order pagination and every nested fulfillment-order-line pagination check completed.
- `refundEvidenceClassification` must equal `MONETARY_REFUND`.
- `refundEvidenceReasonCode` must equal `monetary_refund_verified`.
- Every local `VendorAllocationLineItem` must appear exactly once in `lines`.
- Every line must map one local allocation-line ID to its exact canonical Shopify line-item GID.
- `ownedQuantity` must be a positive integer equal to the persisted allocation-owned quantity.
- `successfullyRefundedQuantity` is the sum of the included canonical refund-line quantities and must equal `ownedQuantity`.
- Every included refund must have `classification = MONETARY_REFUND` and `reasonCode = monetary_refund_verified`.
- Every included refund must have complete refund-line and transaction evidence.
- Supporting transactions must retain their GID and must have `kind = REFUND` and `status = SUCCESS`.
- `remainingFulfillableQuantity` is the sum of matching fulfillment-order `remainingQuantity` values whose fulfillment-order status is `OPEN` and must equal zero.
- Every matching active fulfillment-order line must have a non-null, finite, non-negative `remainingQuantity`.
- Closed or inactive fulfillment-order lines do not contribute to `remainingFulfillableQuantity`; their status must remain in the evidence when retained.
- An empty `fulfillmentOrderLines` array is valid only when `fulfillmentCollectionsComplete` is `true`.
- Missing identities, null statuses, incomplete pagination, contradictory duplicate transactions, non-final refund transactions, ambiguous monetary classification, or unmatched allocation ownership prevent fact creation.

`currentQuantity`, `refundableQuantity`, and `unfulfilledQuantity` are not part of this terminal contract. They are not direct proof that allocation-owned quantity was successfully refunded and have no role in establishing the approved zero-fulfillable rule.

### Evidence Exclusions

The evidence must not contain:

- customer identity or customer account data;
- names, email addresses, or phone numbers;
- billing or shipping addresses;
- order, refund, or customer notes;
- access tokens, credentials, request headers, or secrets;
- raw Shopify order, webhook, request, or response payloads;
- refund amounts, currency, payment data, or finance calculations.

Canonical monetary consistency must pass before fact creation, but this fact stores only the resulting classification and non-monetary transaction semantics. Finance records remain the monetary authority.

## Immutability and Idempotency

- The normal service boundary must expose create and read operations only.
- `vendorAllocationId @unique` enforces one terminal fact per allocation and makes retries idempotent.
- An identical retry returns the existing fact.
- Later conflicting evidence must not update, supersede, or delete the fact. Conflict handling belongs in diagnostics or a separately approved future model.
- No normal Prisma update, upsert, or delete path may be introduced for this model.
- No database trigger is required; the repository-standard enforcement boundary is schema uniqueness plus create-only service policy and focused tests.

## Concurrency Boundary

The schema does not by itself resolve a race between terminal-fact creation and shipment authority creation.

Future writers and forward-action guards must use the existing source-Shopify-order PostgreSQL advisory transaction lock. The transaction that creates this fact and the transaction that persists a durable provider-call or shipment claim must each re-read the competing state while holding the same order-scoped lock.

- If the terminal fact commits first, shipment creation must observe it and stop before persisting provider-call authority.
- If a durable shipment claim commits first, that claim keeps precedence. The later terminal fact may block subsequent actions but must not pretend to revoke an external call that was already authorized.

## Referential and Index Contract

- `vendorAllocationId` references `VendorAllocation.id` with `ON DELETE RESTRICT` and `ON UPDATE CASCADE`.
- Restrict preserves the terminal evidence and prevents removal of its allocation parent.
- The unique index on `vendorAllocationId` is also the guard/actionability lookup index; no duplicate non-unique index is required.
- `shopifyOrderGid` has a non-unique index for order-scoped reconciliation and historical backfill inspection.
- No chronological `verifiedAt` index is part of Phase 1.

## Readiness Contract

When the Phase 1 migration is implemented, `backend/src/app.ts` must add this required-schema entry:

```ts
{
  tableName: 'AllocationFullRefundTerminalFact',
  columnName: 'vendorAllocationId',
  migration: '20260904120000_add_allocation_full_refund_terminal_fact',
}
```

This makes readiness fail closed when the terminal-fact table or its identifying allocation column is absent before later runtime code depends on it.

## Phase 1 Migration Boundary

The future Phase 1 migration is additive and may only:

- create `AllocationFullRefundTerminalFact`;
- create its primary key;
- create the unique `vendorAllocationId` index;
- create the non-unique `shopifyOrderGid` index;
- add the required `VendorAllocation` foreign key with the specified referential actions.

It must not:

- update or insert existing data;
- run a historical backfill;
- alter `AllocationStatus` or another enum;
- rewrite allocation, fulfillment, or shipping state;
- alter refund or finance history;
- implement writers, guards, projections, or queue filtering;
- perform destructive DDL.

## Scenario Contract

- Single-vendor full refund before shipment: create one fact after all evidence passes.
- Partial refund: do not create a fact.
- Multi-line allocation: create a fact only when every owned line independently passes.
- Multi-vendor order: evaluate and persist each allocation independently.
- Already-shipped full refund: a fact may be created; retain all shipment history.
- Multiple refunds covering one line: allowed when their verified quantities sum exactly to the owned quantity.
- Transaction not `SUCCESS`: do not create a fact.
- Transaction not `REFUND`: it does not support refunded quantity.
- Fulfillment split across multiple fulfillment-order lines: retain and sum every matching active line; any positive or unknown remainder blocks creation.
- Incomplete pagination: do not create a fact.
- Historical backfill: use the same evidence contract with `verificationSource = historical_backfill`.

## Explicit Non-Goals

This contract does not authorize:

- a terminal-fact writer;
- operational mutation guards;
- projection or queue changes;
- historical backfill execution;
- changes to existing allocation status fields;
- changes to finance calculations or monetary authority;
- Shopify refund, cancellation, fulfillment, inventory, or restock mutations;
- production database migration execution.
