# Vendor Workspace UI Redesign — Implementation Progress

## P01 — Admin Allocation Finance Summary Preservation (2026-11-18)

Scope: preserve the existing Orders panel's allocation financial summary in the
standalone Order Detail before any future P04 panel removal. Only P01 is implemented.
Baseline: `6675f6230fb2fde445cb843034c873d7a683629a` (`origin/main`).
Branch: `codex/ui-p01-admin-finance-summary`.

### Changed files and decisions

- `src/pages/OrderDetailPage.tsx`: adds an Admin-only **Allocation finance summary**
  article before the existing settlement preview. Uses existing detail styling and
  a page-local presentation helper; no shared component or CSS refactor.
- `src/pages/OrderDetailPage.test.tsx`: adds 34 focused presentation/authorization
  cases alongside the existing Order Detail regressions.
- `docs/UI_REDESIGN_PROGRESS.md`: records this new initiative without rewriting
  the historical Package 4–6 closure records.

### Financial authority and isolation

The only source is the existing `order.allocationFinanceSummary`, already returned
for Admin reads and preserved by `src/services/real/orders.ts`. No API, DTO, backend,
schema, monetary calculation, ledger writer, settlement or payout behavior changed.
The Orders panel remains unchanged. Existing detail finance preview, related ledger
links, Shopify snapshot, shipment actions and notification choices remain intact.

Preserved display contracts:

- Product value, commission, commission VAT and shipping deduction use the existing
  panel's TRY formatting. The DTO has no independent currency field; Shopify order
  currency is not substituted and no conversion is performed.
- Shipping deduction status is displayed separately from its amount using the DTO's
  `available`, `pending` or `unavailable` value.
- Estimated, approved, paid-payout and cashless-offset contributions have distinct
  labels. Settlement and payout statuses stay separate. Paid time comes only from
  the supplied `paidAt`; approval never manufactures payment evidence.
- Missing monetary values remain `Not available`, not zero. An omitted summary
  does not create a substitute. `available: false` displays the existing review-required
  message and no amounts, including ambiguous-authority responses.
- The panel's negative `estimated` / `partially_refunded` primary-payable suppression
  is preserved; it does not suppress other contribution types.

Rendering reuses the existing Admin predicate and the detail page's authenticated,
selected-Vendor/allocation identity checks. Vendor, Support and Finance roles cannot
see the article, even if a fixture includes summary data. Vendor-scoped query keys,
no previous-data placeholder and the keyed detail component remain unchanged.

### Executed validation

- Focused existing/new regressions: **393 passed, 0 failed, 0 skipped**, five files:
  Order Detail, Orders, allocation-finance-summary, Admin Orders read route and
  operational deep links. The new P01 subset is 34 cases.
- `npm run build`: passed (TypeScript + Vite; existing large-chunk warning).
- `npm run backend:typecheck`: passed.
- `npm run backend:build`: passed.
- `npm run backend:smoke`: passed in explicit no-DB mode; DB-backed webhook
  processing was intentionally skipped by the existing script. No production or
  provider access. This is not PostgreSQL integration evidence.
- Full `npm run test -- --reporter=json --outputFile=/private/tmp/p01-tests.json`:
  **4,529 passed, 0 failed, 724 skipped**, 343 test files. All 724 skipped cases
  are existing conditional PostgreSQL tests across 58 files; none is a new P01 test.
  Order Detail: 224 passed (34 new P01); Orders: 134 passed; allocation summary:
  13 passed; real Orders summary mapper: 2 passed. No skips/assertions were added
  or weakened.
- `git diff --check`: passed before documentation; repeated before commit.

UI tests use mocked services/fixtures. Existing financial authority tests use mocked
database inputs; none of these results proves production behavior. Local test runs
use an inert loopback database URL and no production configuration. No new database
test is necessary for this frontend-only rendering addition. Existing conditional
PostgreSQL suites require their own disposable environments and must not be counted
as locally executed when skipped.

