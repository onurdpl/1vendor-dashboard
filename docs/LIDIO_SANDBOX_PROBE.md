# Lidio Sandbox Probe Plan

## Scope
- This document defines environment documentation and a minimal read-only sandbox probe plan only.
- Do not implement runtime code from this plan until the read-only contract is confirmed.
- Do not execute payments, refunds, releases, `/DistributeSubsellerPayout`, `/BalanceTransfer`, `/StartPayout`, or any external money movement.
- Do not create payment routes, database migrations, card storage, shipping/provider logic, Try OTO/Kargonomi work, or finance ledger persistence.
- The first executable probe must be read-only.

## Required Environment Variables
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
```

Notes:
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

## Unresolved Questions
- Does the active sandbox accept `POST /GetSubsellerList` with an empty `GetSubsellerListRequest` body exactly as the OpenAPI schema indicates?
- What is the paymentNotification `parameterhash` formula?
- What is the ReturnURL hash formula for Sporgym's configured flow?
- Are sandbox marketplace APIs active for `SPORGYM`?

## Readiness Gate
Only after the read-only `/GetSubsellerList` probe succeeds should later sandbox steps be considered. Any later mutating or payment-adjacent operation must be separately approved and documented before execution.
