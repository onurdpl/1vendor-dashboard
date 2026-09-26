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

The tests intentionally use stable mock data and lightweight assertions. They do not call Shopify, mutate payout/refund/shipment behavior, or depend on production identifiers.

Covered flows:

- Login and dashboard bootstrap without an Unauthorized flash.
- Finance linked order navigation into the selected Orders workspace row.
- Return detail linked order navigation.
- Vendor support ticket reply thread.
- Vendor communication inbox and linked support context.
- Admin vendor switching without stale cross-vendor selection.
- Expired-session redirect with destination restoration.

## Local real-backend Financial Correction smoke

The separate REVIEW vendor-credit smoke uses normal Admin login, a built Vite frontend,
a real local backend, and a disposable PostgreSQL 16 database. It does not change the
mock-backed `npm run smoke:browser` command or run in CI yet.

Ensure PostgreSQL 16 is running locally, ports 4000 and 5173 are free, and Chromium is
installed. Then run:

```bash
BROWSER_SMOKE_ALLOW_LOCAL_DB=1 npm run smoke:browser:real
```

The runner connects to the local `postgres` maintenance database (override only with
`BROWSER_SMOKE_ADMIN_DATABASE_URL=postgresql://<local-user>@localhost/postgres` using local
credentials if needed), creates a uniquely named `vendor_dashboard_browser_smoke_*`
database, bootstraps it, seeds a real Argon2id Admin and the proven REVIEW-credit
finance fixture, and verifies canonical eligibility before opening Chromium. It
starts backend and frontend with explicit local-only integration settings, verifies
the applied result, and drops only the database it created even if the test fails.
The Admin logs in through `/login`; no cookie or auth bypass is injected. The runner
does not inherit Shopify, Sopyo, bank/provider, or production database settings.

This is a local-first release check; CI wiring is intentionally deferred.
