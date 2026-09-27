import { expect, test } from '@playwright/test';
import { installBrowserEgressGuard } from './fixtures/browser-egress-guard';

test('browser egress guard allows local traffic and blocks public traffic before transmission', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('A local browser base URL is required.');
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const blocked = await installBrowserEgressGuard(context, [new URL(baseURL).origin]);
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    const result = await page.evaluate(async () => {
      try {
        await fetch('https://egress-probe.invalid/blocked');
        return 'unexpected success';
      } catch {
        return 'blocked';
      }
    });
    expect(result).toBe('blocked');
    expect(blocked).toEqual(['https://egress-probe.invalid/blocked']);
  } finally {
    await context.close();
  }
});
