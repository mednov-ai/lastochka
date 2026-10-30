import config from './playwright.header.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({ ...config, testMatch: ['form-focus.spec.ts'] });
