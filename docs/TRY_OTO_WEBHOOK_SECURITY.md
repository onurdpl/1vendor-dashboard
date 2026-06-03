# Try OTO Webhook Security

## Purpose

`POST /webhooks/try-oto` can update local shipment execution state when Try OTO webhook ingestion is enabled. Provider-native Try OTO webhook signature semantics are currently unknown, so production ingestion must fail closed unless interim authenticity verification is configured.

This document describes the current interim guard. It is not provider-native signature verification.

## Current Verification Model

The backend supports an interim shared-secret check:

- Header: `x-try-oto-webhook-secret`
- Env: `TRY_OTO_WEBHOOK_SHARED_SECRET`
- Minimum production length: 32 characters
- Comparison: timing-safe comparison of fixed-length digests

The metadata returned by ingestion uses:

```json
{
  "authenticityVerification": {
    "mode": "shared_secret",
    "providerNativeSignatureVerified": false,
    "note": "Provider-native Try OTO signature semantics remain unknown."
  }
}
```

For local/test environments only, if `TRY_OTO_WEBHOOK_SHARED_SECRET` is missing, the route preserves existing development behavior and marks verification as:

```json
{
  "authenticityVerification": {
    "mode": "disabled_dev_only",
    "providerNativeSignatureVerified": false
  }
}
```

## Required Render Env

Set this before enabling Try OTO webhook ingestion in production:

```txt
TRY_OTO_WEBHOOK_SHARED_SECRET=<high-entropy shared secret, at least 32 characters>
```

Operational rule:

```txt
TRY_OTO_WEBHOOK_INGEST_ENABLED=false
```

must remain in place until `TRY_OTO_WEBHOOK_SHARED_SECRET` is configured and the provider webhook sender is configured to send the same value in `x-try-oto-webhook-secret`.

## Fail-Closed Behavior

In production:

- `TRY_OTO_WEBHOOK_INGEST_ENABLED=true` with no shared secret fails backend config validation.
- `TRY_OTO_WEBHOOK_INGEST_ENABLED=true` with a shared secret shorter than 32 characters fails backend config validation.
- Missing or invalid `x-try-oto-webhook-secret` returns `401`.
- Rejected requests do not call Try OTO ingestion and do not mutate shipment state.

## Unknowns

- Provider-native Try OTO webhook signature algorithm: unknown.
- Provider-native signed payload canonicalization: unknown.
- Provider-native timestamp/replay protection: unknown.

Do not replace this interim guard with guessed provider signature behavior. Provider-native verification should only be implemented after official Try OTO documentation or support confirmation.
