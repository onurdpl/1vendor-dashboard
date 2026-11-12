import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { installBrowserEgressGuard } from '../../tests/e2e/fixtures/browser-egress-guard';

const origin = 'http://127.0.0.1:5173';
const databaseName = process.env.BROWSER_SMOKE_EXPECTED_DATABASE;
assert.ok(databaseName && /^vendor_dashboard_browser_smoke_\d+_\d+$/.test(databaseName),
  'Browser preflight requires the disposable smoke database name.');

const browser = await chromium.launch({ chromiumSandbox: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = await installBrowserEgressGuard(context, [origin]);
  const page = await context.newPage();
  const [document, session] = await Promise.all([
    page.goto(`${origin}/login`),
    page.waitForResponse((response) => response.url() === `${origin}/api/auth/me` &&
      response.request().method() === 'GET'),
  ]);
  assert.equal(document?.status(), 200);
  assert.equal(session.status(), 401, 'Fresh browser context must be unauthenticated.');
  assert.ok(session.headers()['x-request-id'], 'Session response must come from the backend.');
  await page.getByLabel('Email', { exact: true }).waitFor();
  await page.getByLabel('Password', { exact: true }).waitFor();
  assert.equal(await page.getByText('Runtime configuration needs attention', { exact: true }).count(), 0);

  const health = await page.evaluate(async () => {
    const response = await fetch('/api/health');
    const data = await response.json();
    return {
      httpStatus: response.status,
      ready: data.status === 'ok' && data.dbReachable === true && data.schemaReady === true,
      databaseName: data.databaseSource?.databaseName,
      localDatabase: data.databaseSource?.databaseSourceLabel === 'local',
    };
  });
  assert.equal(health.httpStatus, 200);
  assert.ok(health.ready && health.localDatabase && health.databaseName === databaseName,
    'Proxied health must report the expected disposable database.');

  // Health has no POST handler, so the backend can attest to the method
  // and rewritten path without any fixture, authentication or financial write.
  const postProbe = await page.evaluate(async () => {
    const response = await fetch('/api/health', { method: 'POST', headers: { 'X-Request-Id': 'p506k-post-probe' } });
    const data = await response.json();
    return { status: response.status, message: data.message, requestId: response.headers.get('x-request-id') };
  });
  assert.equal(postProbe.status, 404);
  assert.equal(postProbe.message, 'Route POST:/health not found');
  assert.equal(postProbe.requestId, 'p506k-post-probe');
  assert.equal(blocked.length, 0, 'Browser preflight attempted a request outside the frontend origin.');
  console.log('Docker API preflight passed. Login form rendered, GET /api/auth/me returned 401, GET /api/health verified the disposable database, and POST /api/health preserved method, request ID and backend status.');
} finally {
  await browser.close();
}
