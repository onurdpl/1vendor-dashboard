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

## P04-01 — Order Detail Shopify delivery-sync presentation (2026-11-22)

Baseline: `ebcd6bc8546a53af1f520967560f517fb7765b54` (`origin/main`).
Branch: `codex/p04-01-delivery-sync-parity`.
Scope: closes the verified delivery-sync presentation gap only. P04 full-width
redesign and Orders panel removal are not implemented or declared complete.

- `src/pages/OrderDetailPage.tsx`: displays existing `order.shopifyDeliverySync`
  evidence inside the existing Fulfillment article. Exact panel copy is retained:
  confirmed → `Shopify delivery synced`; pending → `Shopify delivery sync pending`;
  rejected → `Shopify delivery sync failed`; outcome_unknown →
  `Shopify delivery sync needs verification`.
- Only exact `shippingStatus === 'Delivered'` and the existing operational story's
  `active_or_unknown` state permit the message. Canonical cancellation/conflict,
  refund-terminal and Vendor-blocked states suppress it. Admin sees all four
  applicable statuses; Vendor sees confirmed/pending only. Admin rejection uses
  the existing danger StatusBadge; unknown outcome uses warning. Null/absent
  evidence creates no message. Local Delivered and fulfillment success are not
  substituted for canonical Delivered-sync evidence.
- `shopifyDeliveryStatusSyncSkippedReason` remains a separate unchanged shipment
  diagnostic. Existing queries, Vendor/allocation identity checks, actions,
  operational rules, Finance, backend/API mapping, Shopify and Orders panel are
  unchanged. The presentation derives directly from current query data, with no
  new effect, request or state cache.
- `src/pages/OrderDetailPage.test.tsx`: 20 new mocked component cases cover the
  four Admin statuses/tones, Vendor visibility, null/absent evidence, non-Delivered
  gating, canonical terminal/blocked suppression, independent fulfillment sync,
  same-Vendor order navigation and a delayed A response after switching to B.
- Executed once: `npm run test -- src/pages/OrderDetailPage.test.tsx
  src/pages/OrdersPage.test.tsx --reporter=json
  --outputFile=/private/tmp/sporgym-p04-01-tests.json`:
  **404 passed, 0 failed, 0 skipped/pending** (Order Detail 270; Orders 134).
  `npm run build` passed (TypeScript and Vite; existing large-chunk warning).
  `git diff --check` passed. No database, Docker, live Shopify or browser tests
  were executed; mocked component evidence does not prove production behavior.
- Third changed file: this existing progress record. Draft delivery and GitHub CI
  outcomes are reported separately; no merge or deployment is claimed here.
  Remaining complete panel-removal parity and full-width acceptance are unverified
  by this bounded change. Existing P01/P02 functionality is retained, not rebuilt.

## P04-02A — Non-Admin Payment Status preservation (2026-11-22)

Baseline: `ad69f9cecc1a697ef3850250188dddcb43a3cd66` (`origin/main`).
Branch: `codex/p04-02a-payment-status-parity`.

The P04-02 pre-removal review found that the Orders panel displays Payment Status
for non-Admin users, while Order Detail's Shopify financial-status field was
Admin-only. This bounded fix preserves that existing information without removing
the panel or implementing the full-width layout.

- `src/pages/OrderDetailPage.tsx`: adds Payment Status to the existing non-Admin
  Order financial summary, outside the unchanged current-state header. The section
  remains visible when monetary rows are absent; existing unknown amounts stay
  absent. Active/unknown operational state uses the existing trimmed
  `order.orderSnapshot?.financialStatus`, with `—` for absent/null/blank evidence.
  Canonical states instead use `getOperationalStory(order).financeLabel`: Sale
  voided, Review required, Refund completed or Held as applicable. These are
  existing display labels, not new payment/settlement/payout authority.
- Vendor, Support and Finance retain existing `orders:read` access and the same
  non-Admin visibility as the panel. Admin snapshot and P01 allocation summary
  are unchanged. No gateway, Admin diagnostics or additional full-order financial
  details are exposed. No route, query, effect, mutation, API or backend changes.
