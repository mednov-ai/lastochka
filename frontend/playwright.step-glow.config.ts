import config from './playwright.header.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...config, testMatch: ['step-glow.spec.ts'] });
