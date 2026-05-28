# Odoo Discovery

## Purpose

This document tracks the minimal Odoo API probe for sending one Shopify/vendor allocation fixture to Odoo as a safe draft/test Sales Order.

The probe is not connected to Shopify webhooks or production order flow.

## Scope

Allowed:

- Authenticate to Odoo from a CLI probe.
- Inspect required fields for `sale.order` and `sale.order.line`.
- Look up or create one clearly marked test vendor partner.
- Create one draft/test Sales Order only when explicitly enabled.

Forbidden:

- Customer invoice creation.
- Vendor customer invoice creation.
- Official accounting entries.
- Shipping, payout, settlement, invoice, or vendor billing logic changes.
- Live Shopify webhook integration.

## Required Credentials

Credentials are read only from `backend/.env`.

```text
ODOO_ENABLED=false
ODOO_URL=
ODOO_DB=
ODOO_USERNAME=
ODOO_API_KEY=
ODOO_DRY_RUN=true
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

Live test mode requires:

```text
ODOO_ENABLED=true
ODOO_DRY_RUN=false
NODE_ENV=development
```

The command refuses to run unless `NODE_ENV` is `development` or `test`, and refuses to run if `ODOO_DRY_RUN` is not explicitly set in `backend/.env`.

## Tested Endpoint Method

Planned method:

- JSON-RPC endpoint: `/jsonrpc`
- Auth service: `common.authenticate`
- Object service: `object.execute_kw`

No XML-RPC dependency is added.

## Current Test Status

- Auth worked: unknown, not yet live-tested.
- Models inspected: planned `sale.order`, `sale.order.line`, `res.partner`.
- Required fields observed: unknown until live probe runs `fields_get`.
- Draft order creation succeeded: unknown until live probe runs with `ODOO_ENABLED=true` and `ODOO_DRY_RUN=false`.
- Validation errors from Odoo: unknown until live probe.

## Required Field Handling

Before creating a draft Sales Order, the probe inspects:

- `sale.order.fields_get`
- `sale.order.line.fields_get`

If Odoo reports required writable fields that are not present in the safe test payload, the probe stops and prints the missing field names.

## Draft/Test Sales Order Mapping

The probe maps one internal fixture to:

- `res.partner`: test vendor partner.
- `sale.order.partner_id`: test vendor partner id.
- `sale.order.client_order_ref`: `SPORGYM-PARASUT-PROBE` or configured reference.
- `sale.order.origin`: generated Shopify probe order name.
- `sale.order.note`: clearly marked test-only note.
- `sale.order.order_line`: one test line with name, quantity, and unit price.

No invoice is created from the Sales Order.

## Known Risks

- Some Odoo deployments require product, unit-of-measure, pricelist, company, fiscal position, or tax fields on sales order lines.
- If those fields are required, the probe must stop and report missing field names rather than guessing.
- Odoo custom modules may enforce additional required fields.
- A live run with `ODOO_DRY_RUN=false` can create a test partner and draft Sales Order in the configured Odoo database.
- API key, password, token, and full credential values must never be logged.
