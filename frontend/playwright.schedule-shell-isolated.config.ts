import { defineConfig } from '@playwright/test';
import base from './playwright.photo-isolated.config';

export default defineConfig({ ...base, testMatch: ['fixed-site-footer.spec.ts', 'fixed-site-header.spec.ts'] });