- `src/pages/OrderDetailPage.test.tsx`: 28 new mocked cases cover roles, active
  values, trimming/missing values, canonical precedence for all three non-Admin
  roles, absent monetary rows, Admin preservation, allocation navigation and a
  late previous-Vendor response using an explicitly switch-enabled membership fixture.
- Validation: the two-file Order Detail/Orders run initially recorded **431 PASS,
  1 FAIL, 0 SKIP**. The new no-monetary-rows fixture used `Not available`, whereas
  the existing source contract uses `Unknown`. Only that fixture was corrected;
  no application logic or assertions were weakened. Its focused rerun recorded
  **1 PASS, 0 FAIL**, with 297 other cases excluded by the test-name filter.
  Across these execution records, all 432 distinct cases have passing evidence:
  Order Detail 298 (including 28 new), Orders 134. Unchanged passing cases were
  not rerun. `npm run build` passed (TypeScript + Vite; existing chunk-size warning).
  `git diff --check` passed. No database, Docker, live provider or browser tests ran.
- Third changed file: this appended progress entry. Local mocked evidence is not
  production verification. Draft PR/CI status is reported separately; no merge or
  deployment is claimed. P04 is not complete: full panel-removal acceptance for
  timeline/timestamps, remaining metadata/product variants, deep links/Back and
  responsive/full-width behavior remains unverified. Do not remove the panel or
  begin P05 automatically.

## P04-02C — G1 read-only shipment information parity (2026-11-22)

Baseline: `57c7535723e210d1c0125b84468a7f27a56a4f06` (`origin/main`).
Branch: `codex/p04-02c-read-only-shipment`.
Scope: G1-14 existing-label opening, G1-26 shipment tracking-number fallback and
G1-27 existing tracking URL only. Orders panel remains unchanged.

- `src/pages/OrderDetailPage.tsx`: adds a small Shipment information presentation
  inside the existing Fulfillment article only for non-Admin, noncanonical-terminal
  states where the existing mutation-eligibility branch does not already show it.
  Admin and eligible/restricted eligible Vendor shipment cards remain unchanged,
  avoiding duplicate tracking cards. Support/Finance and read-only Vendor cases
  use the existing authorized Order Detail object, not a new query or permission.
- Uses the existing nullish tracking-number/URL helpers: allocation evidence first,
  then existing shipment-execution evidence. No number or URL is manufactured.
  Missing values remain Not available. Tracking links retain external-link safety
  attributes. Existing labels open only through handleOpenShipmentLabel and the
  unchanged safe openShipmentLabel utility; unsupported/failed PDF opening uses
  existing feedback and never falls back to create, retry or refresh.
- Canonical cancellation, conflict, refund-terminal and Vendor-blocked stories
  suppress the new presentation. Existing Admin historical displays are unchanged.
  Existing panel secondary label opening is read-only even for restricted Vendors;
  this does not enable their disabled Smart Label/mutation actions. Existing
  canUseFulfillmentActions, ownership, restriction, create/retry/refresh/update/
  cancel/Shopify predicates and P02 automatic-opening policy are unchanged.
- `src/pages/OrderDetailPage.test.tsx`: 37 new mocked cases cover all four roles
  across active/fulfilled allocations, false mutation availability, restricted
  Vendor reads, allocation/execution precedence, missing evidence, unsupported
  and failed PDF opening, all four canonical terminal stories, foreign ownership,
  allocation navigation and delayed previous-Vendor/allocation refetches. Assertions
  verify no shipment creation/retry/tracking/provider-refresh/Shopify probe or other
  shipment mutation is invoked by these reads and label opening.
- Executed once: OrderDetailPage + OrdersPage component suites:
  **469 PASS / 0 FAIL / 0 SKIP / 0 PENDING** (Order Detail 335, Orders 134;
  new G1 subset 37). Frontend TypeScript/Vite build and git diff --check pass.
  Existing large-bundle warning remains. No local PostgreSQL, Docker, live Shopify,
  provider operations, production access or browser smoke was used. Component
  mocks do not establish real-backend/browser/production behavior.
