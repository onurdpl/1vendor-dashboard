# Odoo Discovery

## Purpose

This document tracks the minimal Odoo API probe for sending one Shopify/vendor allocation fixture to Odoo as a safe draft/test Sales Order.

The probe is not connected to Shopify webhooks or production order flow.

## Scope

Allowed:

- Authenticate to Odoo from a CLI probe.
- Inspect required fields for safe discovery models.
- Read up to three safe sample ids/names per inspected model.
- Print unknown when a model is unavailable.

Forbidden:

- Partner creation.
- Sales Order creation.
- Customer invoice creation.
- Vendor customer invoice creation.
- Official accounting entries.
- Stock moves.
- Shipping, payout, settlement, invoice, or vendor billing logic changes.
- Live Shopify webhook integration.

## Required Credentials

Credentials are read from runtime environment variables first. `backend/.env` is used only as a local fallback for keys that are not present in `process.env`.

Render dashboard environment variables are not the same as local `backend/.env`; do not copy Render secrets into the repo or into chat.

```text
ODOO_ENABLED=false
ODOO_URL=
ODOO_DB=
ODOO_USERNAME=
ODOO_API_KEY=
ODOO_DRY_RUN=true
ODOO_DISCOVERY_ONLY=true
```

Optional safe fixture defaults:

```text
ODOO_PROBE_REFERENCE=SPORGYM-PARASUT-PROBE
ODOO_PROBE_VENDOR_NAME=Test Vendor Ltd
ODOO_PROBE_VENDOR_TAX_NUMBER=1111111111
ODOO_PROBE_VENDOR_EMAIL=test-vendor@example.invalid
ODOO_PROBE_COMMISSION_AMOUNT=1
ODOO_PROBE_VAT_RATE=20
```

## Command

Dry-run mode:

```bash
npm run probe:odoo:order
```

Live discovery mode requires:

```text
ODOO_ENABLED=true
ODOO_DRY_RUN=false
ODOO_DISCOVERY_ONLY=true
NODE_ENV=development
```

The command refuses to run unless `NODE_ENV` is `development` or `test`, and refuses to run if `ODOO_DRY_RUN` is not explicitly set in `process.env` or `backend/.env`.

If `ODOO_DRY_RUN=false` and `ODOO_DISCOVERY_ONLY` is not `true`, the command reports `LIVE_CREATE_BLOCKED` and exits before any create/update call.

## Render Execution Notes

Run the probe from the Render backend service shell or a one-off job so it uses Render-managed environment variables.

Exact Render Shell command:

```bash
ODOO_ENABLED=true ODOO_DRY_RUN=false ODOO_DISCOVERY_ONLY=true npm run probe:odoo:order
```

If Render service root is configured as `backend`, use the repository-root script through the parent directory:

```bash
ODOO_ENABLED=true ODOO_DRY_RUN=false ODOO_DISCOVERY_ONLY=true npm --prefix .. run probe:odoo:order
```

Expected startup report:

- `envSource`: `process.env`, `backend/.env`, or `mixed`
- Odoo gate values for `ODOO_ENABLED`, `ODOO_DRY_RUN`, and `ODOO_DISCOVERY_ONLY`
- yes/no presence checks for `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, and `ODOO_API_KEY`

The startup report must not print credential values.

## Tested Endpoint Method

Planned method:

- JSON-RPC endpoint: `/jsonrpc`
- Version/info service: `common.version`
- Auth service: `common.authenticate`
- Object service: `object.execute_kw`
- Model field inspection: `fields_get`
- Safe sample reads: `search_read`

No XML-RPC dependency is added.

## Current Test Status

- Auth worked: unknown, not yet live-tested.
- Models inspected: planned `sale.order`, `sale.order.line`, `res.partner`, `product.product`, `account.tax`, `res.company`, `res.currency`.
- Required fields observed: unknown until live probe runs `fields_get`.
- Draft order creation succeeded: not attempted in discovery-only mode.
- Validation errors from Odoo: unknown until live probe.

## Live Discovery Results

Fill this section after running with `ODOO_ENABLED=true`, `ODOO_DRY_RUN=false`, and `ODOO_DISCOVERY_ONLY=true`.

- Auth result: unknown.
- User/company result: unknown.
- Available sales models:
  - `sale.order`: unknown.
  - `sale.order.line`: unknown.
- Available accounting models:
  - `account.tax`: unknown.
- Available products/taxes/currencies:
  - `product.product`: unknown.
  - `account.tax`: unknown.
  - `res.currency`: unknown.
- Company model:
  - `res.company`: unknown.
- Partner model:
  - `res.partner`: unknown.
- Required fields: unknown.
- Useful fields found: unknown.
- First safe sample ids/names: unknown.
- Odoo validation errors: unknown.
- Unknowns:
  - Whether custom modules require additional Sales Order fields.
  - Whether product/tax/currency mappings are needed before any future create probe.
  - Whether a draft Sales Order can be created without product records.

## Required Field Handling

Before any future draft Sales Order creation is allowed, the probe must inspect:

- `sale.order.fields_get`
- `sale.order.line.fields_get`

If Odoo reports required writable fields that are not present in the safe test payload, the probe stops and prints the missing field names.

## Draft/Test Sales Order Mapping

The dry-run planner maps one internal fixture to:

- `res.partner`: test vendor partner.
- `sale.order.partner_id`: test vendor partner id.
- `sale.order.client_order_ref`: `SPORGYM-PARASUT-PROBE` or configured reference.
- `sale.order.origin`: generated Shopify probe order name.
- `sale.order.note`: clearly marked test-only note.
- `sale.order.order_line`: one test line with name, quantity, and unit price.

Current live discovery mode does not create the Sales Order. No invoice is created.

## Known Risks

- Some Odoo deployments require product, unit-of-measure, pricelist, company, fiscal position, or tax fields on sales order lines.
- If those fields are required, the probe must stop and report missing field names rather than guessing.
- Odoo custom modules may enforce additional required fields.
- A live discovery run with `ODOO_DRY_RUN=false` and `ODOO_DISCOVERY_ONLY=true` authenticates and reads metadata/safe samples only.
- Draft Sales Order creation remains blocked until discovery results are reviewed and a future task explicitly permits it.
- API key, password, token, and full credential values must never be logged.
