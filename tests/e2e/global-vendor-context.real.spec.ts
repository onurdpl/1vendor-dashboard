import assert from 'node:assert/strict';
import { chromium, expect, type Page } from '@playwright/test';
import { installBrowserEgressGuard } from './fixtures/browser-egress-guard';

if (process.env.AUTH_BROWSER_REAL_TEST !== '1') {
  throw new Error('Run only through the guarded auth browser runner.');
}

const frontend = 'http://localhost:5173';
const backend = 'http://localhost:4000';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: frontend, serviceWorkers: 'block' });
const blocked: string[] = [];
let delayedOrders: {
  vendorId: string;
  seen: () => void;
  release: Promise<void>;
  done: (outcome: 'delivered' | 'cancelled') => void;
  used: boolean;
} | null = null;
// One handler owns each request: the local-only egress guard and controlled delay share this route.
await context.route('**/*', async route => {
  const attempted = route.request().url();
  const url = new URL(attempted);
  const permitted = ['about:', 'data:', 'blob:'].includes(url.protocol)
    || (['http:', 'https:'].includes(url.protocol) && [frontend, backend].includes(url.origin));
  if (!permitted) { blocked.push(attempted); await route.abort('blockedbyclient'); return; }
  const delay = delayedOrders;
  if (delay && !delay.used && url.origin === backend && url.pathname === '/orders'
    && route.request().method() === 'GET' && route.request().headers()['x-vendor-id'] === delay.vendorId) {
    delay.used = true;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    delay.seen();
    await delay.release;
    try { await route.fulfill({ response }); delay.done('delivered'); }
    catch { delay.done('cancelled'); }
    return;
  }
  await route.continue();
});
const page = await context.newPage();
const requests: Array<{ path: string; vendor: string | null }> = [];
let passed = 0;
let selectionStarted = 0;
let verificationMs = 0;
let selectionRequestIndex = 0;
page.on('request', request => {
  const url = new URL(request.url());
  if (url.origin === backend) requests.push({ path: url.pathname, vendor: request.headers()['x-vendor-id'] ?? null });
});

async function check(label: string, action: () => Promise<void>) {
  await action();
  passed++;
  console.log(`PASS ${label}`);
}
async function login(email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/, { timeout: 15_000 });
}
async function selectVendor(key: 'a' | 'b') {
  const vendorId = `context-vendor-${key}`;
  await page.goto('/admin/operations');
  const search = page.getByRole('textbox', { name: 'Search vendors' }).first();
  await search.fill(`Context Vendor ${key.toUpperCase()}`);
  const select = page.getByRole('combobox', { name: 'Select vendor' }).first();
  await expect(select.locator(`option[value="${vendorId}"]`)).toHaveCount(1);
  const started = performance.now();
  selectionStarted = started;
  selectionRequestIndex = requests.length;
  const statusResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/admin/vendors/${vendorId}/status`);
  await select.selectOption(vendorId);
  const status = await statusResponse;
  assert.equal(status.status(), 200);
  const body = await status.json();
  assert.equal(body.vendor?.id ?? body.vendorId ?? body.id, vendorId, 'F05 must verify the exact Vendor ID.');
  await expect(select).toHaveValue(vendorId);
  verificationMs = Math.round(performance.now() - started);
}
async function scopePage(path: string, key: 'a' | 'b', record: string, foreign: string, endpoint: string) {
  const vendorId = `context-vendor-${key}`;
  const response = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === backend && url.pathname === endpoint && response.status() === 200;
  });
  await page.goto(path);
  const actual = await response;
  assert.equal(actual.request().headers()['x-vendor-id'] ?? null, vendorId,
    `${endpoint} must request selected Vendor.`);
  const result = await actual.json();
  const serialized = JSON.stringify(result);
  assert.ok(serialized.includes(record), `${endpoint} response must contain own record ${record}.`);
  assert.ok(!serialized.includes(foreign), `${endpoint} response must exclude foreign record ${foreign}.`);
  await expect(page.getByText(`#CTX-${key.toUpperCase()}`, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`#CTX-${key === 'a' ? 'B' : 'A'}`, { exact: false })).toHaveCount(0);
}
async function delayedSwitch(from: 'a' | 'b', to: 'a' | 'b') {
  let release!: () => void;
  let fetched!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { fetched = resolve; });
  let finish!: (outcome: 'delivered' | 'cancelled') => void;
  const done = new Promise<'delivered' | 'cancelled'>(resolve => { finish = resolve; });
  const oldRequestNumber = requests.length + 1;
  delayedOrders = { vendorId: `context-vendor-${from}`, seen: fetched, release: hold, done: finish, used: false };
  await page.goto('/orders', { waitUntil: 'domcontentloaded' });
  await seen;
  await page.locator('.vendor-account-trigger').click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await menu.getByRole('button', { name: 'Choose Vendor' }).click();
  await menu.getByRole('combobox', { name: 'Search vendors' }).fill(`Context Vendor ${to.toUpperCase()}`);
  const option = menu.getByRole('option').filter({ hasText: `context-vendor-${to}` });
  await expect(option).toHaveCount(1);
  const statusResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/admin/vendors/context-vendor-${to}/status`);
  await option.click();
  const status = await statusResponse;
  assert.equal(status.status(), 200);
  assert.equal((await status.json()).vendorId, `context-vendor-${to}`);
  release();
  const oldOutcome = await done;
  await expect(page.getByText(`#CTX-${to.toUpperCase()}`, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`#CTX-${from.toUpperCase()}`, { exact: false })).toHaveCount(0);
  console.log(`RACE request#${oldRequestNumber} old=${from} fetched before new=${to} verification; browser outcome=${oldOutcome}; visible=${to}`);
  delayedOrders = null;
}

