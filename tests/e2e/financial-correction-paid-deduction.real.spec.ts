import { expect, test } from '@playwright/test';

const reviewId = process.env.BROWSER_SMOKE_REVIEW_ID;
const refundId = 'gid://shopify/Refund/browser-smoke-paid-deduction';

test('Admin applies a PAID payout vendor deduction without changing paid history', async ({ page }) => {
  expect(reviewId).toBe('browser-smoke-paid-deduction-review');
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

  const application = detail.getByLabel('Paid correction debt application');
  await expect(application).toBeVisible();
  await expect(application.getByRole('heading', { name: 'Paid payout vendor debt' })).toBeVisible();
  await expect(application.getByText(/creates a new future vendor debt.*historical PAID payout remains unchanged/)).toBeVisible();
  await expect(detail.getByText('Vendor owes Sporgym more')).toBeVisible();
  const reason = application.getByLabel('Required Admin reason');
  const apply = application.getByRole('button', { name: 'Approve & Apply Correction' });
  await expect(reason).toBeVisible();
  await expect(apply).toBeDisabled();
  await expect(application.getByRole('checkbox', {
    name: 'I confirm that no external bank/EFT instruction for this payout has been sent.',
  })).toHaveCount(0);
  await reason.fill('Browser smoke: verified PAID vendor deduction and additive debt.');
  await expect(apply).toBeEnabled();

  const postPath = `/admin/finance/refund-reviews/${reviewId}/financial-correction-paid-debt`;
  let postCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === postPath) postCount += 1;
  });
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === postPath);
  await apply.click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.application?.status).toBe('APPLIED');
  expect(payload.application?.economicDirection).toBe('VENDOR_DEDUCTION');
  expect(payload.application?.vendorBalanceEventId).toBeTruthy();

  await expect(detail.getByText('Applied financial correction')).toBeVisible();
  await expect(detail.getByText('Vendor deduction', { exact: true })).toBeVisible();
  await expect(detail.getByText('Correction debt')).toBeVisible();
  await expect(detail.getByText('Historical PAID payout', { exact: true })).toBeVisible();
  await expect(detail.getByText('The historical PAID payout was not modified. This debt affects future payout balance.')).toBeVisible();
  await expect(application).toHaveCount(0);
  await expect(detail.getByText(/Cancelled (?:DRAFT|REVIEW|PAID) payout/)).toHaveCount(0);
  await expect(detail.getByRole('checkbox', {
    name: 'I confirm that no external bank/EFT instruction for this payout has been sent.',
  })).toHaveCount(0);
  expect(postCount).toBe(1);
});
