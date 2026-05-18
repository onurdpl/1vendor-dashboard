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
    await expect(page.getByRole('link', { name: /Orders/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Dashboard|overview|command/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Operational priority queue' })).toBeVisible();
    await expectNoOperationalAuthError(page);
  });

  test('finance linked order opens the matching orders workspace selection', async ({ page }) => {
    await login(page);
    await page.goto('/finance');

    const linkedOrder = page.locator('a[href^="/orders"]').filter({ hasText: /Order #\d+/ }).first();
    await expect(linkedOrder).toBeVisible();
    const orderLabel = (await linkedOrder.textContent())?.match(/#\d+/)?.[0];
    expect(orderLabel).toBeTruthy();

    await linkedOrder.click();

    await expect(page).toHaveURL(/\/orders(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.getByText(`Shopify ${orderLabel}`)).toBeVisible();
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

  test('support ticket can receive a public reply', async ({ page }) => {
    await login(page, 'vendor-a@demo.com');
    await page.goto('/returns/RET-A-1001');

    await page.getByRole('button', { name: 'Contact support' }).click();
    await expect(page.getByRole('dialog', { name: 'Contact support' })).toBeVisible();
    await page.getByLabel('Subject').fill('Smoke support request');
    await page.getByLabel('Message').fill('Browser smoke needs support context.');
    await page.getByRole('button', { name: 'Create ticket' }).click();
    await expect(page.getByText('Support ticket created.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('link', { name: 'Support', exact: true }).click();
    await page.getByRole('link', { name: /mock-support-|TICKET-|SUP-/ }).first().click();
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

    await page.getByRole('link', { name: 'Inbox', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Communication center' })).toBeVisible();
    await expect(page.getByText('Inbox smoke request').first()).toBeVisible();
    await page.getByText('Inbox smoke request').first().click();
    await page.getByRole('link', { name: 'Open linked record' }).click();

    await expect(page).toHaveURL(/\/support\/mock-support-/);
    await expect(page.getByRole('heading', { name: 'Inbox smoke request' })).toBeVisible();
  });

  test('admin vendor switch refreshes operations without stale selected rows', async ({ page }) => {
    await login(page);
    await page.goto('/orders?order=1001');

    await expect(page.getByText('Shopify #1001')).toBeVisible();
    await page.getByLabel('Select vendor').selectOption('demo-vendor-b');

    await expect(page.locator('.vendor-card .session-state')).toHaveText('Demo Vendor B');
    await expect(page.getByText('Shopify #1001')).toBeVisible();
    await page.goto('/orders?order=1002');

    await expect(page.getByText('Linked order unavailable')).toBeVisible();
    await expect(page.getByText('Shopify #1002')).toHaveCount(0);
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
