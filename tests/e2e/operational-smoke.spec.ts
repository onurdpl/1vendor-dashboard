import { expect, test, type Page } from '@playwright/test';

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
    await page.getByRole('menu', { name: 'Account menu' }).getByLabel('Select vendor').selectOption('demo-vendor-b');

    await expect(page.getByRole('button', { name: /Demo Vendor B Admin view/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '#1001', exact: true })).toBeVisible();
    await page.goto('/orders?order=1002');

    await expect(page.getByText('Linked order unavailable')).toBeVisible();
    await expect(page.getByRole('heading', { name: '#1002', exact: true })).toHaveCount(0);
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
