# FIN-BUG-006 — Inactive Financial Profile Preservation

**Status:** implementation specification only; not an implementation or activation-policy approval. **Evidence baseline:** `main` at `378caaa51e58bde0c133e696a174b1a34ea9d5e5`. The canonical findings are [FIN-BUG-006 and FIN-UI-009](FINANCIAL_BUGS.md); both remain `OPEN`. This package follows the dependency boundary in the [Phase 1 eligibility plan](PHASE_1_ELIGIBILITY_PLAN.md).

## 1. Confirmed defect and data flow

`VendorFinancialProfile` has one row per vendor (`vendorId @unique`), a required `active Boolean @default(true)`, and persisted finance/schedule settings (`backend/prisma/schema.prisma`, model `VendorFinancialProfile`). These are current policy, not a license to recalculate historical finance.

| Stage | Current path | Consequence for a persisted `active=false` row |
| --- | --- | --- |
| Vendor GET | `GET /finance/profile` requires authentication and vendor access, then calls `getVendorFinancialProfile` (`backend/src/modules/finance/finance.routes.ts`). | Service filters `active:true`, so `mapProfile(null, vendorId)` returns a synthetic `source:'default', active:true` DTO. This is observed behavior; whether it was intentionally specified as vendor policy is **UNKNOWN**. Preserve it in this package. |
| Admin GET | `GET /admin/vendors/:vendorId/financial-profile` requires Admin and calls the **same** active-only service. | Despite the distinct Admin route, it also hides the persisted inactive row. |
| Current Admin page read | `VendorProfilePage` calls `getFinanceProfile`, which the real client sends to `/finance/profile`, including in Admin context (`src/pages/VendorProfilePage.tsx`; `src/services/real/finance.ts`). | The Admin form receives the synthetic defaults rather than persisted settings and `active=false`. |
| Form → PUT | `buildFinancePolicyFormState` uses received fields; `buildFinancePolicyInput` and `updateVendorFinancialProfile` omit `active`. PUT `/admin/vendors/:vendorId/financial-profile` is Admin-only and passes the DTO and authenticated audit actor to `upsertVendorFinancialProfile`. | An ordinary settings save carries no activation intent. |
| Write | `upsertVendorFinancialProfile` first calls active-only `getVendorFinancialProfile`, then builds field fallbacks from that DTO. Both Prisma `update` and `create` set `active: input.active ?? true` (`backend/src/modules/finance/finance.service.ts`). | **State-loss point:** inactive persisted values are replaced by synthetic defaults before normalization; the update branch then writes `active=true` when the form omits it. A read alone does not write or reactivate. |

The Admin PUT is the only production route caller found for `upsertVendorFinancialProfile`; service tests also invoke it directly. `VendorFinancialProfileUpdateDto` already permits optional `active?: boolean`, and the existing Admin route forwards that input. Thus explicit Admin API input is technically supported today. No dedicated activation UI, approval process, or operational activation policy is established by this evidence. The ordinary form does not send `active`.

Current creation behavior is separate: if no profile row exists and `active` is omitted, the service's `create` branch writes `true`, consistent with the Prisma default. Existing active-row saves that omit `active` also remain `true`. This package must not turn new-row creation inactive or reinterpret explicit `active` input.

## 2. Required contract and smallest change boundary

**Invariant:** persisted `active=false` + ordinary authorized Admin read/edit/save with `active` omitted = persisted `active=false`, including a no-change save. An ordinary edit may change only the fields the Admin actually submits; it must not substitute synthesized defaults for the inactive row. No activation is inferred from visiting, opening, or saving the form.

1. Keep `/finance/profile` and `getVendorFinancialProfile`'s current active-only/default behavior for vendor-facing consumers in this package. Do not make the shared method return inactive rows globally: other finance readers also use active-only lookup.
2. Make the existing Admin-specific GET load the persisted row by `vendorId` regardless of `active`, mapping it to the existing DTO (`active:false`, `source:'configured'`). If no row exists, retain the existing default DTO. The Admin route remains Admin-only; vendor identity comes from the route, never a client assertion about another vendor.
3. Make the upsert load the actual persisted row, if any, for update fallbacks and audit-before values. For an **existing** row and omitted `input.active`, omit `active` from the Prisma update data so the database value is preserved even if an explicit activity change races with the ordinary save. If `input.active` is explicitly supplied through the existing Admin contract, preserve the current explicit-input behavior; do not add a new caller or activation action. For a **new** row with omitted input, preserve `active=true` and all existing creation defaults.
4. Point the Admin page's finance-policy read at the existing Admin GET; keep the vendor view on `/finance/profile`. Separate or invalidate role-specific query cache state so an Admin-only inactive DTO is not later presented as the vendor-facing default view. The Admin display and edit fields must show the persisted settings and `Policy active: No` (or equivalent truthful current presentation). Keep `active` out of the ordinary form payload; do not add a toggle, activation CTA, confirmation, or new role.
5. The save response and subsequent page state must still show `active=false`. Failure to load the persisted Admin profile must remain an error, not a silent default-policy save. Preserve existing field validation, audit actor, and other profile APIs.

