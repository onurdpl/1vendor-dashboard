# FIN-BUG-003 — Vendor Outbound Configuration, Phase 1 Specification

Status: **implementation specification, not implementation or deployment approval**. Repository evidence baseline: `main` at `774fccf69e93fc401199e6c2edc5272988f6c936`. The [finance defect register](FINANCIAL_BUGS.md) is the status authority; FIN-BUG-003 remains **OPEN**. Phase 1 establishes vendor-level outbound configuration and an onboarding gate only. Allocation snapshots, DELIVERED evidence and finance cutover are separate later phases.

## 1. Problem

The system cannot identify a vendor's selected outbound shipment authority as either Kargonomi or a specific Vendor Integration provider. `VendorShippingConfig.preferredProvider` is a mutable shipment-execution default and is also read by Kargonomi return auto-create; Vendor Integration clients are credentials, not a selected business provider. No allocation has an immutable outbound-source snapshot. Consequently, FIN-BUG-003 cannot safely attribute future delivery evidence to the correct outbound source.

## 2. Approved business rules

- A vendor has exactly one current outbound method: **KARGONOMI** or **VENDOR_INTEGRATION**. Vendor Integration requires exactly one selected, stable integration-provider identity (SOPYO is the known project example). No priority list, automatic failover, or per-order choice is approved.
- The business provider identity is independent of token/client identity; token rotation or revocation does not rename the provider.
- Outbound and return shipping are independent. Outbound SOPYO with Kargonomi returns is valid.
- Admin configures the vendor profile before that vendor's products are opened for sale. Do not add a new `orders/create` allocation-blocking rule in Phase 1.
- A later phase snapshots the selected method/provider when each allocation is created. Existing allocations retain their snapshot after vendor settings change; only new allocations use the new setting.
- Shopify Fulfillment is not the new finance delivery-authority source. Historical shipment/finance rows are test-only for this rollout and receive no guessed authority backfill.

## 3. Existing architecture constraints

`VendorShippingConfig` is one row per vendor, with mutable `preferredProvider`, `shippingEnabled`, desi, warehouse, VAT and provider metadata. `ShippingProvider` includes KARGONOMI and legacy/other shipping-execution values, but not VENDOR_INTEGRATION. A missing row is projected by `getVendorShippingConfig` as an effective HEPSIJET default; that projection is **not** an approved outbound method. Shipment preview chooses request `provider` before current `preferredProvider`; retry retains the execution provider but reloads operational config. Generic Vendor Integration shipment writeback neither reads this config nor arbitrates against `ShipmentExecution`.

Admin provisioning creates `Vendor.status=inactive`; Admin status PUT can activate without shipping readiness. `Vendor.status` is the existing operational activation field. There is no separate persisted “profile complete” or “ready for sale” transition. Normal `orders/create` currently requires a mapped vendor ID to exist, not active status or shipping config. Current-state repair checks an active finance profile but not this outbound selection. Allocation split and economic transfer have their own checks. Phase 1 must not silently reinterpret any of these as an approved new order-intake gate.

## 4. Vendor-level outbound authority

**Recommendation:** add two nullable, explicit vendor-level fields to the existing one-per-vendor `VendorShippingConfig`: a constrained outbound-method value and a stable selected integration-provider code, populated only by an intentional Admin save. Exact column names and migration SQL are engineering details. Nullable is essential because existing rows have no proven selection; do not default from `preferredProvider`, events, executions, clients, carrier/tracking or Fulfillment. The pair has one logical validity rule: KARGONOMI has no selected integration provider; VENDOR_INTEGRATION requires exactly one supported provider code. An unconfigured pair is not activation-ready.

Putting the pair on `Vendor` would split shipping-related configuration between tables and duplicate the existing shipping API/editor. A new model is not justified by the current one-row-per-vendor cardinality. A new model becomes necessary only if later evidence requires independently versioned selection history; Phase 1 does not infer that need. Existing `preferredProvider`, warehouses and return metadata remain separate operational fields even though stored in the same model.

The pair is the vendor's **current** selection, not historical allocation authority. Do not use it retrospectively for an existing allocation.

## 5. Stable integration-provider identity