Backend runtime smoke is checked separately in isolated no-DB mode with external
network egress guarded and the provider URL set to inert loopback. Real-API dry-run
is not executed: no disposable real-API backend was started for this UI rendering change. No
lint script exists in the project. Browser CI execution is reported separately from
the mocked component evidence.

### Delivery status and limitations

At this document's commit, GitHub CI is pending feature-branch/Draft-PR delivery;
the actual run URL and job outcomes are reported in the P01 delivery response.
This record does not claim merge, deployment or production validation.

TRY remains the existing presentation contract, not a newly established multi-currency
guarantee. Admin allocation summary is distinct from ledger preview, related finance
records and whole-order Shopify amounts. No new Finance links were introduced.

P02–P09 remain unimplemented. P04 must verify remaining shipment/information parity
before removing the Orders panel. No panel, automatic detail query, legacy link or
provider behavior was removed during P01. Merge and deployment require separate approval.

## P02 — Orders Shipment Actions & Operational Information Parity (2026-11-18)

Baseline: `1db1f560a026ac152ab746f73bd4cb5a5a898a06`, PR #69 merged.
Branch: `codex/ui-p02-orders-shipment-parity`.
Scope: P02 only. Orders panel and P01 remain intact. The user explicitly approved
opening a returned label only while the same Vendor/allocation detail remains open;
a changed context or unmounted page must not open it. P04 is not ready by this record.

### Verified comparison and bounded changes

| Function | Panel versus original detail | P02 result / source |
| --- | --- | --- |
| Smart label orchestration | NO_PARITY: panel combines open/create/retry; detail has separate controls | Contextual entry uses existing handlers; returned label opens in the user-approved current context only |
| Shipment creation | PARTIAL_PARITY: same API; detail supports shipment-only overrides | Existing `handleCreateShipment` payload/recovery retained; no new mutation |
| Existing label opening | PARTIAL_PARITY: same `openShipmentLabel` utility; different presentation/access conditions | Utility unchanged; contextual open performs no create/retry POST |
| Failed retry | PARTIAL_PARITY: panel checks failed status; detail has evidence-based recovery guards | Existing `canRecoverFailedShipment` and ordinary retry handler retained; no Admin dry-run retry substitution |
| Automatic opening | NO_PARITY: panel opens create/retry labels; detail presents result/manual open | User-approved difference: automatic opening only while same Vendor/allocation remains mounted; no opening after context change |
| Tracking | PARTIAL_PARITY: number/link available, presentation/terminal handling differs | Existing helpers and role/terminal sections retained; no duplicate tracking card |
| Provider/carrier | PARTIAL_PARITY: rail summary versus existing detail evidence | Existing provider/carrier formatting and role boundaries retained |
| Fulfillment synchronization | PARTIAL_PARITY: panel summary versus detailed persisted sync evidence | Existing distinct operational/shipping/fulfillment/sync axes unchanged |
| Warnings/guidance | PARTIAL_PARITY: context-specific copy | Existing warnings, Support/operational guidance and terminal states retained |
| Pending/success/error | PARTIAL_PARITY: panel tags selection feedback; detail uses shipment action state | Existing result/error helpers retained; synchronous reservation and mounted/Vendor completion guards added |
| Terminal restrictions | PARTIAL_PARITY: existing operational story disables shipment creation | Same story gates new entry; cancelled/blocked/refund-terminal cases tested |
| Restricted Vendor | EXACT_PARITY: existing restricted-account checks | New entry disabled using existing restriction; no permission expansion |
| Late responses | PARTIAL_PARITY: different page/selection lifecycles | Ordinary create/retry completion cannot populate feedback after keyed detail unmount/Vendor change; explicit user-approved context policy tested |
| Operational metadata | PARTIAL_PARITY: detail already has customer/channel/Shopify reference; allocation ID missing | Admin-only Allocation reference added to existing header |
| Last update | NO_PARITY in the original detail: panel chooses shipmentUpdatedAt/provider response/fulfilledAt/order date | Same precedence/formatter added as a read-only field; not a new event timestamp |
| Timeline | PARTIAL_PARITY: different event projections | Existing assignment/rejection, shipment and fulfillment timeline retained; no fabricated events or duplicate timeline |
| Shopify snapshot | PARTIAL_PARITY: detail already contains authorized snapshot/integration data | Existing section retained; no duplicate snapshot |
| Invoice | EXACT_PARITY for these fields: existing detail has number/date/amount/received time/URL with Admin gate | Existing section and links unchanged |

