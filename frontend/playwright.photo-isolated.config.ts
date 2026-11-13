import { defineConfig } from '@playwright/test';
import base from './playwright.photo.config';

// Synthetic landing and schedule data; no database or external service.
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:48683/' },
  webServer: [
    { command: 'node tests/fixtures/permanent-api.mjs', url: 'http://127.0.0.1:48684/__fixture/state', reuseExistingServer: false, env: { FIXTURE_PORT: '48684' } },
    { command: 'npm run dev', url: 'http://127.0.0.1:48683/', reuseExistingServer: false,
      env: { APP_BASE_PATH: '/', BACKEND_INTERNAL_URL: 'http://127.0.0.1:48684', DEV_BACKEND_ORIGIN: 'http://127.0.0.1:48684', FRONTEND_DEV_PORT: '48683' } },
  ],
});
