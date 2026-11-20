import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'schedule-initial-load.spec.ts',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:48833/', trace: 'retain-on-failure' },
  projects: (['chromium', 'webkit'] as const).map((browserName) => ({
    name: browserName,
    // React Router waits for the full stream for detected crawlers; HeadlessChrome is a bot.
    use: {
      browserName,
      locale: 'ru-RU',
      ...(browserName === 'chromium'
        ? {
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          }
        : {}),
    },
  })),
  reporter: [['list']],
  webServer: [
    {
      command: 'node tests/fixtures/polish-api.mjs',
      url: 'http://127.0.0.1:48834/__fixture/state',
      reuseExistingServer: false,
      env: { FIXTURE_PORT: '48834' },
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:48833/',
      reuseExistingServer: false,
      env: {
        APP_BASE_PATH: '/',
        BACKEND_INTERNAL_URL: 'http://127.0.0.1:48834',
        DEV_BACKEND_ORIGIN: 'http://127.0.0.1:48834',
        FRONTEND_DEV_PORT: '48833',
      },
    },
  ],
});
