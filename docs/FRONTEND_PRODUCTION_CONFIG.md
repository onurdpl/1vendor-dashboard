# Frontend Production Configuration

## Required Production Env

Production frontend builds must run against the real backend API. Mock mode is only for local development and tests.

Required Render frontend environment variables:

```txt
VITE_API_MODE=real
VITE_API_BASE_URL=<backend URL>
```

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
