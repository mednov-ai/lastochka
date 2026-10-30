import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'new-recurring-session.spec.ts',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    [375, 1440].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        browserName,
        locale: width === 375 ? 'ru-RU' : 'en-US',
        timezoneId: process.env.WEEKLY_TEST_TIMEZONE,
        viewport: { width, height: width === 375 ? 812 : 900 },
      },
    })),
  ),
  reporter: [['list']],
});
