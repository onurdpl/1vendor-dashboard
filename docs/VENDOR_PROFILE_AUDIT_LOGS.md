# Vendor Profile Audit Logs

`VendorProfileAuditLog` is an immutable, append-only audit trail for admin-owned vendor configuration changes.

The end-to-end Vendor Provisioning lifecycle is owned by `docs/product/VENDOR_PROVISIONING_ARCHITECTURE.md`; this document owns only Vendor Profile audit behavior.

The log records one row per changed normalized field. No row is written when a saved value is unchanged after normalization.

Tracked areas:

- Finance Policy: commission, commission VAT, shipping deduction policy, fixed fee, settlement delay.
- Billing / Legal Profile: legal identity, tax office, billing address, billing contact, legal entity type, IBAN.
- Logo Binding: Logo İşbaşı customer code, customer id, e-invoice eligibility, last checked timestamp.
- Shipping Operations: preferred provider, shipping enabled flag, desi, warehouse, cargo integration id, provider metadata, warehouse records.

Snapshot impact follows the vendor profile dependency matrix:

- Finance Policy changes affect future `FinanceLedgerEntry` rows only. Existing ledger rows keep their saved policy snapshots.
- Billing / Legal Profile changes affect future `SettlementApproval` billing snapshots only.
- Logo binding changes affect future commission invoice readiness/request snapshots and may require provider rebinding.
- Shipping Operations changes affect future shipment/return provider requests only. Existing provider request snapshots are not mutated.
- `shippingVatPercent` is marked `UNKNOWN` until an active calculation consumer is confirmed.
- `iban` is marked `FUTURE_PAYOUT_RELEVANT`; it is not currently part of settlement commission invoice snapshots.

Approved settlements and existing commission invoice request/response snapshots are not mutated by vendor profile edits.

The admin read endpoint is:

`GET /admin/vendors/:vendorId/profile-audit-logs`

Supported query parameters:

- `section`
- `limit`

The endpoint returns newest-first safe display values. Sensitive values are masked or redacted before being stored in audit rows.
