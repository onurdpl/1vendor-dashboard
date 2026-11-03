import assert from 'node:assert/strict';
import { chromium, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { installBrowserEgressGuard } from './fixtures/browser-egress-guard';

if (process.env.AUTH_BROWSER_REAL_TEST !== '1') {
  throw new Error('Run only through the guarded auth two-tab browser smoke runner.');
}

const frontend = 'http://localhost:5173';
const backend = 'http://localhost:4000';
const adminEmail = 'auth-admin-a@demo.test';
const vendorEmail = 'auth-vendor-b@demo.test';
const password = 'demo123';
const browser = await chromium.launch({ headless: true });
let passed = 0;
let failed = 0;

async function contextCase(label: string, task: (context: BrowserContext, a: Page, b: Page) => Promise<void>) {
  const context = await browser.newContext({ baseURL: frontend, serviceWorkers: 'block' });
  const blocked = await installBrowserEgressGuard(context, [frontend, backend]);
  const a = await context.newPage();
  const b = await context.newPage();
  try {
    await task(context, a, b);
    assert.equal(blocked.length, 0, 'No external browser requests are permitted.');
    passed++;
    console.log(`PASS ${label}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`UI location=${new URL(a.url()).pathname} text=${(await a.locator('body').innerText().catch(() => '')).slice(0, 400)}`);
  } finally {
    await context.close();
  }
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await signInAtCurrentPage(page, email);
}
async function signInAtCurrentPage(page: Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/, { timeout: 15_000 });
}
async function logout(page: Page) {
  if (await page.locator('.vendor-account-trigger').count()) await page.locator('.vendor-account-trigger').click();
  await page.getByRole('button', { name: /Log out/ }).click();
  await expect(page).toHaveURL(/\/login(?:$|[?#])/, { timeout: 15_000 });
}
async function admin(page: Page) {
  await login(page, adminEmail);
  await page.goto('/admin/operations');
  await expect(page).toHaveURL(/\/admin\/operations/);
  await expect(page.locator('.vendor-account-card .vendor-account-copy strong')).toHaveText('Auth Browser Admin A');
}
async function vendor(page: Page) {
  await login(page, vendorEmail);
  await verifiedMe(page, 'vendor');
}
async function transitionToVendor(a: Page, b: Page, navigateAdmin = true) {
  await b.goto('/');
  await verifiedMe(b, 'admin');
  await logout(b);
  await vendor(b);
  await expect(a.getByRole('navigation', { name: 'Admin tools' })).toHaveCount(0);
  if (navigateAdmin) {
    await a.goto('/admin/operations');
    await expect(a.getByText('Access denied', { exact: true })).toBeVisible();
  }
  const forbidden = await b.evaluate(async () => {
    const response = await fetch('http://localhost:4000/admin/operations', { credentials: 'include' });
    return response.status;
  });
  assert.equal(forbidden, 403, 'Backend must reject Vendor B from Admin operations.');
}
async function verifiedMe(page: Page, expectedRole: string) {
  const result = await page.evaluate(async () => {
    const response = await fetch('http://localhost:4000/auth/me', { credentials: 'include' });
    const body = await response.json();
    return { status: response.status, role: body.user?.role };
  });
  assert.equal(result.status, 200);
  assert.equal(String(result.role).toLowerCase(), expectedRole);
}
function holdResponse(page: Page, predicate: (url: URL) => boolean, statusOverride?: number) {
  let release!: () => void;
  let fetched!: (status: number) => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<number>(resolve => { fetched = resolve; });
  let finished!: (outcome: 'delivered' | 'cancelled') => void;
  const done = new Promise<'delivered' | 'cancelled'>(resolve => { finished = resolve; });
  const handler = async (route: Route) => {
    const response = await route.fetch();
    fetched(response.status());
    await hold;
    try {
      if (statusOverride) await route.fulfill({ status: statusOverride, contentType: 'application/json', body: '{"message":"Controlled stale response"}' });
      else await route.fulfill({ response });
      finished('delivered');
    } catch { finished('cancelled'); }
  };
  return { handler, seen, release, done, predicate: (url: URL) => predicate(url) };
}

function holdTransportFailure() {
  let release!: () => void;
  let fetched!: (status: number) => void;
  let finished!: (outcome: 'aborted' | 'cancelled') => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<number>(resolve => { fetched = resolve; });
  const done = new Promise<'aborted' | 'cancelled'>(resolve => { finished = resolve; });
  const handler = async (route: Route) => {
    const response = await route.fetch();
    fetched(response.status());
    await hold;
    try {
      await route.abort('failed');
      finished('aborted');
    } catch { finished('cancelled'); }
  };
  return { handler, seen, release, done };
}

async function clearApplicationCsrf(page: Page) {
  await page.evaluate(async () => {
    const modulePath = '/src/lib/api-client.ts';
    const { clearCsrfToken } = await import(modulePath);
    clearCsrfToken();
  });
}

function startApplicationPost(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/lib/api-client.ts';
    const { apiClient } = await import(modulePath);
    try {
      await apiClient.post('/notifications/read', {});
      return { resolved: true, kind: null, status: null };
    } catch (error) {
      const failure = error as { kind?: string; status?: number };
      return { resolved: false, kind: failure.kind ?? null, status: failure.status ?? null };
    }
  });
}

async function verifyCurrentCsrfPost(page: Page, baselineCsrfRequests: number, counts: { csrf: number; posts: number }) {
  const reference = await page.evaluate(async () => {
    const response = await fetch('http://localhost:4000/auth/csrf', { credentials: 'include' });
    const body = await response.json();
    return { status: response.status, token: body.csrfToken as string };
  });
  assert.equal(reference.status, 200, 'Current session must obtain real backend CSRF.');
  assert.ok(reference.token, 'Current session CSRF must be present.');
  assert.equal(counts.posts, 0, 'Old protected POST must never be dispatched.');
  const beforeCurrentPost = counts.csrf;
  assert.equal(beforeCurrentPost, baselineCsrfRequests + 1, 'Only the explicit reference CSRF GET may follow the stale request.');
  let observedHeader: string | null = null;
  const onRequest = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname === '/notifications/read') observedHeader = request.headers()['x-csrf-token'] ?? null;
  };
  page.on('request', onRequest);
  try {
    const result = await startApplicationPost(page);
    assert.deepEqual(result, { resolved: false, kind: 'server', status: 400 },
      'The harmless current-session POST must reach real backend validation.');
    assert.equal(observedHeader, reference.token, 'Current POST must use the current session CSRF token.');
    assert.equal(counts.csrf, beforeCurrentPost, 'Current POST must reuse in-memory CSRF without another GET.');
    assert.equal(counts.posts, 1, 'Only the current harmless POST may be dispatched.');
  } finally {
    page.off('request', onRequest);
  }
}

async function verifyStaleApplicationCsrf(page: Page, mode: 'real-success' | 'controlled-401' | 'controlled-transport-failure') {
  await admin(page);
  const firstGeneration = await page.evaluate(() => JSON.parse(localStorage.getItem('vendor-dashboard.session-transition') ?? 'null')?.id);
  assert.ok(firstGeneration);
  await clearApplicationCsrf(page);
  const counts = { csrf: 0, posts: 0 };
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/auth/csrf') counts.csrf++;
    if (path === '/notifications/read') counts.posts++;
  });
  const failure = mode === 'controlled-transport-failure' ? holdTransportFailure() : null;
  const held = failure ?? holdResponse(page, url => url.origin === backend && url.pathname === '/auth/csrf',
    mode === 'controlled-401' ? 401 : undefined);
  await page.route(url => new URL(url).origin === backend && new URL(url).pathname === '/auth/csrf', held.handler, { times: 1 });
  const oldOperation = startApplicationPost(page);
  void oldOperation.catch(() => undefined);
  assert.equal(await held.seen, 200, 'The old CSRF request must reach the real local backend.');
  assert.equal(counts.csrf, 1);
  assert.equal(counts.posts, 0);

  await logout(page);
  await signInAtCurrentPage(page, vendorEmail);
  await verifiedMe(page, 'vendor');
  const nextGeneration = await page.evaluate(() => JSON.parse(localStorage.getItem('vendor-dashboard.session-transition') ?? 'null')?.id);
  assert.ok(nextGeneration && nextGeneration !== firstGeneration, 'Session B must be a distinct confirmed generation.');
  const csrfRequestsBeforeRelease = counts.csrf;
  held.release();
  assert.equal(await held.done, failure ? 'aborted' : 'delivered', 'The old result must reach the browser after Session B login.');
  const oldResult = await oldOperation;
  assert.equal(oldResult.resolved, false, 'An old-session operation must not resolve successfully.');
  assert.equal(oldResult.kind, failure ? 'network' : 'invalid-response');
  assert.equal(counts.csrf, csrfRequestsBeforeRelease, 'Old completion must not start another CSRF GET.');
  await verifiedMe(page, 'vendor');
  await verifyCurrentCsrfPost(page, csrfRequestsBeforeRelease, counts);
}

try {
  await contextCase('Module identity: login CSRF is shared with the tested apiClient', async (_context, a) => {
    await admin(a);
    let csrfRequests = 0;
    a.on('request', request => {
      if (new URL(request.url()).pathname === '/auth/csrf') csrfRequests++;
    });
    const outcome = await a.evaluate(async () => {
      const modulePath = '/src/lib/api-client.ts';
      const { apiClient } = await import(modulePath);
      try {
        await apiClient.post('/notifications/read', {});
        return { accepted: true, status: null };
      } catch (error) {
        return { accepted: false, status: (error as { status?: number }).status ?? null };
      }
    });
    assert.deepEqual(outcome, { accepted: false, status: 400 }, 'The harmless POST must reach backend validation.');
    assert.equal(csrfRequests, 0, 'The tested apiClient must reuse CSRF stored by the real application login.');
  });

  await contextCase('A Admin A to Vendor B shared-cookie transition', async (_context, a, b) => {
    await admin(a);
    await verifiedMe(a, 'admin');
    await transitionToVendor(a, b);
    await verifiedMe(b, 'vendor');
  });

  await contextCase('B cross-tab logout', async (_context, a, b) => {
    await admin(a);
    await b.goto('/');
    await verifiedMe(b, 'admin');
    await logout(b);
    await expect(a.getByRole('navigation', { name: 'Admin tools' })).toHaveCount(0);
    await a.reload();
    await expect(a).toHaveURL(/\/login(?:$|[?#])/, { timeout: 15_000 });
    const status = await b.evaluate(async () => (await fetch('http://localhost:4000/auth/me', { credentials: 'include' })).status);
    assert.equal(status, 401);
  });

  await contextCase('C delayed real Admin read response after Vendor B login', async (_context, a, b) => {
    await admin(a);
    const held = holdResponse(a, url => url.origin === backend && url.pathname === '/admin/operations');
    await a.route(url => held.predicate(new URL(url)), held.handler, { times: 1 });
    const navigation = a.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await held.seen;
    await transitionToVendor(a, b, false);
    held.release();
    assert.equal(await held.done, 'delivered', 'Old real Admin response must actually be delivered.');
    await navigation;
    await expect(a.getByRole('navigation', { name: 'Admin tools' })).toHaveCount(0);
    await verifiedMe(b, 'vendor');
    await a.goto('/admin/operations');
    await expect(a.getByText('Access denied', { exact: true })).toBeVisible();
  });

  await contextCase('D old controlled 401 and current real 401 ownership', async (context, a, b) => {
    await admin(a);
    const held = holdResponse(a, url => url.origin === backend && url.pathname === '/admin/operations', 401);
    await a.route(url => held.predicate(new URL(url)), held.handler, { times: 1 });
    const navigation = a.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await held.seen;
    await transitionToVendor(a, b, false);
    held.release();
    assert.equal(await held.done, 'delivered', 'Old controlled 401 must actually be delivered.');
    await navigation;
    await verifiedMe(b, 'vendor');
    await context.clearCookies();
    await b.reload();
    await expect(b).toHaveURL(/\/login(?:$|[?#])/, { timeout: 15_000 });
    const current = await b.evaluate(async () => (await fetch('http://localhost:4000/auth/me', { credentials: 'include' })).status);
    assert.equal(current, 401);
  });

  await contextCase('E real CSRF endpoint delivery and backend session binding', async (_context, a, b) => {
    await admin(a);
    const initial = await a.evaluate(async () => {
      const response = await fetch('http://localhost:4000/auth/csrf', { credentials: 'include' });
      const body = await response.json();
      return { status: response.status, token: body.csrfToken as string };
    });
    assert.equal(initial.status, 200);
    assert.ok(typeof initial.token === 'string' && initial.token.length > 0);
    const held = holdResponse(a, url => url.origin === backend && url.pathname === '/auth/csrf');
    await a.route(url => held.predicate(new URL(url)), held.handler, { times: 1 });
    const old = a.evaluate(async () => {
      const response = await fetch('http://localhost:4000/auth/csrf', { credentials: 'include' });
      return response.status;
    }).catch(() => 0);
    await held.seen;
    await transitionToVendor(a, b, false);
    held.release();
    assert.equal(await held.done, 'delivered', 'Old real CSRF response must actually be delivered.');
    await old;
    const current = await b.evaluate(async () => {
      const response = await fetch('http://localhost:4000/auth/csrf', { credentials: 'include' });
      const body = await response.json();
      return { status: response.status, token: body.csrfToken as string };
    });
    assert.equal(current.status, 200);
    assert.ok(current.token && current.token !== initial.token);
    // Missing notificationId guarantees this is a no-op even with a valid CSRF token.
    const noOpStatuses = await b.evaluate(async ({ oldToken, newToken }) => {
      const old = await fetch('http://localhost:4000/notifications/read', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': oldToken, 'X-Vendor-Id': 'auth-browser-b' },
        body: '{}',
      });
      const current = await fetch('http://localhost:4000/notifications/read', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': newToken, 'X-Vendor-Id': 'auth-browser-b' },
        body: '{}',
      });
      return { old: old.status, current: current.status };
    }, { oldToken: initial.token, newToken: current.token });
    assert.deepEqual(noOpStatuses, { old: 403, current: 400 });
  });

  await contextCase('E1 delayed real CSRF success preserves Session B in-memory token', async (_context, a) => {
    await verifyStaleApplicationCsrf(a, 'real-success');
  });

  await contextCase('E2 CONTROLLED_401_INJECTION preserves Session B in-memory token', async (_context, a) => {
    await verifyStaleApplicationCsrf(a, 'controlled-401');
  });

  await contextCase('E3 CONTROLLED_TRANSPORT_FAILURE preserves Session B in-memory token', async (_context, a) => {
    await verifyStaleApplicationCsrf(a, 'controlled-transport-failure');
  });

  await contextCase('F same user new session rejects older read response', async (_context, a, b) => {
    await admin(a);
    const originalGeneration = await a.evaluate(() => JSON.parse(localStorage.getItem('vendor-dashboard.session-transition') ?? 'null')?.id);
    assert.ok(originalGeneration);
    const held = holdResponse(a, url => url.origin === backend && url.pathname === '/admin/operations');
    await a.route(url => held.predicate(new URL(url)), held.handler, { times: 1 });
    const navigation = a.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await held.seen;
    await b.goto('/');
    await logout(b);
    await login(b, adminEmail);
    const newGeneration = await b.evaluate(() => JSON.parse(localStorage.getItem('vendor-dashboard.session-transition') ?? 'null')?.id);
    assert.ok(newGeneration && newGeneration !== originalGeneration, 'Same-user login must create a new shared session generation.');
    held.release();
    assert.equal(await held.done, 'delivered', 'Old same-user response must actually be delivered.');
    await navigation;
    await verifiedMe(b, 'admin');
    await a.reload();
    await verifiedMe(a, 'admin');
  });

  await contextCase('F1 delivered same-user old API success rejects with invalid-response', async (_context, a) => {
    await admin(a);
    const firstGeneration = await a.evaluate(() => JSON.parse(localStorage.getItem('vendor-dashboard.session-transition') ?? 'null')?.id);
    assert.ok(firstGeneration);
    const held = holdResponse(a, url => url.origin === backend && url.pathname === '/admin/operations');
    await a.route(url => held.predicate(new URL(url)), held.handler, { times: 1 });
    const oldOperation = a.evaluate(async () => {
      const modulePath = '/src/lib/api-client.ts';
      const { apiClient } = await import(modulePath);
      try {
        await apiClient.get('/admin/operations');
        return { resolved: true, kind: null };
      } catch (error) {
        return { resolved: false, kind: (error as { kind?: string }).kind ?? null };
      }
    });
    void oldOperation.catch(() => undefined);
    assert.equal(await held.seen, 200, 'First session must receive a real successful backend GET.');
    await logout(a);
    await signInAtCurrentPage(a, adminEmail);
    await verifiedMe(a, 'admin');
    const nextGeneration = await a.evaluate(() => JSON.parse(localStorage.getItem('vendor-dashboard.session-transition') ?? 'null')?.id);
    assert.ok(nextGeneration && nextGeneration !== firstGeneration);
    held.release();
    assert.equal(await held.done, 'delivered', 'Old HTTP 200 must be delivered, not cancelled.');
    assert.deepEqual(await oldOperation, { resolved: false, kind: 'invalid-response' },
      'The original apiClient promise must explicitly reject the stale success.');
    const current = await a.evaluate(async () => {
      const modulePath = '/src/lib/api-client.ts';
      const { apiClient } = await import(modulePath);
      try {
        await apiClient.get('/admin/operations');
        return { resolved: true, kind: null };
      } catch (error) {
        return { resolved: false, kind: (error as { kind?: string }).kind ?? null };
      }
    });
    assert.deepEqual(current, { resolved: true, kind: null }, 'The current session GET must succeed.');
    await expect(a.getByRole('navigation', { name: 'Admin tools' })).toBeVisible();
  });

  await contextCase('G reload and back navigation use current Vendor B session', async (_context, a, b) => {
    let meRequests = 0;
    a.on('request', request => { if (new URL(request.url()).pathname === '/auth/me') meRequests++; });
    await login(a, adminEmail);
    const afterLogin = meRequests;
    await a.goto('/admin/operations');
    await expect(a.locator('.vendor-account-card .vendor-account-copy strong')).toHaveText('Auth Browser Admin A');
    const afterAdminNavigation = meRequests;
    await transitionToVendor(a, b);
    await a.reload();
    await verifiedMe(a, 'vendor');
    await a.goBack().catch(() => {});
    await expect(a.getByRole('navigation', { name: 'Admin tools' })).toHaveCount(0);
    console.log(`G /auth/me requests: after login=${afterLogin}, after Admin navigation=${afterAdminNavigation}, after transition/reload/back=${meRequests}.`);
  });
} finally {
  await browser.close();
}
console.log(`Auth real-browser results: ${passed} PASS, ${failed} FAIL, 0 SKIPPED.`);
if (failed) process.exitCode = 1;