Relevant production sources: `src/pages/OrdersPage.tsx` (`handleSmartLabelAction`, panel),
`src/pages/OrderDetailPage.tsx` (existing create/retry/result/recovery handlers and
operational sections), `src/lib/shipmentLabelOpening.ts`,
`src/services/real/orders.ts`, `backend/src/modules/shipping/shipping-execution.routes.ts`
and `shipping-execution.service.ts`. No backend or API contract change was required.

Exact changed files:

- `src/pages/OrderDetailPage.tsx`: contextual label entry; synchronous shared guard
  for ordinary create/failed-retry; completion guards; Admin Allocation ID and Last
  update. Reuses existing styles and missing-field form, including Admin errors
  reached through the contextual entry. No full-width redesign or panel removal.
- `src/pages/OrderDetailPage.test.tsx`: 26 focused P02 cases added; existing assertions
  remain unchanged. Tests cover open without mutation, correct create/retry payload,
  non-failed no-label blocking, rapid clicks, reservation release on errors,
  missing-field recovery, restricted/terminal/Support boundaries, foreign read,
  A→B→A and same-Vendor allocation navigation with delayed completion.
- `docs/UI_REDESIGN_PROGRESS.md`: this record only; historical closure records untouched.

### Preserved contracts

- `/orders/:orderId` still identifies an allocation. Existing authenticated Admin
  selected-Vendor and Vendor membership/ownership checks are unchanged.
- Contextual action is real-mode only, for Admin or the existing eligible Vendor;
  Support receives no new action. Existing terminal/actionability and restriction
  predicates remain in force. Existing historical label controls are untouched.
- No shipment exists: use the current creation path. Label exists: only open it.
  Recoverable failure: current ordinary failed-retry path. Non-recoverable/no-label:
  no retry/create; provider availability message. Known missing fields continue
  through the existing required completion form.
- Guard is reserved synchronously before ordinary mutation; released in `finally`.
  No backend cancellation or cross-instance duplicate guarantee is claimed.
- Create/retry payloads, customer overrides and Navlungo retry options remain intact.
  Admin diagnostic retry and provider-specific operations are not redesigned.
- `notifyCustomer` remains initially false and user-controlled on tracking submission.
  No Shopify, provider, authorization, Finance, settlement or payout rules changed.
- P01 summary/helper/role conditions, Finance links, Orders panel, Returns,
  navigation, CSS and CI are unchanged.

### Explicitly approved label-opening policy

The user selected: "Etiketi yalnız aynı Vendor ve sipariş hâlâ açıkken otomatik aç;
bağlam değiştiyse açma." Ordinary create/failed-retry handlers now reuse the existing
label-opening utility only after the current mounted/Vendor completion guard. The
Vendor/allocation-keyed detail component invalidates the old mount on navigation,
including A→B→A. Existing manual opening remains. No create/retry runs on mount.
Label-format/open errors are shown separately in the contextual action without
replacing the existing successful shipment-record feedback or repeating the operation.
This intentionally differs from the panel's unguarded label-open
continuation and is not evidence that all list-panel code is removable. No unresolved
label-opening decision remains for P02; unrelated D08 decisions remain outside scope.

### Validation and delivery

