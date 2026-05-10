# Deployment Readiness

This application is a Vite + React single-page app that uses `BrowserRouter`.
Production hosting must support SPA fallback/rewrite behavior so direct visits and refreshes on nested routes do not return 404 responses.

## Supported Hosting Assumptions

- Static hosting is supported.
- The host must rewrite unknown routes to `index.html`.
- The app does not require a backend to build or serve the frontend bundle.
- No environment variables are required for the current frontend build.

## Fallback Strategy

- `public/_redirects` is configured for Netlify-style SPA fallback:
  - `/* /index.html 200`
- `vite.config.ts` also emits a generated `404.html` during build.
- This combination helps direct route refreshes and deep links on static hosts that honor one of these fallback mechanisms.

## BrowserRouter Note

- The app intentionally uses `BrowserRouter`.
- Do not switch to `HashRouter` for deployment.
- If the host does not support SPA rewrites, deep links such as `/orders/ORD-10482` or `/finance` will 404 on refresh or direct access.

## Hosting Guidance

- Recommended: a static host with explicit SPA rewrite support, such as Netlify.
- Other static hosts are fine only if they rewrite all unknown routes to `index.html`.
- GitHub Pages is not a good fit for this setup unless a custom rewrite strategy is added, because it does not natively provide SPA fallback for `BrowserRouter` routes.

## Required Commands

```bash
npm ci
npm run build
npm run test
```

## Deployment Smoke Checklist

- `/login`
- login flow succeeds
- `/orders`
- `/orders/:orderId` direct refresh works
- `/returns/:returnId` direct refresh works
- `/finance` direct refresh works
- `/automation` direct refresh works
- logout returns to `/login`
- invalid routes show the not-found page

## Build Artifacts

- `dist/index.html`
- `dist/404.html`
- `dist/assets/*`

## Notes

- The current build and test setup are local-only validation steps.
- CI deployment is not added yet.
- Backend deployment is not part of this phase.
