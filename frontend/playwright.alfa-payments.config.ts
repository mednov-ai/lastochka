import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'alfa-payments.spec.ts',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.TEST_APP_URL ?? 'http://127.0.0.1:18179/lastochka/',
    trace: 'retain-on-failure',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ['ru-RU', 'en-US'].map((locale) => ({
      name: `${browserName}-${locale}`,
      use: { browserName, locale },
    })),
  ),
  outputDir: '../artifacts/alfa-payments/results',
});
