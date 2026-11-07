import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'payment-test-return.spec.ts',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:18181/lastochka/', trace: 'retain-on-failure' },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ['ru-RU', 'en-US'].map((locale) => ({
      name: `${browserName}-${locale}`,
      use: { browserName, locale },
    })),
  ),
  outputDir: '../artifacts/payment-test-return/results',
});