Use a small controlled provider-code catalog/allowlist in server validation, rather than a large provider-management platform or arbitrary client-entered display text. SOPYO is a known example; this spec does not invent other provider codes or claim a Sopyo adapter is implemented. A provider code must retain its meaning across token rotation, client revocation, display-name changes and future allocation snapshots. The UI may show a friendly label, but the API/persistence uses the stable code. Credentials, scopes and active/revoked state remain on `VendorIntegrationClient`; `providerName` on an existing client does not select the vendor's outbound method.

The selected code must be validated against the supported catalog. Whether a live client with appropriate scopes must already exist before completion is **not approved**; Phase 1 must not smuggle that in as a business gate. Expose client readiness separately from selection until its operational requirement is decided.

## 6. Admin profile/onboarding flow

Extend the existing Admin Vendor Profile shipping section and `VendorShippingConfigEditor`; do not create a second vendor settings screen. Admin provisioning remains restricted/inactive. Admin explicitly saves the outbound selection during profile setup. The Admin profile then shows either the selected method/provider or a clear **Outbound shipping not configured** state. The existing `PUT /admin/vendors/:vendorId/status` is the narrowest existing activation transition: an inactive-to-active request should re-read the persisted outbound selection server-side and reject activation if missing or invalid. It must not rely on UI state, a GET default, or submitted client-side readiness.

Do not require the selection merely to save other shipping fields while the vendor is restricted; the profile must remain incrementally editable. Do not auto-deactivate already-active vendors or rewrite their historical rows. An already-active unconfigured vendor is a rollout exception requiring explicit Admin configuration and a separately approved operational plan before new products are opened. The status gate alone does **not** prevent `orders/create` from allocating to an existing inactive/unconfigured vendor; the approved control is configuration before product sale, and Phase 1 deliberately does not add an order-ingestion business rule. This residual technical exposure must be visible in implementation reporting, not described as fully enforced marketplace eligibility.

The activation check should be performed at the status service boundary (not UI alone) and covered against the direct service call as well as the route. Seed/bootstrap status writes do not use that service; Phase 1 must inventory and preserve them as explicit test/setup paths, not silently treat seeded `active` as selected outbound authority.

## 7. Return-shipping separation

Do not substitute the new outbound method for `preferredProvider` in Kargonomi return code. Today return auto-create checks current `preferredProvider === KARGONOMI` and `shippingEnabled`; manual return preview/create uses Kargonomi warehouse/receiver readiness. Keep these readers unchanged in Phase 1. Thus a vendor can explicitly select Vendor Integration outbound while retaining existing Kargonomi operational/return configuration. No new return-provider field is needed merely to introduce the Phase 1 outbound selector. Any later change to return-provider semantics needs its own scope and approval.

## 8. `preferredProvider` compatibility

Retain `preferredProvider` as the existing **operation-time shipping-execution preference**, not the new business outbound authority. Do not migrate it, synchronize it to the new pair, or use it as a fallback for missing selection. Keep shipment preview/create, request-level provider override, retry/readiness and Kargonomi return auto-create behavior unchanged in Phase 1. A provider override does not mutate the new vendor selection. Later allocation-snapshot enforcement must explicitly address an operation that conflicts with the allocation's frozen source; Phase 1 does not silently implement that rule.

## 9. Backend API changes

Extend existing `GET /shipping/config` and Admin-only `PUT /admin/vendors/:vendorId/shipping-config` with the outbound method and selected provider code. GET distinguishes persisted **unconfigured/null** from the effective legacy `preferredProvider` default. PUT validates the pair server-side, rejects unsupported method/provider values, requires provider code for VENDOR_INTEGRATION, and clears/rejects an incompatible provider when KARGONOMI is intentionally selected. Existing partial updates to unrelated config must not erase a valid selection or accidentally complete an unconfigured one. Keep token creation/revocation routes unchanged; they manage credentials, not selection. Keep vendor access and Admin permission conventions unchanged.

The activation/status API response should expose a bounded, actionable readiness error for missing/invalid outbound selection, without secrets or raw provider payloads. No new public order or finance API is needed for Phase 1.

## 10. UI changes

In the Admin Vendor Profile's existing shipping editor, show a simple **Outbound Shipping** choice: Kargonomi or Vendor Integration. Show a required **Integration Provider** selector only for Vendor Integration, populated from the supported controlled codes (initial known example: Sopyo, if enabled in the actual catalog). Do not offer a free-form authority value or derive a choice from token presence. Explain missing selection before activation and show backend validation errors at save/activation. Keep current Kargonomi warehouse/return inputs visible and independently editable, including when outbound Vendor Integration is chosen. Keep integration-token onboarding and token status as separate controls. Vendor-facing shipping information remains read-only unless separately authorized; do not redesign unrelated profile panels.

