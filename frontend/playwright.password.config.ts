import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'password-lifecycle.spec.ts',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.TEST_APP_URL ?? 'http://localhost:5181/lastochka/',
    trace: 'off',
    screenshot: 'off',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ['en-US', 'ru-RU'].flatMap((locale) =>
      [320, 375, 1440].map((width) => ({
        name: `${browserName}-${locale}-${width}`,
        use: { browserName, locale, viewport: { width, height: 1000 } },
      })),
    ),
  ),
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: new URL(
          '../artifacts/password-lifecycle-baseline/browser-results.json',
          import.meta.url,
        ).pathname,
      },
    ],
  ],
});
