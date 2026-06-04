# Lidio Environment Setup

## Scope
- This document covers Lidio backend environment configuration only.
- Do not commit real Lidio tokens, keys, passwords, or credentials.
- Do not use these settings to execute payments, refunds, releases, payout distributions, balance transfers, payouts, or webhooks without a separately approved implementation scope.

## Required Variables
Use placeholders in templates and real values only in private deployment/runtime environment stores.

```bash
LIDIO_ENABLED=true
LIDIO_BASE_URL=
LIDIO_MERCHANT_CODE=
LIDIO_AUTHORIZATION_SCHEME=MxS2S
LIDIO_AUTHORIZATION_TOKEN=
LIDIO_MERCHANT_KEY=
LIDIO_API_PASSWORD=
LIDIO_SUBSELLER_PROFILE_ID=3
```

## Configuration Notes
- `LIDIO_ENABLED` gates Lidio sandbox configuration validation.
- `LIDIO_BASE_URL` is the Lidio API base URL for the active environment.
- `LIDIO_MERCHANT_CODE` is sent in Lidio request headers as `MerchantCode`.
- `LIDIO_AUTHORIZATION_SCHEME` defaults to `MxS2S`.
- `LIDIO_AUTHORIZATION_TOKEN` is the secret token value used in the authorization header.
- Lidio authorization header format is `Authorization: MxS2S <token>`.
- `LIDIO_MERCHANT_KEY` is reserved for ReturnURL hash validation.
- `LIDIO_API_PASSWORD` is reserved for paymentNotification `parameterhash` validation.
- `LIDIO_SUBSELLER_PROFILE_ID` defaults to `3`.

## Startup Validation
When `LIDIO_ENABLED=true`, backend startup validates only:

- `LIDIO_BASE_URL`
- `LIDIO_MERCHANT_CODE`
- `LIDIO_AUTHORIZATION_TOKEN`

`LIDIO_MERCHANT_KEY` and `LIDIO_API_PASSWORD` are intentionally not startup-required yet because they are not needed for the first read-only sandbox probe.