## 11. Rollout behavior

Additive nullable fields begin unconfigured for existing vendors and profiles. No backfill from `preferredProvider`, existing clients, ShipmentExecution, tracking, carrier, Shopify Fulfillment or historical finance. Admin explicitly sets each intended vendor's current selection. Existing historical allocations receive no authority guess and no finance reinterpretation. Existing active vendors are not silently deactivated by the migration; their configuration/remediation order must be tracked before relying on the activation gate operationally. Validate the additive schema and actual profile behavior in isolated tests before any deployment plan. This document authorizes no production mutation.

## 12. Phase 2 snapshot interface

The Phase 1 pair is designed to supply, later, `outboundMethodSnapshot` and `outboundIntegrationProviderSnapshot` on `VendorAllocation` at creation. Phase 2 must map **all** live allocation creation paths—normal Shopify order ingestion, current-state repair, and allocation split—plus economic transfer/reassignment semantics before editing them. It must not read current vendor config to reinterpret an older allocation. An additive allocation schema is not needed in Phase 1: introducing unused snapshot fields now would expand migration and test scope without establishing creation-time authority. No finance reader consumes Phase 1 fields.

## 13. Phase 1 tests

- **Mock/service:** KARGONOMI save; VENDOR_INTEGRATION + SOPYO save; missing/unsupported provider rejection; partial unrelated config save preserves selection; no inference from clients; token rotation/revocation does not change selection; request-level shipment provider override leaves selection unchanged; restricted-to-active status service rejects missing selection and accepts valid selection; seed/default config is not treated as selection.
- **Real PostgreSQL:** persist/reload both valid pairs and unconfigured/null rollout rows; concurrent config save versus activation revalidation cannot activate from an invalid/incomplete pair; no cross-vendor selection bleed. Use isolated disposable DB only.
- **UI:** Admin profile shows the conditional provider control and missing-readiness message; active status action reflects server rejection; outbound SOPYO with Kargonomi return settings remains representable. Existing Kargonomi outbound shipment and return auto-create/manual-return regression tests stay green. No Phase 1 test may assert a new `orders/create` block, allocation snapshot, DELIVERED event or finance outcome.

## 14. Explicit non-goals

No allocation snapshot, first-observed delivery time, provider DELIVERED endpoint, Sopyo polling/status mapping, Kargonomi delivered ingestion, Shopify finance authority, finance settlement-delay cutover, historical authority backfill, changed Kargonomi return behavior, provider priority/failover, per-order routing, new `orders/create` eligibility rule, or FIN-BUG-003 closure.

## 15. Incremental implementation phases

1. **Phase 1 (this spec):** vendor-level outbound selection, stable provider code, Admin profile/API validation, inactive-to-active readiness gate, and return-configuration protection. No order/finance behavior change.
2. **Phase 2:** immutable creation-time allocation source/provider snapshot across every live writer; resolve reassignment/split inheritance and conflicting operational override behavior before enforcement.
3. **Phase 3:** provider-neutral, source-validated DELIVERED evidence and immutable first-observed authority, with real-DB replay/concurrency proof.
4. **Phase 4:** controlled, shared finance settlement-delay cutover after evidence/legacy/source-conflict decisions and cross-stage parity proof.

## 16. Remaining technical unknowns and gates

- The exact stable provider-code catalog and its operational ownership; SOPYO is evidenced as an example, not proof of a deployed adapter.
- Whether token/scope readiness must gate onboarding is unresolved and must not be inferred from the current client table.
- Existing active-vendor rollout sequence and operator ownership, including vendors without a persisted shipping config. Do not convert the HEPSIJET fallback into selected authority.
- Atomicity/concurrency mechanics for config-save versus status activation are engineering decisions, to be proven in PostgreSQL.
- Phase 2 handling of allocation split, economic transfer, existing operational overrides, multi-shipment/partial delivery and conflicting sources remains outside Phase 1.
- The broader observed-delivery spec's actual-provider-time, legacy no-evidence and finance cutover gates remain unresolved. This Phase 1 spec approves none of them.
