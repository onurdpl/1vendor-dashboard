import { expect, test } from '@playwright/test';

const reviewId = process.env.BROWSER_SMOKE_REVIEW_ID;
const refundId = 'gid://shopify/Refund/browser-smoke-zero-net';

test('Admin acknowledges a zero-net reconciliation without a monetary correction', async ({ page }) => {
  expect(reviewId).toBe('browser-smoke-zero-net-review');
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@demo.com');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: /Browser Smoke Vendor Admin view/ }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByLabel('Workspace', { exact: true }).selectOption('admin');
  await expect(page.getByRole('link', { name: 'Refund Adjustments' })).toBeVisible();
  await page.getByRole('link', { name: 'Refund Adjustments' }).click();
  await expect(page).toHaveURL(/\/admin\/finance\/refund-adjustments$/);

  const conflicts = page.getByLabel('Refund evidence conflicts');
  await expect(conflicts.getByText(`Refund ${refundId}`)).toBeVisible();
  await conflicts.getByText(`Refund ${refundId}`).click();
  const detail = conflicts.getByLabel('Refund evidence review detail panel');
  await expect(detail.getByRole('heading', { name: refundId })).toBeVisible();

  const preview = detail.getByLabel('Financial correction preview');
  const zeroNet = preview.getByLabel('Zero-net reconciliation');
  await expect(zeroNet).toBeVisible();
  await expect(preview.getByText('No vendor monetary effect')).toBeVisible();
  await expect(zeroNet.getByText('Acknowledgement records review of this calculation. It does not move money.')).toBeVisible();
  const acknowledge = zeroNet.getByRole('button', { name: 'Acknowledge zero-net reconciliation' });
  await expect(acknowledge).toBeEnabled();
  await expect(zeroNet.getByLabel('Required Admin reason')).toHaveCount(0);
  await expect(zeroNet.getByRole('checkbox', {
    name: 'I confirm that no external bank/EFT instruction for this payout has been sent.',
  })).toHaveCount(0);
  await expect(preview.getByRole('button', { name: /approve|apply|debt|credit|payout/i })).toHaveCount(0);

  const postPath = `/admin/finance/refund-reviews/${reviewId}/financial-correction-zero-net-acknowledgement`;
  let postCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === postPath) postCount += 1;
  });
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === postPath);
  await acknowledge.click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.acknowledgement?.id).toBeTruthy();
  expect(payload.acknowledgement?.reviewId).toBe(reviewId);
  expect(payload.acknowledgement?.economicDirection).toBe('NONE');
  expect(payload.acknowledgement?.vendorPayableDifferenceMinor).toBe(0);
  expect(payload.acknowledgement?.note).toBeNull();

  const history = detail.getByRole('heading', { name: 'Zero-net reconciliation acknowledgement' }).locator('..');
  await expect(history.getByText('Acknowledged — no vendor monetary effect')).toBeVisible();
  await expect(history.getByText('Admin actor').locator('..').locator('strong')).toHaveText(payload.acknowledgement.acknowledgedByUserId);
  await expect(history.getByText('Acknowledged at').locator('..').locator('strong')).not.toBeEmpty();
  await expect(acknowledge).toHaveCount(0);
  expect(postCount).toBe(1);
});
