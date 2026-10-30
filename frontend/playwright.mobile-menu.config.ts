import config from './playwright.header.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({ ...config, testMatch: ['mobile-menu.spec.ts'], timeout: 90000 });
