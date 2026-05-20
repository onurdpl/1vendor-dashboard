# Finance Ledger Model

## 1. Ledger Purpose

The finance ledger is the append-only accounting foundation for vendor operational finance. It records money-relevant facts as immutable events so vendor payables, commissions, shipping deductions, refund reversals, and vendor debts can be recalculated from history instead of mutable balance columns.

This first phase is a domain foundation only. It does not execute payouts, refunds, invoices, tax filings, provider payments, or Shopify mutations.

## 2. Append-Only Principles

- Every financial fact is recorded as a new ledger entry.
- Existing ledger entries are not updated to change balances.
- Corrections are recorded as reversal or adjustment entries.
- Balances are derived by deterministic calculation over ledger entries.
- Ledger entries should carry enough source references to audit order, line item, return, refund, payout, and manual adjustment context.
- Idempotency must be enforced by stable event ids when the ledger is later connected to live ingestion.
- Historical snapshots such as commission rate, shipping cost, and source references must be preserved on entries that depend on them.

## Read-Only Preview

The first UI integration is an admin-only finance ledger preview on Order Detail. It simulates ledger entries from the existing allocation, line items, returns, refunds, active commission profile, and confirmed shipment cost when available.

Preview rules:

- Preview output is read-only.
- Preview entries are not persisted.
- Preview balances are not payout truth.
- Preview balances are not tax or invoice truth.
- Preview does not mutate payouts, refunds, Shopify, invoices, providers, shipping, or vendor balances.
- Missing commission profile or shipping cost data is shown as unknown instead of guessed.
- Shipping cost preview uses confirmed shipment cost records first, then a shipment execution provider snapshot when present.
- Vendor users do not see preview finance numbers.

Future persistent ledger integration should reuse the same event model, then write entries through an idempotent append-only persistence layer after Shopify/order/refund semantics are confirmed for each event.

## 3. Supported Initial Event Types

- `ORDER_CREATED`
- `PAYMENT_CAPTURED`
- `MARKETPLACE_COMMISSION_RESERVED`
- `VENDOR_PAYABLE_RESERVED`
- `SHIPPING_COST_RESERVED`
- `RETURN_CREATED`
- `REFUND_APPROVED`
- `REFUND_COMPLETED`
- `COMMISSION_REVERSED`
- `VENDOR_PAYABLE_REVERSED`
- `VENDOR_DEBT_CREATED`
- `MANUAL_ADJUSTMENT`

These event types are intentionally descriptive. They do not imply payout execution, Shopify refund creation, invoice generation, or tax treatment.

## 4. Line-Item Level Accounting Model

Ledger entries should be scoped to vendor allocation and Shopify line item whenever possible. A single Shopify order can contain multiple vendors, multiple line items, partial fulfillments, and partial returns. Line-item scoping prevents a refund or shipping adjustment for one vendor allocation from affecting another vendor.

Initial line-item sale flow:

1. `ORDER_CREATED` records gross sale context.
2. `PAYMENT_CAPTURED` records payment capture context when known.
3. `MARKETPLACE_COMMISSION_RESERVED` reserves the platform commission using the commission snapshot in effect for that line.
4. `VENDOR_PAYABLE_RESERVED` reserves the vendor payable as gross line amount minus reserved commission.

The current helper uses minor currency units and basis points so recalculation is deterministic.

## 5. Partial Refund Handling

Partial refunds should create new refund/reversal entries only for the refunded quantity or amount:

- `REFUND_APPROVED` records that refund approval occurred.
- `REFUND_COMPLETED` records completion if/when confirmed.
- `COMMISSION_REVERSED` reverses the commission portion for the refunded amount.
- `VENDOR_PAYABLE_REVERSED` reduces unpaid vendor payable for the vendor portion of the refund.

If the vendor has already been paid, do not mutate the old payout. Use `VENDOR_DEBT_CREATED` instead.

## 6. Return Shipping Cost Handling

Return shipping cost handling is not automated in this phase.

The intended model is:

- Add `SHIPPING_COST_RESERVED` when a confirmed return or shipment cost should reduce the vendor position.
- Keep the provider cost source, provider reference, and confirmation status in metadata or future persistent columns.
- Do not estimate provider costs as final ledger deductions unless an explicit business rule and source are confirmed.

Unknowns:

- Whether return shipping is vendor-paid, platform-paid, customer-paid, or conditional by reason.
- Whether Try OTO return label cost is returned synchronously or only after provider processing.
- Whether Turkish tax treatment requires separate VAT ledger entries for shipping costs.

## 7. Vendor Unpaid Payout Deduction

When refund or return costs occur before payout execution, the ledger should reduce vendor payable through append-only reversal/deduction entries:

- Use `VENDOR_PAYABLE_REVERSED` for refunded vendor share.
- Use `COMMISSION_REVERSED` for reversed commission.
- Use `SHIPPING_COST_RESERVED` for confirmed shipping deductions.

The payable balance is recalculated from entries; no mutable vendor balance update is required.

## 8. Vendor Already-Paid Debt Handling

When the vendor was already paid for the affected order or line item, the ledger must not rewrite the paid payout.

Use `VENDOR_DEBT_CREATED` for the vendor portion that must be recovered later. Future payout preparation can then deduct the vendor debt from unpaid payout batches, but this phase does not implement payout deduction automation.

## 9. Invoice / E-Fatura Unknowns

Invoice and e-fatura behavior remains unknown in this phase.

Unknowns include:

- Whether marketplace commission invoices are generated by the platform, provider, or external accounting system.
- Whether vendor debt entries require a separate invoice, credit note, or internal adjustment.
- Whether refunds require customer-facing invoice cancellation, credit note, or e-arşiv/e-fatura workflow.
- Whether shipping cost VAT should be represented as a separate ledger event or metadata on `SHIPPING_COST_RESERVED`.

No invoice or e-fatura generation is implemented by this ledger foundation.

## 10. Explicit Non-Goals

This phase does not:

- Execute payouts.
- Move real money.
- Update mutable vendor balances.
- Mutate Shopify refunds, returns, fulfillments, or orders.
- Generate invoices, e-fatura, e-arşiv, credit notes, or tax documents.
- Create payout batches from the new ledger model.
- Replace the existing operational finance UI.
- Change Kargo, Try OTO, Shopify, shipping, refund, return, or provider behavior.
- Decide Turkish tax treatment.
- Create a database migration.
