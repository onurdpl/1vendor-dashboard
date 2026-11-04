import { expect, test, type Page } from './fixtures/browser-egress-guard';

const SESSION_KEYS = [
  'vendor-dashboard.session-token',
  'vendor-dashboard.current-user',
  'vendor-dashboard.current-vendor-id',
  'vendor-dashboard.expired-session',
] as const;

async function resetBrowserSession(page: Page) {
  await page.goto('/login');
  await page.evaluate((keys) => {
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  }, SESSION_KEYS);
}

async function login(page: Page, email = 'admin@demo.com') {
  await resetBrowserSession(page);
  await page.reload();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('VendorOps')).toBeVisible();
}

async function expectNoOperationalAuthError(page: Page) {
  await expect(page.getByText(/Unauthorized|Linked order unavailable|You do not have access/i)).toHaveCount(0);
}

async function chooseWorkspaceVendor(page: Page, vendorId: string) {
  const menu = page.getByRole('menu', { name: 'Account menu' });
  if (!await menu.isVisible()) await page.locator('.vendor-account-trigger').click();
  await menu.getByRole('button', { name: 'Choose Vendor' }).click();
  await menu.getByRole('option').filter({ hasText: vendorId }).click();
}

test.describe('operational browser smoke', () => {
  test('login loads dashboard without an unauthorized flash', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Orders', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today, Demo Vendor A' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs Attention Today' })).toBeVisible();
    await expectNoOperationalAuthError(page);
  });

  test('finance linked order opens the matching orders workspace selection', async ({ page }) => {
    await login(page);
    await page.goto('/finance');

    await page.getByRole('tab', { name: 'Transactions' }).click();
    await page.getByRole('button', { name: /Sale estimate.*#1001.*View details/ }).click();
    const transactionDetail = page.getByRole('complementary');
    await expect(transactionDetail.getByRole('heading', { name: 'Order #1001' })).toBeVisible();
    const linkedOrder = transactionDetail.getByRole('link', { name: 'Open' });
    await expect(linkedOrder).toBeVisible();
    await linkedOrder.click();

    await expect(page).toHaveURL(/\/orders(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '#1001', exact: true })).toBeVisible();
    await expect(page.getByText('Linked order unavailable')).toHaveCount(0);
  });

  test('return detail linked order opens the matching order', async ({ page }) => {
    await login(page);
    await page.goto('/returns/RET-A-1001');

    await expect(page.getByRole('heading', { name: 'Return request' })).toBeVisible();
    await page.locator('a[href^="/orders"]').filter({ hasText: /Order #1001/ }).first().click();

    await expect(page).toHaveURL(/\/orders/);
    await expect(page.getByRole('heading', { name: 'Order #1001' })).toBeVisible();
    await expect(page.getByText('Linked order unavailable')).toHaveCount(0);
  });

  test('order shipment action remains available in the routed workspace', async ({ page }) => {
    await login(page, 'vendor-b@demo.com');
    await page.goto('/orders?order=2001');

    await expect(page.getByRole('heading', { name: '#2001', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'View details' }).click();
    await expect(page.getByRole('heading', { name: 'Order #2001' })).toBeVisible();
    await page.getByRole('button', { name: 'Create shipment' }).click();

    await expect(page.getByText('Shipping label creation requested (mock).')).toBeVisible();
    await expectNoOperationalAuthError(page);
  });

  test('support ticket can receive a public reply', async ({ page }) => {
    await login(page, 'vendor-a@demo.com');
    await page.goto('/returns/RET-A-1001');

    await page.getByRole('button', { name: 'Contact support' }).click();
    await expect(page.getByRole('dialog', { name: 'Contact support' })).toBeVisible();
    await page.getByLabel('Subject').fill('Smoke support request');
    await page.getByLabel('Message').fill('Browser smoke needs support context.');
    await page.getByRole('button', { name: 'Create ticket' }).click();
    await expect(page.getByText('Support ticket created.').first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Contact support' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Support', exact: true }).click();
    await page.getByRole('link', { name: 'Smoke support request' }).click();
    await page.getByPlaceholder('Write a public reply...').fill('Smoke reply from vendor.');
    await page.getByRole('button', { name: 'Post reply' }).click();

    await expect(page.getByText('Reply posted.')).toBeVisible();
    await expect(page.getByText('Smoke reply from vendor.').first()).toBeVisible();
  });

  test('vendor inbox opens linked communication context', async ({ page }) => {
    await login(page, 'vendor-a@demo.com');
    await page.goto('/returns/RET-A-1001');

    await page.getByRole('button', { name: 'Contact support' }).click();
    await page.getByLabel('Subject').fill('Inbox smoke request');
    await page.getByLabel('Message').fill('Browser smoke is checking the communication center.');
    await page.getByRole('button', { name: 'Create ticket' }).click();
    await expect(page.getByText('Support ticket created.').first()).toBeVisible();

    await page.evaluate(() => {
      window.history.pushState({}, '', '/support/inbox');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'Communication center', exact: true })).toBeVisible();
    await expect(page.getByText('Inbox smoke request').first()).toBeVisible();
    await page.getByText('Inbox smoke request').first().click();
    await page.getByRole('link', { name: 'Open linked record' }).click();

    await expect(page).toHaveURL(/\/support\/mock-support-/);
    await expect(page.getByRole('heading', { name: 'Inbox smoke request' })).toBeVisible();
  });

  test('admin vendor switch refreshes operations without stale selected rows', async ({ page }) => {
    await login(page);
    await page.goto('/orders?order=1001');

    await expect(page.getByRole('heading', { name: '#1001', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Demo Vendor A Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');

    await expect(page.getByRole('button', { name: /Demo Vendor B Admin view/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '#1001', exact: true })).toBeVisible();
    await page.goto('/orders?order=1002');

    await expect(page.getByText('Linked order unavailable')).toBeVisible();
    await expect(page.getByRole('heading', { name: '#1002', exact: true })).toHaveCount(0);
  });

  test('Orders list and embedded detail hide Vendor A while Vendor B is delayed', async ({ page }) => {
    await login(page);
    await page.goto('/orders');
    const rows = page.locator('.orders-op-table .op-table-row');
    await expect(rows.filter({ hasText: '#1002' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View details' })).toHaveAttribute('href', /ORD-A-/);
    await page.addScriptTag({ type: 'module', content: `
      import { runtimeServices } from '/src/services/runtime-services.ts';
      const original = runtimeServices.orders.list;
      runtimeServices.orders.list = (...args) => args[0] === 'demo-vendor-b'
        ? new Promise((resolve) => { window.__releaseBug001Orders = () => {
            window.__releaseBug001Orders = null; original(...args).then(resolve);
          }; })
        : original(...args);
      window.__bug001OrdersReady = true;
    ` });
    await page.waitForFunction(() => (window as Window & { __bug001OrdersReady?: boolean }).__bug001OrdersReady);
    await page.getByRole('button', { name: /Demo Vendor A Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');
    await page.waitForFunction(() => typeof (window as Window & { __releaseBug001Orders?: () => void }).__releaseBug001Orders === 'function');
    await expect(rows.filter({ hasText: '#1002' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View details' })).toHaveCount(0);
    await page.evaluate(() => (window as Window & { __releaseBug001Orders?: () => void }).__releaseBug001Orders?.());
    await expect(rows.filter({ hasText: '#2001' })).toBeVisible();
    await expect(rows.filter({ hasText: '#1002' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View details' })).toHaveAttribute('href', /ORD-B-/);

    if (!await page.getByRole('menu', { name: 'Account menu' }).isVisible()) {
      await page.getByRole('button', { name: /Demo Vendor B Admin view/ }).click();
    }
    await chooseWorkspaceVendor(page, 'demo-vendor-a');
    await expect(rows.filter({ hasText: '#2001' })).toHaveCount(0);
    await expect(rows.filter({ hasText: '#1002' })).toBeVisible();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');
    await page.waitForFunction(() => typeof (window as Window & { __releaseBug001Orders?: () => void }).__releaseBug001Orders === 'function');
    await chooseWorkspaceVendor(page, 'demo-vendor-a');
    await expect(rows.filter({ hasText: '#2001' })).toHaveCount(0);
    await page.evaluate(() => (window as Window & { __releaseBug001Orders?: () => void }).__releaseBug001Orders?.());
    await expect(rows.filter({ hasText: '#1002' })).toBeVisible();
    await expect(rows.filter({ hasText: '#2001' })).toHaveCount(0);
  });

  test('Returns list and embedded detail hide Vendor A while Vendor B is delayed', async ({ page }) => {
    await login(page);
    await page.goto('/returns');
    const rows = page.locator('.returns-op-table .op-table-row');
    await expect(rows.filter({ hasText: '#1002' })).toBeVisible();
    await page.addScriptTag({ type: 'module', content: `
      import { runtimeServices } from '/src/services/runtime-services.ts';
      const original = runtimeServices.returns.list;
      runtimeServices.returns.list = (...args) => args[0] === 'demo-vendor-b'
        ? new Promise((resolve) => { window.__releaseBug001Returns = () => {
            window.__releaseBug001Returns = null; original(...args).then(resolve);
          }; })
        : original(...args);
      window.__bug001ReturnsReady = true;
    ` });
    await page.waitForFunction(() => (window as Window & { __bug001ReturnsReady?: boolean }).__bug001ReturnsReady);
    await page.getByRole('button', { name: /Demo Vendor A Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');
    await page.waitForFunction(() => typeof (window as Window & { __releaseBug001Returns?: () => void }).__releaseBug001Returns === 'function');
    await expect(rows.filter({ hasText: '#1002' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review return' })).toHaveCount(0);
    await page.evaluate(() => (window as Window & { __releaseBug001Returns?: () => void }).__releaseBug001Returns?.());
    await expect(rows.filter({ hasText: '#2002' })).toBeVisible();
    await expect(rows.filter({ hasText: '#1002' })).toHaveCount(0);
    if (!await page.getByRole('menu', { name: 'Account menu' }).isVisible()) {
      await page.getByRole('button', { name: /Demo Vendor B Admin view/ }).click();
    }
    await chooseWorkspaceVendor(page, 'demo-vendor-a');
    await expect(rows.filter({ hasText: '#2002' })).toHaveCount(0);
    await expect(rows.filter({ hasText: '#1002' })).toBeVisible();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');
    await page.waitForFunction(() => typeof (window as Window & { __releaseBug001Returns?: () => void }).__releaseBug001Returns === 'function');
    await chooseWorkspaceVendor(page, 'demo-vendor-a');
    await expect(rows.filter({ hasText: '#2002' })).toHaveCount(0);
    await page.evaluate(() => (window as Window & { __releaseBug001Returns?: () => void }).__releaseBug001Returns?.());
    await expect(rows.filter({ hasText: '#1002' })).toBeVisible();
    await expect(rows.filter({ hasText: '#2002' })).toHaveCount(0);
  });

  test('a Vendor change in one tab hides prior Orders and Returns rows in another tab', async ({ page, context }) => {
    await login(page);
    await page.goto('/orders');
    const orderRows = page.locator('.orders-op-table .op-table-row');
    await expect(orderRows.filter({ hasText: '#1002' })).toBeVisible();

    const returnsTab = await context.newPage();
    await returnsTab.goto('/returns');
    const returnRows = returnsTab.locator('.returns-op-table .op-table-row');
    await expect(returnRows.filter({ hasText: '#1002' })).toBeVisible();

    await page.getByRole('button', { name: /Demo Vendor A Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');

    await expect(orderRows.filter({ hasText: '#1002' })).toHaveCount(0);
    await expect(returnRows.filter({ hasText: '#1002' })).toHaveCount(0);
    await expect(orderRows.filter({ hasText: '#2001' })).toBeVisible();
    await expect(returnRows.filter({ hasText: '#2002' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View details' })).toHaveAttribute('href', /ORD-B-/);
    await expect(returnsTab.getByRole('link', { name: 'Review return' })).toHaveAttribute('href', /RET-B-/);
  });

  test('two tabs keep Shipping GET and pending save scoped to their original Vendors', async ({ page, context }) => {
    await login(page);
    await page.goto('/admin/vendors/demo-vendor-a');
    await expect(page.getByText('Vendor ID: demo-vendor-a')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save shipping config' })).toBeVisible();
    await page.addScriptTag({ type: 'module', content: `
      import { runtimeServices } from '/src/services/runtime-services.ts';
      const originalRead = runtimeServices.orders.vendorShippingConfig;
      window.__shippingSaveCalls = [];
      runtimeServices.orders.updateVendorShippingConfig = (id, input) => {
        window.__shippingSaveCalls.push({ id, input });
        return new Promise((resolve) => { window.__finishShippingSaveA = () => originalRead(id).then(resolve); });
      };
    ` });
    await page.getByRole('button', { name: 'Save shipping config' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__shippingSaveCalls?.length ?? 0)).toBe(1);

    const workspaceTab = await context.newPage();
    await workspaceTab.goto('/');
    await workspaceTab.addScriptTag({ type: 'module', content: `
      import { runtimeServices } from '/src/services/runtime-services.ts';
      const originalRead = runtimeServices.orders.vendorShippingConfig;
      runtimeServices.orders.vendorShippingConfig = (id, options) => id === 'demo-vendor-b'
        ? new Promise((resolve) => { window.__releaseShippingB = () => originalRead(id, options).then((config) => resolve({
            ...config, defaultWarehouseId: '223344',
            warehouses: [{ ...config.warehouses[0], vendorId: id, warehouseId: '223344', name: 'Vendor B warehouse' }],
          })); })
        : originalRead(id, options).then((config) => ({
            ...config, defaultWarehouseId: '112668',
            warehouses: [{ ...config.warehouses[0], vendorId: id, warehouseId: '112668', name: 'Vendor A warehouse' }],
          }));
    ` });
    await workspaceTab.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' }).click();
    await expect(workspaceTab.getByText('Vendor A warehouse').first()).toBeVisible();
    await workspaceTab.getByRole('button', { name: /Demo Vendor A Admin view/ }).click();
    await chooseWorkspaceVendor(workspaceTab, 'demo-vendor-b');
    await expect(workspaceTab.getByText('Vendor A warehouse')).toHaveCount(0);
    await expect(workspaceTab.getByText('Vendor B warehouse')).toHaveCount(0);
    await expect(page.getByText('Vendor ID: demo-vendor-a')).toBeVisible();
    await workspaceTab.evaluate(() => (window as any).__releaseShippingB?.());
    await expect(workspaceTab.getByText('Vendor B warehouse').first()).toBeVisible();
    await page.evaluate(() => (window as any).__finishShippingSaveA?.());
    await expect(workspaceTab.getByText('Vendor B warehouse').first()).toBeVisible();
    await expect(workspaceTab.getByText('Shipping provider configuration saved.')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__shippingSaveCalls?.map((call: { id: string }) => call.id))).toEqual(['demo-vendor-a']);
    await expect(page.getByText('Vendor ID: demo-vendor-a')).toBeVisible();
  });

  test('admin Settings discards unsaved finance policy across A to B to A', async ({ page }) => {
    await login(page);
    await page.goto('/vendor/profile');
    await page.getByRole('button', { name: 'Edit finance policy' }).click();
    await page.getByLabel('Commission %').fill('44');
    await expect(page.getByLabel('Commission %')).toHaveValue('44');

    await page.getByRole('button', { name: /Demo Vendor A Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');
    await expect(page.getByRole('button', { name: /Demo Vendor B Admin view/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save finance policy' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit finance policy' }).click();
    await expect(page.getByLabel('Commission %')).toHaveValue('10.00');

    await page.getByRole('button', { name: /Demo Vendor B Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-a');
    await expect(page.getByRole('button', { name: /Demo Vendor A Admin view/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save finance policy' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit finance policy' }).click();
    await expect(page.getByLabel('Commission %')).toHaveValue('10.00');
  });

  test('admin Settings discards an unsaved billing edit without a mutation request', async ({ page }) => {
    await login(page);
    await page.addScriptTag({ type: 'module', content: `
      import { runtimeServices } from '/src/services/runtime-services.ts';
      window.__billingUpdateCalls = [];
      runtimeServices.vendors.billingProfile = async (vendorId) => ({
        id: 'browser-billing-' + vendorId,
        vendorId,
        legalCompanyName: vendorId === 'demo-vendor-a' ? 'Vendor A Ltd.' : 'Vendor B Ltd.',
        taxNumber: '1234567890', taxOffice: 'Demo', billingAddress: 'Demo address',
        billingCity: 'Vienna', billingDistrict: 'Center', billingEmail: 'billing@demo.com',
      });
      runtimeServices.vendors.updateBillingProfile = async (vendorId, input) => {
        window.__billingUpdateCalls.push({ vendorId, input });
        throw new Error('Browser test blocked a billing mutation');
      };
    ` });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Edit billing profile' }).click();
    await page.getByLabel('Legal company name').fill('UNSAVED_VENDOR_A');

    await page.getByRole('button', { name: /Demo Vendor A Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-b');
    await expect(page.getByRole('button', { name: /Demo Vendor B Admin view/ })).toBeVisible();
    await expect(page.getByText('UNSAVED_VENDOR_A')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save billing profile' })).toHaveCount(0);
    await expect(page.getByText('Vendor B Ltd.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit billing profile' }).click();
    await expect(page.getByLabel('Legal company name')).toHaveValue('Vendor B Ltd.');

    await page.getByRole('button', { name: /Demo Vendor B Admin view/ }).click();
    await chooseWorkspaceVendor(page, 'demo-vendor-a');
    await expect(page.getByRole('button', { name: /Demo Vendor A Admin view/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save billing profile' })).toHaveCount(0);
    await expect(page.getByText('Vendor A Ltd.').first()).toBeVisible();
    const calls = await page.evaluate(() => (window as Window & { __billingUpdateCalls?: unknown[] }).__billingUpdateCalls ?? []);
    expect(calls).toEqual([]);
  });

  test('expired session redirect preserves destination and message', async ({ page }) => {
    await login(page);
    await page.goto('/orders');
    await page.evaluate(() => {
      window.localStorage.removeItem('vendor-dashboard.session-token');
      window.localStorage.removeItem('vendor-dashboard.current-user');
      window.localStorage.setItem(
        'vendor-dashboard.expired-session',
        JSON.stringify({
          message: 'Your session expired. Please sign in again.',
          intendedPath: '/finance',
        }),
      );
    });

    await page.goto('/finance');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible();

    await page.getByLabel('Email').fill('admin@demo.com');
    await page.getByLabel('Password').fill('demo123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/finance$/);
    await expect(page.getByRole('heading', { name: /Finance/i })).toBeVisible();
  });
});
