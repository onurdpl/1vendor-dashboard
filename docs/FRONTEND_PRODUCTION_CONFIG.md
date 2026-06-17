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
