import { defineConfig } from '@playwright/test';

// Production bundle against synthetic data; run `APP_BASE_PATH=/ npm run build` first.
export default defineConfig({
  testDir: 'tests',
  testMatch: ['landing-ribbon.spec.ts'],
  workers: 1,
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:48893/', locale: 'ru-RU', trace: 'retain-on-failure' },
  projects: (['chromium', 'webkit'] as const).map((browserName) => ({
    name: browserName,
    use: { browserName },
  })),
  reporter: 'line',
  webServer: [
    {
      command: 'node tests/fixtures/ribbon-api.mjs',
      url: 'http://127.0.0.1:48894/__fixture/state',
      reuseExistingServer: false,
      env: { FIXTURE_PORT: '48894' },
    },
    {
      command: 'node server.mjs',
      url: 'http://127.0.0.1:48893/',
      reuseExistingServer: false,
      env: { APP_BASE_PATH: '/', PORT: '48893', BACKEND_INTERNAL_URL: 'http://127.0.0.1:48894' },
    },
  ],
});
