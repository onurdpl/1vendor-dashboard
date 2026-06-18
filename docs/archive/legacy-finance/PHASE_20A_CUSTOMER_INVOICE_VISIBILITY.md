# Phase 20A - Customer Invoice Visibility Foundation

## Purpose

Revised Phase 20A reframes invoice work around merchant-of-record visibility and reconciliation.

The platform remains the canonical operational and finance truth for Shopify orders, immutable finance ledger rows, settlement state, payout batches, and vendor balances. Accounting providers such as BizimHesap and future Paraşüt/BirFatura adapters are external accounting visibility systems, not the final source of invoice truth.

This phase does not add procurement accounting, supplier invoice automation, automatic payout execution, a tax engine, ERP sync, or shipping execution.

## Merchant-of-Record Invoice Ownership

- Customer invoices belong to the platform.
- Shopify remains the commerce source.
- Immutable finance sale rows remain the canonical source for invoice linkage.
- External accounting providers may receive deterministic accounting sync payloads and return identifiers or PDF links.
- A provider draft/accounting sync does not prove final e-invoice issuance.

## Draft vs. Finalized Semantics

`InvoiceExecution` records now expose visibility-oriented fields:

- `visibilityStatus`
- `visibilityLabel`
- `reconciliationState`
- `finalInvoiceState`
- `syncSemantics`
- `providerCapabilities`

BizimHesap AddInvoice is represented as `draft_accounting_sync` unless a future provider flow can prove final invoice visibility. A BizimHesap GUID or response alone is treated as accounting sync evidence, not final invoice authority.

## Invoice Reconciliation States

The lightweight visibility model supports:

- `invoice_missing`
- `accounting_sync_pending`
- `accounting_synced`
- `invoice_linked`
- `invoice_visibility_incomplete`
- `provider_failed`
- `cancelled`

These are derived from existing `InvoiceExecution` rows and provider identifiers. No finance ledger snapshots, payout calculations, settlement states, or Shopify state are mutated by this visibility layer.

## Provider Capabilities

Provider capability metadata describes what each adapter can safely claim:

- `supportsDraftSubmission`
- `supportsFinalInvoiceVisibility`
- `supportsPdfLink`
- `supportsStatusSync`

For BizimHesap, the current capability set is:

- draft/accounting submission supported
- final invoice visibility not guaranteed
- PDF URL supported when provider returns one
- status sync not implemented yet

## Finance Drawer Visibility

The Finance drawer separates two concepts:

- Customer invoice/accounting: provider, visibility status, invoice number, PDF availability, final invoice state, and accounting sync semantics.
- Supplier settlement/payout: payout status, expected payout, refund impact, payout impact, and payout batch/payment context.

Admins can see a compact safe provider issue summary for failed or unknown invoice visibility states. The summary includes HTTP status, content type, response keys, provider error text when safely available, and parsed GUID/PDF presence booleans. It does not expose API keys, raw payloads, provider identifiers, or secrets.

Vendors see customer invoice visibility and payout relationship only. They do not see provider response internals or sensitive accounting diagnostics.

## Boundaries

Revised Phase 20A preserves:

- immutable finance snapshots
- settlement and payout correctness
- vendor isolation
- duplicate-safe invoice execution rows
- admin-only provider diagnostics
- existing provider abstraction

Still future work:

- final invoice status synchronization
- provider PDF polling
- Paraşüt/BirFatura adapters
- customer credit note/refund invoice visibility
- ERP/accounting export workflows
- procurement/supplier invoice accounting
