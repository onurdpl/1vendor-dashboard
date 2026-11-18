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
