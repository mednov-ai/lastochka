import { defineConfig } from '@playwright/test';
import base from './playwright.permanent.config';

process.env.PERMANENT_FIXTURE_URL = 'http://127.0.0.1:48694';
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:48693/' },
  webServer: [
    { command: 'node tests/fixtures/permanent-api.mjs', url: 'http://127.0.0.1:48694/__fixture/state', reuseExistingServer: false, env: { FIXTURE_PORT: '48694' } },
    { command: 'npm run dev', url: 'http://127.0.0.1:48693/', reuseExistingServer: false,
      env: { APP_BASE_PATH: '/', BACKEND_INTERNAL_URL: 'http://127.0.0.1:48694', DEV_BACKEND_ORIGIN: 'http://127.0.0.1:48694', FRONTEND_DEV_PORT: '48693' } },
  ],
});
