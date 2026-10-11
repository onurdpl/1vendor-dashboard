import { expect, installBrowserEgressGuard, test } from './fixtures/browser-egress-guard';

const run = 'browser-smoke-settlement-replacement';
const runDate = process.env.BROWSER_SMOKE_RUN_DATE;
const vendorId = `${run}-eligible-vendor`;
const uncertainVendorId = `${run}-uncertain-vendor`;

test('Admin reviews, confirms and reopens a distinct replacement through real finance APIs', async ({ page, browser }) => {
  test.setTimeout(120_000);
  expect(runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@demo.com');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: /Replacement eligible Vendor Admin view/ }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByLabel('Workspace', { exact: true }).selectOption('admin');

  const scheduledPath = '/admin/finance/settlement-schedules';
  await page.goto(scheduledPath);
  await expect(page.getByRole('heading', { name: 'Scheduled Settlements' })).toBeVisible();
  await page.getByLabel('Run date').fill(runDate!);
  await page.getByRole('button', { name: 'Preview Schedule' }).click();
  const beforeResponse = await page.request.get(`http://localhost:4000/admin/finance/settlement-schedules/dry-run?runDate=${runDate}&vendorId=${vendorId}`);
  expect(beforeResponse.ok()).toBe(true);
  const before = await beforeResponse.json();
  const originalId = before.vendors[0]?.existingSettlementApprovalId as string;
  expect(before.vendors[0]).toMatchObject({ vendorId, state: 'DRAFT_EXISTS', existingSettlementApprovalStatus: 'draft' });
  expect(originalId).toBeTruthy();

  // Cancellation uses the normal Admin UI and its real backend route.
  await page.goto('/admin/finance/settlement-approvals');
  await page.getByPlaceholder('Vendor, settlement, status').fill(vendorId);
  await expect(page.getByRole('button', { name: 'Cancel Settlement' })).toBeVisible();
  const cancelResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/admin/finance/settlement-approvals/${originalId}/cancel`);
  await page.getByRole('button', { name: 'Cancel Settlement' }).click();
  await page.getByRole('dialog', { name: 'Cancel Settlement' }).getByRole('button', { name: 'Cancel Settlement' }).click();
  expect((await cancelResponse).ok()).toBe(true);

  await page.goto(scheduledPath);
  await page.getByLabel('Run date').fill(runDate!);
  await page.getByRole('button', { name: 'Preview Schedule' }).click();
  await page.getByRole('button', { name: /^Blocked/ }).click();
  await expect(page.getByRole('button', { name: 'Review Replacement' })).toBeVisible();
  const assessmentResponse = page.waitForResponse((response) => response.request().method() === 'GET' &&
    new URL(response.url()).pathname === `/admin/finance/settlement-approvals/${originalId}/replacement-assessment`);
  await page.getByRole('button', { name: 'Review Replacement' }).click();
  const assessment = await (await assessmentResponse).json();
  expect(assessment).toMatchObject({ outcome: 'ELIGIBLE', writesPerformed: false,
    originalSettlementApprovalId: originalId, vendorId, existingReplacement: null });
  const review = page.getByLabel('Controlled replacement review');
  await expect(review.getByText('ELIGIBLE', { exact: true })).toBeVisible();
  const create = review.getByRole('button', { name: 'Create Replacement Draft' });
  await expect(create).toBeDisabled();
  await review.getByLabel('Admin reason').fill('Real browser smoke: reviewed frozen scheduled sources.');
  await expect(create).toBeDisabled();
  await review.getByRole('checkbox', { name: 'I confirm creation of a replacement DRAFT only.' }).check();
  await expect(create).toBeEnabled();
  const createResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/admin/finance/settlement-approvals/${originalId}/replacement-draft`);
  await create.click();
  const created = await (await createResponse).json();
  expect(created).toMatchObject({ outcome: 'CREATED', originalSettlementApprovalId: originalId, vendorId,
    status: 'DRAFT', writesPerformed: true });
  expect(created.replacementSettlementApprovalId).not.toBe(originalId);
  await expect(review.getByRole('link', { name: 'Open Replacement' })).toBeVisible();
  await expect(create).toHaveCount(0);
  const openedResponse = page.waitForResponse((response) => response.request().method() === 'GET' &&
    new URL(response.url()).pathname === `/admin/finance/settlement-approvals/${created.replacementSettlementApprovalId}`);
  await review.getByRole('link', { name: 'Open Replacement' }).click();
  await expect(page).toHaveURL(new RegExp(`approvalId=${created.replacementSettlementApprovalId}`));
  expect(await (await openedResponse).json()).toMatchObject({ id: created.replacementSettlementApprovalId,
    vendorId, status: 'draft' });

  await page.goto(scheduledPath);
  await page.reload();
  await page.getByLabel('Run date').fill(runDate!);
  await page.getByRole('button', { name: 'Preview Schedule' }).click();
  await page.getByRole('button', { name: /^Blocked/ }).click();
  const blockedResponse = page.waitForResponse((response) => response.request().method() === 'GET' &&
    new URL(response.url()).pathname === `/admin/finance/settlement-approvals/${originalId}/replacement-assessment`);
  await page.getByRole('button', { name: 'Review Replacement' }).click();
  expect(await (await blockedResponse).json()).toMatchObject({ outcome: 'BLOCKED',
    existingReplacement: { id: created.replacementSettlementApprovalId, status: 'DRAFT' } });
  await expect(page.getByLabel('Controlled replacement review').getByRole('link', { name: 'Open Replacement' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Replacement Draft' })).toHaveCount(0);

  // A second real vendor demonstrates uncertain transport after a successful server write.
  const secondBefore = await page.request.get(`http://localhost:4000/admin/finance/settlement-schedules/dry-run?runDate=${runDate}&vendorId=${uncertainVendorId}`);
  expect(secondBefore.ok()).toBe(true);
  const uncertainOriginalId = (await secondBefore.json()).vendors[0].existingSettlementApprovalId as string;
  await page.getByRole('combobox', { name: 'Select vendor' }).selectOption({ label: 'Replacement uncertain Vendor' });
  await page.goto('/admin/finance/settlement-approvals');
  await page.getByPlaceholder('Vendor, settlement, status').fill(uncertainVendorId);
  const secondCancelResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/admin/finance/settlement-approvals/${uncertainOriginalId}/cancel`);
  await page.getByRole('button', { name: 'Cancel Settlement' }).click();
  await page.getByRole('dialog', { name: 'Cancel Settlement' }).getByRole('button', { name: 'Cancel Settlement' }).click();
  expect((await secondCancelResponse).ok()).toBe(true);
  await page.goto(scheduledPath);
  await page.getByLabel('Run date').fill(runDate!);
  await page.getByPlaceholder('Optional vendor id').fill(uncertainVendorId);
  await page.getByRole('button', { name: 'Preview Schedule' }).click();
  await page.getByRole('button', { name: 'Review Replacement' }).click();
  const uncertainReview = page.getByLabel('Controlled replacement review');
  await expect(uncertainReview.getByText('ELIGIBLE', { exact: true })).toBeVisible();
  await uncertainReview.getByLabel('Admin reason').fill('Transport uncertainty smoke with persisted write.');
  await uncertainReview.getByRole('checkbox', { name: 'I confirm creation of a replacement DRAFT only.' }).check();
  let intercepted = false;
  let uncertainRequestId: string | null = null;
  await page.route(`**/admin/finance/settlement-approvals/${uncertainOriginalId}/replacement-draft`, async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    uncertainRequestId = (route.request().postDataJSON() as { requestId: string }).requestId;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await uncertainReview.getByRole('button', { name: 'Create Replacement Draft' }).click();
  await expect(uncertainReview.getByRole('link', { name: 'Open Replacement' })).toBeVisible();
  expect(intercepted).toBe(true);
  expect(uncertainRequestId).toBeTruthy();
  const reconciled = await page.request.get(`http://localhost:4000/admin/finance/settlement-approvals/${uncertainOriginalId}/replacement-assessment?vendorId=${uncertainVendorId}`);
  expect(await reconciled.json()).toMatchObject({ outcome: 'BLOCKED', existingReplacement: {
    replacementRequestId: uncertainRequestId,
  } });
  await page.unrouteAll();

  const vendorContext = await browser.newContext();
  const blockedVendorEgress = await installBrowserEgressGuard(vendorContext,
    ['http://localhost:5173', 'http://localhost:4000']);
  try {
    const vendorPage = await vendorContext.newPage();
    await vendorPage.goto('http://localhost:5173/login');
    await vendorPage.getByLabel('Email').fill('vendor@demo.com');
    await vendorPage.getByLabel('Password').fill('demo123');
    await vendorPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(vendorPage.getByRole('heading', { name: /Today, Replacement eligible Vendor/ })).toBeVisible();
    const denied = await vendorPage.request.get(`http://localhost:4000/admin/finance/settlement-approvals/${originalId}/replacement-assessment?vendorId=${vendorId}`);
    expect(denied.status()).toBe(403);
  } finally {
    await vendorContext.close();
  }
  expect(blockedVendorEgress).toEqual([]);
});
