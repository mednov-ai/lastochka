import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'russian-feedback.spec.ts',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.TEST_APP_URL ?? 'http://localhost:5177/lastochka/',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ['en-US', 'ru-RU'].flatMap((locale) =>
      [375, 1440].map((width) => ({
        name: `${browserName}-${locale}-${width}`,
        use: { browserName, locale, viewport: { width, height: 900 } },
      })),
    ),
  ),
  reporter: [['list']],
});
