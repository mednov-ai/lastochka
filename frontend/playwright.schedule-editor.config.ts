import config from './playwright.header.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...config,
  testMatch: ['schedule-editor.spec.ts'],
  timeout: 90000,
  use: { ...config.use, timezoneId: 'America/Los_Angeles' },
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: new URL('../artifacts/schedule-editor/browser-results.json', import.meta.url)
          .pathname,
      },
    ],
  ],
});
