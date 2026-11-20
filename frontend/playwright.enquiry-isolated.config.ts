import { defineConfig } from '@playwright/test';

process.env.ENQUIRY_FIXTURE_URL = 'http://127.0.0.1:48797';
export default defineConfig({
  testDir: 'tests',
  testMatch: ['enquiry-age-directions.spec.ts'],
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:48796/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    (['ru-RU', 'en-US'] as const).map((locale) => ({
      name: `${browserName}-${locale}`,
      use: { browserName, locale },
    })),
  ),
  reporter: [['list']],
  webServer: [
    {
      command: 'node tests/fixtures/enquiry-api.mjs',
      url: 'http://127.0.0.1:48797/__fixture/state',
      reuseExistingServer: true,
      env: { FIXTURE_PORT: '48797' },
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:48796/',
      reuseExistingServer: true,
      env: {
        APP_BASE_PATH: '/',
        BACKEND_INTERNAL_URL: 'http://127.0.0.1:48797',
        DEV_BACKEND_ORIGIN: 'http://127.0.0.1:48797',
        FRONTEND_DEV_PORT: '48796',
      },
    },
  ],
});
