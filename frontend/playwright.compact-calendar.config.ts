import { defineConfig } from '@playwright/test';
import config from './playwright.header.config';
export default defineConfig({
  ...config,
  testMatch: ['compact-calendar.spec.ts'],
  timeout: 90000,
  expect: { timeout: 10000 },
  outputDir: '../artifacts/compact-calendar/results',
  use: {
    ...config.use,
    baseURL: 'http://localhost:18100/lastochka/',
    timezoneId: 'America/Los_Angeles',
    reducedMotion: 'reduce',
    actionTimeout: 10000,
  },
  reporter: [['list'], ['json', { outputFile: '../artifacts/compact-calendar/results.json' }]],
});
