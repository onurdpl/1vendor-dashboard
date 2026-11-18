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
