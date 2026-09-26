import { defineConfig, devices } from '@playwright/test';

const allowedSpecs = [
  'financial-correction-review-credit.real.spec.ts',
  'financial-correction-draft-deduction.real.spec.ts',
];
const selectedSpec = process.env.BROWSER_SMOKE_REAL_SPEC ?? allowedSpecs[0];
if (!allowedSpecs.includes(selectedSpec)) {
  throw new Error('Real browser smoke spec must be one of the allowlisted Financial Correction scenarios.');
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: selectedSpec,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
