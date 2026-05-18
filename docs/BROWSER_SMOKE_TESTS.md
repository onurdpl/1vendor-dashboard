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
