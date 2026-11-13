import { defineConfig } from '@playwright/test';

process.env.POLISH_FIXTURE_URL = 'http://127.0.0.1:48794';
export default defineConfig({
  testDir: 'tests',
  testMatch: ['client-review-polish.spec.ts', 'schedule-poster-rows.spec.ts'],
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:48793/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: (['chromium', 'webkit'] as const).map((browserName) => ({
    name: browserName,
    use: { browserName, locale: 'ru-RU' },
  })),
  reporter: [['list']],
  webServer: [
    {
      command: 'node tests/fixtures/polish-api.mjs',
      url: 'http://127.0.0.1:48794/__fixture/state',
      reuseExistingServer: true,
      env: { FIXTURE_PORT: '48794' },
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:48793/',
      reuseExistingServer: true,
      env: {
        APP_BASE_PATH: '/',
        BACKEND_INTERNAL_URL: 'http://127.0.0.1:48794',
        DEV_BACKEND_ORIGIN: 'http://127.0.0.1:48794',
        FRONTEND_DEV_PORT: '48793',
      },
    },
  ],
});
