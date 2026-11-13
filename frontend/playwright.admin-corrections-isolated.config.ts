import { defineConfig } from '@playwright/test';
import base from './playwright.admin-corrections.config';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:48703/lastochka/' },
  webServer: [
    { command: 'node tests/fixtures/permanent-api.mjs', url: 'http://127.0.0.1:48704/__fixture/state', reuseExistingServer: false, env: { FIXTURE_PORT: '48704' } },
    { command: 'npm run dev', url: 'http://127.0.0.1:48703/lastochka/', reuseExistingServer: false,
      env: { APP_BASE_PATH: '/lastochka', BACKEND_INTERNAL_URL: 'http://127.0.0.1:48704/lastochka', DEV_BACKEND_ORIGIN: 'http://127.0.0.1:48704', FRONTEND_DEV_PORT: '48703' } },
  ],
});
