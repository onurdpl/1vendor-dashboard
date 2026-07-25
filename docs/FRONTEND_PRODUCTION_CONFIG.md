# Frontend Production Configuration

## Required Production Env

Production frontend builds must run against the real backend API. Mock mode is only for local development and tests.

Required Render frontend environment variables:

```txt
VITE_API_MODE=real
VITE_API_BASE_URL=<backend URL>
```

For the reversible mobile iOS same-origin auth test, use a path-only API base:

```txt
VITE_API_MODE=real
VITE_API_BASE_URL=/api
```

With this test mode, the browser calls `https://onevendor-dashboard.onrender.com/api/*`; the Render Static Site rewrite forwards those requests to the backend service. Auth remains HttpOnly Secure cookie based, CSRF remains enabled, and no localStorage token fallback is used.

If production is detected and `VITE_API_MODE` is missing or not set to `real`, frontend startup fails with:

```txt
Production frontend requires VITE_API_MODE=real.
```

## Production Detection

The frontend treats the build as production when:

- `VITE_APP_ENV=production`, or
- Vite production mode reports `import.meta.env.PROD=true`.

## Local Development

Local and test environments may still omit `VITE_API_MODE`. In that case the existing mock fallback remains available.

Do not deploy production frontend services with mock mode enabled.

## Mobile-Safe Same-Origin Proxy Test

Required Render Static Site rewrite order:

```txt
Source: /api/*
Destination: https://vendor-dashboard-backend-398h.onrender.com/*
Action: Rewrite

Source: /*
Destination: /index.html
Action: Rewrite
```

The `/api/*` rule must be before the SPA fallback. Do not add a `/admin/*` proxy rule because `/admin/*` is a frontend route namespace; backend admin APIs are reached through `/api/admin/*`.

Rollback:

```txt
VITE_API_BASE_URL=https://vendor-dashboard-backend-398h.onrender.com
```

Then remove the `/api/*` Static Site rewrite and keep the SPA fallback.

## Temporary login POST transport diagnostic

While the production same-origin `/api` auth transport issue is being isolated, the backend exposes:

```txt
POST /auth/diagnostics/public-login-transport
```

Through the same-origin frontend rewrite this is reached as:

```txt
POST /api/auth/diagnostics/public-login-transport
```

The request body is fixed and contains no credentials:

```json
{ "probe": "login-post-transport" }
```

The endpoint is public, does not authenticate, does not query the database, does not create a session, and does not set cookies. The frontend invokes it only after a login request fails before receiving an HTTP response, such as a login timeout or network-level failure.

Interpretation:

- login fails and the transport probe succeeds: the general JSON POST path through `/api` works; investigate `/auth/login` route-specific or intermittent behavior next.
- login fails and the transport probe also times out or has a network failure: browser/front-end origin/Render proxy POST transport failure is strongly supported.

Remove this temporary diagnostic after the production auth transport root cause is confirmed and no longer needs field verification.

## Auth flow Reference correlation

When the login screen shows a retryable error with a `Reference: auth-...` value, that reference is the auth flow ID for that single login submission. Search frontend diagnostics and backend logs for the exact value as `flowId`.

The same `flowId` is sent on the public login readiness probe, login POST, optional safe POST transport probe, backend auth route entry, backend auth completion/failure, and frontend final success/error state. Logs include stage, outcome, duration, and HTTP status when available. They must not include passwords, email values, cookies, tokens, authorization headers, CSRF values, or full request bodies.
