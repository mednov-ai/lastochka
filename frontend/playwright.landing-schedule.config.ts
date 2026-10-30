import config from './playwright.header.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...config,
  testMatch: ['landing-schedule.spec.ts'],
  outputDir: '../artifacts/landing-schedule/integration-results',
  use: { ...config.use, timezoneId: 'America/Los_Angeles' },
  reporter: [['list'], ['json', { outputFile: '../artifacts/landing-schedule/integration.json' }]],
});
