import config from './playwright.header.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...config,
  outputDir: '../artifacts/schedule-layout/test-results',
  testMatch: ['schedule-layout.spec.ts'],
  use: { ...config.use, timezoneId: 'America/Los_Angeles' },
  reporter: [['list'], ['json', { outputFile: '../artifacts/schedule-layout/results.json' }]],
});
