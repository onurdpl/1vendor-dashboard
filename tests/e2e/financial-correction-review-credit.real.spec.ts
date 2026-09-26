import { expect, test } from '@playwright/test';

const reviewId = process.env.BROWSER_SMOKE_REVIEW_ID;
const refundId = 'gid://shopify/Refund/browser-smoke-review-credit';

test('Admin applies the persisted REVIEW vendor credit with explicit EFT-not-sent attestation', async ({ page }) => {
  expect(reviewId).toBe('browser-smoke-review-credit-review');
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

  const application = detail.getByLabel('Review payout correction application');
  await expect(application).toBeVisible();
  await expect(application.getByText('Vendor credit:', { exact: false })).toBeVisible();
  await expect(detail.getByText('Vendor credit application is unavailable for this review.')).toHaveCount(0);

  const reason = application.getByLabel('Required Admin reason');
  const confirmation = application.getByRole('checkbox', {
    name: 'I confirm that no external bank/EFT instruction for this payout has been sent.',
  });
  const apply = application.getByRole('button', { name: 'Cancel Review Payout & Apply Correction' });
  await expect(reason).toBeVisible();
  await expect(confirmation).not.toBeChecked();
  await expect(apply).toBeDisabled();
  await reason.fill('Browser smoke: verified REVIEW vendor credit and EFT-not-sent attestation.');
  await expect(apply).toBeDisabled();
  await confirmation.check();
  await expect(apply).toBeEnabled();

  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' &&
      url.pathname === `/admin/finance/refund-reviews/${reviewId}/financial-correction-review-payout`;
  });
  await apply.click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.application?.route).toBe('REVIEW_PAYOUT_VENDOR_CREDIT');

  const applied = detail.getByText('Applied review payout financial correction');
  await expect(applied).toBeVisible();
  await expect(detail.getByText('Cancelled REVIEW payout')).toBeVisible();
  await expect(detail.getByText('EFT not sent confirmed at')).toBeVisible();
  await expect(detail.getByText('Prepare a new payout separately from current financial sources.')).toBeVisible();
  await expect(application).toHaveCount(0);
});
