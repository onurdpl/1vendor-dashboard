# Browser Smoke Tests

This suite adds a small Playwright browser layer for runtime regressions that unit tests can miss: login bootstrapping, deep-link selection, support replies, vendor switching, and expired-session redirects.

## Run

```bash
npm run smoke:browser
```

The Playwright config starts the Vite app in mock API mode by default:

```bash
VITE_API_MODE=mock npm run dev -- --host 127.0.0.1
```

If Chromium is not installed locally yet, run:

```bash
npx playwright install chromium
```

## Scope

These eight tests intentionally use stable mock data and lightweight assertions. They do not use a real backend or PostgreSQL, call Shopify, mutate payout/refund/shipment behavior, or depend on production identifiers.

Covered flows:

- Login and dashboard bootstrap without an Unauthorized flash.
- Finance linked order navigation into the selected Orders workspace row.
- Return detail linked order navigation.
- Vendor support ticket reply thread.
- Vendor communication inbox and linked support context.
- Admin vendor switching without stale cross-vendor selection.
- Expired-session redirect with destination restoration.

## Real-backend Financial Correction smokes

The REVIEW vendor-credit, DRAFT vendor-deduction, PAID vendor-deduction, and zero-net
acknowledgement smokes use
normal Admin login, a built Vite frontend, a real local backend, and separate disposable
PostgreSQL 16 databases.
They are separate from the
mock-backed `npm run smoke:browser` command.

Ensure PostgreSQL 16 is running locally, ports 4000 and 5173 are free, and Chromium is
installed. Then run:

```bash
BROWSER_SMOKE_ALLOW_LOCAL_DB=1 npm run smoke:browser:real
```

The runner connects to the local `postgres` maintenance database (override only with
`BROWSER_SMOKE_ADMIN_DATABASE_URL=postgresql://<local-user>@localhost/postgres` using local
credentials if needed; the hostname must be `localhost`), creates a uniquely named
`vendor_dashboard_browser_smoke_*` database for each scenario, runs the canonical fresh
bootstrap, seeds a real Argon2id Admin and the scenario's persisted finance fixture,
and verifies canonical eligibility before opening Chromium. REVIEW, DRAFT, PAID, and zero-net run
sequentially, never sharing a database. For each scenario the runner starts backend and
frontend with explicit local-only integration settings, verifies the applied result,
and drops only the database it created even if the test fails.
The Admin logs in through `/login`; no cookie or auth bypass is injected. The runner
does not inherit Shopify, Sopyo, bank/provider, or production database settings or
require production provider credentials.

The REVIEW browser test covers an eligible `VENDOR_CREDIT`: it requires an Admin
reason and an initially unchecked EFT-not-sent attestation before the dedicated REVIEW
correction POST. It confirms the unavailable-credit message is absent, the correction
is applied, the original REVIEW payout is cancelled, and no replacement payout is
created automatically. The attestation is a UI control, not verification of external
bank/EFT state.

The DRAFT browser test covers an eligible `VENDOR_DEDUCTION`: it requires an Admin reason
but explicitly verifies that no EFT-not-sent attestation appears. It observes the real
DRAFT correction POST and verifies that the original unpaid DRAFT payout is cancelled,
one deduction with approved coverage is created, no correction-linked vendor debt is
created, and no replacement payout is created automatically.

The PAID browser test covers an eligible `VENDOR_DEDUCTION`: it requires an Admin reason
but no EFT-not-sent attestation. It observes the real PAID correction POST and verifies
that the historical PAID payout and approved settlement remain unchanged, a separate
correction-linked vendor debt is created, the payout is not cancelled, and no replacement
payout is created automatically.

The zero-net browser test covers a real Admin acknowledgement of an eligible TRY
preview with no vendor monetary effect. It requires no Admin reason or EFT attestation.
The DB post-check verifies one acknowledgement and one baseline claim, with no monetary
correction authority, credit, deduction, vendor debt, correction settlement or payout
effect, new payout, or new settlement. The original SALE/REFUND ledgers and accepted/
incoming evidence remain unchanged. PAID credit, approved/no-payout, DRAFT credit,
and REVIEW deduction routes are not covered here.

GitHub CI installs Chromium with the repository Playwright CLI and runs
`npm run smoke:browser:real` as a required step in the existing `build-and-test` job.
The CI step sets `BROWSER_SMOKE_ALLOW_LOCAL_DB=1` and uses
`BROWSER_SMOKE_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`
for its local PostgreSQL service. If that step fails, CI uploads `test-results/` with
three-day retention; Playwright may place a failure screenshot and trace there. The
real-smoke config uses a list reporter, not an HTML report. The failure-artifact path
is configured but has not been exercised by the successful hosted run.
