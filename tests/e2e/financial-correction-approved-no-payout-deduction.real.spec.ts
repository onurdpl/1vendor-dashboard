import { expect, test } from './fixtures/browser-egress-guard';

const reviewId = process.env.BROWSER_SMOKE_REVIEW_ID;
const refundId = 'gid://shopify/Refund/browser-smoke-approved-no-payout-deduction';

test('Admin reserves an approved-settlement deduction without payout or vendor debt', async ({ page }) => {
  expect(reviewId).toBe('browser-smoke-approved-no-payout-deduction-review');
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

  const application = detail.getByLabel('Approved-settlement correction deduction application');
  await expect(application).toBeVisible();
  await expect(application.getByRole('heading', { name: 'Approved settlement vendor entitlement reduction' })).toBeVisible();
  await expect(detail.getByText('Unpaid vendor entitlement decreases')).toBeVisible();
  await expect(application.getByText(/Historical approved settlement:.*The historical approved settlement remains unchanged\. This does not create vendor debt\./)).toBeVisible();
  const reason = application.getByLabel('Required Admin reason');
  const apply = application.getByRole('button', { name: 'Approve & Apply Correction' });
  await expect(reason).toBeVisible();
  await expect(apply).toBeDisabled();
  await expect(application.getByRole('checkbox', {
    name: 'I confirm that no external bank/EFT instruction for this payout has been sent.',
  })).toHaveCount(0);
  await reason.fill('Browser smoke: verified approved-settlement deduction coverage without payout.');
  await expect(apply).toBeEnabled();

  const postPath = `/admin/finance/refund-reviews/${reviewId}/financial-correction-approved-settlement-deduction`;
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
  expect(payload.ok).toBe(true);
  expect(payload.application?.route).toBe('APPROVED_SETTLEMENT_VENDOR_DEDUCTION');
  expect(payload.application?.status).toBe('APPLIED');
  expect(payload.application?.direction).toBe('VENDOR_DEDUCTION');
  expect(payload.application?.deductionId).toBeTruthy();
  expect(payload.application?.coverageId).toBeTruthy();
  expect(payload.application?.historicalApprovedSettlementId).toBe('browser-smoke-approved-no-payout-deduction-origin');
  expect(payload.application?.payoutBatchId).toBeNull();

  const applied = detail.getByRole('heading', { name: 'Applied approved-settlement financial correction deduction' }).locator('..');
  await expect(applied).toBeVisible();
  await expect(applied.getByText('Vendor entitlement reduction')).toBeVisible();
  await expect(applied.getByText('Historical approved settlement', { exact: true })).toBeVisible();
  await expect(applied.getByText('Reserved coverage')).toBeVisible();
  await expect(applied.getByText('Not yet paid')).toBeVisible();
  await expect(applied.getByText('The historical approved settlement was not modified. This separate deduction reduces the first payout entitlement; it is not vendor debt.')).toBeVisible();
  await expect(application).toHaveCount(0);
  expect(postCount).toBe(1);
});