- Third changed file: this appended progress record. GitHub Draft PR and CI results
  are reported separately; no merge/deployment is claimed. G2 carrier precedence,
  G3 fulfillment timestamp and U1-U10 remain outside this implementation. P04
  full-width/removal acceptance is not complete; do not remove the panel or begin P05.

## P04-02D — G2 carrier presentation preservation (2026-11-22)

Baseline: `2ae7528799e514918171ba7e29ff6c9d54fa783d` (`origin/main`, PR #76 merged).
Branch: `codex/p04-02d-carrier-parity`. Scope: G2 only; G1 remains present.

### Consumer analysis and bounded presentation change

- `formatShopifyCarrierForShipment` supplies `shipmentShopifyCarrier`, which is
  used by Shopify-sync eligibility, the tracking mutation payload and diagnostic
  copy as well as the original Carrier UI. Changing that helper would change more
  than presentation. Its implementation, calculation, action predicates, payload
  and diagnostic consumers remain unchanged.
- `getRailProviderLabel` is used only by the Orders panel. Its active source order
  is formatted providerCarrierName, provider, allocation carrier, Provider pending;
  canonical stories use Blocked. Orders production code remains unchanged.
- `formatShippingProviderName` is shared by Orders, Detail and Vendor Profile UI,
  tracking-label formatting, diagnostics and the original operational helper.
  This shared formatter remains unchanged. Other providerCarrierName consumers
  are existing Support context/diagnostic data, API types, backend DTO mapping
  and a mock runtime fixture; none is modified.
- `src/pages/OrderDetailPage.tsx`: adds a local display-only helper. Non-TryOto
  meaningful providerCarrierName uses the same formatting as the panel. If absent
  or blank, the existing Detail fallback remains allocation carrier, then provider.
  This intentionally does not reorder the established fallback when no carrier
  evidence exists: the panel's provider-before-allocation order is not substituted
  into the Shopify payload or existing fallback contract.
- Try OTO delegates to the unchanged helper, preserving Sürat Kargo normalization,
  its existing supplied-name handling and allocation/Try OTO fallbacks. No provider
  is newly mapped to a physical carrier. Missing evidence stays Not available.
- The display value replaces only the existing active Carrier rows and adds one
  Carrier row inside the existing G1 read-only section for its already-authorized
  roles. No duplicate Carrier field or second shipment card is introduced.
  Canonical terminal states retain their existing Detail historical presentation;
  G1 remains suppressed there. Admin-only provider diagnostics remain Admin-only.

### Validation and delivery boundaries

- `src/pages/OrderDetailPage.test.tsx`: 40 new mocked cases cover four roles,
  active/fulfilled/restricted states, source/blank/missing fallbacks, Try OTO/Sürat,
  all four canonical terminal stories, G1 tracking/label access, delayed Vendor and
  allocation responses, and an explicit mock tracking submission proving the
  displayed carrier does not change the existing payload carrier.
- Initial two-file run: **506 PASS / 3 FAIL / 0 SKIP**. One existing assertion
  expected raw lowercase `kargonomi`; it now checks the exact Carrier row for the
  supplied/formatted `Kargonomi` value, retaining all provider-control assertions.
  Two new Admin cases incorrectly expected diagnostics to be hidden; they now
  assert existing Admin visibility while non-Admin suppression remains asserted.
  No application change or unrelated fix was made after that validation.
- Focused corrected-case rerun: **3 PASS / 0 FAIL**, with 372 cases excluded by
  the name filter. Across the records, all 509 distinct cases have passing evidence:
  Order Detail 375 (40 new G2), Orders 134. Unchanged passing cases were not repeated.
  Frontend TypeScript/Vite build and git diff --check pass; existing chunk warning
  remains. G1 and previous parity regressions remain passing in the initial run.
- Third changed file: this appended progress entry. Tests use frontend mocks only;
  no PostgreSQL, Docker, live Shopify/provider, production operation or browser
  smoke was executed. Draft PR/CI status is reported separately, not assumed PASS.
- No Orders/backend/API/auth/Finance/tracking/label integration or mutation handler
  changed. G3 and U1-U10 remain outside scope. No full-width implementation, panel
  removal, merge, deployment or P04 completion is claimed.

## P04-02E — G3 independent fulfillment completion evidence (2026-11-23)

Baseline: `06eda77c2de330a1899bd61d9295346473a3de37` (`origin/main`, PR #77 merged).
Branch: `codex/p04-02e-fulfillment-timestamp`. Scope: G3 only.

- Original loss: the panel has a separate Fulfillment synced entry whose date is
  fulfilledAt. Detail only used fulfilledAt as a fallback for tracking, Delivered
  and Last update; newer shipment/provider timestamps could obscure that evidence.
- Existing source: Orders service exposes allocation.fulfillment.fulfilledAt via
  toIsoString; the existing real mapper passes dto.fulfilledAt through (null becomes
  undefined). Native timeline mapping comes from assignment history and does not
  guarantee a fulfillment completion event. No backend/DTO/mapper change is needed.
- `src/pages/OrderDetailPage.tsx`: adds one read-only Fulfillment synced Activity
  event using order.fulfilledAt directly. Its condition matches the existing panel:
  no canonical operational story, and either fulfilledAt, fulfillmentIdPresent or
  shopifyFulfillmentSync.status === synced. Raw Fulfilled status alone does not
  create the event. Pending reassignment retains the existing panel condition.
- When sync evidence exists without a completion date, the unchanged shared
  OperationalTimeline date formatter displays its existing `—`. Invalid supplied
  dates also use that formatter fallback; no shipment/order/provider/delivery time
  is substituted. Display formatting does not change timestamp authority.
- Exact native fulfillment-synced labels (case-normalized) with the same valid
  instant as supplied fulfilledAt are replaced by this single current evidence
  entry before existing grouping. Date parsing is used only to compare identity,
  not to generate the displayed timestamp. Native entries with a different date
  remain intact; no fuzzy event-name or history inference is introduced.
- Admin, Vendor, Support and Finance retain authorized read access. Cancellation,
  conflict, refund-terminal and Vendor-blocked stories suppress the new event.
  Existing native timeline, operational rules, G1/G2, Delivered-sync, tracking,
  delivery and Finance authorities otherwise remain unchanged. No query/effect,
  shipment action, financial operation or permission is added.
- `src/pages/OrderDetailPage.test.tsx`: 36 new mocked G3 cases cover independent
  dates, all four roles, empty/equivalent/different native evidence, UTC-equivalent
  duplicate handling, missing/null/invalid dates, timestamp-only evidence, missing
  tracking/shipment data, pending reassignment, all four terminal stories, G1/G2
  preservation and delayed previous-allocation/Vendor responses. Mutations are
  explicitly asserted unused during rendering.
- One complete two-file execution: `npm run test -- src/pages/OrderDetailPage.test.tsx
  src/pages/OrdersPage.test.tsx --reporter=json
  --outputFile=/private/tmp/sporgym-p04-02e-tests.json`:
  **545 PASS / 0 FAIL / 0 SKIP / 0 PENDING** (Detail 411, Orders 134; new G3 36).
  No test correction or repeat run was needed. Frontend TypeScript/Vite build and
  git diff --check pass; existing bundle-size warning remains.
- Third changed file: this appended record. No shared timeline, API, backend,
  Shopify, financial, authorization or operational timestamp semantics changed.
  No local PostgreSQL, Docker, live provider/Shopify, production or browser smoke
  was used. Mocked component results are not real-backend/production evidence.
  Draft PR/CI state is reported separately. U1-U10 and full-width/panel-removal
  acceptance remain outside scope; no P04 completion, merge or deployment claimed.
