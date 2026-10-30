import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'admin-entry.spec.ts',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:18142/lastochka/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    [320, 1440].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        browserName,
        viewport: { width, height: 900 },
        locale: width === 320 ? 'ru-RU' : 'en-US',
      },
    })),
  ),
  outputDir: '../artifacts/admin-entry/results',
  reporter: [['list']],
});
