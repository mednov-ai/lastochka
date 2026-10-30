import { defineConfig } from '@playwright/test';
import base from './playwright.config';
if (process.env.TEST_APP_URL !== 'https://localhost:5445/lastochka') {
  throw new Error('Public MailHog acceptance requires the isolated local HTTPS stack');
}
export default defineConfig(base, {
  testMatch: [
    'mailhog-public.spec.ts',
    'auth-feedback.spec.ts',
    'calendar-attendance.spec.ts',
    'landing.spec.ts',
    'routing.spec.ts',
  ],
  use: { ignoreHTTPSErrors: true, trace: 'off' },
});
