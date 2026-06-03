# Kargo Entegrator Webhook Security

## Purpose

`POST /webhooks/shipping/kargo-entegrator` can update local shipment execution state when sandbox webhook ingestion is enabled. Provider-native Kargo Entegrator webhook signature semantics are currently unknown, so production ingestion must fail closed unless interim authenticity verification is configured.

This document describes the current interim guard. It is not provider-native signature verification.

## Current Verification Model

The backend supports an interim shared-secret check:

- Header: `x-kargo-entegrator-webhook-secret`
- Env: `KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET`
- Minimum production length: 32 characters
- Comparison: timing-safe comparison of fixed-length digests

Rejected requests return metadata shaped like:

```json
{
  "authenticityVerification": {
    "mode": "shared_secret",
    "providerNativeSignatureVerified": false,
    "note": "Provider-native Kargo Entegrator signature semantics remain unknown."
  }
}
```

For local/test environments only, if `KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET` is missing, the route preserves existing development behavior. The internal authenticity mode for that path is `disabled_dev_only`.

## Required Render Env

Set this before enabling Kargo Entegrator webhook ingestion in production:

```txt
KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET=<high-entropy shared secret, at least 32 characters>
```

Operational rule:

```txt
KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED=false
```

must remain in place until `KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET` is configured and the webhook sender is configured to send the same value in `x-kargo-entegrator-webhook-secret`.

## Fail-Closed Behavior

In production:

- `KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED=true` with no shared secret fails backend config validation.
- `KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED=true` with a shared secret shorter than 32 characters fails backend config validation.
- Missing or invalid `x-kargo-entegrator-webhook-secret` returns `401`.
- Rejected requests do not call Kargo Entegrator ingestion and do not mutate shipment state.

## Scope

This guard does not change shipment business logic. Kargo Entegrator webhook ingestion remains disabled by default and still uses the existing sandbox/dev ingestion gate. The webhook does not create Shopify fulfillments, submit tracking to Shopify, mark orders delivered, or mutate finance state.

## Unknowns

- Provider-native Kargo Entegrator webhook signature algorithm: unknown.
- Provider-native signed payload canonicalization: unknown.
- Provider-native timestamp/replay protection: unknown.

Do not replace this interim guard with guessed provider signature behavior. Provider-native verification should only be implemented after official Kargo Entegrator documentation or support confirmation.