- Focused five-file regressions after the approved auto-open and error handling:
  **448 passed, 0 failed, 0 skipped** (Order Detail,
  Orders, shipment client, shipping foundation, operational deep links).
- P02 adds 26 component cases; P01's 34 cases remain included.
- Frontend TypeScript/Vite build: passed; existing large-chunk warning remains.
- Backend typecheck and build: passed; backend source unchanged.
- Final full suite (`npm run test -- --reporter=json --outputFile=/private/tmp/p02-delivery-tests.json`):
  **4,555 passed, 0 failed, 724 skipped**, 343 files. Skips are existing conditional
  PostgreSQL cases; no new skips or weakened assertions. Order Detail: 250 passed;
  Orders: 134; shipping foundation: 58; shipment client: 1; operational deep links: 5.
  P01: 34 passed; P02: 26 passed (included in these totals).
- `npm run backend:smoke`: passed in explicit no-DB mode, provider URL inert
  loopback and external egress guarded. Existing DB-backed smoke processing was
  intentionally skipped; this is not PostgreSQL verification.
- An intermediate full regression caught label-opening errors replacing the successful
  shipment-record feedback. UI presentation was corrected to keep both results
  separate; the original regression assertion was preserved. Final full suite passed.
- Tests use mocked services/synthetic data and the existing test egress guard.
  Database-dependent suites need their own disposable environments. No production,
  Shopify or shipping-provider mutation was executed. No new PostgreSQL test is
  necessary for the unchanged backend contract; no real-backend/browser claim is made.
- Real-API dry-run not executed: no disposable real-API backend started for this
  frontend change. No lint script exists. Git diff checks repeated before commit.

At this record's commit, Draft-PR CI is pending delivery. Exact commit/PR/run/job
identities and observed results are reported in the delivery response. No merge or
deployment is authorized; no P03/P04 work starts automatically.

## P03 — Returns Detail information parity

### Verified baseline and scope

- Isolated branch `codex/ui-p03-returns-detail-parity`, based on main
  `27c9da6a694da9b84f1990c97b2fdcfe5b46d02c`; PR #70 verified merged.
- Original checkout and unrelated modifications preserved. P03 changes only
  `src/pages/ReturnDetailPage.tsx`, `src/pages/ReturnDetailPage.test.tsx` and this file.
- D07/D08 investigation leads were checked against current source. No panel,
  operational sidebar, route, navigation, backend, DTO, mapper, stylesheet or
  financial/provider behavior is removed or changed.

### Panel versus Detail matrix

| Area | Before | After | Evidence / limit |
| --- | --- | --- | --- |
| Return lifecycle labels | EXACT_PARITY | EXACT_PARITY | Existing operational/terminal helpers retained |
| Refund pending/terminal interpretation | EXACT_PARITY | EXACT_PARITY | Existing refund projection and review guards retained |
| Request date | EXACT_PARITY | EXACT_PARITY | Existing date field, no new timestamp |
| Reason/customer note | EXACT_PARITY | EXACT_PARITY | Existing detail content retained |
| Vendor carrier/tracking | NO_PARITY | EXACT_PARITY | Read-only summary from authorized detail fields |
| Item name/SKU/variant/quantity/image | PARTIAL_PARITY | PARTIAL_PARITY | Actual detail lines retained; legacy summary-only SKU fallback unresolved |
| Item amount | NO_PARITY | PARTIAL_PARITY | Actual formatted detail-line amounts displayed; no summary-total synthesis |
| Support | PARTIAL_PARITY | EXACT_PARITY | Existing local Return ID/modal/tickets retained; first item SKU added to snapshot |
| Timeline | PARTIAL_PARITY | PARTIAL_PARITY | Existing request/receipt/review/refund/Support projections retained; Closed timestamp gap below |
| Review actions/restrictions | EXACT_PARITY | EXACT_PARITY | Existing receipt/approve/reject/Support/restricted/terminal gates retained |
| Admin shipment diagnostics | EXACT_PARITY | EXACT_PARITY | Existing Admin card unchanged, no duplicate Vendor card |
| Vendor/route lifecycle and deep links | EXACT_PARITY | EXACT_PARITY | Existing Vendor+Return query/remount/response guards retained and tested |

