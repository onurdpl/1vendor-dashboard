# Phase 20A - Invoice Execution Foundation

## Purpose

Phase 20A introduces the first merchant-of-record invoice execution foundation.

The platform now acts as the canonical operational and finance truth for the customer relationship. External accounting systems are execution providers that receive deterministic invoice requests and return provider identifiers, PDFs, and status signals.

This phase does not add full ERP integration, procurement accounting, supplier invoice accounting, tax calculation, payment reconciliation, automatic invoice cancellation, or automatic refund invoice execution.

## Merchant-of-Record Model

Business ownership:
- the platform owns the customer commerce relationship
- the platform issues customer invoices
- vendors/suppliers remain fulfillment and supply operators
- vendor payout and supplier balances remain separate from customer invoice execution
- immutable finance ledger rows remain canonical for invoice inputs

External providers:
- execute accounting documents
- return provider invoice GUIDs/numbers/PDF URLs
- do not become the source of finance truth

## Invoice Execution Model

`InvoiceExecution` links provider execution state to a finance sale ledger row:
- `financeLedgerEntryId`
- provider (`BIZIMHESAP`, future-ready `PARASUT`, `BIRFATURA`)
- provider invoice GUID
- provider invoice number
- provider PDF URL
- status (`PENDING`, `CREATED`, `FAILED`, `CANCELLED`, `UNKNOWN`)
- deterministic request snapshot
- safe response snapshot
- timestamps

Duplicate prevention:
- one invoice execution row per finance ledger row and provider
- duplicate create attempts are rejected
- failed/unknown executions can be retried through the retry flow

## Provider Abstraction

The backend has a provider adapter contract:
- `createInvoice()`
- `cancelInvoice()`
- `getInvoiceStatus()`
- `getInvoicePdfUrl()`

Phase 20A implements the `BizimHesapAdapter` foundation around the AddInvoice request shape. The adapter can persist provider GUID, invoice number, PDF URL, request snapshot, and response snapshot.

Cancellation, status polling, and PDF polling are interface-level future hooks. They intentionally do not execute full provider workflows yet.

## Configuration

Invoice execution is disabled by default:

```text
INVOICE_EXECUTION_ENABLED=false
INVOICE_PROVIDER=bizimhesap
BIZIMHESAP_ENABLED=false
BIZIMHESAP_FIRM_ID=
BIZIMHESAP_API_KEY=
BIZIMHESAP_BASE_URL=
BIZIMHESAP_ADD_INVOICE_URL=
BIZIMHESAP_ACCESS_TOKEN=
```

When disabled, execution attempts are recorded as failed with a safe response snapshot. This protects production from accidental outbound accounting calls while keeping the orchestration path auditable.

BizimHesap live execution requires both the generic invoice gate and the provider gate:

- `INVOICE_EXECUTION_ENABLED=true`
- `BIZIMHESAP_ENABLED=true`

Keep `BIZIMHESAP_ENABLED=false` for production dry-run preparation and preview-only validation. The backend reads `BIZIMHESAP_FIRM_ID` and `BIZIMHESAP_API_KEY` without logging either value. `BIZIMHESAP_BASE_URL` can be used to derive the AddInvoice URL, while `BIZIMHESAP_ADD_INVOICE_URL` remains available as an explicit override.

## Dry-Run Preview

Admins can preview the deterministic BizimHesap AddInvoice payload without creating an `InvoiceExecution` row or calling the provider:

```text
POST /admin/invoices/preview
{
  "financeLedgerEntryId": "..."
}
```

The preview returns:

- customer display fields
- invoice date, currency, description, and notes
- line items and amounts
- Shopify/ledger/vendor references
- configuration presence booleans only

The preview does not return FirmId, API keys, access tokens, provider URLs containing credentials, or raw secrets.

## Live Response Parsing

BizimHesap AddInvoice success responses are parsed defensively:

- documented lowercase `guid`
- documented lowercase `url`
- existing uppercase/provider aliases such as `Guid`, `InvoiceGuid`, `PdfUrl`, and `invoicePdfUrl`
- nested wrapper payloads
- simple XML-style `<guid>` / `<url>` response bodies

The provider response snapshot stores safe inspection metadata:

- HTTP status
- content type
- parsed body type
- parsed body keys

Admin-only response summaries expose key presence and body-key structure without returning raw provider values or secrets:

```text
GET /admin/invoices/:id/response-summary
```

If BizimHesap does not return an invoice number, the platform leaves `providerInvoiceNo` empty and keeps the provider GUID/PDF URL as the primary execution references.

## Controlled Execution Flow

Admin create flow:
1. operator selects an eligible sale ledger row
2. backend verifies the row exists, is a sale row, and is vendor-scoped
3. backend checks no active invoice execution already exists for the same ledger/provider pair
4. backend stores a pending execution with deterministic request snapshot
5. provider adapter attempts AddInvoice execution when enabled/configured
6. backend persists provider GUID/number/PDF on success or safe failure metadata on failure

Vendor users can see invoice state and PDF links when present, but cannot create or retry invoices.

## Finance Integration

Finance ledger detail now shows:
- invoice provider
- invoice status
- provider invoice GUID
- provider invoice number
- provider PDF link if available
- execution timestamp

Admin controls:
- create invoice
- retry failed/unknown invoice execution

Vendor visibility:
- read-only invoice status
- read-only PDF link when safe

## Immutable Ledger Compatibility

Invoice request snapshots are derived from immutable finance ledger state:
- finance ledger id
- vendor allocation id
- vendor id
- Shopify order id/number
- customer display fields when available
- line item SKU/title/quantity/amount context

Invoice execution does not mutate:
- finance amount snapshots
- commission snapshots
- settlement state
- payout batches
- vendor balances
- Shopify state

## Safety Boundaries

Phase 20A does not:
- automatically create invoices from every sale row
- cancel provider invoices
- issue refund invoices/credit notes
- reconcile provider accounting state back into finance truth
- execute supplier invoices
- execute payouts or payments
- add tax engine behavior
- call ERP/procurement systems

## Future Direction

Future phases can add:
- production BizimHesap credential setup and live AddInvoice smoke
- Paraşüt and BirFatura adapters
- provider status polling
- provider PDF refresh
- credit note/refund invoice execution
- cancellation reconciliation
- accounting export/audit statement generation
- supplier invoice/procurement accounting
- tax mapping and compliance review
