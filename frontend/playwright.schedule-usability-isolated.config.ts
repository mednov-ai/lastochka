import { defineConfig } from '@playwright/test';
import base from './playwright.permanent-isolated.config';

export default defineConfig({
  ...base,
  testMatch: ['schedule-usability.spec.ts'],
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ['ru-RU', 'en-US'].map((locale) => ({
      name: `${browserName}-${locale}`,
      use: { browserName, locale, viewport: { width: 1440, height: 900 } },
    })),
  ),
});
