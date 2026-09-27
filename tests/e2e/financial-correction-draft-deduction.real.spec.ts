import { expect, test } from './fixtures/browser-egress-guard';

const reviewId = process.env.BROWSER_SMOKE_REVIEW_ID;
const refundId = 'gid://shopify/Refund/browser-smoke-draft-deduction';

test('Admin applies a DRAFT payout vendor deduction without EFT attestation', async ({ page }) => {
  expect(reviewId).toBe('browser-smoke-draft-deduction-review');
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

  const application = detail.getByLabel('Draft payout correction application');
  await expect(application).toBeVisible();
  await expect(application.getByText('Vendor deduction:', { exact: false })).toBeVisible();
  const reason = application.getByLabel('Required Admin reason');
  const apply = application.getByRole('button', { name: 'Cancel Draft Payout & Apply Correction' });
  await expect(reason).toBeVisible();
  await expect(apply).toBeDisabled();
  await expect(application.getByRole('checkbox', {
    name: 'I confirm that no external bank/EFT instruction for this payout has been sent.',
  })).toHaveCount(0);
  await reason.fill('Browser smoke: verified DRAFT vendor deduction and payout cancellation.');
  await expect(apply).toBeEnabled();

  const postPath = `/admin/finance/refund-reviews/${reviewId}/financial-correction-draft-payout`;
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
  expect(payload.application?.route).toBe('DRAFT_PAYOUT_VENDOR_DEDUCTION');

  await expect(detail.getByText('Applied draft payout financial correction')).toBeVisible();
  await expect(detail.getByText('Vendor deduction', { exact: true })).toBeVisible();
  await expect(detail.getByText('Cancelled DRAFT payout')).toBeVisible();
  await expect(detail.getByText('Prepare a new payout separately from current financial sources.')).toBeVisible();
  await expect(application).toHaveCount(0);
  expect(postCount).toBe(1);
});
