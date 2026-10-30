import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.TEST_APP_URL ?? 'http://localhost:5173/lastochka/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['html', { open: 'never' }]],
});