EXACT_PARITY describes these shared UI contracts, not identical layouts or live
provider/production verification.

### Shipment and amount semantics

- A Vendor gets a summary only when carrier, tracking number or tracking URL is
  present. A provider ID alone is insufficient. Missing text uses `Not provided`;
  URL-only tracking uses `Open tracking`. Existing cancellation/terminal predicates
  label retained tracking as historical. No provider IDs, diagnostics or controls
  are added for Vendors; Admin retains the original detailed card.
- `getReturnedItems` still prefers actual `refundedItems`, then `items`. Formatted
  nonblank item amounts, including zero, are displayed verbatim as **Item amount**.
  No multiplication, currency conversion or whole-return-total fallback is added.
- Missing amount on a Shopify return request without a refund reference uses
  `Not posted`; other missing amounts use `Not available`. This defensive UI handling
  does not change the API's string type or the real client's existing formatting.
- Backend `toAllocationReturnedItem` uses allocation line value, whereas
  `toRefundReturnedItem` uses refund-line subtotal. Therefore the existing field
  `refundAmount` is not universally evidence of a completed cash refund. Displaying
  it does not create a refund event or financial authority.

### Timeline, Support and remaining decisions

- Existing detail `getTimeline` and panel `buildTimeline` were compared. Dedicated
  receipt/review dates exist; some existing approval/shipment/refund projections
  use `updatedAt` fallbacks. These projections are unchanged, not newly certified
  event timestamps. Admin Finance events remain separate.
- Terminal panel adds `Closed` using `updatedAt`/request-date fallback. Detail has
  no distinct persisted closed-event timestamp in its current contract. P03 does
  not fabricate that event/date or alter the existing normalization protected by
  regression tests. Exact Closed-event parity is **USER_DECISION_REQUIRED** if it
  must be preserved before P05: establish an authoritative event/date contract or
  separately approve an explicitly qualified presentation. No API change is made.
- Panel legacy SKU-only fallback repeats the whole-return amount and invents a
  quantity of one. This is not copied. If actual detail lines are absent, existing
  `No returned items` stays. Preserving legacy per-item quantities/amounts requires
  authoritative line evidence; **USER_DECISION_REQUIRED** for that affected portion.
- Existing Contact support/modal/local ReturnRecord ID/linked-ticket flow and
  review-blocking rules remain. First actual item SKU restores panel snapshot
  context. No Support endpoint, workflow or permissions change.
- Full parity and P05 panel-removal readiness are **not claimed**. The above
  timeline/legacy decisions and their verification remain dependencies before
  any separately authorized panel removal. P03 is partial with those bounded
  decisions, not blocked for the completed shipment/item-line presentation.

### Validation and delivery

Validation results and Draft-PR CI state are recorded below after execution.

- Final full suite: **4,584 passed, 0 failed, 724 skipped**, 343 files.
  P03 adds 29 passing component cases. Return Detail: 94; Returns list: 55;
  Returns real-client mapping: 13; review route/service: 16; Admin reads: 9;
  operational deep links: 5. These six focused files total **192 passed** in
  the final run. Order Detail: 250; Orders: 134; P01's 34 and P02's 26 cases
  remain passing (included in totals).
- Initial focused run found one new Admin assertion selecting an existing provider
  ID repeated in several Admin sections; scoped it to the existing shipment card.
  Broader focused run then found the old Vendor test expecting carrier/tracking to
  be entirely hidden. Updated that test for the explicitly approved read-only
  summary while preserving its Admin-diagnostics and lifecycle protections.
  No old test was deleted or skipped; no assertion hides a production regression.
