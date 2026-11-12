import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Page, Request } from '@playwright/test';

const limit = 80;
const startupMessages = [
  'Real API mode requires VITE_API_BASE_URL.',
  'Real API mode is pointing at a local backend URL.',
  'Production real API mode requires VITE_API_BASE_URL to point to the backend origin, not the frontend origin.',
];
const startupTitle = 'Runtime configuration needs attention';
const startupEyebrow = 'Startup configuration';
const knownRoutes = new Set(['/', '/login', '/auth/me', '/auth/session', '/auth/csrf', '/auth/login', '/health', '/ready']);

export function observeLogin(
  page: Page,
  baseURL: string | undefined,
  guard: { origins: readonly string[]; blocked: readonly string[] },
) {
  const directory = process.env.BROWSER_SMOKE_LOGIN_DIAGNOSTICS_DIR;
  if (!directory || !isAbsolute(directory)) throw new Error('Login diagnostics require an absolute artifact directory.');

  function safeUrl(value: string) {
    if (value === 'about:blank') return value;
    try {
      const url = new URL(value);
      const safePath = knownRoutes.has(url.pathname) || /^\/assets\/[\w.-]{1,100}\.(?:js|css)$/.test(url.pathname);
      if (guard.origins.includes(url.origin)) return url.origin + (safePath ? url.pathname : '/[other-path]');
      if (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        return url.origin + (safePath ? url.pathname : '/[other-path]');
      }
      return `${url.protocol} [origin outside allowlist]`;
    } catch {
      return '[invalid URL]';
    }
  }

  function browserError(message: string) {
    const code = message.match(/\b(?:net::)?ERR_[A-Z0-9_]+\b/)?.[0];
    if (code) return code;
    for (const [pattern, category] of [
      [/CORS policy|Access-Control-Allow-Origin/i, 'CORS policy error'],
      [/Content Security Policy/i, 'Content Security Policy error'],
      [/Failed to fetch dynamically imported module/i, 'Failed to fetch dynamically imported module'],
      [/Failed to load module script/i, 'Failed to load module script'],
      [/Failed to fetch/i, 'Failed to fetch'],
      [/Unexpected token/i, 'Unexpected token'],
      [/Cannot read properties of undefined/i, 'Cannot read properties of undefined'],
      [/Cannot read properties of null/i, 'Cannot read properties of null'],
    ] as const) {
      if (pattern.test(message)) return category;
    }
    return '[message omitted]';
  }

  async function domSummary() {
    return page.evaluate(({ startupMessages, startupTitle, startupEyebrow }) => {
      const root = document.getElementById('root');
      const title = root?.querySelector('h2')?.textContent?.trim();
      const startupIssues = startupMessages.filter((message) => root?.textContent?.includes(message));
      const visibleText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      const startupFallback = title === startupTitle && startupIssues.length > 0;
      return {
        title: document.title === 'Vendor Dashboard' || document.title === '' ? document.title : '[other title]',
        readyState: document.readyState,
        contentType: document.contentType,
        root: Boolean(root),
        rootChildren: root?.childElementCount ?? 0,
        loginForm: Boolean(document.querySelector('form.auth-form')),
        emailInput: Boolean(document.querySelector('input[type="email"]')),
        passwordInput: Boolean(document.querySelector('input[type="password"]')),
        authRestorePending: Boolean(document.querySelector('.auth-page[aria-busy="true"]')),
        loginHeading: root?.querySelector('h1')?.textContent?.trim() === 'Sign in to continue',
        startupFallback,
        startupHeading: startupFallback ? startupTitle : null,
        startupIssues,
        otherErrorPanel: !startupFallback && Boolean(document.querySelector('.state-error, [role="alert"], #main-frame-error')),
        safeScreenshot: startupFallback &&
          visibleText.toLowerCase() === [startupEyebrow, startupTitle, startupIssues.join(' ')].join(' ').toLowerCase(),
      };
    }, { startupMessages, startupTitle, startupEyebrow });
  }

  const events: Record<string, unknown>[] = [];
  let loginDocument: Record<string, unknown> | undefined;
  let initialDom: Promise<Awaited<ReturnType<typeof domSummary>> | null> | undefined;
  let loginStarted = false;
  let credentialRequestSeen = false;
  function record(event: Record<string, unknown>) {
    if (loginStarted && !credentialRequestSeen && events.length < limit) events.push(event);
  }
  function requestMetadata(request: Request) {
    const previous = request.redirectedFrom();
    return {
      url: safeUrl(request.url()), method: request.method(), resource: request.resourceType(),
      redirectedFrom: previous ? safeUrl(previous.url()) : undefined,
    };
  }
  function isMainNavigation(request: Request) {
    if (!request.isNavigationRequest()) return false;
    try { return request.frame() === page.mainFrame(); } catch { return false; }
  }
  page.on('request', (request) => {
    if (isMainNavigation(request)) loginStarted = true;
    if (loginStarted && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) credentialRequestSeen = true;
    record({ type: 'request', ...requestMetadata(request) });
  });
  page.on('response', (response) => {
    const request = response.request();
    const responseMeta = {
      ...requestMetadata(request), status: response.status(),
      contentType: response.headers()['content-type']?.split(';')[0].match(/^[\w.+-]+\/[\w.+-]+$/)?.[0],
    };
    if (loginStarted && !credentialRequestSeen && isMainNavigation(request)) loginDocument = responseMeta;
    record({ type: 'response', ...responseMeta });
  });
  page.on('requestfailed', (request) => {
    record({ type: 'requestfailed', ...requestMetadata(request), error: browserError(request.failure()?.errorText ?? '') });
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) record({ type: 'navigation', url: safeUrl(frame.url()) });
  });
  page.on('domcontentloaded', () => {
    if (loginStarted && !credentialRequestSeen) initialDom ??= domSummary().catch(() => null);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    record({ type: 'console', error: browserError(message.text()), url: safeUrl(location.url), line: location.lineNumber });
  });
  page.on('pageerror', (error) => {
    const frame = error.stack?.match(/(https?:\/\/[^\s()]+):(\d+):(\d+)/);
    const name = /^(?:Error|TypeError|SyntaxError|ReferenceError|RangeError|SecurityError)$/.test(error.name) ? error.name : 'Error';
    record({ type: 'pageerror', name, error: browserError(error.message),
      frame: frame ? { url: safeUrl(frame[1]), line: Number(frame[2]), column: Number(frame[3]) } : undefined });
  });

  return async (status: string) => {
    try {
      await mkdir(directory, { recursive: true });
      const url = safeUrl(page.url());
      const onLoginPage = baseURL && url === new URL('/login', baseURL).href;
      const finalDom = !credentialRequestSeen && !page.isClosed() && onLoginPage
        ? await domSummary().catch(() => null) : null;
      let screenshot = 'omitted because the page did not match the static pre-auth startup panel';
      if (finalDom?.safeScreenshot) {
        try {
          await page.screenshot({
            path: join(directory, 'login-failure.png'), timeout: 2000,
            mask: [page.locator('input, textarea, select, iframe, [contenteditable]')],
          });
          screenshot = 'login-failure.png';
        } catch {
          screenshot = 'screenshot capture failed';
        }
      }
      const report = {
        status, baseURL: baseURL ? safeUrl(baseURL) : null, url, loginDocument,
        initialDom: await initialDom, finalDom, allowlist: guard.origins,
        blocked: guard.blocked.slice(0, limit).map(safeUrl),
        screenshot, trace: 'raw login trace omitted because it may contain credentials or session data', events,
      };
      await writeFile(join(directory, 'login-diagnostics.json'), JSON.stringify(report, null, 2) + '\n');
      if (status !== 'passed') {
        await writeFile(join(directory, 'error-context.md'),
          '# Sanitized login failure context\n\n```json\n' + JSON.stringify({ ...report, events: undefined }, null, 2) + '\n```\n');
      }
      console.log('Login browser diagnostics', JSON.stringify(report));
    } catch {
      console.error('Unable to persist sanitized login browser diagnostics.');
    }
  };
}