This is a behavioral correction within the existing DTO and Admin GET/PUT routes: **no public API shape change is expected**. A browser-supplied `active=false` echo is not the preservation authority; the server/database is. The technical implementation may name a separate Admin read service/helper, but must not alter the vendor-facing read contract as a side effect.

## 3. Scheduler and historical boundary

`listScheduleProfiles` in `backend/src/modules/finance/settlement-schedule.service.ts` selects `vendorFinancialProfile` rows with `active:true`. Accidental reactivation can therefore place a previously inactive vendor into future scheduled processing. Preserving `false` leaves that vendor excluded by the **existing** predicate. This package does not change schedule due-ness, settlement eligibility, auto-draft rules, or any scheduler predicate.

Neither the Admin GET nor the corrected policy save may rewrite `FinanceLedgerEntry`, frozen SALE commission/delay snapshots, `SettlementApproval`/lines, `PayoutBatch`/lines, `VendorBalanceEvent`, Financial Correction records, or other approved monetary authority. No backfill or historical recalculation is authorized. An explicit current-policy edit may affect future processing under existing rules; it does not retroactively change frozen finance.

## 4. Implementation package and tests

**Package name:** FIN-BUG-006 Inactive Financial Profile Preservation, including FIN-UI-009 truthful Admin read/edit presentation.

| Area | Expected implementation boundary |
| --- | --- |
| Backend | `backend/src/modules/finance/finance.service.ts` (`getVendorFinancialProfile`, Admin persisted-profile read/helper, `upsertVendorFinancialProfile`, profile mapping/audit-before); `backend/src/modules/finance/finance.routes.ts` (Admin GET calls the Admin-specific read; Admin PUT contract retained). `backend/src/modules/finance/finance.types.ts` should need no DTO change. |
| Frontend | `src/services/real/finance.ts`, the corresponding finance API/runtime-service bridge if needed, and `src/pages/VendorProfilePage.tsx`: Admin uses Admin GET, vendor uses vendor GET, role-specific cached data stays isolated, form still omits `active`. No production UI activation control. |
| Focused tests | Extend `src/finance-persisted-calculation.test.ts` or the most focused service test for inactive/active/new/explicit-input semantics; `src/finance-route-validation.test.ts` for Admin authorization and route selection; `src/pages/VendorProfilePage.test.tsx` for Admin inactive persisted display, no-change and unrelated-field save without `active`, vendor-read separation, and truthful post-save state. Test the real client path where current client tests support it. |
| PostgreSQL | Add an isolated DB regression using existing `TEST_DATABASE_URL` and repository-local DB safety conventions: create a vendor plus an inactive profile with deliberately non-default settings; Admin-equivalent read → ordinary unrelated update/no-change save → reload the row and assert `active=false` and all unedited settings retained. Include active-row and new-row controls, explicit input preservation, and verify existing schedule enumeration still excludes the inactive row. Never use production DB; clean only the isolated test fixture/database. |

Focused assertions should distinguish an Admin persisted inactive DTO from a vendor-facing synthetic default DTO. Test omitted `active` in the actual update payload, not just a mock that sends `false`. A concurrent explicit deactivation versus ordinary settings save is worth a targeted PostgreSQL regression because omission from update data—not a stale client echo—must protect the database state. Do not change schedule logic merely to make that test pass.

## 5. Release, closure, and unresolved policy

No Prisma/schema migration, bootstrap change, backfill, or production-data edit is required by this specification. Implementation validation should include focused service/route/UI tests, isolated PostgreSQL persistence, applicable project builds/typecheck/full tests, and a clean diff. Application rollback would restore the old risky read/save behavior; it would not roll back an independently made explicit profile-state change. Deployment should be verified at the intended commit before claiming runtime completion.

FIN-BUG-006 and FIN-UI-009 may close only after the persisted inactive Admin read, unchanged/no-change and unrelated-field saves, active/new/explicit-input controls, vendor-read separation, and scheduler exclusion pass relevant tests including isolated PostgreSQL; no historical finance mutation occurs; deployment is verified; and safe production read-only verification is performed if a naturally existing inactive profile is available. Audit F found **zero inactive profiles among two production profiles** at its observation time, so production incidence and a live regression case remain unproven. Do not manufacture one, mutate an active profile, or mark either finding closed merely because tests pass. If no safe live inactive case exists, retain `FIXED_NOT_VERIFIED` after implementation/deployment as appropriate.

**Out of scope / unresolved:** who may activate or deactivate, whether a dedicated UI/action or checks are required, vendor self-activation, interaction with auto-settlement flags, and any reactivation date/configuration policy. Existing optional Admin API `active` input is an implementation fact, not approval of a new activation workflow. No Shopify clarification is needed: this package concerns a local persisted profile, Admin authorization, and local scheduling selection; it does not call Shopify or change commerce evidence.
