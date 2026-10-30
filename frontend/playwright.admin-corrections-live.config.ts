import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'admin-corrections-live.spec.ts',
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: 'http://127.0.0.1:18180/lastochka/',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  outputDir: '../artifacts/admin-corrections/live-results',
});
