import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['alfa-security-settings.spec.ts', 'sensitive-confirmation.spec.ts'],
  workers: 1,
  timeout: 60_000,
  use: { baseURL: process.env.TEST_APP_URL ?? 'http://127.0.0.1:5173/lastochka/' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', locale: 'ru-RU' } },
    { name: 'webkit', use: { browserName: 'webkit', locale: 'en-US' } },
  ],
  reporter: 'line',
});
