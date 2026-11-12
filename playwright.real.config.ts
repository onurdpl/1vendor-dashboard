import { defineConfig, devices } from '@playwright/test';

const allowedSpecs = [
  'financial-correction-review-credit.real.spec.ts',
  'financial-correction-draft-deduction.real.spec.ts',
  'financial-correction-paid-deduction.real.spec.ts',
  'financial-correction-zero-net.real.spec.ts',
  'financial-correction-approved-no-payout-deduction.real.spec.ts',
  'settlement-replacement.real.spec.ts',
  'r1-payout.real.spec.ts',
  'fin03-settlement-history.real.spec.ts',
  'cancellation-eligibility.real.spec.ts',
];
const selectedSpec = process.env.BROWSER_SMOKE_REAL_SPEC ?? allowedSpecs[0];
if (!allowedSpecs.includes(selectedSpec)) {
  throw new Error('Real browser smoke spec must be one of the allowlisted finance scenarios.');
}
const loopbackMode = process.env.BROWSER_SMOKE_IPV4_LOOPBACK;
if (loopbackMode !== undefined && (loopbackMode !== '1' || selectedSpec !== allowedSpecs[0])) {
  throw new Error('IPv4 loopback mode requires the review-credit browser smoke.');
}
const ipv4Loopback = loopbackMode === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: selectedSpec,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: ipv4Loopback ? 'http://127.0.0.1:5173' : 'http://localhost:5173',
    ...(ipv4Loopback ? { launchOptions: { chromiumSandbox: true } } : {}),
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
