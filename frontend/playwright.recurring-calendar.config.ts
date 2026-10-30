import { defineConfig } from '@playwright/test';
import config from './playwright.header.config';
export default defineConfig({
  ...config,
  testMatch: ['recurring-calendar.spec.ts'],
  timeout: 90000,
  use: {
    ...config.use,
    actionTimeout: 10000,
    baseURL: 'http://localhost:18100/lastochka/',
    timezoneId: 'America/Los_Angeles',
  },
  reporter: [
    ['list'],
    ['json', { outputFile: '../artifacts/recurring-calendar/browser-results.json' }],
  ],
});
