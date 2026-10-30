import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'enquiry-push.spec.ts',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://localhost:18215/lastochka/', trace: 'retain-on-failure' },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ['en-US', 'ru-RU'].flatMap((locale) =>
      [375, 1440].map((width) => ({
        name: `${browserName}-${locale}-${width}`,
        use: { browserName, viewport: { width, height: 900 }, locale },
      })),
    ),
  ),
});
