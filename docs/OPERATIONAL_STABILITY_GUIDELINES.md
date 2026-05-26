# Operational Stability Guidelines

This workspace is an operational control center. Production data can be partial, stale, malformed, or temporarily inconsistent while Shopify, providers, webhooks, and manual recovery jobs reconcile. UI rendering should degrade safely without hiding real backend failures.

## Defensive Rendering Principles

- Treat API records as operational evidence, not guaranteed complete view models.
- Format dates, currencies, statuses, and arrays through safe helpers when data crosses page boundaries.
- Render `Unknown`, `Not synced`, `Not configured`, or `—` when a display value is missing or malformed.
- Preserve field paths, statuses, and diagnostic keys when useful, but redact secrets and PII values.
- Keep vendor isolation checks outside render fallbacks; never use a fallback to broaden access.

## Common Safe Fallbacks

- Invalid dates: show `—` or the section-specific fallback such as `Not synced`.
- Missing arrays: treat as an empty list and render the normal empty state.
- Missing nested relations: render the parent record with an unavailable/unknown child state.
- Unknown statuses: render a neutral `Unknown` label instead of throwing.
- Invalid currency input: render a safe formatted fallback and keep estimate/unknown wording honest.

## When To Degrade Safely

Use section-level degraded rendering when:

- a timestamp is invalid;
- a relation is absent while the parent record is still usable;
- an optional diagnostics snapshot is malformed;
- a secondary widget such as support, finance, or provider diagnostics fails;
- a stale query cache has partial data during background refetch.

## When To Fail Loudly

Let errors surface through API error states or route boundaries when:

- authentication or authorization fails;
- vendor scope cannot be resolved;
- required route identifiers are missing;
- backend requests return explicit 4xx/5xx errors and no stale data exists;
- a mutation cannot safely determine whether a provider or Shopify operation ran.

## Route Boundary Philosophy

Route error boundaries are a last resort for unexpected React render exceptions. Expected production data problems should be handled inside the page or section using local fallbacks and retry surfaces. A single malformed card must not crash Orders, Returns, Inbox, Support, Finance, Vendor Profile, Automation, or Diagnostics.

## Malformed Production Data Handling

- Prefer small shared helpers over repeated local `new Date(...)`, `.map(...)`, `.toLowerCase()`, or currency formatting assumptions.
- Keep fallback copy operational and honest.
- Log client query/render errors with route and endpoint context, but do not expose stack traces to vendor users.
- Add regression fixtures for invalid dates, null nested relations, missing finance previews, empty support records, partial return/refund data, and unknown statuses when a crash is fixed.
