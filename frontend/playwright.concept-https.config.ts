import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'admin-concept-https.spec.ts',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'https://localhost:18489/lastochka/',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    [375, 1440].map((width) => ({
      name: `${browserName}-${width}`,
      use: { browserName, viewport: { width, height: 900 } },
    })),
  ),
  reporter: [['list']],
});
