import { test as base } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const internalSchemes = new Set(['about:', 'data:', 'blob:']);

export async function installBrowserEgressGuard(context: BrowserContext, origins: readonly string[]) {
  const allowed = new Set(origins);
  const blocked: string[] = [];
  await context.route('**/*', async (route) => {
    const attempted = route.request().url();
    let permitted = false;
    try {
      const url = new URL(attempted);
      permitted = internalSchemes.has(url.protocol) ||
        ((url.protocol === 'http:' || url.protocol === 'https:') && allowed.has(url.origin));
    } catch { /* Unknown destinations fail closed. */ }
    if (permitted) return route.continue();
    blocked.push(attempted);
    await route.abort('blockedbyclient');
  });
  return blocked;
}

export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (!baseURL) throw new Error('Browser egress guard requires a configured local baseURL.');
    const baseOrigin = new URL(baseURL);
    if (!localHosts.has(baseOrigin.hostname)) {
      throw new Error(`EXTERNAL EGRESS BLOCKED: ${baseURL}`);
    }
    const origins = [baseOrigin.origin];
    if (process.env.BROWSER_SMOKE_REAL_SPEC) origins.push('http://localhost:4000');
    const blocked = await installBrowserEgressGuard(context, origins);
    await use(context);
    if (blocked.length) throw new Error(`EXTERNAL EGRESS BLOCKED: ${blocked.join(', ')}`);
  },
});

export { expect, type Page } from '@playwright/test';
