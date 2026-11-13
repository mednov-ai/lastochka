import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['permanent-schedule.spec.ts', 'permanent-admin.spec.ts'],
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:48673/' },
  webServer: [
    { command: 'node tests/fixtures/permanent-api.mjs', url: 'http://127.0.0.1:48674/__fixture/state', reuseExistingServer: false },
    { command: 'npm run dev', url: 'http://127.0.0.1:48673/', reuseExistingServer: false,
      env: { APP_BASE_PATH: '/', BACKEND_INTERNAL_URL: 'http://127.0.0.1:48674', DEV_BACKEND_ORIGIN: 'http://127.0.0.1:48674', FRONTEND_DEV_PORT: '48673' } },
  ],
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { browserName: 'webkit', viewport: { width: 375, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  reporter: 'line',
});