- Existing conditional PostgreSQL suites account for all 724 skipped tests; no
  new skips. No disposable PostgreSQL, real-backend browser or live provider test
  was run for these frontend-only changes. Mock component evidence is not backend
  authorization or production evidence. Backend ownership source is unchanged.
- Frontend TypeScript/Vite build, backend typecheck and backend build passed.
  Existing Vite chunk-size warning remains. Backend smoke passed with explicit
  no-DB mode, inert loopback provider URL and egress guard; DB-backed processing
  was intentionally omitted. Prisma client generation completed locally.
- Full suite used an inert `DATABASE_URL` on loopback port 9 and unset
  `TEST_DATABASE_URL`; no production credentials/database/services were used.
  `real-api:dry-run` was not run because no disposable real backend was started.
  No lint script exists. `git diff --check` passed.
- Delivery is a Draft PR only. At this commit its number and CI result are pending;
  exact PR/head/run/job evidence is supplied in the delivery response rather than
  represented as a historical PASS here. No merge or deployment is authorized.
- Classification for overall parity: `P03_PARTIAL_BLOCKED_BY_USER_DECISION` for the
  explicitly documented Closed-event/legacy-line portions; completed presentation
  has local PASS. This does not certify P05 panel removal.


## P03-FIX-01 — authoritative current closure evidence (2026-11-20)

- Isolated implementation based on main `2a0e7796d599795c0de62e77bf815a45a5a2ab66`.
- Adds four nullable ReturnRecord closure fields and a PostgreSQL sequence in one
  additive migration. No historical records are backfilled. PG16/PG18 bootstrap
  SQL and manifests are regenerated with the existing official refresh script;
  the schema checksum guard requires both updates.
- Reserve observation order before each existing canonical Return read. Atomic
  SQL fences older responses, matches exact Return/Order identities, and leaves
  operational timestamps/status/ownership unchanged. Existing-row evidence is
  committed independently before operational status guards; rejected operational
  transitions cannot undo an accepted closure observation. Existing row creation
  also applies the same fenced evidence within its existing transaction. The
  request-ingestion canonical read now occurs before opening that transaction;
  no database transaction is held across the Shopify request.
- Missing/invalid/failed canonical evidence preserves prior values; explicit null
  remains distinct. Mock-source reads do not establish Shopify authority.
- Existing Returns panel and detail use the same closure presentation helper:
  actual canonical date, `Kapanış tarihi bilinmiyor` when unknown, or no current
  closure event for known non-CLOSED canonical state. Panel remains present.
- Local final focused regressions: 269 PASS / 0 FAIL / 0 SKIP across 12 files,
  including seven actual disposable PostgreSQL 18 cases. Four additional directly
  affected route/runner suites: 38 PASS / 0 FAIL / 0 SKIP. Component/API mocks do
  not prove production behavior. PostgreSQL tests cover overlapping old/new reads,
  identity denial, rollback independence, UTC storage, null/omission/failure,
  duplicate application and mock-source rejection. The rollback case uses a real
  rejected transaction; unchanged operational-guard assertions remain unit tests.
- Frontend build, backend typecheck and backend build pass. No-DB backend smoke
  passes with outbound requests guarded and an inert loopback provider URL. PG16 and PG18 baseline
  refresh/restore checks pass; fresh PG18 bootstrap accepts 135 migrations. The
  bootstrap correctly refused a populated target during validation; a new empty
  disposable database was then used successfully.
- New PostgreSQL suite requires explicit isolated loopback database flags and was
  executed locally. It is not added to mandatory CI PostgreSQL suite lists in this
  change. No production database, live Shopify request or browser smoke was used.
- Draft delivery only; CI status is pending at this commit. FIX-01 is not marked
  complete until review, migration verification and GitHub CI are resolved.
  No financial/quantity/currency rules or operational status guards are changed;
  no history, backfill, P04/P05 work, merge or deployment is authorized.
