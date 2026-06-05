# Lidio Sandbox Probe Plan

## Scope
- This document defines environment documentation and a minimal read-only sandbox probe plan only.
- Do not implement runtime code from this plan until the read-only contract is confirmed.
- Do not execute payments, refunds, releases, `/DistributeSubsellerPayout`, `/BalanceTransfer`, `/StartPayout`, or any external money movement.
- Do not create payment routes, database migrations, card storage, shipping/provider logic, Try OTO/Kargonomi work, or finance ledger persistence.
- The first executable probe must be read-only.

## Sandbox Environment Variables
Use placeholders for all secrets. Do not commit real tokens, keys, passwords, or credentials.

```bash
LIDIO_ENABLED=true
LIDIO_BASE_URL=https://test.lidio.com/api
LIDIO_MERCHANT_CODE=SPORGYM
LIDIO_AUTHORIZATION_SCHEME=MxS2S
LIDIO_AUTHORIZATION_TOKEN=<secret>
LIDIO_MERCHANT_KEY=<secret>
LIDIO_API_PASSWORD=<secret>
LIDIO_SUBSELLER_PROFILE_ID=3
LIDIO_ALLOW_WRITE_PROBE=false
```

Notes:
- Shared env templates should keep placeholders empty and avoid committing real support values. See `docs/LIDIO_ENV_SETUP.md`.
- `LIDIO_ENABLED=true` is required for the executable read-only probe.
- `LIDIO_BASE_URL=https://test.lidio.com/api` is the support-provided test base URL.
- `developer.lidio.com` and `lab.lidio.com` are documentation URLs, not API base URLs, unless Lidio explicitly confirms otherwise.
- `LIDIO_MERCHANT_CODE=SPORGYM` is support-confirmed.
- `LIDIO_AUTHORIZATION_SCHEME=MxS2S` is support-confirmed.
- `LIDIO_AUTHORIZATION_TOKEN` is the secret token value used after the `MxS2S` scheme in `Authorization: MxS2S <token>`.
- `LIDIO_MERCHANT_KEY` is for ReturnURL hash verification.
- `LIDIO_API_PASSWORD` is for paymentNotification `parameterhash` verification.
- The paymentNotification `parameterhash` formula is still unknown.
- `LIDIO_SUBSELLER_PROFILE_ID=3` is support-confirmed.
- The first read-only probe validates only `LIDIO_ENABLED`, `LIDIO_BASE_URL`, `LIDIO_MERCHANT_CODE`, and `LIDIO_AUTHORIZATION_TOKEN`.
- `LIDIO_MERCHANT_KEY` and `LIDIO_API_PASSWORD` may remain empty until ReturnURL and notification validation probes are approved.
- `LIDIO_ALLOW_WRITE_PROBE=true` is required only for the opt-in `CreateSubseller` sandbox write probe.

## Confirmed Read-Only Probe Result
- Probe date: 2026-06-05.
- Base URL: `https://test.lidio.com/api`.
- Endpoint called: `POST /GetSubsellerList`.
- Request headers included `MerchantCode: SPORGYM` and `Authorization: MxS2S <token>`.
- HTTP status: `200`.
- Response shape: `{ result: "Success", resultMessage: null, subsellerList: [] }`.
- `writesPerformed=false`.
- No Lidio error message was returned.
- MerchantCode plus `MxS2S` token authentication is confirmed for the read-only sandbox probe.
- No payment, refund, release, unrelease, `/DistributeSubsellerPayout`, `/BalanceTransfer`, or `/StartPayout` call was made.

Implications:
- Sandbox base URL `https://test.lidio.com/api` is confirmed.
- Read-only authentication probe passed.
- Empty `subsellerList` means no API-visible subsellers were returned in this account/scope. Do not infer that subseller creation failed or that marketplace is inactive.

## Safe Read-Only Probe Order
1. Validate environment presence only.
   - Confirm required variables exist.
   - Do not print secret values.
   - Do not persist secrets.
2. Call `/GetSubsellerList` with:
   - Header `MerchantCode: SPORGYM`
   - Header `Authorization: MxS2S <token>`
   - Request model `GetSubsellerListRequest`
   - Purpose: confirm read-only authentication and marketplace API availability.
   - Command: `npm run lidio:sandbox-probe`
3. Optionally call `/PayoutAccountInquiry` only if `payoutSourceAccount` is known.
   - This is read-only by schema description.
   - Do not invent or guess `payoutSourceAccount`.
4. Do not call `/CreateSubseller` until read-only auth is confirmed.
5. Do not call `/ProcessPayment` or `/StartHostedPaymentProcess` until auth and sandbox contract are confirmed.
6. Do not call `/Release`, `/Unrelease`, `/DistributeSubsellerPayout`, `/BalanceTransfer`, or `/StartPayout` in the first probe.

## Explicitly Forbidden In First Probe
- `/ProcessPayment`
- `/StartHostedPaymentProcess`
- `/StartHostedPrePaymentProcess`
- `/Refund`
- `/Release`
- `/Unrelease`
- `/DistributeSubsellerPayout`
- `/BalanceTransfer`
- `/StartPayout`
- Any card data collection or card tokenization
- Any route, database, checkout, shipping, payout, or finance-ledger implementation

## Next Planned PoC: CreateSubseller Sandbox Probe
- `CreateSubseller` is not read-only.
- It must use test-only vendor data.
- It must not create payments or payouts.
- It must be implemented as a separate opt-in command.
- Command: `npm run backend:lidio:create-subseller-probe`.
- The command exits before sending any request unless `LIDIO_ALLOW_WRITE_PROBE=true`.
- It creates only sandbox test subseller data and must not be used in production.
- It does not store the returned subseller in the database.
- Previous live attempt reached Lidio but failed with `InvalidParameter` because the generated `vkntckn` did not pass Lidio validation.
- `vkntckn` must pass Lidio validation even in sandbox.
- The probe uses the checksum-valid dummy VKN `9999999994` as fake sandbox-only test data. Do not replace it with a real personal or company tax number.
- Output must include the endpoint, HTTP status, Lidio `result` / `resultMessage`, returned `subsellerId` when present, and `writesPerformed=true` only if the request was actually sent.
- It must not call `/ProcessPayment`, `/StartHostedPaymentProcess`, `/Release`, `/Unrelease`, `/DistributeSubsellerPayout`, `/BalanceTransfer`, or `/StartPayout`.
- It should run only after an explicit approval for a mutating sandbox vendor-onboarding probe.

## Unresolved Questions
- What is the paymentNotification `parameterhash` formula?
- What is the ReturnURL hash formula for Sporgym's configured flow?
- Are sandbox marketplace APIs active for `SPORGYM`?

## Readiness Gate
The read-only `/GetSubsellerList` probe has succeeded. Any later mutating or payment-adjacent operation must be separately approved and documented before execution.