try {
  await login('context-admin@demo.test');
  for (const key of ['a', 'b', 'a'] as const) {
    await check(`${key.toUpperCase()} directory selection and exact F05 verification`, () => selectVendor(key));
    const foreign = key === 'a' ? 'b' : 'a';
    await check(`${key.toUpperCase()} Orders backend and UI ownership`, () =>
      scopePage('/orders', key, `context-allocation-${key}`, `context-allocation-${foreign}`, '/orders'));
    const transitionRequests = requests.slice(selectionRequestIndex);
    console.log(`MEASURE ${key === 'a' && passed > 5 ? 'B→A' : key === 'b' ? 'A→B' : 'initial A'}: verification=${verificationMs}ms workspace=${Math.round(performance.now() - selectionStarted)}ms statusRequests=${transitionRequests.filter(r => r.path.endsWith('/status')).length} ordersRequests=${transitionRequests.filter(r => r.path === '/orders').length}`);
    await check(`${key.toUpperCase()} Order Detail ownership`, () =>
      scopePage(`/orders/context-allocation-${key}`, key,
        `context-allocation-${key}`, `context-allocation-${foreign}`, `/orders/context-allocation-${key}`));
    await check(`${key.toUpperCase()} Returns backend and UI ownership`, () =>
      scopePage('/returns', key, `context-return-${key}`, `context-return-${foreign}`, '/returns'));
    await check(`${key.toUpperCase()} Finance backend and UI ownership`, async () => {
      const vendorId = `context-vendor-${key}`;
      const before = requests.length;
      const response = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.origin === backend && url.pathname === '/finance' && response.status() === 200;
      });
      await page.goto('/finance');
      const actual = await response;
      assert.equal(requests.slice(before).find(item => item.path === '/finance')?.vendor, vendorId);
      const payload = JSON.stringify(await actual.json());
      assert.ok(payload.includes(`context-ledger-${key}`));
      assert.ok(!payload.includes(`context-ledger-${key === 'a' ? 'b' : 'a'}`));
      await expect(page.getByText(key === 'a' ? '111.11' : '222.22', { exact: false }).first()).toBeVisible();
      await expect(page.getByText(key === 'a' ? '222.22' : '111.11', { exact: false })).toHaveCount(0);
    });
  }
  await check('Delayed A Orders response cannot overwrite B after an in-place Vendor switch', () => delayedSwitch('a', 'b'));
  await check('Delayed B Orders response cannot overwrite A after an in-place Vendor switch', () => delayedSwitch('b', 'a'));
  await check('Directory cursor reaches and selects a later-page Vendor', async () => {
    await page.goto('/admin/operations');
    const firstResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === backend && url.pathname === '/admin/vendors' && !url.searchParams.has('cursor');
    });
    await page.reload();
    const first = await firstResponse;
    const firstPage = await first.json();
    assert.equal(firstPage.filters.limit, 100);
    assert.equal(firstPage.hasMore, true);
    assert.ok(firstPage.nextCursor);
    const nextResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === backend && url.pathname === '/admin/vendors'
        && url.searchParams.get('cursor') === firstPage.nextCursor;
    });
    await page.getByRole('button', { name: 'Next Vendors' }).click();
    const second = await nextResponse;
    const secondPage = await second.json();
    assert.ok(secondPage.vendors.some((vendor: { vendorId: string }) => vendor.vendorId === 'context-vendor-b'));
    const selector = page.getByRole('combobox', { name: 'Select vendor' });
    await expect(selector.locator('option[value="context-vendor-b"]')).toHaveCount(1);
    const statusResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/admin/vendors/context-vendor-b/status');
    await selector.selectOption('context-vendor-b');
    assert.equal((await statusResponse).status(), 200);
    await expect(selector).toHaveValue('context-vendor-b');
    console.log(`DIRECTORY page1=${firstPage.vendors.length} page2=${secondPage.vendors.length} selected=context-vendor-b`);
  });
  await check('Invalid selected Vendor fails closed after browser refresh', async () => {
    await page.evaluate(() => localStorage.setItem('vendor-dashboard.current-vendor-id', 'context-vendor-missing'));
    await page.goto('/orders');
    await expect(page.getByText('#CTX-A', { exact: false })).toHaveCount(0);
    await expect(page.getByText('#CTX-B', { exact: false })).toHaveCount(0);
    const selected = await page.evaluate(() => localStorage.getItem('vendor-dashboard.current-vendor-id'));
    assert.notEqual(selected, 'context-vendor-a', 'Invalid selection must not silently restore A.');
  });
  await check('Vendor user cannot request another Vendor', async () => {
    const vendorContext = await browser.newContext({ baseURL: frontend, serviceWorkers: 'block' });
    try {
      const vendorPage = await vendorContext.newPage();
      await installBrowserEgressGuard(vendorContext, [frontend, backend]);
      await vendorPage.goto('/login');
      await vendorPage.getByLabel('Email').fill('context-vendor-a@demo.test');
      await vendorPage.getByLabel('Password').fill('demo123');
      await vendorPage.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(vendorPage).not.toHaveURL(/\/login(?:$|[?#])/, { timeout: 15_000 });
      const status = await vendorPage.evaluate(async () => {
        const response = await fetch('http://localhost:4000/orders', {
          credentials: 'include', headers: { 'X-Vendor-Id': 'context-vendor-b' },
        });
        return response.status;
      });
      assert.equal(status, 403);
    } finally {
      await vendorContext.close();
    }
  });
  assert.equal(blocked.length, 0, 'Browser must not make external requests.');
  console.log(`RESULT ${passed} PASS / 0 FAIL / 0 SKIPPED`);
} finally {
  await context.close();
  await browser.close();
}
