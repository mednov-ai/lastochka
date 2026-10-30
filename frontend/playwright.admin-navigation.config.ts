import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'admin-navigation.spec.ts',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:18142/lastochka/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    [375, 1440].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        browserName,
        viewport: { width, height: 900 },
        locale: width === 375 ? 'ru-RU' : 'en-US',
        hasTouch: width === 375,
        reducedMotion: 'reduce' as const,
      },
    })),
  ),
  outputDir: '../artifacts/admin-navigation-20261029/results',
  reporter: [['list']],
});
