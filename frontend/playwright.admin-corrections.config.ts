import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'admin-corrections.spec.ts',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:18179/lastochka/',
    trace: 'retain-on-failure',
    timezoneId: process.env.ADMIN_CORRECTIONS_TIMEZONE,
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ['ru-RU', 'en-US'].map((locale) => ({
      name: `${browserName}-${locale}`,
      use: { browserName, locale },
    })),
  ),
  outputDir: '../artifacts/admin-corrections/results',
});
