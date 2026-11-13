import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['photo-led-public-design.spec.ts', 'public-redesign.spec.ts'],
  workers: 1,
  timeout: 60_000,
  use: { baseURL: process.env.TEST_APP_URL ?? 'http://127.0.0.1:5179/' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', locale: 'ru-RU' } },
    {
      name: 'webkit',
      use: { browserName: 'webkit', locale: 'en-US', hasTouch: true, isMobile: true },
    },
  ],
  reporter: 'line',
});
