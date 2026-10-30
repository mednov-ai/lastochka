import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'admin-entry-upgrade.spec.ts',
  workers: 1,
  timeout: 45000,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  outputDir: '../artifacts/admin-entry/upgrade-results',
});
