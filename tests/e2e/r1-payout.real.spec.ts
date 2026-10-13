import { expect, test } from './fixtures/browser-egress-guard';

async function loginAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@demo.com');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: /Admin view/ }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByLabel('Workspace', { exact: true }).selectOption('admin');
  await page.goto('/admin/finance/payment-preparation');
  await expect(page.getByLabel('Payment preparation queue')).toBeVisible();
}

async function selectVendor(page: import('@playwright/test').Page, vendorId: string) {
  await page.getByPlaceholder('Vendor id').fill(vendorId);
  await expect(page.getByLabel('Payment preparation detail panel')).toBeVisible();
}

async function clickAction(page: import('@playwright/test').Page, name: string, confirm = name) {
  const detail = page.getByLabel('Payment preparation detail panel');
  await detail.getByRole('button', { name, exact: true }).click();
  return page.getByRole('dialog').getByRole('button', { name: confirm, exact: true });
}

test('Admin prepares and pays 1000 with exact 200 R1 refund and vendor sees real cash', async ({ page }) => {
  await loginAdmin(page);
  await selectVendor(page, 'r1-browser-positive');
  if (process.env.BROWSER_SMOKE_R1_RECOVERY !== '1') {
    await (await clickAction(page, 'Prepare Batch')).click();
  }
  const detail = page.getByLabel('Payment preparation detail panel');
  await expect(detail.getByText('Verified R1 payment authority')).toBeVisible();
  await expect(detail.getByText('Net bank payment').locator('..')).toContainText('800');
  if (process.env.BROWSER_SMOKE_R1_RECOVERY !== '1') {
    await (await clickAction(page, 'Mark for Review')).click();
  }
  const markPaid = await clickAction(page, 'Mark Paid');
  const now = new Date(Date.now() - 1000);
  await page.getByRole('dialog').getByLabel('Bank EFT execution date').fill(now.toISOString().slice(0, 10));
  await page.getByRole('dialog').getByLabel('Bank EFT execution time').fill(now.toISOString().slice(11, 16));
  await page.getByRole('dialog').getByLabel('Bank record UTC offset (for example +03:00)').fill('+00:00');
  await page.getByRole('dialog').getByLabel('Actual bank EFT amount (TRY)').fill('800.00');
  await markPaid.click();
  await expect(detail.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('Additional exact refund offset').locator('..')).toContainText('200');

  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByLabel('Email').fill('vendor@demo.com');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /R1 Browser positive Vendor/ })).toBeVisible();
  await page.goto('/finance');
  await page.getByRole('tab', { name: 'Transactions' }).click();
  await expect(page.getByText('Onaylanmış hak ediş')).toBeVisible();
  await expect(page.getByText('Banka ile ödenen nakit').locator('..')).toContainText('800');
  await expect(page.getByText('R1 Browser cashless')).toHaveCount(0);
  if (process.env.BROWSER_SMOKE_R1_RECOVERY === '1') {
    await page.goto('/admin/finance/payment-preparation');
    await expect(page.getByLabel('Payment preparation queue')).toHaveCount(0);
  }
});

test('Admin completes a zero-cash offset with no fake EFT or Mark Paid', async ({ page }) => {
  await loginAdmin(page);
  await selectVendor(page, 'r1-browser-cashless');
  if (process.env.BROWSER_SMOKE_R1_RECOVERY !== '1') {
    await (await clickAction(page, 'Prepare Batch')).click();
    await (await clickAction(page, 'Mark for Review')).click();
  }
  const detail = page.getByLabel('Payment preparation detail panel');
  await expect(detail.getByRole('button', { name: 'Mark Paid' })).toHaveCount(0);
  const complete = await clickAction(page, 'Complete Cashless Offset', 'Complete Cashless');
  await complete.click();
  await expect(page.getByRole('alert')).toContainText('Written reason');
  await page.getByRole('dialog').getByLabel('Written reason').fill('Verified exact zero-cash authority');
  await page.getByRole('dialog').getByLabel('I confirm no external EFT was sent.').check();
  await page.getByRole('dialog').getByLabel('I confirm zero-cash offset completion; this is not a bank payment.').check();
  await complete.click();
  await expect(detail.getByText('Cashless offset completed — no EFT')).toBeVisible();
  await expect(detail.getByText('Net bank payment').locator('..')).toContainText('No EFT');
});

test('Admin can cancel R1 REVIEW only with written no-EFT confirmation', async ({ page }) => {
  await loginAdmin(page);
  await selectVendor(page, 'r1-browser-cancel');
  if (process.env.BROWSER_SMOKE_R1_RECOVERY !== '1') {
    await (await clickAction(page, 'Prepare Batch')).click();
    await (await clickAction(page, 'Mark for Review')).click();
  }
  const cancel = await clickAction(page, 'Cancel Review (No EFT)', 'Cancel Review');
  await cancel.click();
  await expect(page.getByRole('alert')).toContainText('Written reason');
  await page.getByRole('dialog').getByLabel('Written reason').fill('No bank EFT sent');
  await page.getByRole('dialog').getByLabel('I confirm no external EFT was sent.').check();
  await cancel.click();
  await expect(page.getByLabel('Payment preparation detail panel').getByText('Cancelled', { exact: true }).first())
    .toBeVisible();
});
