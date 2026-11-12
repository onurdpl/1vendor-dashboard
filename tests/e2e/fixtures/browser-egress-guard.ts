import { test as base } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { observeLogin } from './login-diagnostics';

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const internalSchemes = new Set(['about:', 'data:', 'blob:']);
const loginDiagnostics = new WeakMap<BrowserContext, { origins: readonly string[]; blocked: readonly string[] }>();

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
    if (process.env.BROWSER_SMOKE_REAL_SPEC && process.env.BROWSER_SMOKE_IPV4_LOOPBACK !== '1') {
      origins.push('http://localhost:4000');
    }
    const blocked = await installBrowserEgressGuard(context, origins);
    const diagnosticsEnabled = process.env.BROWSER_SMOKE_LOGIN_DIAGNOSTICS === '1';
    if (diagnosticsEnabled) {
      loginDiagnostics.set(context, { origins, blocked });
    }
    await use(context);
    if (blocked.length) {
      const details = diagnosticsEnabled ? 'see sanitized login diagnostics' : blocked.join(', ');
      throw new Error(`EXTERNAL EGRESS BLOCKED: ${details}`);
    }
  },
  page: async ({ page, baseURL }, use, testInfo) => {
    const guard = loginDiagnostics.get(page.context());
    if (!guard) return use(page);
    const finish = observeLogin(page, baseURL, guard);
    try {
      await use(page);
    } finally {
      await finish(testInfo.status ?? 'unknown');
    }
  },
});

export { expect, type Page } from '@playwright/test';
