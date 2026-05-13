# Phase 18D — Vendor Balance Workspace

## Purpose

Phase 18D adds a vendor-facing balance and payout workspace on top of the existing settlement ledger and payout batch preparation foundation.

The goal is to make vendor finance state understandable without exposing admin-only operational controls or diagnostics-heavy ledger mechanics.

## Vendor Payout Philosophy

Vendor finance visibility is read-only and vendor-scoped:
- vendors see only their own balances and ledger rows
- refunds fully reduce vendor payout
- immutable sale calculation snapshots remain the source for historical deductions
- the current vendor profile applies only to future sales
- payout batches are visible as upcoming payout context, not editable objects

This phase still does not execute payments, trigger bank transfers, export accounting data, generate invoices, or confirm real settlement.

## Admin vs Vendor Finance Visibility

Admin finance remains operational:
- vendor profile editing
- payout batch draft preparation
- dense ledger review
- Shopify identifiers
- calculation snapshot metadata
- vendor isolation and operational notes

Vendor finance is simplified:
- balance cards emphasize payable, upcoming, accruing, refund, and held amounts
- upcoming payout panel is read-only
- ledger details prioritize gross sale, deductions, estimated payout, payout status, and batch reference
- internal reconciliation and diagnostics language is hidden from vendor users

## Payout Timeline Semantics

Vendor detail drawers now present a compact payout timeline:
- `Accruing`: sale exists but payout readiness is still pending
- `Payable`: sale/refund impact is ready for payout preparation
- `Batched`: row is included in a payout batch draft/review lifecycle
- `Payout pending`: no real payment execution has occurred
- `Paid placeholder`: future-ready status only, not real money movement

The timeline is explanatory and read-only.

## Batch Visibility

Vendors can see:
- payout batch reference
- batch status
- batch net amount
- whether a row is included in an upcoming payout

Vendors cannot:
- prepare payout batches
- cancel payout batches
- mark batches for review
- approve or execute payouts

## Future Direction

Future phases can add payout execution, payment confirmation, payout statements, ERP/accounting exports, invoice provider integration, and richer vendor payout history.

Those are intentionally outside Phase 18D.
