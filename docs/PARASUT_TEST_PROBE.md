# Paraşüt Commission Invoice Test Probe

## Purpose

This is a controlled test-only probe for Sporgym -> Vendor commission invoice behavior in a Paraşüt test company.

It exists only to inspect Paraşüt API behavior for Sporgym commission accounting. It is not part of the normal backend runtime and must not be used for customer invoice flows.

## Required Env Vars

Configure values in `backend/.env` or pass them inline to the command.

Base gates:

- `PARASUT_ENABLED=true`
- `PARASUT_TEST_MODE=true`
- `NODE_ENV` must not be `production`
- `PARASUT_BASE_URL=https://api.parasut.com`
- `PARASUT_COMPANY_ID=`

OAuth/token options:

- `PARASUT_CLIENT_ID=`
- `PARASUT_CLIENT_SECRET=`
- `PARASUT_REDIRECT_URI=`
- `PARASUT_GRANT_TYPE=password`
- `PARASUT_USERNAME=`
- `PARASUT_PASSWORD=`
- `PARASUT_ACCESS_TOKEN=`
- `PARASUT_REFRESH_TOKEN=`

Probe controls:

- `PARASUT_PROBE_DRY_RUN=true`
- `PARASUT_PROBE_ALLOW_CREATE=false`
- `PARASUT_PROBE_ALLOW_LIFECYCLE=false`
- `PARASUT_PROBE_CONFIRM=`

Probe data:

- `PARASUT_PROBE_VENDOR_NAME=Sporgym Commission Test Vendor`
- `PARASUT_PROBE_VENDOR_EMAIL=`
- `PARASUT_PROBE_VENDOR_TAX_NUMBER=`
- `PARASUT_PROBE_VENDOR_TAX_OFFICE=`
- `PARASUT_PROBE_COMMISSION_PRODUCT_NAME=Sporgym Marketplace Commission Test`
- `PARASUT_PROBE_COMMISSION_PRODUCT_CODE=SPORGYM-COMMISSION-TEST`
- `PARASUT_PROBE_COMMISSION_AMOUNT=1`
- `PARASUT_PROBE_CURRENCY=TRL`
- `PARASUT_PROBE_VAT_RATE=20`
- `PARASUT_PROBE_INVOICE_DESCRIPTION=Sporgym marketplace commission test probe. No customer invoice.`

## Command

Dry-run, default and safe:

```bash
npm run parasut:commission-probe
```

## Temporary Render Runtime Auth Diagnostic

The deployed backend includes a temporary no-network env diagnostic endpoint for checking Paraşüt runtime env shape from the Render backend runtime:

```text
GET /admin/probes/parasut/env-check
```

This endpoint:

- requires a logged-in admin session;
- requires `ADMIN_PROBES_ENABLED=true`;
- reports only presence/absence for `PARASUT_CLIENT_ID`, `PARASUT_CLIENT_SECRET`, `PARASUT_USERNAME`, `PARASUT_PASSWORD`, `PARASUT_COMPANY_ID`, `PARASUT_REDIRECT_URI`, and `PARASUT_GRANT_TYPE`;
- does not return client secrets, passwords, usernames, tokens, or credential values;
- warns when `PARASUT_GRANT_TYPE` is missing or not configured as `password`;
- performs no Paraşüt API calls and no writes.

The deployed backend includes a temporary read-only diagnostic endpoint for checking Paraşüt runtime env, OAuth, and `/v4/me` from the Render backend runtime:

```text
GET /admin/probes/parasut/auth-me
```

This endpoint:

- requires a logged-in admin session;
- requires `ADMIN_PROBES_ENABLED=true`;
- requires `PARASUT_TEST_MODE=true`;
- requires `PARASUT_BASE_URL=https://api.heroku-staging.parasut.com`;
- performs only an OAuth token request and `GET /v4/me`;
- does not create contacts, products, invoices, payments, e-documents, or lifecycle actions;
- does not return access tokens, refresh tokens, passwords, client secrets, or full upstream response bodies.

Keep `ADMIN_PROBES_ENABLED=false` unless actively diagnosing Paraşüt runtime configuration. Disable the endpoint again after the runtime check is complete.

## Confirmed Auth Notes

Paraşüt support confirmed:

- `PARASUT_COMPANY_ID` / `firma_no` is correct when it matches the numeric company id visible in the Paraşüt app URL.
- The configured `PARASUT_REDIRECT_URI` is already registered correctly.
- Authorization-code flow is not mandatory for this server-side probe.
- OAuth password grant can be used for the current controlled probe flow.
- `PARASUT_CLIENT_ID` and `PARASUT_CLIENT_SECRET` must belong to the same Paraşüt email/account used in `PARASUT_USERNAME`.
- For e-invoice tests, Paraşüt VKN `6490512763` can be used because the e-invoice taxpayer list may not be current.

Live test probe with creation enabled:

```bash
PARASUT_ENABLED=true \
PARASUT_TEST_MODE=true \
PARASUT_PROBE_DRY_RUN=false \
PARASUT_PROBE_ALLOW_CREATE=true \
PARASUT_PROBE_CONFIRM=CREATE_COMMISSION_INVOICE_TEST \
npm run parasut:commission-probe
```

Cancel/recover/archive lifecycle probe, only after accounting/test approval:

```bash
PARASUT_ENABLED=true \
PARASUT_TEST_MODE=true \
PARASUT_PROBE_DRY_RUN=false \
PARASUT_PROBE_ALLOW_CREATE=true \
PARASUT_PROBE_ALLOW_LIFECYCLE=true \
PARASUT_PROBE_CONFIRM=CREATE_COMMISSION_INVOICE_TEST_AND_RUN_LIFECYCLE \
npm run parasut:commission-probe
```

## What It Creates

Only when dry-run is disabled and create confirmation is present, the probe may create:

- one vendor contact if no matching contact is found by `PARASUT_PROBE_VENDOR_NAME`;
- one commission product/service item if no matching product is found by code/name;
- one Sporgym -> Vendor commission sales invoice in the configured Paraşüt test company.

The probe then fetches the created invoice with:

```text
include=contact,details,payments,payments.transaction,tags
```

## What It Does NOT Create

The probe does not create:

- customer sales invoices;
- vendor customer invoices;
- vendor-owned Paraşüt account connections;
- e-Fatura/e-Arşiv formalization requests;
- e-SMM formalization requests;
- payout records;
- finance calculation changes;
- database records.

It does not run from the normal app flow.

## Cleanup / Cancel Guidance

By default, the probe does not cancel, recover, archive, or otherwise mutate lifecycle state after creating the test commission invoice.

Use Paraşüt UI or accountant-approved test cleanup steps for the created test contact/product/invoice. The `cancel/recover/archive` probe is separately gated by:

- `PARASUT_PROBE_ALLOW_LIFECYCLE=true`
- `PARASUT_PROBE_CONFIRM=CREATE_COMMISSION_INVOICE_TEST_AND_RUN_LIFECYCLE`

Do not run lifecycle mutation probes against a production Paraşüt company.

## Known Risks

- Paraşüt endpoint payload details may still require adjustment after the first test response.
- Refresh-token rotation may return a new `refresh_token`; store the newest token in secret storage before future probes.
- The probe uses the configured `firma_no`/company context. A wrong `PARASUT_COMPANY_ID` can create test records in the wrong company.
- Invoice cancel/recover/archive legal/accounting meaning remains unknown until accountant-approved.
- Rate limit is 10 requests per 10 seconds; bulk behavior is out of scope for this probe.
